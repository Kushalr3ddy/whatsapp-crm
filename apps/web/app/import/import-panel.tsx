'use client';

import { useRef, useState, useTransition } from 'react';
import { uploadSheet, runSheet } from '@/app/actions';
import type { ImportUpload, ImportSummary } from '@/lib/crm';

/** Guesses which column holds a field, from its header name — a starting point the user can change. */
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
  const [error, setError] = useState<string | null>(null);
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
      setUpload(result.upload);
      setPhone(guess(h, /phone|mobile|number|contact|whatsapp/i) ?? h[0] ?? '');
      setName(guess(h, /name/i) ?? '');
      setEmail(guess(h, /e-?mail/i) ?? '');
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
        dryRun
      );
      if (!result.ok || result.summary === undefined) {
        setError(result.error ?? 'Run failed.');
        return;
      }
      setSummary({ result: result.summary, committed: !dryRun });
    });
  }

  /** Clears everything back to the file picker for another import. */
  function reset() {
    setUpload(null); setSummary(null); setError(null);
    setPhone(''); setName(''); setEmail('');
    if (fileRef.current !== null) fileRef.current.value = '';
  }

  return (
    <div className="mx-auto max-w-2xl px-5 py-6">
      <h1 className="text-lg font-semibold tracking-tight">Import contacts</h1>
      <p className="mt-1 text-sm text-muted">
        Upload a CSV or Excel (.xlsx) sheet. The same file is not imported twice — re-uploading
        identical bytes is refused with a pointer to the original.
      </p>

      {error !== null && (
        <p className="mt-4 rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">
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
            className="text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm"
          />
          <div>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
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
            <Picker label="Name" value={name} onChange={setName} headers={upload.headers} />
            <Picker label="Email" value={email} onChange={setEmail} headers={upload.headers} />
          </div>

          <Sample upload={upload} />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { go(true); }}
              disabled={pending || phone === ''}
              className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent-soft disabled:opacity-50"
            >
              {pending ? 'Working…' : 'Preview'}
            </button>
            <button
              type="button"
              onClick={() => { go(false); }}
              disabled={pending || phone === '' || summary === null || summary.committed}
              className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
              title={summary === null ? 'Preview first' : undefined}
            >
              Import
            </button>
            <button type="button" onClick={reset} className="text-xs text-muted underline underline-offset-2">
              Start over
            </button>
          </div>

          {summary !== null && (
            <div className={[
              'rounded-md border px-3 py-2 text-sm',
              summary.committed ? 'border-accent/40 bg-accent-soft' : 'border-border bg-surface'
            ].join(' ')}>
              <p className="font-medium">
                {summary.committed ? '✓ Imported' : 'Preview (nothing written yet)'}
              </p>
              <p className="mt-0.5 text-muted">
                {summary.result.read} read · {summary.result.created} contacts{' '}
                {summary.committed ? 'created' : 'would be created'} · {summary.result.errors} errors
              </p>
            </div>
          )}
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
        className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-ink"
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
