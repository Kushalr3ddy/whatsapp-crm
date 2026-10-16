'use client';

import { useRef, useState, useTransition } from 'react';
import { uploadSheet, runSheet, importProblems } from '@/app/actions';
import type { ImportUpload, ImportSummary, ImportProblems } from '@/lib/crm';

/** Fallback guess from the header name alone, for an older server that sends no value-based suggestion. */
function guess(headers: string[], patterns: RegExp): string | null {
  return headers.find((h) => patterns.test(h)) ?? null;
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
  const [error, setError] = useState<string | null>(null);
  // Rows that failed or lost something in the last preview or commit, shown in a box to fix.
  const [problems, setProblems] = useState<ImportProblems | null>(null);
  const [pending, startTransition] = useTransition();

  /** Sends the chosen file, then pre-fills the column pickers from the headers. */
  function submitUpload(formData: FormData) {
    setError(null);
    setSummary(null);
    startTransition(async () => {
      const result = await uploadSheet(formData);
      if (!result.ok || result.upload === undefined) {
        setError(result.error ?? 'Upload failed.');
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
    });
  }

  /** Previews (dry run) or commits the mapping. */
  function go(dryRun: boolean) {
    if (upload === null || phone === '') return;
    setError(null);
    startTransition(async () => {
      const result = await runSheet(
        upload.id,
        { phone, name: name === '' ? null : name, email: email === '' ? null : email },
        dryRun,
        tagName
      );
      if (!result.ok || result.summary === undefined) {
        setError(result.error ?? 'Run failed.');
        return;
      }
      setSummary({ result: result.summary, committed: !dryRun });
      // Anything that failed or lost a number is listed so it can be fixed in the sheet.
      const found = (result.summary.errors > 0 || (result.summary.warnings ?? 0) > 0)
        ? await importProblems(upload.id) : null;
      setProblems(found);
    });
  }

  /** Clears everything back to the file picker for another import. */
  function reset() {
    setUpload(null); setSummary(null); setError(null); setProblems(null);
    setPhone(''); setName(''); setEmail('');
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

      {upload === null ? (
        <form action={submitUpload} className="mt-5 flex flex-col gap-3">
          <input
            ref={fileRef}
            type="file"
            name="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="field field-sm"
          />
          <div>
            <button
              type="submit"
              disabled={pending}
              className="btn btn-primary"
            >
              {pending ? 'Uploading…' : 'Upload'}
            </button>
          </div>
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

          <Sample upload={upload} />

          <label className="mb-2 flex flex-col gap-1 text-xs font-medium text-muted">
            Tag everyone in this file (optional)
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
              onClick={() => { go(false); }}
              disabled={pending || phone === '' || summary === null || summary.committed}
              className="btn btn-primary"
              title={summary === null ? 'Preview first' : undefined}
            >
              Import
            </button>
            <button type="button" onClick={reset} className="text-xs text-muted underline underline-offset-2">
              Start over
            </button>
          </div>

          {summary !== null && problems !== null && (
            <ProblemBox problems={problems} phoneColumn={phone} committed={summary.committed} />
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
  { problems, phoneColumn, committed }:
  { problems: ImportProblems; phoneColumn: string; committed: boolean }
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
