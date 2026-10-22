'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { uploadSheet, runSheet, importProblems } from '@/app/actions';
import type { ImportUpload, ImportSummary, ImportProblems } from '@/lib/crm';
import { isPersonalColumn } from '@/lib/personal-columns';
import { joinNamePreview } from '@/lib/join-name';

/** The value of the name dropdown that means "join a first-name and a last-name column". */
const JOIN = '__join__';

/** Fallback guess from the header name alone, for an older server that sends no value-based suggestion. */
function guess(headers: string[], patterns: RegExp): string | null {
  return headers.find((h) => patterns.test(h)) ?? null;
}

/** Where an unfinished import is kept, so switching to another tab and back does not lose it. */
const DRAFT_KEY = 'crm.import.draft';

/** What is remembered of an import in progress. The file itself lives on the server, referred to by `upload.id`. */
interface Draft {
  upload: ImportUpload; phone: string; phones?: string[]; name: string; first?: string; last?: string; skipPersonal?: boolean; email: string; tagName: string; keep?: string[]; fileName?: string;
  summary: { result: ImportSummary; committed: boolean } | null;
  /** Set while a commit is running, cleared when its answer arrives. */
  committing: boolean;
}

/** Reads the saved draft; null when there is none or storage is blocked. */
function loadDraft(): Draft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw === null ? null : JSON.parse(raw) as Draft;
  } catch { return null; }
}

