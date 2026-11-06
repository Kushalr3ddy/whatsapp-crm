'use client';

import './import.css';
import Link from 'next/link';
import { useEffect, useRef, useState, useTransition, type CSSProperties } from 'react';
import { Check, Download, Upload } from 'lucide-react';
import { importProblems, numberExamples, runSheet, sheetCsv, sheetRows, uploadSheet } from '@/app/actions';
import type { ImportProblems, ImportRun, ImportSummary, ImportUpload, SheetPage } from '@/lib/crm';
import {
  checkCounts, columnCount, countryOptions, dayText, doneCounts, exampleParts, exampleValues, formatNumber, gapFileName, groupSkipped, isGap, missingDetails, pageList, otherColumns, peekPeople, peopleText, phoneOptionId, phoneOptions, readColumns, sheetColumns,
  skippedCsv, skippedLine, tagFromFile, tagNote, tagProblem, type ColumnChoice, type MissingDetail, type NameChoice, type NumberExample, type PersonPeek, type SkipGroup
} from '@/lib/import';

/** The number campaigns will send from, or null when none is linked. */
export interface SendingNumber { number: string; label: string | null }

/** What the page hands the screen. */
export interface ImportScreenProps {
  /** The first linked number, read on the server. */
  sender: SendingNumber | null;
  /** Files imported before, newest first. */
  earlier: ImportRun[];
  /** The names of the tags that already exist. */
  tags: string[];
}

/** Which screen is showing. */
type Stage = 'start' | 'check' | 'running' | 'done';

/** What the dry run found, kept while the person looks at it. */
interface Checked { summary: ImportSummary; problems: ImportProblems }

/** Where an import in progress is kept, so switching to another tab and back does not lose it. */
const DRAFT_KEY = 'crm.import.draft';

/** What is remembered of an import in progress. The file itself lives on the server, referred to by `upload.id`. */
interface Draft { upload: ImportUpload; choice: ColumnChoice; fileName: string; tag: string; committing: boolean }

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

/** The mapping inputs the server action takes, from the columns the file is read with. */
function colsFor(upload: ImportUpload, choice: ColumnChoice) {
  return {
    phones: choice.phones,
    name: choice.name.kind === 'column' ? choice.name.column : null,
    nameParts: choice.name.kind === 'joined' ? { first: choice.name.first, last: choice.name.last } : null,
    email: choice.email,
    country: choice.country,
    keep: otherColumns(upload.headers, choice)
  };
}

/** Hands the browser a CSV to save. */
function saveCsv(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = fileName; a.click();
  URL.revokeObjectURL(url);
}


/** What the screen is doing while it waits for the server: the step, and what is already known about the file. */
interface Work { step: 'reading' | 'checking'; rows?: number; columns?: number; mobile?: string }

