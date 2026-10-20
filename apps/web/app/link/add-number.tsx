'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import type { CountryCode } from 'libphonenumber-js/min';
import { addNumberAction } from './actions';
import { composeE164, dialCodes, guessCountry, readTyped, DEFAULT_COUNTRY } from '@/lib/dial-codes';

/**
 * The "Add a number" form: a name, and optionally the phone number. Creating it puts a card on the
 * page with the Link button, so the whole path (add, then scan the QR) happens in the browser.
 */
export function AddNumber({ first }: { first: boolean }) {
  const [open, setOpen] = useState(first);
  const [label, setLabel] = useState('');
  // The phone is a country (from a list) plus digits only; the +code form is built on submit.
  const known = useMemo(() => dialCodes(typeof navigator === 'undefined' ? 'en' : navigator.language), []);
  const [country, setCountry] = useState<CountryCode>(DEFAULT_COUNTRY);
  const [national, setNational] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Start on the country the browser's language points to (en-IN → India); the list still changes it.
  useEffect(() => { setCountry(guessCountry(navigator.languages, known)); }, [known]);

  /** Keeps digits only; text that starts with + (+91…, +63…) picks that country and carries on, like Google's phone box. */
  function onNumberChange(text: string) {
    const next = readTyped(text, known, country);
    setCountry(next.country);
    setNational(next.national);
  }

  /** Sends the form; on success it clears and closes, and the new card appears from the refreshed page. */
  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await addNumberAction(label, composeE164(country, national));
      if (!result.ok) { setError(result.error ?? 'Could not add the number.'); return; }
      setLabel(''); setNational(''); setOpen(false);
    });
  }

  if (!open) {
    return <button type="button" onClick={() => { setOpen(true); }} className="btn btn-primary">Add a number</button>;
  }

  return (
    <form onSubmit={submit} className="card mb-4 flex max-w-xl flex-col gap-3 p-5" aria-label="Add a number">
      <h2 className="text-base font-semibold">Add a number</h2>
      <p className="text-sm text-muted">
        Name it so your team knows which line it is. After adding, press <strong>Link this number</strong> on its
        card and scan the QR code with that phone.
      </p>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        Name
        <input
          value={label} onChange={(e) => { setLabel(e.target.value); }} maxLength={100} required
          placeholder="e.g. Sales line" className="field font-normal text-ink"
        />
      </label>
      <div className="flex flex-col gap-1 text-xs font-medium text-muted">
        <label htmlFor="add-number-phone">Phone number (optional)</label>
        <div className="flex gap-2">
          <select
            aria-label="Country code" value={country}
            onChange={(e) => { setCountry(e.target.value as CountryCode); }}
            className="field w-40 min-w-0 font-normal text-ink"
          >
            {known.map((d) => <option key={d.code} value={d.code}>{d.name} (+{d.dial})</option>)}
          </select>
          <input
            id="add-number-phone" value={national} onChange={(e) => { onNumberChange(e.target.value); }}
            inputMode="tel" autoComplete="tel-national" placeholder="98765 43210"
            className="field min-w-0 flex-1 font-normal text-ink"
          />
        </div>
        <span className="font-normal">Pick the country, then type the number without the country code. Digits only.</span>
      </div>
      {error !== null && <p role="alert" className="notice notice-danger">{error}</p>}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={pending} className="btn btn-primary">{pending ? 'Adding…' : 'Add number'}</button>
        {!first && <button type="button" onClick={() => { setOpen(false); }} className="btn">Cancel</button>}
      </div>
    </form>
  );
}
