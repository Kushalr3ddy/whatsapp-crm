'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import type { AiTemplate, Sender, Tag } from '@/lib/crm';
import { useTemplateAction } from '../../actions';
import { GroupSection } from './group-section';

/**
 * The choices after saving a template. Only what is built is offered as a button; the rest are named so the plan is visible
 * (messaging a group with an auto-named tag, a test to yourself, and the replies section come in the next pieces).
 */
export function NextPanel({ template, tags, senders }: { template: AiTemplate; tags: Tag[]; senders: Sender[] }) {
  const [section, setSection] = useState<'group' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  /** Makes the template what every chat follows by default. */
  function answerAll() {
    setError(null); setNotice(null);
    start(async () => {
      const result = await useTemplateAction(template.id, true);
      if (!result.ok) { setError(result.error ?? 'Could not use it.'); return; }
      setNotice(`“${template.name}” now answers all the chats by default.`);
    });
  }

  return (
    <div className="mt-6 flex flex-col gap-5">
      <section className="card p-5" aria-label="What next">
        <h2 className="text-base font-semibold">What next?</h2>
        <p className="mt-1 text-sm text-muted">Nothing is forced. Pick one, or come back later.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn" disabled={pending} onClick={answerAll}>Let it answer all chats</button>
          <button type="button" className="btn btn-primary" onClick={() => { setSection('group'); }}>Message a group with this</button>
          <button type="button" className="btn" disabled title="Coming next: sends the first message to one saved contact">Send a test to myself (coming next)</button>
          <Link href="/ai" className="btn">Done for now</Link>
        </div>
        {notice !== null && <p role="status" className="notice notice-success mt-3">{notice}</p>}
        {error !== null && <p role="alert" className="notice notice-danger mt-3">{error}</p>}
      </section>

      {section === 'group' && <GroupSection template={template} tags={tags} senders={senders} />}

      <section className="card p-5" aria-label="The template">
        <h2 className="text-base font-semibold">{template.name}</h2>
        <p className="mt-1 text-xs text-muted">Used {template.useCount} {template.useCount === 1 ? 'time' : 'times'}</p>
        <h3 className="mt-3 text-sm font-medium">Instructions for the AI</h3>
        <pre className="mt-1 whitespace-pre-wrap text-sm text-muted">{template.instructions}</pre>
        {template.audience !== '' && <p className="mt-3 text-sm"><span className="font-medium">Who gets the first message:</span> <span className="text-muted">{template.audience}</span></p>}
        {template.firstMessage !== '' && <p className="mt-1 text-sm"><span className="font-medium">First message:</span> <span className="text-muted">{template.firstMessage}</span></p>}
      </section>
    </div>
  );
}