/** Seconds as 0:07, 1:05. */
function clock(seconds: number): string {
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Counts the seconds since it appeared, so a wait never looks like a freeze. */
function useElapsed(): number {
  const [s, setS] = useState(0);
  useEffect(() => {
    const t = setInterval(() => { setS((v) => v + 1); }, 1000);
    return () => { clearInterval(t); };
  }, []);
  return s;
}

/** One line of the list: done, happening now, or still to come. */
function Step({ state, title, detail }: { state: 'done' | 'now' | 'todo'; title: string; detail?: string }) {
  return (
    <li className={`im-step im-${state}`} aria-current={state === 'now' ? 'step' : undefined}>
      <i aria-hidden>{state === 'done' ? <Check /> : state === 'now' ? <span className="im-spin im-tiny" /> : null}</i>
      <span><b>{title}</b>{detail !== undefined && <span className="im-small">{detail}</span>}</span>
    </li>
  );
}

/**
 * The wait after a file is chosen, said step by step. Each step is a real stage of the work: the upload and the reading finish
 * before the check starts, and the lines under them are what the file turned out to hold. The server answers once per stage, not
 * continuously, so there is no percentage and none is made up; the clock shows it is still going.
 */
function Working({ fileName, work }: { fileName: string; work: Work }) {
  const seconds = useElapsed();
  const read = work.step !== 'reading';
  return (
    <div className="im-card im-panel">
      <div className="im-body">
        <div className="im-big">
          <span className="im-spin" aria-hidden />
          <div>
            <h3 role="status">Checking {fileName === '' ? 'your sheet' : fileName}…</h3>
            <p className="im-small">Nothing is saved yet. This is only a check. <span className="im-clock">{clock(seconds)}</span></p>
          </div>
        </div>
        <ol className="im-steps" aria-label="What is happening">
          <Step
            state={read ? 'done' : 'now'} title={read ? 'Read your sheet' : 'Sending and reading your sheet'}
            detail={read && work.rows !== undefined ? `${peopleText(work.rows)} and ${String(work.columns ?? 0)} ${work.columns === 1 ? 'column' : 'columns'}` : 'Every row is read, and an Excel file is converted first.'}
          />
          <Step
            state={read ? 'done' : 'todo'} title="Found the name and mobile number"
            {...(read && work.mobile !== undefined ? { detail: `Numbers are read from “${work.mobile}”.` } : {})}
          />
          <Step
            state={read ? 'now' : 'todo'} title="Checking each person against your contacts"
            detail="Numbers are tidied, and people you already have are matched."
          />
        </ol>
        {seconds >= 15 && <p className="im-small" role="status">Big sheets take a while. You can keep this tab open; nothing is lost if it takes a minute.</p>}
      </div>
    </div>
  );
}

/** What the real import does, in order, shown while it runs. The server reports once, at the end, so these are not ticked off. */
function Saving({ count, tag }: { count: number; tag: string }) {
  const seconds = useElapsed();
  return (
    <div className="im-card im-panel">
      <div className="im-body">
        <div className="im-big">
          <span className="im-spin" role="status" aria-label="Importing" />
          <div>
            <h3>Importing {peopleText(count)}… <span className="im-clock">{clock(seconds)}</span></h3>
            <p className="im-small">Keep this tab open. If you leave, it carries on, and rows already saved are never added twice.</p>
          </div>
        </div>
        <div className="im-bar im-wait" aria-hidden><i /></div>
        <ol className="im-steps" aria-label="What is happening">
          <Step state="now" title="Adding each person to Contacts" detail="People you already have are matched by number and updated, not added twice." />
          {tag !== '' && <Step state="todo" title={`Putting the tag “${tag}” on everyone`} />}
          <Step state="todo" title="Marking the file as imported" detail="So the same file is not imported twice by mistake." />
        </ol>
        {seconds >= 30 && <p className="im-small" role="status">Large sheets take a few minutes. It is still working.</p>}
      </div>
    </div>
  );
}

/** A number that counts up from zero; the real figure is in the page for screen readers and tests. */
function Count({ n }: { n: number }) {
  return (
    <>
      <span aria-hidden className="count" style={{ '--to': n } as CSSProperties} />
      <span className="sr-only">{n}</span>
    </>
  );
}

/**
 * Import: drop a sheet, check what will happen, import it, then message the people.
 *
 * The check is a dry run that starts the moment the file is read, with the columns the server found in it. Nothing is written
 * until the person presses "Import N people". If the file holds more than one column of numbers they say which to message first.
 */
export function ImportScreen({ sender, earlier, tags }: ImportScreenProps) {
  const [stage, setStage] = useState<Stage>('start');
  const [upload, setUpload] = useState<ImportUpload | null>(null);
  const [fileName, setFileName] = useState('');
  const [choice, setChoice] = useState<ColumnChoice | null>(null);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [tag, setTag] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [showRows, setShowRows] = useState(false);
  const [done, setDone] = useState<{ summary: ImportSummary; tag: string } | null>(null);
  // The notes at the top of Start: the same file again, a file with no mobile column, anything else that went wrong.
  const [dup, setDup] = useState(false);
  const [noPhone, setNoPhone] = useState<{ file: string; headers: string[] } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [resumed, setResumed] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [work, setWork] = useState<Work | null>(null);
  const [pending, startTransition] = useTransition();
  const lastFile = useRef<File | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);

  // Come back to where the import was left (switching tabs unmounts this page).
  useEffect(() => {
    const draft = loadDraft();
    if (draft === null) return;
    saveDraft(null);
    // A commit was running when the page was left: say so, and let the person see how far it got in Contacts.
    if (draft.committing) { setResumed(true); return; }
    setUpload(draft.upload); setFileName(draft.fileName); setChoice(draft.choice); setTag(draft.tag);
    startTransition(async () => { await check(draft.upload, draft.choice); });
  }, []);

  // Remember an unfinished import. A finished or empty one is forgotten.
  useEffect(() => {
    if (upload === null || choice === null || (stage !== 'check' && stage !== 'running')) return;
    saveDraft({ upload, choice, fileName, tag, committing: stage === 'running' });
  }, [upload, choice, fileName, tag, stage]);

  // A hard reload or closing the tab mid-run would lose the answer: ask first.
  useEffect(() => {
    if (!pending) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => { window.removeEventListener('beforeunload', warn); };
  }, [pending]);

  // Keyboard and screen-reader users land on the new screen's heading when it changes.
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    heading.current?.focus();
  }, [stage]);

  /** Back to the drop box. */
  function reset() {
    setStage('start'); setUpload(null); setChoice(null); setChecked(null); setTag(''); setFileName(''); setEditOpen(false);
    setShowRows(false); setDone(null); setDup(false); setNoPhone(null); setNote(null); setResumed(false);
    saveDraft(null); lastFile.current = null;
  }

  /** Runs the dry run with these columns and shows the check. */
  async function check(u: ImportUpload, c: ColumnChoice) {
    setNote(null);
    setWork({ step: 'checking', rows: u.rowCount, columns: u.headers.length, ...(c.phones[0] !== undefined ? { mobile: c.phones[0] } : {}) });
    try {
      const result = await runSheet(u.id, colsFor(u, c), true);
      if (!result.ok || result.summary === undefined) {
        setStage('start'); setUpload(null); setChoice(null); setSignedOut(result.signedOut === true);
        setNote(result.error ?? 'We couldn’t check this file. Try uploading it again.');
        return;
      }
      const problems = result.summary.errors > 0 ? await importProblems(u.id) : { errors: [], warnings: [] };
      setChecked({ summary: result.summary, problems });
      setChoice(c); setEditOpen(false); setShowRows(false); setStage('check');
    } catch {
      // The browser lost the server mid-way. Nothing was saved by a check, so the person can simply try again.
      setStage('start'); setUpload(null); setChoice(null);
      setNote('We lost the connection while checking the file. Nothing was saved. Check your connection and upload it again.');
    } finally {
      setWork(null);
    }
  }

  /** Uploads a file the person chose or dropped, then checks it. `force` is only set by "Import it again". */
  function chooseFile(file: File, force = false) {
    lastFile.current = file;
    setFileName(file.name); setDup(false); setNoPhone(null); setNote(null); setResumed(false);
    const form = new FormData();
    form.set('file', file);
    if (force) form.set('force', '1');
    setSignedOut(false);
    setWork({ step: 'reading' });
    startTransition(async () => {
      try {
        const result = await uploadSheet(form);
        if (!result.ok || result.upload === undefined) {
          if (result.duplicate === true) setDup(true);
          else { setSignedOut(result.signedOut === true); setNote(result.error ?? 'We couldn’t read that file.'); }
          return;
        }
        const u = result.upload;
        if (u.rowCount === 0) {
          setNote('This file has no rows to import. It needs the column names on the first row and at least one person under them.');
          return;
        }
        const reading = readColumns(u);
        if (reading.kind === 'no-phone') { setNoPhone({ file: file.name, headers: reading.headers }); return; }
        setUpload(u); setTag(tagFromFile(file.name)); setChoice(reading.choice); setChecked(null);
        // Two columns of numbers: the person says which to message before anything is checked.
        if (reading.kind === 'pick') { setEditOpen(true); setStage('check'); return; }
        await check(u, reading.choice);
      } catch {
        setNote('We lost the connection while sending the file. Nothing was saved. Check your connection and try again.');
      } finally {
        setWork(null);
      }
    });
  }

  /** Writes the people for real. */
  function importNow() {
    if (upload === null || choice === null) return;
    // The tag is how these people are found later: no tag, no import. Take the person to the box instead of failing silently.
    if (tagProblem(tag) !== null) { document.getElementById('im-tag')?.focus(); return; }
    setStage('running');
    startTransition(async () => {
      try {
        const result = await runSheet(upload.id, colsFor(upload, choice), false, tag);
        if (!result.ok || result.summary === undefined) {
          setStage('check'); setSignedOut(result.signedOut === true);
          setNote(result.error ?? 'The import didn’t finish. Nothing is added twice if you try again.');
          return;
        }
        saveDraft(null);
        setDone({ summary: result.summary, tag: tag.trim() });
        setStage('done');
      } catch {
        // The answer was lost, not necessarily the work: part or all of the file may be saved already.
        setStage('check');
        setNote('We lost the connection before the import reported back. Some of it may already be saved. Open Contacts to see how far it got; pressing Import again never adds anyone twice.');
      }
    });
  }

  const counts = checked === null ? null : checkCounts(checked.summary);
  const skipped = checked === null || choice === null ? null : groupSkipped(checked.problems, choice, checked.summary.errors);

  return (
    <div className="im im-app">
      {sender !== null ? (
        <div className="im-sendfrom">
          <span className="im-st im-ok"><i />Linked</span>
          <span>Campaigns will send from <span className="im-ph">{formatNumber(sender.number)}</span>{sender.label !== null && sender.label !== '' ? ` (${sender.label})` : ''}</span>
        </div>
      ) : (
        <div className="im-hint">
          <span><b>No WhatsApp number is linked yet.</b> You can import now; link a number before you message them.</span>
          <span className="im-acts"><Link href="/link" className="im-btn im-sm">Link a number</Link></span>
        </div>
      )}

      {note !== null && (
        <div className="im-hint" role="alert">
          <span>{note}</span>
          {signedOut && <span className="im-acts"><Link href="/login?next=/import" className="im-btn im-sm">Sign in</Link></span>}
        </div>
      )}
      {resumed && (
        <div className="im-hint im-in" role="status">
          <span>An import was running when you left this page. Open Contacts to see how far it got. Rows already saved are never added twice.</span>
          <span className="im-acts"><Link href="/contacts" className="im-btn im-sm">Open Contacts</Link></span>
        </div>
      )}

      {work !== null && <Working fileName={fileName} work={work} />}

      {stage === 'start' && work === null && (
        <Start
          earlier={earlier} pending={pending} fileName={fileName} dup={dup} noPhone={noPhone}
          onFile={(f) => { chooseFile(f); }}
          onAgain={() => { if (lastFile.current !== null) chooseFile(lastFile.current, true); }}
        />
      )}

      {stage === 'check' && work === null && upload !== null && choice !== null && (
        <div className="im-card im-panel">
          <div className="im-body">
            <h2 ref={heading} tabIndex={-1} className="sr-only">Check the file</h2>
            <p className="im-small"><b style={{ color: 'var(--ink)', fontWeight: 600 }}>{fileName}</b> · {upload.rowCount} rows · {upload.headers.length} columns</p>
            {checked === null ? (
              <ColumnEditor
                key="pick" upload={upload} choice={choice} title={`This file has ${columnCount(choice.phones.length)} phone columns`}
                onUse={(c) => { startTransition(async () => { await check(upload, c); }); }} busy={pending}
              />
            ) : counts !== null && skipped !== null && (
              <div className="im-ccols">
                <div className="im-sec">
                  {counts.ready > 0 ? (
                    <div className="im-big">
                      <span className="im-ico"><Check aria-hidden /></span>
                      <div><h3>{peopleText(counts.ready)} ready to import</h3><p className="im-small">{(checked?.summary.withoutNumber ?? 0) > 0 ? `${peopleText(checked?.summary.withoutNumber ?? 0)} ${(checked?.summary.withoutNumber ?? 0) === 1 ? 'has' : 'have'} an email but no mobile number: they come in, but you can’t message them. ` : 'Each has a mobile number. '}Nothing is saved yet.</p></div>
                    </div>
                  ) : (
                    <div className="im-hint"><span><b>Nobody in this file has a mobile number we can use.</b> Fix the numbers in your sheet and upload it again.</span></div>
                  )}
                  <div className="im-tiles">
                    <div className="im-tile im-ok"><span className="im-v"><Count n={counts.fresh} /></span><span className="im-l">New</span><span className="im-s">Added to your contacts</span></div>
                    <div className="im-tile"><span className="im-v"><Count n={counts.existing} /></span><span className="im-l">Already in your contacts</span><span className="im-s">Matched by number. They get this file’s tag; nobody is added twice.</span></div>
                    <div className="im-tile im-mu"><span className="im-v"><Count n={counts.skipped} /></span><span className="im-l">Skipped</span><span className="im-s">{skipped.groups.every((g) => g.reason === 'no_number') ? 'No mobile number to message' : 'No mobile number we can message'}</span></div>
                  </div>
                  {counts.existing > 0 && (
                    <div className="im-info im-blue">
                      <b>{peopleText(counts.existing)} {counts.existing === 1 ? 'is' : 'are'} already in your contacts</b>
                      <span className="im-small" style={{ color: 'var(--ink)' }}>
                        They keep everything they have and get the tag <b>{tag.trim() === '' ? 'you choose' : tag.trim()}</b> next to their other tags. A different name or detail in this file replaces the old one; a blank never erases anything, and anything new is added.
                      </span>
                    </div>
                  )}
                  {counts.skipped > 0 && (
                    <SkippedCard
                      total={counts.skipped} groups={skipped.groups} unlisted={skipped.unlisted} open={showRows}
                      onToggle={() => { setShowRows((v) => !v); }}
                      onDownload={() => { saveCsv(skippedCsv(skipped.groups.flatMap((g) => g.rows), upload.headers), 'skipped-rows.csv'); }}
                    />
                  )}
                </div>
                <div className="im-sec">
                  <div className={`im-card im-tagcard${tagProblem(tag) === null ? '' : ' im-bad'}`}>
                    <span className="im-tagtop"><label htmlFor="im-tag" className="im-label">Tag</label><span className="im-req">required</span></span>
                    <p className="im-small">Everyone in this file gets this tag. It is how you find them later, in Contacts and when you start a campaign.</p>
                    <input
                      id="im-tag" className="im-in" value={tag} maxLength={60} required aria-required="true"
                      aria-invalid={tagProblem(tag) !== null} aria-describedby="im-tag-note" onChange={(e) => { setTag(e.target.value); }}
                    />
                    <p id="im-tag-note" className={`im-small${tagProblem(tag) === null ? '' : ' im-err'}`} role={tagProblem(tag) === null ? undefined : 'alert'}>{tagNote(tag, tags)}</p>
                  </div>
                  {editOpen ? (
                    <ColumnEditor
                      key="change" upload={upload} choice={choice} title="Name and mobile number" busy={pending}
                      onClose={() => { setEditOpen(false); }}
                      onUse={(c) => { startTransition(async () => { await check(upload, c); }); }}
                    />
                  ) : (
                    <ReadCard
                      upload={upload} choice={choice}                       onChange={() => { setEditOpen(true); }}
                    />
                  )}
                </div>
              </div>
            )}
            {checked !== null && (
              <SheetCard key={upload.id} upload={upload} choice={choice} missing={missingDetails(upload, choice)} />
            )}
            {checked !== null && <PeopleCard people={peekPeople(upload, choice)} />}
          </div>
          <div className="im-foot">
            <button type="button" className="im-btn im-g" onClick={reset}>Choose another file</button>
            <div className="im-r">
              {checked === null ? (
                <span className="im-small">Pick one, then press Use these.</span>
              ) : (
                <>
                  <span className="im-small im-tagline" aria-live="polite">
                    {tagProblem(tag) === null ? <>Tag: <b>{tag.trim()}</b></> : 'Name the tag to import'}
                  </span>
                  <button
                    type="button" className="im-btn im-p" aria-describedby="im-tag-note" aria-busy={pending}
                    disabled={pending || counts === null || counts.ready === 0 || tagProblem(tag) !== null} onClick={importNow}
                  >
                    Import {counts === null ? '' : peopleText(counts.ready)}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {stage === 'running' && counts !== null && <Saving count={counts.ready} tag={tag.trim()} />}

      {stage === 'done' && done !== null && upload !== null && counts !== null && (
        <DoneCard
          id={upload.id} summary={done.summary} tag={done.tag} linked={sender !== null} skipped={skipped?.groups ?? []}
          headers={upload.headers} heading={heading} onAnother={reset}
        />
      )}
    </div>
  );
}

/** The first screen: the drop box, what a sheet needs, and the files imported before. */
function Start({ earlier, pending, fileName, dup, noPhone, onFile, onAgain }: {
  earlier: ImportRun[]; pending: boolean; fileName: string; dup: boolean; noPhone: { file: string; headers: string[] } | null;
  onFile: (file: File) => void; onAgain: () => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <>
      {dup && (
        <div className="im-hint" role="status">
          <span><b>You uploaded this exact file before.</b> Importing it again adds nobody twice: people are matched by number, nothing they already have is lost, and this import replaces the earlier one in your file list.</span>
          <span className="im-acts"><button type="button" className="im-btn im-sm im-p" onClick={onAgain}>Import it again</button></span>
        </div>
      )}
      {noPhone !== null && (
        <div className="im-hint" role="alert">
          <span>
            <b>{noPhone.file} has no mobile number column.</b> Its columns are {listOf(noPhone.headers)}. Add a column with each person’s mobile number and upload it again.
          </span>
        </div>
      )}
      <div className="im-card im-panel">
        <div className="im-body">
          <div className="im-cols">
            <label
              className={`im-drop${over ? ' im-over' : ''}`} aria-busy={pending}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => { setOver(false); }}
              onDrop={(e) => {
                e.preventDefault(); setOver(false);
                const f = e.dataTransfer.files[0];
                if (f !== undefined && !pending) onFile(f);
              }}
            >
              <Upload aria-hidden />
              <b>{pending ? `Reading ${fileName}…` : 'Drop your sheet here'}</b>
              <span className="im-small">{pending ? 'Checking the columns and who is already in your contacts.' : 'or click to choose a file. CSV or Excel (.xlsx), one person per row.'}</span>
              <input
                type="file" name="file" className="sr-only" disabled={pending}
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f !== undefined) onFile(f);
                }}
              />
            </label>
            <div className="im-sec">
              <h3>Your sheet needs</h3>
              <ul className="im-need">
                <li><i><Check aria-hidden /></i><span>A <b>name</b> column</span></li>
                <li><i><Check aria-hidden /></i><span>A <b>mobile number</b> column</span></li>
                <li><i><Check aria-hidden /></i><span>Column names in the <b>first row</b></span></li>
              </ul>
              <p className="im-small">That is enough. Other columns are optional and come in as they are.</p>
            </div>
          </div>
          {earlier.length > 0 && (
            <>
              <hr className="im-div" />
              <div className="im-sec">
                <h3>Earlier files</h3>
                <div className="im-list">
                  {earlier.slice(0, 5).map((r, i) => (
                    <div key={r.id} className="im-it row-in" style={{ '--i': i } as CSSProperties}>
                      <div className="im-m"><b>{r.filename ?? 'Untitled file'}</b><span className="im-small">{dayText(r.createdAt)} · {peopleText(r.contactCount)}</span></div>
                      <Link className="im-btn im-sm" href={`/broadcast/new?import=${r.id}`}>Message them</Link>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/** "Name, Email, City and Company". */
function listOf(items: readonly string[], word = 'and'): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${word} ${items[items.length - 1] ?? ''}`;
}

/** The skipped rows, grouped by why, with the rows themselves one press away and a download to fix them in Excel. */
function SkippedCard({ total, groups, unlisted, open, onToggle, onDownload }: {
  total: number; groups: SkipGroup[]; unlisted: number; open: boolean; onToggle: () => void; onDownload: () => void;
}) {
  return (
    <div className="im-card im-skip">
      <div className="im-top">
        <b>Why {total} {total === 1 ? 'was' : 'were'} skipped</b>
        <span className="im-acts">
          <button type="button" className="im-btn im-sm im-g" aria-expanded={open} onClick={onToggle}>{open ? 'Hide rows' : 'Show rows'}</button>
          <button type="button" className="im-btn im-sm" onClick={onDownload}><Download aria-hidden />Download</button>
        </span>
      </div>
      <div className="im-list">
        {groups.map((g, i) => (
          <div key={g.reason} className="im-it row-in" style={{ '--i': i } as CSSProperties}>
            <div className="im-m">
              <b>{g.count} · {g.title}</b>
              {open && <span>{g.rows.slice(0, 8).map((r) => skippedLine(r)).join(' · ')}{g.rows.length > 8 ? ` · and ${String(g.rows.length - 8)} more` : ''}</span>}
            </div>
          </div>
        ))}
        {unlisted > 0 && <div className="im-it"><div className="im-m"><span className="im-small">{unlisted} more, with the same kinds of reasons, are not listed here.</span></div></div>}
      </div>
      <span className="im-small">You don’t have to do anything. To add them later, fix the number in your sheet and import it again.</span>
    </div>
  );
}

/** How many detail chips show before "and N more". */
const SHOWN_CHIPS = 10;

/** A count with thousands separators. */
const num = (n: number): string => n.toLocaleString('en-IN');

/** How many people one page of the table shows. */
const SHEET_PAGE = 25;

/**
 * Your sheet as a small read-only table, before anything is imported: every column, as the file has it, a page at a time. The
 * ticked details narrow it to the people who lack them (any or all of them), a search narrows it further, and one button
 * downloads everyone it shows, not only this page, as a sheet to fill in and import again. Nothing here changes the file.
 */
function SheetCard({ upload, choice, missing }: { upload: ImportUpload; choice: ColumnChoice; missing: MissingDetail[] }) {
  // The details ticked as chips, and whether a person must lack any or all of them.
  const [sel, setSel] = useState<string[]>([]);
  const [mode, setMode] = useState<'any' | 'all'>('any');
  const [allChips, setAllChips] = useState(false);
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [data, setData] = useState<SheetPage | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [failed, setFailed] = useState('');
  const [fetching, setFetching] = useState(false);
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const ticket = useRef(0);
  const cols = sheetColumns(upload.headers, choice);
  // A column nobody filled in is one line, not a chip: it says "this whole column is empty", which is a different thing to know.
  const empty = missing.filter((m) => m.blank >= upload.rowCount);
  const partial = missing.filter((m) => m.blank < upload.rowCount);
  // A ticked detail never hides behind "and N more".
  const chips = allChips ? partial : partial.filter((m, i) => i < SHOWN_CHIPS || sel.includes(m.header));
  const toggle = (h: string): void => { setSel((cur) => (cur.includes(h) ? cur.filter((x) => x !== h) : [...cur, h])); };

  // The page belongs to the filter it was chosen under: a new filter starts on page one without a second fetch.
  const filterKey = JSON.stringify([sel, mode, q]);
  const [at, setAt] = useState({ key: filterKey, page: 0 });
  const page = at.key === filterKey ? at.page : 0;

  // A typed search waits a moment, so each key press is not a request.
  useEffect(() => {
    const t = setTimeout(() => { setQ(typed); }, 250);
    return () => { clearTimeout(t); };
  }, [typed]);

  useEffect(() => {
    const mine = ++ticket.current;
    setFetching(true);
    void (async () => {
      try {
        const r = await sheetRows(upload.id, { missing: sel, mode, q }, page * SHEET_PAGE, SHEET_PAGE);
        if (mine !== ticket.current) return;
        if (r.ok) { setData(r.data); setStatus('ready'); } else { setFailed(r.error); setStatus('error'); }
      } catch {
        if (mine !== ticket.current) return;
        setFailed('We lost the connection. Nothing was changed.'); setStatus('error');
      } finally {
        if (mine === ticket.current) setFetching(false);
      }
    })();
    // The filter is read through its key so an unchanged filter does not refetch on every render.
  }, [upload.id, filterKey, page, retry]);

  const total = data?.total ?? 0;
  const first = total === 0 ? 0 : page * SHEET_PAGE + 1;
  const last = Math.min(total, (page + 1) * SHEET_PAGE);
  const pages = Math.ceil(total / SHEET_PAGE);

  /** Hands over everyone the filter keeps, not only the page on screen. */
  async function download(): Promise<void> {
    setSaving(true); setSaveError(null);
    try {
      const r = await sheetCsv(upload.id, { missing: sel, mode, q });
      if (r.ok) saveCsv(r.data.csv, gapFileName(sel));
      else setSaveError(r.error);
    } catch {
      setSaveError('We lost the connection. Try the download again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="im-card im-gap im-sheetcard">
      <b>People in your sheet</b>
      <p className="im-small">
        {sel.length === 0
          ? `${num(upload.rowCount)} ${upload.rowCount === 1 ? 'person' : 'people'}, as they are in your file. You can only look here; nothing in your file changes.`
          : <>Only the people who lack {sel.length > 1 && mode === 'all' ? 'all of ' : sel.length > 1 ? 'any of ' : ''}{listOf(sel, mode === 'all' ? 'and' : 'or')}. <button type="button" className="im-link im-inl" onClick={() => { setSel([]); }}>Show everyone</button></>}
      </p>
      {missing.length === 0 ? (
        <p className="im-small">Nothing is missing: every person has every detail filled in.</p>
      ) : (
        <fieldset className="im-flt">
          <legend className="im-small">Show only the people who lack a detail (the number is how many):</legend>
          {chips.map((m) => (
            <label key={m.header} className={`im-fc${sel.includes(m.header) ? ' im-on' : ''}`} title={`${String(m.blank)} of ${String(upload.rowCount)} people have none`}>
              <input type="checkbox" checked={sel.includes(m.header)} onChange={() => { toggle(m.header); }} />
              <span className="im-cn">{m.header}</span>{' '}
              <span className="im-n">{num(m.blank)}</span>
            </label>
          ))}
          {(allChips || partial.length > chips.length) && partial.length > SHOWN_CHIPS && (
            <button type="button" className="im-link im-more" aria-expanded={allChips} onClick={() => { setAllChips((v) => !v); }}>
              {allChips ? 'Show fewer' : `and ${String(partial.length - chips.length)} more details`}
            </button>
          )}
        </fieldset>
      )}
      {empty.length > 0 && (
        <p className="im-small">
          <b style={{ color: 'var(--ink)', fontWeight: 500 }}>Empty for everyone ({empty.length} {empty.length === 1 ? 'column' : 'columns'}):</b>{' '}
          {empty.slice(0, 4).map((m) => m.header).join(', ')}{empty.length > 4 ? ` and ${String(empty.length - 4)} more` : ''}
        </p>
      )}
      {sel.length > 1 && (
        <fieldset className="im-mode">
          <legend className="sr-only">Which people to show</legend>
          <label><input type="radio" name="im-mode" checked={mode === 'any'} onChange={() => { setMode('any'); }} />Lack any of these</label>
          <label><input type="radio" name="im-mode" checked={mode === 'all'} onChange={() => { setMode('all'); }} />Lack all of these</label>
        </fieldset>
      )}
      <div className="im-tool">
        <label className="sr-only" htmlFor="im-sq">Search every column</label>
        <input id="im-sq" type="search" className="im-in" placeholder="Search every column" value={typed} maxLength={100} onChange={(e) => { setTyped(e.target.value); }} />
        <button type="button" className="im-btn im-sm" disabled={saving || status !== 'ready' || total === 0} aria-busy={saving} onClick={() => { void download(); }}>
          <Download aria-hidden />{status === 'ready' && total > 0 ? `Download ${peopleText(total)}` : 'Download'}
        </button>
      </div>
      {saveError !== null && <p className="im-small" role="alert" style={{ color: 'var(--bd)' }}>{saveError}</p>}

      {status === 'error' && (
        <div className="im-hint" role="alert">
          <span>{failed}</span>
          <span className="im-acts"><button type="button" className="im-btn im-sm" onClick={() => { setRetry((n) => n + 1); }}>Try again</button></span>
        </div>
      )}
      {status === 'loading' && <p className="im-small" role="status">Loading your sheet…</p>}
      {status === 'ready' && data !== null && (
        total === 0 ? (
          <p className="im-small" role="status">{q.trim() !== '' ? 'Nobody matches that search.' : sel.length > 0 ? 'Nobody lacks that. Everyone has it filled in.' : 'The sheet has nobody in it.'}</p>
        ) : (
          <>
            <div className="im-sheet" role="region" aria-label="People in your sheet. Scrolls sideways." tabIndex={0} aria-busy={fetching}>
              <table>
                <thead>
                  <tr>
                    <th scope="col" className="im-rowh">Row</th>
                    {cols.map((h) => <th key={h} scope="col" title={h} className={sel.includes(h) ? 'im-pick' : undefined}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.row}>
                      <th scope="row" className="im-rowh">{r.row}</th>
                      {cols.map((h) => {
                        const v = r.values[h] ?? '';
                        return isGap(v)
                          ? <td key={h} className={`im-gapc${sel.includes(h) ? ' im-pick' : ''}`}><span aria-label="empty">—</span></td>
                          : <td key={h} title={v}>{v}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="im-pager">
              <span className="im-small" role="status">Showing {num(first)}–{num(last)} of {num(total)}. Row numbers are the sheet’s own.</span>
              {pages > 1 && (
                <nav className="im-pages" aria-label="Pages of your sheet">
                  <button type="button" className="im-btn im-sm" disabled={page === 0 || fetching} onClick={() => { setAt({ key: filterKey, page: page - 1 }); }}>Previous</button>
                  {pageList(page + 1, pages).map((p, i) => (p === '…'
                    ? <span key={`gap${String(i)}`} className="im-dots" aria-hidden>…</span>
                    : (
                      <button
                        key={p} type="button" className="im-btn im-sm im-pg" disabled={fetching && p !== page + 1}
                        aria-label={`Page ${String(p)}`} aria-current={p === page + 1 ? 'page' : undefined}
                        onClick={() => { setAt({ key: filterKey, page: p - 1 }); }}
                      >{p}</button>
                    )))}
                  <button type="button" className="im-btn im-sm" disabled={page + 1 >= pages || fetching} onClick={() => { setAt({ key: filterKey, page: page + 1 }); }}>Next</button>
                </nav>
              )}
            </div>
          </>
        )
      )}
    </div>
  );
}

/** How many details a person shows before "Show all". */
const SHOWN_FIELDS = 6;

/** A few people picked at random from the file, with everything the file says about them. */
function PeopleCard({ people }: { people: PersonPeek[] }) {
  if (people.length === 0) return null;
  return (
    <div className="im-card im-gap">
      <b>A few people from your file</b>
      <p className="im-small">Picked at random, from rows {listOf(people.map((p) => String(p.row)))}. Look at them to be sure the columns were read right.</p>
      <div className="im-people">{people.map((p) => <Person key={p.row} person={p} />)}</div>
    </div>
  );
}

/** One person: the name, their details, and what they lack. */
function Person({ person }: { person: PersonPeek }) {
  const [all, setAll] = useState(false);
  const fields = all ? person.fields : person.fields.slice(0, SHOWN_FIELDS);
  return (
    <div className="im-person">
      <div className="im-ptop"><b>{person.name === '' ? 'No name' : person.name}</b><span className="im-small">Row {person.row}</span></div>
      <dl className="im-pf">
        {fields.map((f) => <div key={f.header}><dt title={f.header}>{f.header}</dt><dd>{f.value}</dd></div>)}
      </dl>
      {person.fields.length > SHOWN_FIELDS && (
        <button type="button" className="im-link im-more" aria-expanded={all} onClick={() => { setAll((v) => !v); }}>
          {all ? 'Show fewer' : `Show all ${String(person.fields.length)} details`}
        </button>
      )}
      {person.missing.length > 0 && (
        <p className="im-small im-pmiss">
          <b>Missing:</b> {person.missing.slice(0, 5).join(', ')}{person.missing.length > 5 ? ` and ${String(person.missing.length - 5)} more` : ''}
        </p>
      )}
    </div>
  );
}

/** How many of the other columns are named before "and N more". */
const SHOWN_COLUMNS = 6;

/** How the file was read, with a Change button. */
function ReadCard({ upload, choice, onChange }: { upload: ImportUpload; choice: ColumnChoice; onChange: () => void }) {
  const [all, setAll] = useState(false);
  // The first people's numbers as the import will save them; until they arrive (or if they cannot), the cells as typed.
  const [examples, setExamples] = useState<Record<string, NumberExample[]> | null>(null);
  const exKey = JSON.stringify([upload.id, choice.phones, choice.country]);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const r = await numberExamples(upload.id, choice.phones, choice.country);
        if (live && r.ok) setExamples(Object.fromEntries(r.data.columns.map((c) => [c.column, c.examples])));
      } catch { /* the cells as typed stay on screen */ }
    })();
    return () => { live = false; };
    // Read through the key so the same columns and country do not refetch on every render.
  }, [exKey]);
  const others = otherColumns(upload.headers, choice);
  const shown = all ? others : others.slice(0, SHOWN_COLUMNS);
  const country = countryOptions().find((c) => c.code === choice.country)?.label ?? choice.country;
  return (
    <div className="im-card im-read">
      <div className="im-top"><span className="im-cap">How the file was read</span><button type="button" className="im-btn im-sm" onClick={onChange}>Change</button></div>
      <dl className="im-dl">
        <div className="im-rd"><dt>Name</dt><dd>{nameText(choice.name)}</dd></div>
        <div className="im-rd">
          <dt>Mobile</dt>
          <dd>
            {choice.phones.map((p) => (
              <span key={p} className="im-ph-line">
                <b>{p}</b>
                {examples?.[p] === undefined
                  ? <span className="im-ex">{exampleValues(upload.sample, p)}</span>
                  : (
                    <span className="im-exl">
                      {(examples[p] ?? []).map((e, i) => (
                        <span key={i} className="im-exr">
                          {exampleParts(e).map((part, j) => (
                            <span key={j} className={`im-exp im-${part.kind}`}>{part.kind === 'dropped' ? `“${part.text}” can’t be read` : part.text}</span>
                          ))}
                        </span>
                      ))}
                    </span>
                  )}
              </span>
            ))}
          </dd>
        </div>
        <div className="im-rd"><dt>Country</dt><dd>Numbers without a country code are read as {country}</dd></div>
        <div className="im-rd">
          <dt>Other columns</dt>
          <dd>
            {others.length === 0 ? 'None' : (
              <>
                <span className="im-small">{others.length === 1 ? '1 column comes in as it is, as an extra detail.' : `${String(others.length)} columns come in as they are, as extra details.`}</span>
                <span className="im-chips">
                  {shown.map((h) => <span key={h} className="im-chip" title={h}>{h}</span>)}
                  {others.length > SHOWN_COLUMNS && (
                    <button type="button" className="im-link im-more" aria-expanded={all} onClick={() => { setAll((v) => !v); }}>
                      {all ? 'Show fewer' : `and ${String(others.length - SHOWN_COLUMNS)} more`}
                    </button>
                  )}
                </span>
              </>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** The name column(s) in words. */
function nameText(name: NameChoice): string {
  if (name.kind === 'column') return name.column;
  if (name.kind === 'joined') return `${name.first} + ${name.last}, joined`;
  return 'No name column';
}

const NAME_JOIN = '⁣join';
const NAME_NONE = '⁣none';

/**
 * Change columns: which column is the name (or two joined), which number column to message, and the country for numbers without a
 * code. Nothing else; every other column is kept.
 */
function ColumnEditor({ upload, choice, title, busy, onUse, onClose }: {
  upload: ImportUpload; choice: ColumnChoice; title: string; busy: boolean; onUse: (c: ColumnChoice) => void; onClose?: () => void;
}) {
  const options = phoneOptions(upload, choice);
  const [phoneId, setPhoneId] = useState(phoneOptionId(options, choice.phones));
  const initialName = choice.name.kind === 'column' ? choice.name.column : choice.name.kind === 'joined' ? NAME_JOIN : NAME_NONE;
  const [nameValue, setNameValue] = useState(initialName);
  const [first, setFirst] = useState(choice.name.kind === 'joined' ? choice.name.first : upload.headers[0] ?? '');
  const [last, setLast] = useState(choice.name.kind === 'joined' ? choice.name.last : upload.headers[1] ?? '');
  const [country, setCountry] = useState(choice.country);
  const countries = countryOptions();

  const name: NameChoice = nameValue === NAME_NONE ? { kind: 'none' }
    : nameValue === NAME_JOIN ? { kind: 'joined', first, last } : { kind: 'column', column: nameValue };
  const phones = options.find((o) => o.id === phoneId)?.phones ?? choice.phones;
  // A column cannot be both a number and a name.
  const clash = (name.kind === 'column' && phones.includes(name.column))
    || (name.kind === 'joined' && (first === last || phones.includes(first) || phones.includes(last)));

  return (
    <div className="im-edit" aria-label="Columns">
      <div className="im-top">
        <h3>{title}</h3>
        {onClose !== undefined && <button type="button" className="im-btn im-sm im-g" onClick={onClose}>Done</button>}
      </div>
      <fieldset className="im-fs">
        <legend>Which one should we message?</legend>
        {options.map((o) => (
          <label key={o.id} className={`im-pcol${o.id === phoneId ? ' im-on' : ''}`}>
            <input type="radio" name="im-phone" checked={o.id === phoneId} onChange={() => { setPhoneId(o.id); }} />
            <span className="im-m"><b>{o.label}</b><span>{o.examples}</span></span>
          </label>
        ))}
      </fieldset>
      <div className="im-frow">
        <label htmlFor="im-name">Name</label>
        <select id="im-name" className="im-in" value={nameValue} onChange={(e) => { setNameValue(e.target.value); }}>
          {upload.headers.map((h) => <option key={h} value={h}>{h}</option>)}
          <option value={NAME_JOIN}>First name + last name, joined</option>
          <option value={NAME_NONE}>No name column</option>
        </select>
        {nameValue === NAME_JOIN && (
          <>
            <label htmlFor="im-first">First name</label>
            <select id="im-first" className="im-in" value={first} onChange={(e) => { setFirst(e.target.value); }}>
              {upload.headers.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
            <label htmlFor="im-last">Last name</label>
            <select id="im-last" className="im-in" value={last} onChange={(e) => { setLast(e.target.value); }}>
              {upload.headers.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </>
        )}
        <label htmlFor="im-country">No country code</label>
        <select id="im-country" className="im-in" value={country} onChange={(e) => { setCountry(e.target.value); }}>
          {countries.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
        </select>
      </div>
      {clash && <p className="im-small" role="alert">A column can’t be both the name and a number. Pick a different one.</p>}
      <p className="im-small">Every other column comes in as it is, as extra details on each person. You choose what to use from them later, in a template or a campaign.</p>
      <div>
        <button
          type="button" className="im-btn im-p im-sm" disabled={busy || clash} aria-busy={busy}
          onClick={() => { onUse({ phones, name, email: choice.email, country }); }}
        >
          Use these
        </button>
      </div>
    </div>
  );
}

/** The result: who is in your contacts now, and the way on to a campaign. */
function DoneCard({ id, summary, tag, linked, skipped, headers, heading, onAnother }: {
  id: string; summary: ImportSummary; tag: string; linked: boolean; skipped: SkipGroup[]; headers: string[];
  heading: React.RefObject<HTMLHeadingElement | null>; onAnother: () => void;
}) {
  const counts = doneCounts(summary);
  const rows = skipped.flatMap((g) => g.rows);
  return (
    <div className="im-card im-panel">
      <div className="im-body">
        <div className="im-big">
          <span className="im-ico"><Check aria-hidden /></span>
          <div>
            <h3 ref={heading} tabIndex={-1}>{peopleText(counts.ready)} {counts.ready === 1 ? 'is' : 'are'} in your contacts</h3>
            <p className="im-small">
              {counts.fresh} new and {counts.existing} already there{tag !== '' && <>, all tagged <b style={{ color: 'var(--ink)' }}>{tag}</b></>}.
              {counts.skipped > 0 && <> {counts.skipped} {counts.skipped === 1 ? 'row was' : 'rows were'} skipped.</>}
            </p>
          </div>
        </div>
        <div className="im-next">
          <h4>Message them now</h4>
          <p className="im-small" style={{ color: 'var(--ink)' }}>Opens New campaign with these {counts.ready} people picked. Choose a template and press Start.</p>
          <div className="im-row">
            {linked
              ? <Link className="im-btn im-p" href={`/broadcast/new?import=${id}`}>Start a campaign</Link>
              : <Link className="im-btn im-p" href="/link">Link a number first</Link>}
          </div>
          {!linked && <span className="im-small">A campaign needs a linked number to send from.</span>}
        </div>
      </div>
      <div className="im-foot">
        <Link href={`/contacts?file=${id}`} className="im-btn im-g">View them in Contacts</Link>
        <div className="im-r">
          {rows.length > 0 && (
            <button type="button" className="im-btn im-sm im-g" onClick={() => { saveCsv(skippedCsv(rows, headers), 'skipped-rows.csv'); }}><Download aria-hidden />Skipped rows</button>
          )}
          <button type="button" className="im-btn" onClick={onAnother}>Import another file</button>
        </div>
      </div>
    </div>
  );
}
