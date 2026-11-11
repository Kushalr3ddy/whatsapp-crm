'use client';

import './inbox.css';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { highlightPieces, initials, kindLabel, listWhen, snippetAround } from '@/lib/inbox-format';
import type { InboxCounts, InboxFilterChoices, InboxOwner, InboxPage, InboxQuery, InboxRow, InboxStatus, InboxView } from '@/lib/inbox';
import { loadFilterChoicesAction, loadInboxAction } from './actions';

/** How many chats one fetch brings, and the most the list ever holds (the API's own cap). */
const PAGE = 50;
const MOST = 200;
/** How often the list looks again. */
const POLL_MS = 5000;

/** Fired by anything that changes who has a chat or whether it is open, so the list updates now instead of at the next look. */
export const INBOX_CHANGED = 'inbox:changed';

const VIEWS: Array<{ key: InboxView; label: string }> = [
  { key: 'all', label: 'All' }, { key: 'needs', label: 'Needs you' }, { key: 'unread', label: 'Unread' },
  { key: 'ai', label: 'AI answering' }, { key: 'you', label: 'You answering' }
];

/** The text with the searched word marked. */
function Marked({ text, word }: { text: string; word: string }) {
  return <>{highlightPieces(text, word).map((p, i) => (p.hit ? <mark key={i} className="ib-mark">{p.text}</mark> : <span key={i}>{p.text}</span>))}</>;
}

/** What a row says under the name: the last message, or the part of it the search matched. */
function rowLine(row: InboxRow, word: string): { text: string; quoted: boolean } {
  const last = row.lastMessage;
  if (last === null) return { text: 'No messages yet', quoted: false };
  const text = last.text !== null && last.text.trim() !== '' ? last.text : kindLabel(last.kind);
  const name = (row.contactName ?? '').toLowerCase();
  const w = word.trim().toLowerCase();
  if (w !== '' && !name.includes(w) && text.toLowerCase().includes(w)) return { text: snippetAround(text, w), quoted: true };
  return { text: text.replace(/\s+/g, ' '), quoted: false };
}

/**
 * The Inbox screen: the search, Filters and quick views on top, the list of chats on the left and the chosen chat (the page below) on the
 * right. It lives in the layout, so the list, its filters and its scroll position stay put while you open one chat after another.
 */
