'use client';

import { useState } from 'react';

/**
 * A tag chip (a small rounded label showing a tag's name) on a contact, whose "×" asks first.
 *
 * Tags are the only way to group people, so one stray click removing one is costly: the contact may have to be
 * searched for and tagged all over again. The first click turns the chip into a short question; only "Yes, remove"
 * submits the form.
 */
export function RemoveTag({ contactId, tagId, tagName, action }: {
  contactId: string; tagId: string; tagName: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <button
        type="button" title="Remove tag" onClick={() => { setAsking(true); }}
        className="badge badge-accent cursor-pointer hover:!border-danger hover:!text-danger"
      >
        {tagName} <span aria-hidden className="opacity-60">×</span>
      </button>
    );
  }

  return (
    <form action={action} className="inline-flex flex-wrap items-center gap-1.5 rounded-md border border-danger/40 bg-danger-soft px-2 py-1 text-xs">
      <input type="hidden" name="contactId" value={contactId} />
      <input type="hidden" name="tagId" value={tagId} />
      <span>
        Are you sure? This person will lose “{tagName}”, and you may have to search for them and tag them again.
      </span>
      <button type="submit" className="btn btn-sm btn-danger">Yes, remove</button>
      <button type="button" onClick={() => { setAsking(false); }} className="btn btn-sm">Keep it</button>
    </form>
  );
}
