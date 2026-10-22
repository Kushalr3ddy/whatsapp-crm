'use client';

import { useState, useTransition, type ReactNode } from 'react';

/**
 * A button that asks "Are you sure?" in an in-app dialog before doing something that cannot be undone.
 *
 * `action` is a server action that takes a FormData; `fields` become its hidden inputs (an id, a key).
 * While it runs the Delete button shows `Working…` and is disabled, so a second click does nothing.
 * The dialog closes when the action finishes (the page is refreshed by the action itself).
 */
export function ConfirmAction({ label, title, children, confirmLabel = 'Delete', fields, action, className, ariaLabel }: {
  label: ReactNode;
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  fields: Record<string, string>;
  action: (formData: FormData) => Promise<void>;
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  /** Runs the action with the hidden fields, then closes the dialog. */
  function confirm(): void {
    const formData = new FormData();
    for (const [name, value] of Object.entries(fields)) formData.set(name, value);
    startTransition(async () => {
      await action(formData);
      setOpen(false);
    });
  }

  return (
    <>
      <button type="button" className={className ?? 'text-muted hover:text-danger'} aria-label={ariaLabel}
        onClick={() => { setOpen(true); }}>
        {label}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => { if (!pending) setOpen(false); }}>
          <div role="alertdialog" aria-modal="true" aria-label={title}
            className="card w-full max-w-sm p-5 text-sm shadow-lg"
            onClick={(e) => { e.stopPropagation(); }}
            onKeyDown={(e) => { if (e.key === 'Escape' && !pending) setOpen(false); }}>
            <h2 className="text-base font-semibold">{title}</h2>
            <div className="mt-2 text-muted">{children}</div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn btn-sm" disabled={pending} autoFocus
                onClick={() => { setOpen(false); }}>
                Cancel
              </button>
              <button type="button" className="btn btn-sm btn-danger" disabled={pending} onClick={confirm}>
                {pending ? 'Working…' : confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