export function InboxShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const selected = /^\/inbox\/([0-9a-f-]{36})/i.exec(pathname)?.[1] ?? null;

  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [view, setView] = useState<InboxView>('all');
  const [status, setStatus] = useState<InboxStatus>('open');
  const [owner, setOwner] = useState<InboxOwner>('all');
  const [campaigns, setCampaigns] = useState<string[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [choices, setChoices] = useState<InboxFilterChoices | null>(null);
  const [limit, setLimit] = useState(PAGE);

  const [page, setPage] = useState<InboxPage | null>(null);
  const [failed, setFailed] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const asked = useRef(0);

  // The search waits a moment after the last key so each letter is not a trip to the server.
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q); setLimit(PAGE); }, 250);
    return () => { clearTimeout(t); };
  }, [q]);

  const query: InboxQuery = { q: debouncedQ, view, status, owner, campaigns, files, limit, offset: 0 };
  const queryKey = JSON.stringify(query);

  /** Reads the list for the current choices. Only the newest answer is used; a failed look keeps what is on screen. */
  const load = useCallback(async (): Promise<void> => {
    const mine = ++asked.current;
    const result = await loadInboxAction(JSON.parse(queryKey) as InboxQuery);
    if (mine !== asked.current) return;
    if (result.ok) { setPage(result.page); setFailed(false); } else setFailed(true);
  }, [queryKey]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const look = (): void => { if (!document.hidden) void load(); };
    const timer = setInterval(look, POLL_MS);
    window.addEventListener(INBOX_CHANGED, look);
    return () => { clearInterval(timer); window.removeEventListener(INBOX_CHANGED, look); };
  }, [load]);

  // The choices in Filters are read the first time the panel opens.
  useEffect(() => {
    if (filtersOpen && choices === null) void loadFilterChoicesAction().then(setChoices);
  }, [filtersOpen, choices]);

  // "/" jumps to the search, like the hint in the box says; Escape clears it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (e.key === '/' && tag !== 'input' && tag !== 'textarea' && tag !== 'select') { e.preventDefault(); searchRef.current?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); };
  }, []);

  const activeFilters: Array<{ key: string; label: string; clear: () => void }> = [];
  for (const id of campaigns) activeFilters.push({ key: `c${id}`, label: `Campaign: ${choices?.campaigns.find((c) => c.id === id)?.name ?? 'campaign'}`, clear: () => { setCampaigns((c) => c.filter((x) => x !== id)); } });
  for (const id of files) activeFilters.push({ key: `f${id}`, label: `File: ${choices?.files.find((f) => f.id === id)?.name ?? 'file'}`, clear: () => { setFiles((f) => f.filter((x) => x !== id)); } });
  if (owner !== 'all') activeFilters.push({ key: 'o', label: `Owner: ${owner === 'me' ? 'Mine' : 'Unassigned'}`, clear: () => { setOwner('all'); } });
  if (status !== 'open') activeFilters.push({ key: 's', label: `Status: ${status === 'closed' ? 'Closed' : 'Any'}`, clear: () => { setStatus('open'); } });

  /** Puts every search and filter back to how the screen opens. */
  function clearAll(): void {
    setQ(''); setDebouncedQ(''); setView('all'); setStatus('open'); setOwner('all'); setCampaigns([]); setFiles([]); setLimit(PAGE);
  }
  const toggle = (list: string[], id: string): string[] => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const counts: InboxCounts | null = page?.counts ?? null;
  const rows = page?.rows ?? [];
  const word = debouncedQ.trim();
  const noChatsAtAll = page !== null && page.orgTotal === 0;
  const loadedOk = page !== null && !noChatsAtAll;

  return (
    <div className="ib ib-page" data-view={selected === null ? 'list' : 'thread'}>
      <header className="ib-head">
        <h1>Inbox</h1>
        <p>Replies from your campaigns. The AI answers where it can, and you step in where it can&apos;t.</p>
      </header>

      <div className="ib-above">
        <div className="ib-bar">
          <div className="ib-sbox">
            <label htmlFor="ib-q">Search</label>
            <input ref={searchRef} className="ib-in" id="ib-q" name="q" type="text" value={q} placeholder="Name, number or message…" autoComplete="off"
              onChange={(e) => { setQ(e.target.value); }}
              onKeyDown={(e) => { if (e.key === 'Escape' && q !== '') { setQ(''); } }} />
            {q !== '' ? (
              <button className="ib-x" type="button" aria-label="Clear search" onClick={() => { setQ(''); searchRef.current?.focus(); }}><X size={16} aria-hidden /></button>
            ) : <kbd aria-hidden="true">/</kbd>}
          </div>
          <button className="ib-btn" type="button" aria-expanded={filtersOpen} aria-controls="ib-fpanel" onClick={() => { setFiltersOpen(!filtersOpen); }}>
            Filters <span className="ib-small">{activeFilters.length > 0 ? `· ${String(activeFilters.length)}` : '· campaign, file'}</span>
          </button>
        </div>

        <div id="ib-fpanel" className="ib-card ib-fpanel" hidden={!filtersOpen}>
          <div>
            <h2>Campaign</h2>
            <div className="ib-stack">
              {choices === null && <span className="ib-small">Loading…</span>}
              {choices !== null && choices.campaigns.length === 0 && <span className="ib-small">No campaign has messaged anyone yet.</span>}
              {choices?.campaigns.map((c) => (
                <label key={c.id} className="ib-chk"><input type="checkbox" checked={campaigns.includes(c.id)} onChange={() => { setCampaigns(toggle(campaigns, c.id)); setLimit(PAGE); }} />
                  <span className="ib-nm">{c.name}</span><span className="ib-n">{c.chats}</span></label>
              ))}
            </div>
          </div>
          <div>
            <h2>Imported file</h2>
            <div className="ib-stack">
              {choices === null && <span className="ib-small">Loading…</span>}
              {choices !== null && choices.files.length === 0 && <span className="ib-small">No imported file has a chat yet.</span>}
              {choices?.files.map((f) => (
                <label key={f.id} className="ib-chk"><input type="checkbox" checked={files.includes(f.id)} onChange={() => { setFiles(toggle(files, f.id)); setLimit(PAGE); }} />
                  <span className="ib-nm">{f.name}</span><span className="ib-n">{f.chats}</span></label>
              ))}
            </div>
          </div>
          <div>
            <h2>Owner</h2>
            <div className="ib-seg" role="group" aria-label="Owner">
              {([['all', 'All'], ['me', 'Mine'], ['unassigned', 'Unassigned']] as const).map(([k, label]) => (
                <button key={k} type="button" aria-pressed={owner === k} onClick={() => { setOwner(k); setLimit(PAGE); }}>{label}</button>
              ))}
            </div>
          </div>
          <div>
            <h2>Status</h2>
            <div className="ib-seg" role="group" aria-label="Status">
              {([['open', 'Open'], ['closed', 'Closed'], ['any', 'Any']] as const).map(([k, label]) => (
                <button key={k} type="button" aria-pressed={status === k} onClick={() => { setStatus(k); setLimit(PAGE); }}>{label}</button>
              ))}
            </div>
          </div>
        </div>

        {loadedOk && (
          <div className="ib-quick" role="group" aria-label="Quick views">
            {VIEWS.map((v) => (
              <button key={v.key} type="button" className="ib-chipbtn" aria-pressed={view === v.key} onClick={() => { setView(v.key); setLimit(PAGE); }}>
                {v.label}<span className="ib-n">{counts?.[v.key] ?? 0}</span>
              </button>
            ))}
          </div>
        )}

        {activeFilters.length > 0 && (
          <div className="ib-chips" aria-live="polite">
            {activeFilters.map((a) => (
              <span key={a.key} className="ib-chip">{a.label}<button type="button" aria-label={`Remove ${a.label}`} onClick={() => { a.clear(); setLimit(PAGE); }}><X size={14} aria-hidden /></button></span>
            ))}
            <button type="button" className="ib-btn ib-g ib-sm" onClick={clearAll}>Clear all</button>
          </div>
        )}
      </div>

      <div className="ib-split" data-view={selected === null ? 'list' : 'thread'}>
        <section className="ib-listpane" aria-label="Chats">
          <div className="ib-lhead">{page === null ? (failed ? '' : 'Loading chats…') : noChatsAtAll ? '0 chats' : `${page.total.toLocaleString('en-US')} ${page.total === 1 ? 'chat' : 'chats'}`}</div>
          <div className="ib-rows">
            {page === null && !failed && [1, 2, 3, 4, 5, 6].map((n) => (
              <div key={n} className="ib-sk" aria-hidden="true"><i className="ib-a" /><div className="ib-l"><i style={{ width: '55%' }} /><i style={{ width: '90%' }} /><i style={{ width: '40%' }} /></div></div>
            ))}
            {page === null && failed && (
              <div className="ib-empty">
                <h2>Couldn&apos;t load your chats</h2>
                <p>The server did not answer. Nothing was lost.</p>
                <button className="ib-btn ib-p" type="button" onClick={() => { void load(); }}>Try again</button>
              </div>
            )}
            {noChatsAtAll && (
              <div className="ib-empty">
                <h2>No chats yet</h2>
                <p>Replies to your campaigns show up here.</p>
                <Link className="ib-btn ib-p" href="/broadcast/new">Create a campaign</Link>
              </div>
            )}
            {loadedOk && rows.length === 0 && (
              <div className="ib-empty">
                <h2>No chats match your filters</h2>
                <p>Try fewer filters, or clear them all.</p>
                <button className="ib-btn ib-p" type="button" onClick={clearAll}>Clear all filters</button>
              </div>
            )}
            {rows.map((row) => {
              const title = row.contactName ?? row.contactPhone ?? 'Unknown';
              const line = rowLine(row, word);
              return (
                <Link key={row.id} href={`/inbox/${row.id}`} className={`ib-row${row.unreadCount > 0 ? ' ib-unr' : ''}`} aria-current={row.id === selected}>
                  <span className="ib-av" aria-hidden="true">{initials(title)}</span>
                  <span className="ib-rb">
                    <span className="ib-r1"><b><Marked text={title} word={word} /></b><time dateTime={row.lastAt}>{listWhen(row.lastAt)}</time></span>
                    <span className="ib-r2">{line.quoted && '“'}<Marked text={line.text} word={word} />{line.quoted && '”'}</span>
                    <span className="ib-r3">
                      {row.needsYou && <span className="ib-need">Needs you</span>}
                      {row.unreadCount > 0 && <span className="ib-un" aria-label={`${String(row.unreadCount)} unread`}>{row.unreadCount}</span>}
                    </span>
                  </span>
                </Link>
              );
            })}
            {page !== null && rows.length > 0 && page.total > rows.length && (
              <div className="ib-more">
                {limit < MOST
                  ? <button className="ib-btn ib-sm" type="button" onClick={() => { setLimit(Math.min(MOST, limit + PAGE)); }}>Show more chats</button>
                  : <p className="ib-small">Showing the newest {MOST}. Search or use Filters to find the others.</p>}
              </div>
            )}
          </div>
        </section>
        <section className="ib-thread" aria-label="Chat">{children}</section>
      </div>
    </div>
  );
}
