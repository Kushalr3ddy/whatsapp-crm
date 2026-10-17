'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { uploadSheet, runSheet, importProblems } from '@/app/actions';
import type { ImportUpload, ImportSummary, ImportProblems } from '@/lib/crm';

/** Fallback guess from the header name alone, for an older server that sends no value-based suggestion. */
function guess(headers: string[], patterns: RegExp): string | null {
  return headers.find((h) => patterns.test(h)) ?? null;
}

/** Where an unfinished import is kept, so switching to another tab and back does not lose it. */
const DRAFT_KEY = 'crm.import.draft';

/** What is remembered of an import in progress. The file itself lives on the server, referred to by `upload.id`. */
interface Draft {
  upload: ImportUpload; phone: string; name: string; email: string; tagName: string; keep?: string[];
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
  const [upload, setUpload] = useState<ImportUpload | null>(null);
  const [phone, setPhone] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [summary, setSummary] = useState<{ result: ImportSummary; committed: boolean } | null>(null);
  // Optional: tag everyone this file creates or updates (the tag is created if new).
  const [tagName, setTagName] = useState('');
  // Extra columns to keep on each contact (as fields). None are ticked until the person chooses.
  const [keep, setKeep] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Rows that failed or lost something in the last preview or commit, shown in a box to fix.
  const [problems, setProblems] = useState<ImportProblems | null>(null);
  const [pending, startTransition] = useTransition();
  const [fileName, setFileName] = useState('');
  // Set when the server says this exact file was uploaded before; shows the "Upload anyway" button.
  const [duplicate, setDuplicate] = useState(false);
  // Said once when the page comes back with a commit that was running when the person left it.
  const [resumed, setResumed] = useState(false);

  // Come back to where the import was left (switching tabs unmounts this page).
  useEffect(() => {
    const draft = loadDraft();
    if (draft === null) return;
    setUpload(draft.upload); setPhone(draft.phone); setName(draft.name); setEmail(draft.email);
    setTagName(draft.tagName); setKeep(draft.keep ?? []); setSummary(draft.summary);
    if (draft.committing && draft.summary?.committed !== true) setResumed(true);
    // The rows-to-fix box is not remembered, it is asked for again.
    const sm = draft.summary?.result;
    if (sm !== undefined && (sm.errors > 0 || (sm.warnings ?? 0) > 0)) {
      void importProblems(draft.upload.id).then(setProblems);
    }
  }, []);

  // Remember each change. Runs only once there is an upload to remember.
  useEffect(() => {
    if (upload === null) return;
    saveDraft({ upload, phone, name, email, tagName, keep, summary, committing: false });
  }, [upload, phone, name, email, tagName, keep, summary]);

  // A hard reload or closing the tab mid-run would lose the answer: ask first.
  useEffect(() => {
    if (!pending) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => { window.removeEventListener('beforeunload', warn); };
  }, [pending]);

