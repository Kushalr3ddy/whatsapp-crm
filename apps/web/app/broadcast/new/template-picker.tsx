'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { AiTemplate } from '@/lib/crm';

/**
 * "Start from a saved template": choosing one copies its first message into the message box below, where it can still be
 * changed. Nothing is sent and the template itself is not changed.
 */
export function TemplatePicker({ templates }: { templates: AiTemplate[] }) {
  const [picked, setPicked] = useState('');

  /** Remembers the choice and copies the template's first message into the message box. */
  function choose(id: string): void {
    setPicked(id);
    const t = templates.find((x) => x.id === id);
    const box = document.querySelector<HTMLTextAreaElement>('textarea[name="body"]');
    if (t !== undefined && box !== null) box.value = t.firstMessage;
  }

  return (
    <div className="mb-3 rounded-lg border border-border bg-surface p-3">
      <label className="flex flex-col gap-1 text-sm font-medium">
        Start from a saved template
        <span className="text-xs font-normal text-muted">Picking one fills the message box below. You can still change the text.</span>
        <select value={picked} onChange={(e) => { choose(e.target.value); }} className="field font-normal" aria-label="Saved template">
          <option value="">{templates.length === 0 ? 'No saved templates yet' : 'Choose a template…'}</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <Link href="/ai" className="mt-2 inline-block text-sm text-accent hover:underline">Build a new template →</Link>
    </div>
  );
}