/** Saves the draft, or clears it with null. Never throws: blocked storage only means no memory. */
function saveDraft(draft: Draft | null): void {
  try {
    if (draft === null) sessionStorage.removeItem(DRAFT_KEY);
    else sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch { /* blocked storage: the import still works, it just is not remembered */ }
}

/**
 * The file picker: a large box to drop a file onto, or click to browse.
 *
 * The real `<input type="file">` stays in the page (visually hidden) so keyboard users, screen
 * readers and tests reach it exactly as before; the box is its label.
 */
function DropZone({ inputRef, fileName, onFile }: {
  inputRef: React.RefObject<HTMLInputElement | null>; fileName: string; onFile: (name: string) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => { setOver(false); }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const dropped = e.dataTransfer.files;
        if (dropped.length === 0 || inputRef.current === null) return;
        inputRef.current.files = dropped;
        onFile(dropped[0]?.name ?? '');
      }}
      className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
        over ? 'border-accent bg-accent-soft' : 'border-border bg-surface hover:border-accent'}`}
    >
      <span className="text-3xl" aria-hidden>⬆</span>
      <span className="font-medium">
        {fileName !== '' ? fileName : 'Drop your file here, or click to choose one'}
      </span>
      <span className="text-xs text-muted">CSV or Excel (.xlsx)</span>
      <input
        ref={inputRef}
        type="file"
        name="file"
        accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        onChange={(e) => { onFile(e.target.files?.[0]?.name ?? ''); }}
      />
    </label>
  );
}

/**
 * The import flow: upload a CSV or .xlsx, say which column is the phone (and optionally name and
 * email), preview what would happen, then commit.
 *
 * The phone column is required — a contact with nothing to reach them by is not a contact. The
 * preview is a dry run: it writes nothing and reports counts, so a commit is never a surprise.
 */
export function ImportPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [upload, setUpload] = useState<ImportUpload | null>(null);
  // Every column that holds a phone number, in the order they are tried.
  const [phones, setPhones] = useState<string[]>([]);
  const phone = phones[0] ?? '';
  // The name: one column, or JOIN for a first-name column plus a last-name column.
  const [name, setName] = useState<string>('');
  const [first, setFirst] = useState<string>('');
  const [last, setLast] = useState<string>('');
  // While on, columns that look like personal data cannot be kept on a contact.
  const [skipPersonal, setSkipPersonal] = useState(true);
  const [email, setEmail] = useState<string>('');
  const [summary, setSummary] = useState<{ result: ImportSummary; committed: boolean } | null>(null);
  // Optional: tag everyone this file creates or updates (the tag is created if new).
  const [tagName, setTagName] = useState('');
  // Extra columns to keep on each contact (as fields). None are ticked until the person chooses.
  const [keep, setKeep] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Set when Import is pressed before Preview; shown right under the buttons, where the person is looking.
  const [needPreview, setNeedPreview] = useState(false);
  // Rows that failed or lost something in the last preview or commit, shown in a box to fix.
  const [problems, setProblems] = useState<ImportProblems | null>(null);
  const [pending, startTransition] = useTransition();
  const [fileName, setFileName] = useState('');
  // Set when the server says this exact file was uploaded before; shows the "Upload anyway" button.
  const [duplicate, setDuplicate] = useState(false);
  // React empties the file box once a form action finishes, so the last file is kept here for "Upload anyway".
  const lastFile = useRef<File | null>(null);
  // Said once when the page comes back with a commit that was running when the person left it.
  const [resumed, setResumed] = useState(false);

  // Come back to where the import was left (switching tabs unmounts this page).
  useEffect(() => {
    const draft = loadDraft();
    if (draft === null) return;
    // A finished import is done: coming back to this page starts clean, not on the old result.
    if (draft.summary?.committed === true) { saveDraft(null); return; }
    setUpload(draft.upload); setPhones(draft.phones ?? (draft.phone === '' ? [] : [draft.phone])); setName(draft.name);
    setFirst(draft.first ?? ''); setLast(draft.last ?? ''); setSkipPersonal(draft.skipPersonal ?? true); setEmail(draft.email);
    setTagName(draft.tagName); setKeep(draft.keep ?? []); setFileName(draft.fileName ?? ''); setSummary(draft.summary);
    if (draft.committing) setResumed(true);
    // The rows-to-fix box is not remembered, it is asked for again.
    const sm = draft.summary?.result;
    if (sm !== undefined && (sm.errors > 0 || (sm.warnings ?? 0) > 0)) {
      void importProblems(draft.upload.id).then(setProblems);
    }
  }, []);

  // Remember each change. Runs only once there is an upload to remember.
  useEffect(() => {
    if (upload === null) return;
    saveDraft({ upload, phone, phones, name, first, last, skipPersonal, email, tagName, keep, fileName, summary, committing: false });
  }, [upload, phones, name, first, last, skipPersonal, email, tagName, keep, fileName, summary]);

  // A hard reload or closing the tab mid-run would lose the answer: ask first.
  useEffect(() => {
    if (!pending) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => { window.removeEventListener('beforeunload', warn); };
  }, [pending]);

  /** Sends the chosen file, then pre-fills the column pickers from the headers. */
  function submitUpload(formData: FormData) {
    const picked = formData.get('file');
    if (picked instanceof File && picked.size > 0) lastFile.current = picked;
    else if (lastFile.current !== null) formData.set('file', lastFile.current);
    // The file's own name, not the `fileName` state: a file picked a moment ago has not reached state yet.
    const uploadedName = lastFile.current?.name ?? fileName;
    setError(null);
    setDuplicate(false);
    setSummary(null);
    startTransition(async () => {
      const result = await uploadSheet(formData);
      if (!result.ok || result.upload === undefined) {
        setError(result.error ?? 'Upload failed.');
        setDuplicate(result.duplicate === true);
        return;
      }
      if (result.upload.rowCount === 0) {
        setError('This file has no rows to import. It needs a header row on top and at least one row of people under it.');
        return;
      }
      const h = result.upload.headers;
      const suggested = result.upload.suggestions;
      setUpload(result.upload);
      setProblems(null);
      // The server looked at the values; the header name is only the fallback.
      setPhones([suggested?.phone ?? guess(h, /phone|mobile|number|contact|whatsapp/i) ?? h[0] ?? ''].filter((c) => c !== ''));
      // A sheet with separate first-name and last-name columns defaults to joining them.
      const firstGuess = guess(h, /^first.?name$|^given.?name$/i);
      const lastGuess = guess(h, /^last.?name$|^sur.?name$|^family.?name$/i);
      setFirst(firstGuess ?? ''); setLast(lastGuess ?? '');
      setName(firstGuess !== null && lastGuess !== null ? JOIN : suggested?.name ?? guess(h, /name/i) ?? '');
      setEmail(suggested?.email ?? guess(h, /e-?mail/i) ?? '');
      setKeep([]);
      // Everyone in a file is tagged with the file's name unless the person clears or changes it.
      setFileName(uploadedName);
      setTagName(uploadedName.replace(/\.[^.]+$/, '').replace(/[_\s]+/g, '-').slice(0, 60));
    });
  }

  /** The kept columns that will really be saved: personal-looking ones are dropped while the protection is on. */
  const keepStored = keep.filter((h) => !(skipPersonal && isPersonalColumn(h)));

  /** Previews (dry run) or commits the mapping. */
  function go(dryRun: boolean) {
    if (upload === null || phone === '') return;
    setError(null);
    setNeedPreview(false);
    setResumed(false);
    // Note a commit as running, so coming back mid-run can say so.
    if (!dryRun) saveDraft({ upload, phone, phones, name, first, last, skipPersonal, email, tagName, keep, fileName, summary, committing: true });
    startTransition(async () => {
      const result = await runSheet(
        upload.id,
        {
          phones,
          name: name === '' || name === JOIN ? null : name,
          nameParts: name === JOIN && first !== '' && last !== '' ? { first, last } : null,
          email: email === '' ? null : email
        },
        dryRun,
        tagName,
        keepStored
      );
      if (!result.ok || result.summary === undefined) {
        setError(result.error ?? 'Run failed.');
        return;
      }
      setSummary({ result: result.summary, committed: !dryRun });
      // Written directly as well: if the person left the page, this answer still lands in the draft.
      saveDraft({ upload, phone, phones, name, first, last, skipPersonal, email, tagName, keep, fileName, summary: { result: result.summary, committed: !dryRun }, committing: false });
      // Anything that failed or lost a number is listed so it can be fixed in the sheet.
      const found = (result.summary.errors > 0 || (result.summary.warnings ?? 0) > 0)
        ? await importProblems(upload.id) : null;
      setProblems(found);
    });
  }

  /** Clears everything back to the file picker for another import. */
  function reset() {
    setUpload(null); setSummary(null); setError(null); setNeedPreview(false); setProblems(null);
    setPhones([]); setName(''); setFirst(''); setLast(''); setEmail(''); setKeep([]); setTagName('');
    setFileName(''); setResumed(false); saveDraft(null); lastFile.current = null;
    if (fileRef.current !== null) fileRef.current.value = '';
  }

  return (
    <div className="page page-wide">
      <h1 className="page-title">Import contacts</h1>
      <p className="page-desc">
        Upload a CSV or Excel (.xlsx) sheet. The same file is not imported twice — re-uploading
        identical bytes is refused with a pointer to the original.
      </p>

      <ol className="mt-6 grid grid-cols-3 gap-2 text-sm" aria-label="Import steps">
        {['Upload', 'Match columns', 'Review & import'].map((label, i) => {
          const current = upload === null ? 0 : summary === null ? 1 : 2;
          const state = i < current ? 'done' : i === current ? 'now' : 'todo';
          return (
            <li
              key={label}
              aria-current={state === 'now' ? 'step' : undefined}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${
                state === 'now' ? 'border-accent bg-accent-soft font-semibold text-accent'
                : state === 'done' ? 'border-transparent bg-success-soft text-success'
                : 'border-border text-muted'}`}
            >
              <span className="avatar size-6 bg-transparent text-xs" aria-hidden>{state === 'done' ? '✓' : i + 1}</span>
              <span className="truncate">{label}</span>
            </li>
          );
        })}
      </ol>

      {error !== null && (
        <p className="mt-4 notice notice-danger">
          {error}
        </p>
      )}

      {resumed && (
        <p role="status" className="mt-4 notice notice-warning">
          An import was running when you left this page. Check the Contacts page to see how far it got,
          or press Preview to see what is still waiting. Rows already imported are not added twice.
        </p>
      )}

      {upload === null ? (
        <form ref={formRef} action={submitUpload} className="mt-5 flex flex-col gap-3">
          {/* Choosing or dropping a file uploads it straight away; there is no separate Upload button. */}
          <DropZone
            inputRef={fileRef} fileName={fileName}
            onFile={(picked) => {
              setFileName(picked);
              if (picked !== '') formRef.current?.requestSubmit();
            }}
          />
          {pending && <p role="status" className="text-sm text-muted">Reading {fileName}…</p>}
          {duplicate && (
            <div>
              <button type="submit" name="force" value="1" disabled={pending || fileName === ''} className="btn">
                Upload anyway
              </button>
            </div>
          )}
          {duplicate && (
            <p className="text-xs text-muted">
              “Upload anyway” starts a fresh import of the same file. Contacts already in the CRM are matched by phone
              or email and updated, not duplicated.
            </p>
          )}
        </form>
      ) : (
        <div className="mt-5">
         <div className="rounded-xl border border-border bg-surface px-5 sm:px-6">
          <section className="py-4" aria-label="The file">
            <p className="text-base">
              <span className="font-semibold">{upload.rowCount}</span> rows ·{' '}
              <span className="text-muted">{upload.headers.length} columns{fileName !== '' ? ` · ${fileName}` : ''}</span>
            </p>
          </section>

          <hr className="border-border" />
          <section className="py-4" aria-label="Phone columns">
            <h2 className="text-base font-semibold">Which columns hold phone numbers?</h2>
            <p className="mb-2 text-sm text-muted">
              Tick every column that has a number. If a person has more than one, we try them in this order.
            </p>
            <PhoneColumns upload={upload} phones={phones} onChange={setPhones} />
          </section>

          <hr className="border-border" />
          <section className="py-4" aria-label="Name and email">
            <h2 className="mb-2 text-base font-semibold">Name and email</h2>
            <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-[15px]">
              <label htmlFor="import-name" className="text-muted">Name from</label>
              <select id="import-name" value={name} onChange={(e) => { setName(e.target.value); }} className="field w-full">
                <option value="">— none —</option>
                <option value={JOIN}>First name + Last name (joined)</option>
                {upload.headers.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
              {name === JOIN && (
                <>
                  <label htmlFor="import-first" className="text-muted">First name</label>
                  <select id="import-first" value={first} onChange={(e) => { setFirst(e.target.value); }} className="field w-full">
                    <option value="">— choose —</option>
                    {upload.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                  <label htmlFor="import-last" className="text-muted">Last name</label>
                  <select id="import-last" value={last} onChange={(e) => { setLast(e.target.value); }} className="field w-full">
                    <option value="">— choose —</option>
                    {upload.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </>
              )}
              <label htmlFor="import-email" className="text-muted">Email</label>
              <select id="import-email" value={email} onChange={(e) => { setEmail(e.target.value); }} className="field w-full">
                <option value="">— none —</option>
                {upload.headers.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
            {name === JOIN && (
              <p className="mt-2 text-sm text-muted">
                Names are joined as they are written, never shortened: Anita and Sharma become Anita Sharma. Only if the
                first name is already a single letter is it joined with a dot: a and sharma become a.sharma.
              </p>
            )}
          </section>

          <hr className="border-border" />
          <section className="py-4" aria-label="Columns to store">
            <h2 className="text-lg font-semibold">Select the columns to be stored</h2>
            <p className="mb-2 text-sm text-muted">
              Tick what you want saved on each person. Columns you leave unticked are not stored on the contact.
            </p>
            <KeepColumns
              headers={upload.headers.filter((h) => !phones.includes(h) && h !== name && h !== first && h !== last && h !== email)}
              keep={keep} onChange={setKeep} skipPersonal={skipPersonal}
            />
            <label className="mt-3 flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={skipPersonal} onChange={(e) => { setSkipPersonal(e.target.checked); }} />
              Never store columns marked personal (you can untick this)
            </label>
          </section>

          <hr className="border-border" />
          <section className="py-4" aria-label="Preview of the import">
            <Sample
              upload={upload} fileName={fileName}
              columns={[
                ...phones.map((h, i) => ({ key: h, label: phones.length > 1 ? `Phone ${String(i + 1)}` : 'Phone', value: (row: Record<string, string>) => row[h] ?? '' })),
                ...(name === JOIN
                  ? [{ key: JOIN, label: 'Name', value: (row: Record<string, string>) => joinNamePreview(row[first] ?? '', row[last] ?? '') }]
                  : name !== '' ? [{ key: name, label: 'Name', value: (row: Record<string, string>) => row[name] ?? '' }] : []),
                ...(email !== '' ? [{ key: email, label: 'Email', value: (row: Record<string, string>) => row[email] ?? '' }] : []),
                ...keepStored.map((h) => ({ key: h, label: h, value: (row: Record<string, string>) => row[h] ?? '' }))
              ]}
            />
          </section>

          <hr className="border-border" />
          <section className="py-4" aria-label="Tag and import">
            <label className="mb-3 flex flex-col gap-1 text-xs font-medium text-muted">
              Tag everyone in this file (named after the file; clear it to skip)
              <input
                value={tagName} onChange={(e) => { setTagName(e.target.value); }} maxLength={60}
                placeholder="e.g. october-batch" aria-label="Tag everyone in this file"
                className="field font-normal text-ink"
              />
            </label>

            <p className="mb-2 text-sm text-muted">
              <strong>Preview</strong> checks your file and shows who is new and who is already in your book. It saves nothing.
              {summary === null && ' The Import button appears once you have run a preview.'}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => { go(true); }}
                disabled={pending || phone === ''}
                className="btn"
              >
                {pending ? 'Working…' : 'Preview'}
              </button>
              {summary !== null && (
                <button
                  type="button"
                  onClick={() => { go(false); }}
                  disabled={pending || phone === '' || summary.committed}
                  className="btn btn-primary"
                >
                  {pending ? 'Working…' : 'Import'}
                </button>
              )}
              <button type="button" onClick={reset} className="text-xs text-muted underline underline-offset-2">
                Start over
              </button>
            </div>
            {needPreview && summary === null && (
              <p role="alert" className="notice notice-danger mt-3 text-base font-semibold">
                Click Preview first, so you can see what will be imported before it is saved.
              </p>
            )}
          </section>
         </div>

         <div className="mt-4 flex flex-col gap-3">
          {summary !== null && problems !== null && (
            <ProblemBox problems={problems} phoneColumn={phone} headers={upload.headers} committed={summary.committed} />
          )}

          {summary !== null && (
            <div className={[
              'rounded-md border px-3 py-2 text-sm',
              summary.committed ? 'border-transparent bg-success-soft' : 'border-border bg-surface'
            ].join(' ')}>
              <p className="font-medium">
                {summary.committed ? '✓ Imported' : 'Preview (nothing written yet)'}
              </p>
              <p className="mt-0.5 text-muted">
                {summary.result.read} read · {summary.result.created} contacts{' '}
                {summary.committed ? 'created' : 'would be created'} · {summary.result.updated} updated ·{' '}
                {summary.result.errors} errors
                {!summary.committed && summary.result.updated > 0 && (
                  <span className="mt-1 block rounded bg-warning-soft px-2 py-1 text-warning">
                    {summary.result.updated} {summary.result.updated === 1 ? 'person is' : 'people are'} already in your book and will be updated (their name and details are overwritten with this file’s).
                  </span>
                )}
                {summary.committed && summary.result.tagged !== undefined && (
                  <> · {summary.result.tagged} tagged “{tagName.trim()}”</>
                )}
              </p>
              {summary.committed && (
                <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="What next">
                  <span className="text-muted">What next?</span>
                  <Link
                    href={summary.result.tagId !== undefined ? `/contacts?tag=${summary.result.tagId}` : '/contacts'}
                    className="btn btn-sm"
                  >
                    View the {summary.result.tagged ?? summary.result.created + summary.result.updated} imported contacts
                  </Link>
                  <Link href={`/broadcast/new?import=${upload.id}`} className="btn btn-sm btn-primary">
                    Message these people
                  </Link>
                </div>
              )}
            </div>
          )}
         </div>
        </div>
      )}
    </div>
  );
}

/**
 * Tick boxes for the other columns in the sheet. A ticked column becomes a field on every contact in the file,
 * shown on the contact's details and searchable; nothing is ticked until the person chooses, so personal data
 * nobody needs is not copied.
 */
function KeepColumns(
  { headers, keep, onChange, skipPersonal }:
  { headers: string[]; keep: string[]; onChange: (next: string[]) => void; skipPersonal: boolean }
) {
  if (headers.length === 0) return null;
  // Personal-looking columns cannot be ticked while the protection is on.
  const locked = (h: string): boolean => skipPersonal && isPersonalColumn(h);
  const tickable = headers.filter((h) => !locked(h));
  const ticked = keep.filter((h) => !locked(h));
  const toggle = (h: string) => { onChange(keep.includes(h) ? keep.filter((k) => k !== h) : [...keep, h].slice(0, 40)); };
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
        <button type="button" className="underline underline-offset-2" onClick={() => { onChange(tickable.slice(0, 40)); }}>Tick all</button>
        <button type="button" className="underline underline-offset-2" onClick={() => { onChange([]); }}>Clear</button>
        <span className="text-muted">{ticked.length} of {headers.length} ticked, up to 40. Scroll for more.</span>
      </div>
      {/* A box of fixed height with its own scrollbar, so a sheet with 80 columns does not push the page down. */}
      <div className="grid max-h-40 grid-cols-1 content-start gap-x-4 gap-y-1.5 overflow-y-auto rounded-md border border-border px-3 py-2 text-[15px] sm:grid-cols-2 lg:grid-cols-3">
        {headers.map((h) => (
          <label key={h} className={`flex items-center gap-2 ${locked(h) ? 'text-muted' : ''}`}>
            <input type="checkbox" checked={!locked(h) && keep.includes(h)} disabled={locked(h)} onChange={() => { toggle(h); }} />
            <span className="truncate" title={h}>{h}</span>
            {isPersonalColumn(h) && <span className="shrink-0 rounded bg-warning-soft px-1.5 py-0.5 text-xs text-warning">personal</span>}
          </label>
        ))}
      </div>
    </div>
  );
}