  /** Sends the chosen file, then pre-fills the column pickers from the headers. */
  function submitUpload(formData: FormData) {
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
      const h = result.upload.headers;
      const suggested = result.upload.suggestions;
      setUpload(result.upload);
      setProblems(null);
      // The server looked at the values; the header name is only the fallback.
      setPhone(suggested?.phone ?? guess(h, /phone|mobile|number|contact|whatsapp/i) ?? h[0] ?? '');
      setName(suggested?.name ?? guess(h, /name/i) ?? '');
      setEmail(suggested?.email ?? guess(h, /e-?mail/i) ?? '');
      setKeep([]);
      // Everyone in a file is tagged with the file's name unless the person clears or changes it.
      setTagName(fileName.replace(/\.[^.]+$/, '').replace(/[_\s]+/g, '-').slice(0, 60));
    });
  }

  /** Previews (dry run) or commits the mapping. */
  function go(dryRun: boolean) {
    if (upload === null || phone === '') return;
    setError(null);
    setResumed(false);
    // Note a commit as running, so coming back mid-run can say so.
    if (!dryRun) saveDraft({ upload, phone, name, email, tagName, keep, summary, committing: true });
    startTransition(async () => {
      const result = await runSheet(
        upload.id,
        { phone, name: name === '' ? null : name, email: email === '' ? null : email },
        dryRun,
        tagName,
        keep
      );
      if (!result.ok || result.summary === undefined) {
        setError(result.error ?? 'Run failed.');
        return;
      }
      setSummary({ result: result.summary, committed: !dryRun });
      // Written directly as well: if the person left the page, this answer still lands in the draft.
      saveDraft({ upload, phone, name, email, tagName, keep, summary: { result: result.summary, committed: !dryRun }, committing: false });
      // Anything that failed or lost a number is listed so it can be fixed in the sheet.
      const found = (result.summary.errors > 0 || (result.summary.warnings ?? 0) > 0)
        ? await importProblems(upload.id) : null;
      setProblems(found);
    });
  }

  /** Clears everything back to the file picker for another import. */
  function reset() {
    setUpload(null); setSummary(null); setError(null); setProblems(null);
    setPhone(''); setName(''); setEmail(''); setKeep([]); setTagName('');
    setFileName(''); setResumed(false); saveDraft(null);
    if (fileRef.current !== null) fileRef.current.value = '';
  }

  return (
    <div className="page page-narrow">
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
        <form action={submitUpload} className="mt-5 flex flex-col gap-3">
          <DropZone inputRef={fileRef} fileName={fileName} onFile={setFileName} />
          <div>
            <button
              type="submit"
              disabled={pending || fileName === ''}
              className="btn btn-primary"
            >
              {pending ? 'Uploading…' : 'Upload'}
            </button>
            {duplicate && (
              <button type="submit" name="force" value="1" disabled={pending || fileName === ''} className="btn ml-2">
                Upload anyway
              </button>
            )}
          </div>
          {duplicate && (
            <p className="text-xs text-muted">
              “Upload anyway” starts a fresh import of the same file. Contacts already in the CRM are matched by phone
              or email and updated, not duplicated.
            </p>
          )}
        </form>
      ) : (
        <div className="mt-5 flex flex-col gap-4">
          <p className="text-sm">
            <span className="font-medium">{upload.rowCount}</span> rows ·{' '}
            <span className="text-muted">{upload.headers.length} columns</span>
          </p>

          <div className="grid grid-cols-[7rem_1fr] items-center gap-x-3 gap-y-2">
            <Picker label="Phone *" value={phone} onChange={setPhone} headers={upload.headers} required />
            <PhoneHint upload={upload} phone={phone} />
            <Picker label="Name" value={name} onChange={setName} headers={upload.headers} />
            <Picker label="Email" value={email} onChange={setEmail} headers={upload.headers} />
          </div>

          <KeepColumns
            headers={upload.headers.filter((h) => h !== phone && h !== name && h !== email)}
            keep={keep} onChange={setKeep}
          />

          <Sample upload={upload} />

          <label className="mb-2 flex flex-col gap-1 text-xs font-medium text-muted">
            Tag everyone in this file (named after the file; clear it to skip)
            <input
              value={tagName} onChange={(e) => { setTagName(e.target.value); }} maxLength={60}
              placeholder="e.g. october-batch" aria-label="Tag everyone in this file"
              className="field font-normal text-ink"
            />
          </label>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { go(true); }}
              disabled={pending || phone === ''}
              className="btn"
            >
              {pending ? 'Working…' : 'Preview'}
            </button>
            <button
              type="button"
              onClick={() => {
                if (summary === null) { setError('Please click Preview first, so you can see what will be imported.'); return; }
                go(false);
              }}
              disabled={pending || phone === '' || summary?.committed === true}
              className="btn btn-primary"
            >
              Import
            </button>
            <button type="button" onClick={reset} className="text-xs text-muted underline underline-offset-2">
              Start over
            </button>
          </div>

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
                {summary.committed && summary.result.tagged !== undefined && (
                  <> · {summary.result.tagged} tagged “{tagName.trim()}”</>
                )}
              </p>
            </div>
          )}
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
function KeepColumns({ headers, keep, onChange }: { headers: string[]; keep: string[]; onChange: (next: string[]) => void }) {
  if (headers.length === 0) return null;
  const toggle = (h: string) => { onChange(keep.includes(h) ? keep.filter((k) => k !== h) : [...keep, h].slice(0, 40)); };
  return (
    <fieldset className="rounded-md border border-border bg-surface px-3 py-2">
      <legend className="px-1 text-xs font-medium text-muted">Keep these columns on each contact (optional, up to 40)</legend>
      <div className="mb-2 flex gap-3 text-xs">
        <button type="button" className="underline underline-offset-2" onClick={() => { onChange(headers.slice(0, 40)); }}>Tick all</button>
        <button type="button" className="underline underline-offset-2" onClick={() => { onChange([]); }}>Clear</button>
        <span className="text-muted">{keep.length} ticked</span>
      </div>
      <div className="grid max-h-56 grid-cols-1 gap-x-4 gap-y-1 overflow-y-auto text-sm sm:grid-cols-2">
        {headers.map((h) => (
          <label key={h} className="flex items-center gap-2">
            <input type="checkbox" checked={keep.includes(h)} onChange={() => { toggle(h); }} />
            <span className="truncate" title={h}>{h}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * A line under the Phone picker saying how well the chosen column looks like phone numbers.
 * Occupies the grid's second column; renders nothing when the server sent no profile (older API).
 */
function PhoneHint({ upload, phone }: { upload: ImportUpload; phone: string }) {
  const profile = upload.columns?.find((c) => c.header === phone);
  if (profile === undefined || profile.sampled === 0) return null;
  const pct = Math.round(profile.phoneShare * 100);
  const poor = profile.phoneShare < 0.5;
  return (
    <>
      <span aria-hidden />
      <p
        role={poor ? 'alert' : undefined}
        className={`-mt-1 text-xs ${poor ? 'text-danger' : 'text-muted'}`}
      >
        {poor
          ? `Only ${String(pct)}% of the values in "${phone}" look like phone numbers. Is this the right column?`
          : `${String(pct)}% of the values in "${phone}" look like phone numbers.`}
      </p>
    </>
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

/** One labelled column dropdown. The Phone picker offers no blank option; Name/Email may be none. */
function Picker(
  { label, value, onChange, headers, required }:
  { label: string; value: string; onChange: (v: string) => void; headers: string[]; required?: boolean }
) {
  return (
    <>
      <label className="text-xs font-medium text-muted">{label}</label>
      <select
        value={value}
        onChange={(e) => { onChange(e.target.value); }}
        className="field field-sm"
      >
        {required !== true && <option value="">— none —</option>}
        {headers.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
    </>
  );
}

/** A tiny preview of the first sampled rows, so the mapping is checked against real values. */
function Sample({ upload }: { upload: ImportUpload }) {
  if (upload.sample.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-left text-xs">
        <thead className="bg-surface text-muted">
          <tr>{upload.headers.map((h) => <th key={h} className="px-2 py-1 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {upload.sample.map((row, i) => (
            <tr key={i} className="border-t border-border">
              {upload.headers.map((h) => <td key={h} className="truncate px-2 py-1">{row[h]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
