'use client';

import { useState } from 'react';
import type { CustomField } from '@/lib/crm';
import { ConfirmAction } from '@/components/confirm-action';
import { createFieldAction, deleteFieldAction } from './actions';
import { SubmitButton } from './submit-button';

/**
 * Defining the org's fields. Everyone sees what exists (and the `{{key}}` to use it in a campaign);
 * only an admin's create/remove goes through, since it changes every contact.
 *
 * Built for dozens of fields: a search box, a list that scrolls instead of growing, and one row per
 * field with fixed columns (name cut short with the full name on hover, type, remove).
 */
export function FieldsPanel({ fields }: { fields: CustomField[] }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = needle === ''
    ? fields
    : fields.filter((f) => f.label.toLowerCase().includes(needle) || f.key.toLowerCase().includes(needle));

  return (
    <details className="card px-4 py-2.5 text-sm">
      <summary className="cursor-pointer font-medium">Custom fields ({fields.length})</summary>
      <p className="mt-2 text-muted">
        Extra details on each contact, usable as {'{{field}}'} in a campaign message.
      </p>
      {fields.length > 6 && (
        <input type="search" value={q} onChange={(e) => { setQ(e.target.value); }}
          placeholder="Search fields…" aria-label="Search fields" className="field field-sm mt-2 w-full" />
      )}
      <ul className="mt-2 max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
        {shown.map((f) => {
          const detail = `${f.label} — {{${f.key}}}${f.type === 'select' ? ` — options: ${f.options.join(', ')}` : ''}`;
          return (
            <li key={f.key} title={detail} className="flex items-center gap-2 px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate font-medium">{f.label}</span>
              <span className="w-14 shrink-0 text-xs text-muted">{f.type}</span>
              <span className="w-14 shrink-0 text-right">
                <ConfirmAction label="remove" ariaLabel={`Remove field ${f.label}`} title="Remove this field?"
                  fields={{ key: f.key }} action={deleteFieldAction} confirmLabel="Remove">
                  <p>
                    <strong>{f.label}</strong> and the value it holds on every contact will be deleted. Campaign
                    messages that use <code>{`{{${f.key}}}`}</code> will no longer fill it in.
                  </p>
                </ConfirmAction>
              </span>
            </li>
          );
        })}
        {shown.length === 0 && <li className="px-2 py-2 text-muted">No field matches.</li>}
      </ul>
      <form action={createFieldAction} className="mt-2 flex flex-wrap items-center gap-2">
        <input name="label" required placeholder="Field name, e.g. City" aria-label="Field name"
          className="field field-sm" />
        <select name="type" aria-label="Field type" className="field field-sm">
          <option value="text">text</option><option value="number">number</option>
          <option value="date">date</option><option value="select">select</option>
        </select>
        <input name="options" placeholder="options, comma separated (select only)" aria-label="Options"
          className="min-w-48 flex-1 rounded-md border border-border bg-surface px-2 py-1" />
        <SubmitButton className="btn btn-sm" pendingLabel="Adding…">Add field (admin)</SubmitButton>
      </form>
    </details>
  );
}