/**
 * The phone columns: a tick box per likely column (those whose values mostly look like phone numbers, and any already
 * ticked), numbered in the order they will be tried, with a note on how well each one looks like phone numbers. A
 * dropdown adds any other column.
 */
function PhoneColumns(
  { upload, phones, onChange }: { upload: ImportUpload; phones: string[]; onChange: (next: string[]) => void }
) {
  const profile = (h: string) => upload.columns?.find((c) => c.header === h);
  const likely = upload.headers.filter((h) => phones.includes(h) || (profile(h)?.phoneShare ?? 0) >= 0.3);
  const shown = likely.length > 0 ? likely : upload.headers.slice(0, 6);
  const others = upload.headers.filter((h) => !shown.includes(h));
  const toggle = (h: string) => { onChange(phones.includes(h) ? phones.filter((p) => p !== h) : [...phones, h]); };
  return (
    <div className="grid gap-1.5">
      {shown.map((h) => {
        const order = phones.indexOf(h);
        const p = profile(h);
        const pct = p === undefined || p.sampled === 0 ? null : Math.round(p.phoneShare * 100);
        return (
          <label
            key={h}
            className={`flex items-center gap-3 rounded-md border px-3 py-2 text-[15px] ${
              order >= 0 ? 'border-accent bg-accent-soft' : 'border-border'}`}
          >
            <input type="checkbox" checked={order >= 0} onChange={() => { toggle(h); }} />
            <span className="w-5 text-center font-medium text-accent">{order >= 0 ? order + 1 : '–'}</span>
            <span className="min-w-0 truncate" title={h}>{h}</span>
            {pct !== null && (
              <span className="ml-auto shrink-0 text-xs text-muted">
                {pct >= 50 ? `${String(pct)}% of the values look like phone numbers` : `only ${String(pct)}% look like phone numbers`}
              </span>
            )}
          </label>
        );
      })}
      {others.length > 0 && (
        <select
          aria-label="Add another column that holds phone numbers" value=""
          onChange={(e) => { if (e.target.value !== '') onChange([...phones, e.target.value]); }}
          className="field mt-1 w-full sm:w-72"
        >
          <option value="">Another column holds numbers…</option>
          {others.map((h) => <option key={h} value={h}>{h}</option>)}
        </select>
      )}
      {phones.length === 0 && <p className="text-sm text-danger">Pick at least one column with phone numbers.</p>}
    </div>
  );
}

