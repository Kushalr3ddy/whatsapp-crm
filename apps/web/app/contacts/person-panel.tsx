'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import type { PersonDetail, PersonRow } from '@/lib/crm';
import { emailOf, formatDay, initials, phoneOf } from '@/lib/contacts-screen';

/** What each campaign outcome says, and whether it reads as good news. */
const OUTCOME: Record<PersonDetail['campaigns'][number]['outcome'], { text: string; tone: 'ok' | 'mu' | 'bd' }> = {
  replied: { text: 'Replied', tone: 'ok' }, read: { text: 'Read', tone: 'mu' }, delivered: { text: 'Delivered', tone: 'mu' },
  sent: { text: 'Sent', tone: 'mu' }, failed: { text: 'Did not send', tone: 'bd' }, skipped: { text: 'Skipped', tone: 'mu' },
  pending: { text: 'Waiting to send', tone: 'mu' }, queued: { text: 'Waiting to send', tone: 'mu' }
};

/**
 * The person opens in a side panel, not a separate page: where they came from with every column of the file, every
 * campaign they have been in, and Open chat, which goes to the Inbox.
 */
export function PersonPanel(
  { person, detail, state, timeZone, onClose, onRetry }: {
    person: PersonRow;
    detail: PersonDetail | null;
    state: 'loading' | 'ready' | 'error';
    timeZone: string;
    onClose: () => void;
    onRetry: () => void;
  }
) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);

  const name = person.displayName ?? phoneOf(person) ?? 'Unnamed';
  const phone = phoneOf(person);
  const email = emailOf(person);
  const day = (iso: string): string => formatDay(iso, timeZone);
  const fileTag = person.tags.find((t) => t.isFile);

  return (
    <>
      <div className="ct-scrim" onClick={onClose} aria-hidden />
      <aside className="ct-panel" role="dialog" aria-modal="true" aria-label={`${name}, details`}
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
        <div className="ct-ph">
          <span className="ct-av" aria-hidden>{initials(name)}</span>
          <div className="ct-t">
            <b>{name}</b>
            <span className="ct-small">{[phone, email].filter((x) => x !== null).join(' · ')}</span>
          </div>
          <button ref={closeRef} className="ct-btn ct-g ct-sm" type="button" onClick={onClose}>Close</button>
        </div>

        {person.doNotContact
          ? <div className="ct-hint ct-bad"><span><b>Do not contact.</b> They asked to stop. Campaigns skip them.</span></div>
          : <span className="ct-st ct-ok"><i />Can be messaged</span>}

        <div>
          <h4>Tags</h4>
          <p style={{ fontSize: 14 }}>{person.tags.length === 0 ? 'No tags yet.' : person.tags.map((t) => t.name).join(', ')}</p>
          {fileTag !== undefined && <p className="ct-small" style={{ marginTop: 4 }}>The first one is added by the import. The others are yours.</p>}
        </div>

        <div>
          <h4>Campaigns</h4>
          {state === 'loading' && <p className="ct-small" role="status">Loading their campaigns</p>}
          {state === 'error' && (
            <p className="ct-small" role="alert">
              We couldn’t load their history. <button type="button" className="ct-link" style={{ minHeight: 0 }} onClick={onRetry}>Try again</button>
            </p>
          )}
          {detail !== null && detail.campaigns.length === 0 && (
            <p className="ct-small">Never messaged. They have not been in a campaign yet.</p>
          )}
          {detail?.campaigns.map((c) => {
            const o = OUTCOME[c.outcome];
            return (
              <div className="ct-camp" key={c.id}>
                <div className="ct-l1">
                  <b style={{ fontWeight: 500 }}>{c.name}</b>
                  <span className={`ct-st ct-${o.tone}`}><i />{o.text}</span>
                </div>
                <span className="ct-small">From {c.numberLabel} · {day(c.at)}</span>
              </div>
            );
          })}
        </div>

        {detail?.source !== undefined && detail.source !== null && (
          <div>
            <h4>From {detail.source.filename ?? 'a file'}</h4>
            <dl className="ct-dl">
              <dt>Imported</dt><dd>{day(detail.source.importedAt)}</dd>
              <dt>Last active</dt><dd>{person.lastActiveAt === null ? 'Never replied' : day(person.lastActiveAt)}</dd>
              {detail.source.columns.map((c) => (
                <FileValue key={c.header} header={c.header} value={c.value} />
              ))}
            </dl>
            <p className="ct-small" style={{ marginTop: 6 }}>Every column from the file, including the ones hidden in the table.</p>
          </div>
        )}
        {detail !== null && detail.source === null && (
          <div>
            <h4>Where they came from</h4>
            <p className="ct-small">Not from an imported file. They wrote to you first, or were added another way.</p>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {detail?.conversationId !== undefined && detail.conversationId !== null
            ? <Link className="ct-btn ct-p" href={`/inbox/${detail.conversationId}`}>Open chat</Link>
            : <button className="ct-btn ct-p" type="button" disabled>{state === 'ready' ? 'No chat yet' : 'Open chat'}</button>}
        </div>
      </aside>
    </>
  );
}

/** One column of the file: its name and this person's value, "Blank" when there is none. */
function FileValue({ header, value }: { header: string; value: string }) {
  return (
    <>
      <dt>{header}</dt>
      <dd>{value === '' ? <span className="ct-mu">Blank</span> : value}</dd>
    </>
  );
}
