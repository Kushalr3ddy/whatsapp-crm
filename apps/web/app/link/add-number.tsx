'use client';

import { useState, useTransition } from 'react';
import { addNumberAction } from './actions';

/**
 * The "Add a number" form: a name, and optionally the phone number. Creating it puts a card on the
 * page with the Link button, so the whole path (add, then scan the QR) happens in the browser.
 */
export function AddNumber({ first }: { first: boolean }) {
  const [open, setOpen] = useState(first);
  const [label, setLabel] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** Sends the form; on success it clears and closes, and the new card appears from the refreshed page. */
  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await addNumberAction(label, phone);
      if (!result.ok) { setError(result.error ?? 'Could not add the number.'); return; }
      setLabel(''); setPhone(''); setOpen(false);
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
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        Phone number (optional)
        <input
          value={phone} onChange={(e) => { setPhone(e.target.value); }} inputMode="tel"
          placeholder="+91 98765 43210" className="field font-normal text-ink"
        />
      </label>
      {error !== null && <p role="alert" className="notice notice-danger">{error}</p>}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={pending} className="btn btn-primary">{pending ? 'Adding…' : 'Add number'}</button>
        {!first && <button type="button" onClick={() => { setOpen(false); }} className="btn">Cancel</button>}
      </div>
    </form>
  );
}