/** Spreadsheet row number: the ledger counts data rows, and the sheet's first row is the header. */
const sheetRow = (rowNumber: number): number => rowNumber + 1;

/** How many problem rows to list before saying "and N more". */
const SHOWN = 8;

/**
 * A small box listing the rows that could not be imported, or lost a number, so the person can
 * correct the sheet and upload it again rather than discover the gap later. Plain words, the value
 * as typed, and the row to find it on.
 */
function ProblemBox(
  { problems, phoneColumn, headers, committed }:
  { problems: ImportProblems; phoneColumn: string; headers: string[]; committed: boolean }
) {
  const { errors, warnings } = problems;
  if (errors.length === 0 && warnings.length === 0) return null;
  const typed = (raw: Record<string, string> | null): string => raw?.[phoneColumn] ?? '';
  return (
    <div
      role="alert" aria-label="Rows to fix"
      className={`rounded-md border px-3 py-2 text-sm ${errors.length > 0 ? 'border-danger' : 'border-border'}`}
    >
      {errors.length > 0 && (
        <>
          <p className="mb-1 font-semibold text-danger">Invalid numbers found, please check these rows.</p>
          <p className="font-medium">
            {errors.length} {errors.length === 1 ? 'row' : 'rows'} couldn’t be imported
            {committed ? ' and ' + (errors.length === 1 ? 'was' : 'were') + ' left out' : ''}: a number or email in
            {errors.length === 1 ? ' it' : ' them'} isn’t readable.
          </p>
          <p className="mt-0.5 text-muted">
            {committed
              ? 'Correct them in your sheet and upload it again to add them.'
              : 'Correct them in your sheet and upload it again, or import the rest as they are.'}
          </p>
          <ul className="mt-2 flex flex-col gap-1 text-xs">
            {errors.slice(0, SHOWN).map((e) => (
              <li key={e.rowNumber}>
                <span className="font-medium">Row {sheetRow(e.rowNumber)}</span>
                {typed(e.raw) !== '' && <> · “{typed(e.raw)}”</>} · <span className="text-muted">{e.error}</span>
              </li>
            ))}
            {errors.length > SHOWN && <li className="text-muted">…and {errors.length - SHOWN} more.</li>}
          </ul>
        </>
      )}
      {warnings.length > 0 && (
        <div className={errors.length > 0 ? 'mt-3' : ''}>
          <p className="font-medium">
            {warnings.length} {warnings.length === 1 ? 'row' : 'rows'}{' '}
            {committed ? (warnings.length === 1 ? 'was' : 'were') : 'would be'} imported without one of{' '}
            {warnings.length === 1 ? 'its' : 'their'} numbers.
          </p>
          <ul className="mt-2 flex flex-col gap-1 text-xs">
            {warnings.slice(0, SHOWN).map((w) => (
              <li key={w.rowNumber}>
                <span className="font-medium">Row {sheetRow(w.rowNumber)}</span> · <span className="text-muted">{w.note}</span>
              </li>
            ))}
            {warnings.length > SHOWN && <li className="text-muted">…and {warnings.length - SHOWN} more.</li>}
          </ul>
        </div>
      )}
      <RowsFromSheet
        rows={[
          ...errors.map((e) => ({ rowNumber: e.rowNumber, raw: e.raw, problem: e.error })),
          ...warnings.map((w) => ({ rowNumber: w.rowNumber, raw: w.raw, problem: w.note }))
        ].sort((a, b) => a.rowNumber - b.rowNumber)}
        headers={headers} phoneColumn={phoneColumn}
      />
    </div>
  );
}

