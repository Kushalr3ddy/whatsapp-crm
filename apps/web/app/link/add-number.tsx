'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addNumberAction } from './actions';

/**
 * The "Add a number" form: just a name. The phone number is not asked for: once the QR is scanned WhatsApp
 * tells us which number it is, and it is saved then. After adding, the new card opens with its QR already
 * showing, so adding and scanning is one step.
 */
export function AddNumber({ first }: { first: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(first);
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** Sends the form; on success it goes to the Numbers page with the new card's QR started. */
  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await addNumberAction(label);
      if (!result.ok || result.id === undefined) { setError(result.error ?? 'Could not add the number.'); return; }
      setLabel(''); setOpen(false);
      router.push(`/link?start=${result.id}`);
    });
  }

  if (!open) {
    return <button type="button" onClick={() => { setOpen(true); }} className="btn btn-primary">Add a number</button>;
  }

  return (
    <form onSubmit={submit} className="card mb-4 flex max-w-xl flex-col gap-3 p-5" aria-label="Add a number">
      <h2 className="text-base font-semibold">Add a number</h2>
      <p className="text-sm text-muted">
        Name it so your team knows which line it is. The QR code for it opens next: scan it with that phone
        (WhatsApp → Settings → Linked devices). The number itself is picked up when you scan.
      </p>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        Name
        <input
          value={label} onChange={(e) => { setLabel(e.target.value); }} maxLength={100} required
          placeholder="e.g. Sales line" className="field font-normal text-ink"
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