/** One problem row, with the sheet's own cells so it can be found and fixed. */
interface SheetRow { rowNumber: number; raw: Record<string, string> | null; problem: string }

/** Quotes a value for CSV: wrapped in quotes, with inner quotes doubled. */
const csvCell = (value: string): string => `"${value.replace(/"/g, '""')}"`;

/**
 * The problem rows laid out like the sheet (row number, every column, what is wrong) and a button to
 * download just those rows, so they can be fixed in Excel and uploaded again.
 */
function RowsFromSheet(
  { rows, headers, phoneColumn }: { rows: SheetRow[]; headers: string[]; phoneColumn: string }
) {
  if (rows.length === 0) return null;

  /** Builds a CSV of just these rows, with the sheet's own columns, and hands it to the browser as a download. */
  function download() {
    const lines = [['Sheet row', ...headers, 'Problem'].map(csvCell).join(',')];
    for (const r of rows) {
      lines.push([String(sheetRow(r.rowNumber)), ...headers.map((h) => r.raw?.[h] ?? ''), r.problem].map(csvCell).join(','));
    }
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'rows-to-fix.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted">These rows, as they are in your sheet</p>
        <button type="button" onClick={download} className="btn btn-sm">Download these rows (CSV)</button>
      </div>
      <div className="max-h-64 overflow-auto rounded-md border border-border">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-surface text-muted">
            <tr>
              <th className="px-2 py-1 font-medium">Row</th>
              {headers.map((h) => <th key={h} className="px-2 py-1 font-medium">{h}</th>)}
              <th className="px-2 py-1 font-medium">Problem</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.rowNumber} className="border-t border-border align-top">
                <td className="px-2 py-1 font-medium">{sheetRow(r.rowNumber)}</td>
                {headers.map((h) => (
                  <td key={h} className={`px-2 py-1 ${h === phoneColumn ? 'font-medium text-danger' : ''}`}>
                    {r.raw?.[h] ?? ''}
                  </td>
                ))}
                <td className="px-2 py-1 text-muted">{r.problem}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A tiny preview of the first sampled rows, so the mapping is checked against real values. */
function Sample(
  { upload, fileName, columns }:
  { upload: ImportUpload; fileName: string; columns: Array<{ key: string; label: string; value: (row: Record<string, string>) => string }> }
) {
  if (upload.sample.length === 0 || columns.length === 0) return null;
  return (
    <div>
      <h2 className="text-base font-semibold">Preview of the columns and rows that will be imported</h2>
      <p className="mb-2 text-sm text-muted">
        From {fileName !== '' ? fileName : 'your file'}. Showing {upload.sample.length} of {upload.rowCount} rows.
      </p>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface text-muted">
            <tr>{columns.map((c) => <th key={c.key} className="whitespace-nowrap px-3 py-2 font-medium">{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {upload.sample.map((row, i) => (
              <tr key={i} className="border-t border-border">
                {columns.map((c) => <td key={c.key} className="whitespace-nowrap px-3 py-2">{c.value(row)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
