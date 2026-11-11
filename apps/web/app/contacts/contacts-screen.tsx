'use client';

import './contacts.css';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, X } from 'lucide-react';
import type { ContactSources, PersonDetail, PersonRow, SegmentDefinition } from '@/lib/crm';
import {
  EVERYONE, PAGE_SIZES, addedText, fmt, peopleParams, chipsFor, cleanFilter, deleteTagText, emailOf, filterCount, formatDay,
  pageCount, phoneOf, showingText, sourceLabel, subheading, tagsText, viewToRequest, viewToSearch, withoutChip,
  type Source, type ViewState
} from '@/lib/contacts-screen';
import {
  addTagAction, createTagAction, deleteListAction, deleteTagAction, loadDetailAction, loadPeopleAction,
  loadSourcesAction, saveListAction, undoTagAction, type Reply
} from './people-actions';
import { FiltersPanel } from './filters-panel';
import { PersonPanel } from './person-panel';

/** What the page hands the screen: everything it could read on the server. A null means that read failed. */
export interface ContactsScreenProps {
  sources: ContactSources | null;
  view: ViewState;
  people: { rows: PersonRow[]; total: number } | null;
  timeZone: string;
  /** Only an admin can delete a tag or export. */
  isAdmin: boolean;
}

/** The columns every table has besides Name, and whether each is on to begin with. */
const BUILT_IN: ReadonlyArray<readonly [string, string]> = [
  ['phone', 'Phone'], ['email', 'Email'], ['tags', 'Tags'], ['last', 'Last campaign'], ['imported', 'Imported'], ['seen', 'Last active']
];

/** Which small dialog is open: delete a tag or list, or name a saved list. */
type Dialog = { kind: 'delete-tag' | 'delete-list'; id: string } | { kind: 'save-list' } | null;
/** The line at the bottom, with an Undo when the last thing can be taken back. */
interface Toast { text: string; undo?: () => void }

/** A sentence for an error code the server sent back. */
function problemText(code: string, what: string): string {
  switch (code) {
    case 'TAG_EXISTS': return 'A tag with that name already exists.';
    case 'SEGMENT_EXISTS': return 'A list with that name already exists.';
    case 'FILE_TAG': return 'That tag comes from an imported file, so it stays as long as the file does.';
    case 'COUNT_CHANGED': return 'The people changed while you were choosing. Select them again.';
    case 'VALIDATION_FAILED': return 'That did not look right. Check it and try again.';
    default: return `We couldn’t ${what}. Check your connection and try again.`;
  }
}

/**
 * Contacts: the imported files, your tags and saved lists down the left; one table of everyone with search, Filters, Columns
 * and Export; tick people and tag them; open a person in a side panel. Every list, count and tag runs on the server against
 * the same filter, so "Select all 486" tags the 486 people the filter matches, not 486 ids sent from the page.
 */
export function ContactsScreen(props: ContactsScreenProps) {
  const { timeZone, isAdmin } = props;
  const [sources, setSources] = useState<ContactSources | null>(props.sources);
  const [view, setView] = useState<ViewState>(props.view);
  const [people, setPeople] = useState(props.people);
  const [status, setStatus] = useState<'ready' | 'loading' | 'error'>(props.people === null ? 'error' : 'ready');
  const [qText, setQText] = useState(props.view.q);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [everyone, setEveryone] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [newTagOpen, setNewTagOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [shown, setShown] = useState<Record<string, boolean>>(() => Object.fromEntries(BUILT_IN.map(([k]) => [k, true])));
  // The person is kept as it was when opened, so a reload of the list underneath (a search, a tag added) does not close the panel.
  const [openRow, setOpenRow] = useState<PersonRow | null>(null);
  const openId = openRow?.id ?? null;
  const [detail, setDetail] = useState<{ id: string; data: PersonDetail | null; state: 'loading' | 'ready' | 'error' } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const ticket = useRef(0);
  const firstLoad = useRef(true);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const day = useCallback((iso: string): string => formatDay(iso, timeZone), [timeZone]);
  const names = useMemo(() => ({ campaigns: sources?.campaigns ?? [], fields: sources?.fields ?? [] }), [sources]);
  const chips = useMemo(() => chipsFor(view.q, view.filter, names), [view.q, view.filter, names]);
  const nFilters = filterCount(view.filter);
  const rows = people?.rows ?? [];
  const total = people?.total ?? 0;
  const file = view.source.kind === 'file' ? sources?.files.find((f) => f.id === view.source.id) : undefined;
  const fileColumns = file?.columns ?? [];

  const say = useCallback((text: string, undo?: () => void): void => {
    clearTimeout(toastTimer.current);
    setToast(undo === undefined ? { text } : { text, undo });
    toastTimer.current = setTimeout(() => { setToast(null); }, undo === undefined ? 6000 : 10000);
  }, []);

  /** A reply that says the session is over sends the person to sign in again. */
  const settled = useCallback(<T,>(r: Reply<T>): r is Extract<Reply<T>, { ok: true }> => {
    if (!r.ok && r.expired) window.location.assign('/login?next=/contacts');
    return r.ok;
  }, []);

  // ---- Reading the people for the current view ----
  const viewKey = JSON.stringify([view.source, view.q, cleanFilter(view.filter), view.page, view.size, view.sort]);
  const reload = useCallback(async (v: ViewState): Promise<void> => {
    const mine = ++ticket.current;
    setStatus('loading');
    const r = await loadPeopleAction(v);
    if (mine !== ticket.current) return;
    if (!settled(r)) { setStatus('error'); return; }
    setPeople(r.data);
    setStatus('ready');
  }, [settled]);

  useEffect(() => {
    if (firstLoad.current) { firstLoad.current = false; return; }
    // The rows on screen belong to the old view: say so at once instead of leaving them clickable until the answer comes.
    setStatus('loading');
    const t = setTimeout(() => { void reload(view); }, 160);
    return () => { clearTimeout(t); };
    // The view is read through its key so a typed rule does not refetch on every re-render.
  }, [viewKey, reload]);

  // The address always says what is on screen, so a refresh or a shared link comes back to it.
  useEffect(() => {
    window.history.replaceState(null, '', `/contacts${viewToSearch(view)}`);
  }, [view]);

  // The search box commits a moment after typing stops.
  useEffect(() => {
    if (qText === view.q) return;
    const t = setTimeout(() => { setView((v) => ({ ...v, q: qText, page: 0 })); setSel(new Set()); setEveryone(false); }, 250);
    return () => { clearTimeout(t); };
  }, [qText, view.q]);

  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      const t = (document.activeElement?.tagName ?? '');
      if (e.key === '/' && t !== 'INPUT' && t !== 'TEXTAREA' && t !== 'SELECT') { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'Escape') {
        if (dialog !== null) setDialog(null);
        else if (openId === null) { setFiltersOpen(false); setColumnsOpen(false); setTagOpen(false); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); };
  }, [dialog, openId]);

  // ---- Changing the view ----
  const resetPick = (): void => { setSel(new Set()); setEveryone(false); setTagOpen(false); };
  const change = (patch: Partial<ViewState>): void => { setView((v) => ({ ...v, ...patch })); resetPick(); };

  /** A change to the filter while a saved list is open leaves the list: the filter stays, the list no longer describes it. */
  const changeFilter = (filter: SegmentDefinition): void => {
    change({ filter, page: 0, source: view.source.kind === 'list' ? EVERYONE : view.source });
  };

  const pickSource = (source: Source): void => {
    let filter = view.filter;
    if (source.kind === 'list') {
      const list = sources?.lists.find((l) => l.id === source.id);
      filter = list === undefined ? {} : (JSON.parse(JSON.stringify(list.definition)) as SegmentDefinition);
    } else if (view.source.kind === 'list') filter = {};
    change({ source, filter, page: 0 });
    setSourceOpen(false);
  };

  const clearAll = (): void => {
    setQText('');
    change({ q: '', filter: {}, page: 0, source: view.source.kind === 'list' ? EVERYONE : view.source });
  };

  const refreshSources = useCallback(async (): Promise<ContactSources | null> => {
    const r = await loadSourcesAction();
    if (!settled(r)) return null;
    setSources(r.data);
    return r.data;
  }, [settled]);

  // ---- Ticking people ----
  const pageIds = rows.map((r) => r.id);
  const pageAllTicked = rows.length > 0 && (everyone || pageIds.every((id) => sel.has(id)));
  const pickedCount = everyone ? total : sel.size;
  const isTicked = (id: string): boolean => everyone || sel.has(id);

  const tickPage = (on: boolean): void => {
    setSel((s) => { const n = new Set(s); for (const id of pageIds) { if (on) n.add(id); else n.delete(id); } return n; });
    if (!on) setEveryone(false);
  };
  const tick = (id: string, on: boolean): void => {
    if (everyone && !on) {
      // "Everyone" cannot be listed in the browser, so unticking one person narrows the choice to this page without them.
      setEveryone(false);
      setSel(new Set(pageIds.filter((x) => x !== id)));
      return;
    }
    setSel((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  };

  // ---- Tags ----
  const applyTag = async (tagId: string, tagName: string): Promise<void> => {
    const picked = pickedCount;
    if (!everyone && sel.size > 5000) { say('That is more than 5,000 people picked by hand. Use Select all instead.'); return; }
    const r = await addTagAction(tagId, everyone
      ? { kind: 'view', view, expected: total }
      : { kind: 'ids', ids: [...sel] });
    if (!settled(r)) { say(problemText(r.error, 'add the tag')); return; }
    setTagOpen(false); resetPick();
    const added = r.data.addedIds;
    say(addedText(tagName, picked, r.data.changed), added !== undefined && added.length > 0
      ? () => {
        void (async () => {
          const u = await undoTagAction(tagId, added);
          if (settled(u)) { await Promise.all([reload(view), refreshSources()]); say(`Took “${tagName}” off ${String(added.length)} ${added.length === 1 ? 'person' : 'people'}.`); }
        })();
      }
      : undefined);
    await Promise.all([reload(view), refreshSources()]);
  };

  const createAndApply = async (name: string): Promise<void> => {
    const n = name.trim();
    if (n === '') return;
    if ((sources?.files ?? []).some((f) => (f.filename ?? '').toLowerCase() === n.toLowerCase())) {
      say(`A tag called “${n}” already exists.`); return;
    }
    const r = await createTagAction(n);
    if (!settled(r)) { say(problemText(r.error, 'make that tag')); return; }
    await refreshSources();
    await applyTag(r.data.id, r.data.name);
  };

  const makeTag = async (name: string): Promise<void> => {
    const n = name.trim();
    if (n === '') return;
    const r = await createTagAction(n);
    if (!settled(r)) { say(problemText(r.error, 'make that tag')); return; }
    setNewTagOpen(false);
    await refreshSources();
    say(`Tag “${r.data.name}” created. Tick people, then Add tag to put it on them.`);
  };

  const confirmDelete = async (): Promise<void> => {
    if (dialog === null || dialog.kind === 'save-list') return;
    const { kind, id } = dialog;
    const name = kind === 'delete-tag' ? sources?.tags.find((t) => t.id === id)?.name : sources?.lists.find((l) => l.id === id)?.name;
    const r = kind === 'delete-tag' ? await deleteTagAction(id) : await deleteListAction(id);
    setDialog(null);
    if (!settled(r)) { say(problemText(r.error, `delete that ${kind === 'delete-tag' ? 'tag' : 'list'}`)); return; }
    if (view.source.id === id) change({ source: EVERYONE, filter: {}, page: 0 }); else resetPick();
    await Promise.all([refreshSources(), reload(view.source.id === id ? { ...view, source: EVERYONE, filter: {}, page: 0 } : view)]);
    say(`Deleted ${kind === 'delete-tag' ? 'tag' : 'list'} “${name ?? ''}”.`);
  };

  const saveList = async (name: string): Promise<string | null> => {
    const r = await saveListAction(name, view.filter);
    if (!settled(r)) return problemText(r.error, 'save the list');
    setDialog(null); setFiltersOpen(false);
    const fresh = await refreshSources();
    if (fresh !== null) setView((v) => ({ ...v, source: { kind: 'list', id: r.data.id }, page: 0 }));
    say(`Saved the list “${r.data.name}”. It is in the left panel now.`);
    return null;
  };

  // ---- A person ----
  const openPerson = (row: PersonRow): void => {
    const id = row.id;
    setOpenRow(row);
    setDetail({ id, data: null, state: 'loading' });
    void (async () => {
      const r = await loadDetailAction(id);
      if (!settled(r)) { setDetail({ id, data: null, state: 'error' }); return; }
      setDetail({ id, data: r.data, state: 'ready' });
    })();
  };
  const closePerson = (): void => {
    const id = openId;
    setOpenRow(null); setDetail(null);
    if (id !== null) setTimeout(() => { document.querySelector<HTMLElement>(`[data-open="${id}"]`)?.focus(); }, 0);
  };
  const person = openRow ?? undefined;

  // ---- What the table shows ----
  const showFileCols = fileColumns.filter((c) => shown[`f:${c}`] === true);
  const visible = BUILT_IN.filter(([k]) => shown[k] === true);
  const noContactsAtAll = sources !== null && sources.total === 0 && chips.length === 0 && view.source.kind === 'all';
  const exportHref = `/contacts/export?format=csv${peopleParams(viewToRequest(view, false)).replace(/^\?/, '&')}`;

  return (
    <div className="ct">
      <div className="ct-app">
        <div className="ct-headrow">
          <div>
            <h1>Contacts</h1>
            <p id="ct-sub">{subheading(view.source, sources, day)}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link href="/import" className="ct-btn">Import people</Link>
          </div>
        </div>

        <div className="ct-layout">
          <aside className={`ct-card ct-files${sourceOpen ? ' ct-open' : ''}`} id="ct-files" aria-label="Imported files">
            <SourceList
              sources={sources} source={view.source} isAdmin={isAdmin} day={day} onPick={pickSource}
              onAskDelete={(kind, id) => { setDialog({ kind, id }); }}
              newTagOpen={newTagOpen} onNewTag={setNewTagOpen} onMakeTag={(n) => { void makeTag(n); }} />
          </aside>

          <section className="ct-main">
            <button className="ct-btn ct-filesel" type="button" aria-expanded={sourceOpen} aria-controls="ct-files"
              onClick={() => { setSourceOpen((o) => !o); }}>
              <span>{sourceLabel(view.source, sources)}</span><ChevronDown size={16} aria-hidden />
            </button>

            <div className="ct-bar">
              <div className="ct-sbox">
                <label htmlFor="ct-q">Search</label>
                <input ref={searchRef} className="ct-in" id="ct-q" type="search" placeholder="Name, phone or email"
                  autoComplete="off" spellCheck={false} name="q" value={qText} onChange={(e) => { setQText(e.target.value); }} />
                <kbd aria-hidden>/</kbd>
              </div>
              <button className="ct-btn" type="button" id="ct-fbtn" aria-expanded={filtersOpen} aria-controls="ct-fpanel"
                onClick={() => { setFiltersOpen((o) => !o); setColumnsOpen(false); }}>
                Filters {nFilters > 0 && <span className="ct-small">· {nFilters}</span>}
              </button>
              <button className="ct-btn" type="button" id="ct-cbtn" aria-expanded={columnsOpen} aria-controls="ct-cpanel"
                onClick={() => { setColumnsOpen((o) => !o); setFiltersOpen(false); }}>Columns</button>
              <span className="ct-sp" />
              {isAdmin && <a className="ct-btn" href={exportHref} download>Export</a>}
              {filtersOpen && sources !== null && (
                <div id="ct-fpanel" className="ct-card ct-pop ct-fpanel">
                  <FiltersPanel filter={view.filter} sources={sources} matching={total}
                    onChange={changeFilter} onSave={() => { setDialog({ kind: 'save-list' }); }} onClear={clearAll} />
                </div>
              )}
              {columnsOpen && (
                <div id="ct-cpanel" className="ct-card ct-pop" style={{ right: 0, left: 'auto' }}>
                  <h4>Show these columns</h4>
                  {BUILT_IN.map(([k, label]) => (
                    <label className="ct-chk" key={k}>
                      <input type="checkbox" checked={shown[k] === true} onChange={(e) => { setShown((s) => ({ ...s, [k]: e.target.checked })); }} />{label}
                    </label>
                  ))}
                  {file !== undefined && fileColumns.length > 0 && (
                    <>
                      <h4 style={{ marginTop: 10 }}>Kept from your file, hidden</h4>
                      <p className="ct-small" style={{ marginBottom: 4 }}>Nothing is deleted. Tick one to show it in the table.</p>
                      {fileColumns.map((c) => (
                        <label className="ct-chk" key={c}>
                          <input type="checkbox" checked={shown[`f:${c}`] === true}
                            onChange={(e) => { setShown((s) => ({ ...s, [`f:${c}`]: e.target.checked })); }} />{c}
                        </label>
                      ))}
                    </>
                  )}
                  {file === undefined && (
                    <p className="ct-small" style={{ marginTop: 8 }}>Columns from your imported files (like city or due date) show up here and in the table when you pick a file on the left.</p>
                  )}
                </div>
              )}
            </div>

            <div className="ct-chips" aria-live="polite">
              {chips.map((c) => (
                <span className="ct-chip" key={c.key}>{c.label}
                  <button type="button" aria-label={`Remove ${c.label}`} onClick={() => {
                    const next = withoutChip(view.q, view.filter, c.key);
                    if (c.key === 'q') setQText('');
                    change({ q: next.q, filter: next.filter, page: 0, source: view.source.kind === 'list' ? EVERYONE : view.source });
                  }}><X size={16} aria-hidden /></button>
                </span>
              ))}
              {nFilters > 0 && <button type="button" className="ct-btn ct-sm" onClick={() => { setDialog({ kind: 'save-list' }); }}>Save as a list</button>}
              {chips.length > 0 && <button type="button" className="ct-btn ct-g ct-sm" onClick={clearAll}>Clear all</button>}
            </div>

            {pickedCount > 0 && (
              <BulkBar
                picked={pickedCount} everyone={everyone} total={total} pageAllTicked={pageAllTicked}
                tags={sources?.tags ?? []} open={tagOpen} onOpen={setTagOpen}
                onSelectAll={() => { setEveryone(true); }} onClear={resetPick}
                onPick={(t) => { void applyTag(t.id, t.name); }} onCreate={(n) => { void createAndApply(n); }} />
            )}

            <div className="ct-frame" aria-busy={status === 'loading'}>
              <div className="ct-tbl">
                {status === 'loading' && <Skeleton />}
                {status === 'error' && (
                  <div className="ct-empty" role="alert">
                    <h3>Couldn’t load your contacts</h3>
                    <p>The server did not answer. Nothing was lost.</p>
                    <button className="ct-btn ct-p" type="button" onClick={() => { void reload(view); }}>Try again</button>
                  </div>
                )}
                {status === 'ready' && people !== null && noContactsAtAll && (
                  <div className="ct-empty">
                    <h3>No contacts yet</h3>
                    <p>Import a spreadsheet and your people appear here, ready to tag and message.</p>
                    <Link href="/import" className="ct-btn ct-p">Import people</Link>
                  </div>
                )}
                {status === 'ready' && people !== null && !noContactsAtAll && total === 0 && (
                  <div className="ct-empty">
                    <h3>No people match</h3>
                    <p>Try fewer filters, or clear them all.</p>
                    <button className="ct-btn ct-p" type="button" onClick={clearAll}>Clear all filters</button>
                  </div>
                )}
                {status === 'ready' && people !== null && total > 0 && (
                  <table>
                    <thead>
                      <tr>
                        <th className="ct-nm">
                          <div className="ct-nmc">
                            <label className="ct-cb">
                              <input type="checkbox" aria-label="Select everyone on this page" checked={pageAllTicked}
                                onChange={(e) => { tickPage(e.target.checked); }} />
                            </label>
                            <button type="button" aria-label="Sort by name" onClick={() => { change({ sort: view.sort === 'name_asc' ? 'name_desc' : 'name_asc', page: 0 }); }}>
                              Name {view.sort === 'name_asc' ? <ArrowUp size={14} aria-hidden /> : <ArrowDown size={14} aria-hidden />}
                            </button>
                          </div>
                        </th>
                        {visible.map(([k, label]) => <th key={k}>{label}</th>)}
                        {showFileCols.map((c) => <th key={`f:${c}`}>{c}</th>)}
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((p) => (
                        <tr key={p.id} className={`ct-r${isTicked(p.id) ? ' ct-sel' : ''}`} onClick={() => { openPerson(p); }}>
                          <td className="ct-nm">
                            <div className="ct-nmc">
                              <label className="ct-cb" onClick={(e) => { e.stopPropagation(); }}>
                                <input type="checkbox" aria-label={`Select ${p.displayName ?? 'this person'}`} checked={isTicked(p.id)}
                                  onChange={(e) => { tick(p.id, e.target.checked); }} />
                              </label>
                              <button type="button" className="ct-link" data-open={p.id}
                                onClick={(e) => { e.stopPropagation(); openPerson(p); }}>{p.displayName ?? phoneOf(p) ?? 'Unnamed'}</button>
                            </div>
                          </td>
                          {visible.map(([k]) => <td key={k}>{cell(k, p, day)}</td>)}
                          {showFileCols.map((c) => (
                            <td key={`f:${c}`}>{(p.fileValues?.[c] ?? '') === '' ? <span className="ct-mu">Blank</span> : p.fileValues?.[c]}</td>
                          ))}
                          <td className="ct-chev" aria-hidden><ChevronRight size={16} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="ct-foot">
                {status === 'loading' ? <span>Loading people</span> : (
                  <>
                    <span>{showingText(view.page, view.size, total)}</span>
                    {total > 0 && (
                      <span className="ct-pg">
                        <label className="ct-small" htmlFor="ct-sz">Rows</label>
                        <select id="ct-sz" value={view.size} onChange={(e) => { change({ size: Number(e.target.value), page: 0 }); }}>
                          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                        <button className="ct-btn ct-sm" type="button" disabled={view.page === 0}
                          onClick={() => { setView((v) => ({ ...v, page: v.page - 1 })); }}>Previous</button>
                        <span>Page {view.page + 1} of {pageCount(total, view.size)}</span>
                        <button className="ct-btn ct-sm" type="button" disabled={view.page >= pageCount(total, view.size) - 1}
                          onClick={() => { setView((v) => ({ ...v, page: v.page + 1 })); }}>Next</button>
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>

      {person !== undefined && detail !== null && (
        <PersonPanel person={person} detail={detail.data} state={detail.state} timeZone={timeZone}
          onClose={closePerson} onRetry={() => { openPerson(person); }} />
      )}

      {dialog !== null && (
        <DialogBox dialog={dialog} sources={sources} total={total} onCancel={() => { setDialog(null); }}
          onDelete={() => { void confirmDelete(); }} onSave={saveList} />
      )}

      {toast !== null && (
        <div className="ct-toast" role="status">
          <span>{toast.text}</span>
          {toast.undo !== undefined && <button type="button" onClick={() => { toast.undo?.(); setToast(null); }}>Undo</button>}
        </div>
      )}
    </div>
  );
}

/** What one cell of the table says. */
function cell(key: string, p: PersonRow, day: (iso: string) => string) {
  switch (key) {
    case 'phone':
      return <>{p.doNotContact && <span className="ct-dncx">Do not contact </span>}{phoneOf(p) ?? <span className="ct-mu">Missing</span>}</>;
    case 'email': return emailOf(p) ?? <span className="ct-mu">Missing</span>;
    case 'tags': return tagsText(p);
    case 'last': return p.lastCampaign === null ? <span className="ct-mu">Never messaged</span> : p.lastCampaign.name;
    case 'imported': return p.file === null ? <span className="ct-mu">Not imported</span> : day(p.file.importedAt);
    case 'seen': return p.lastActiveAt === null ? <span className="ct-mu">Never replied</span> : day(p.lastActiveAt);
    default: return null;
  }
}

/** Seven grey rows while the first page is on its way. */
function Skeleton() {
  return (
    <div role="status" aria-label="Loading people">
      {[1, 2, 3, 4, 5, 6, 7].map((n) => (
        <div className="ct-sk" key={n}><i style={{ width: 18 }} /><i style={{ width: '30%' }} /><i style={{ width: '20%' }} /><i style={{ width: '25%' }} /></div>
      ))}
    </div>
  );
}

/** The left list: imported files, your tags, saved lists. */
function SourceList(
  { sources, source, isAdmin, day, onPick, onAskDelete, newTagOpen, onNewTag, onMakeTag }: {
    sources: ContactSources | null; source: Source; isAdmin: boolean; day: (iso: string) => string;
    onPick: (s: Source) => void; onAskDelete: (kind: 'delete-tag' | 'delete-list', id: string) => void;
    newTagOpen: boolean; onNewTag: (open: boolean) => void; onMakeTag: (name: string) => void;
  }
) {
  const on = (k: Source['kind'], id: string): boolean => source.kind === k && source.id === id;
  const row = (k: Source['kind'], id: string, name: string, sub: string, del?: 'delete-tag' | 'delete-list') => (
    <div className="ct-frow" key={`${k}:${id}`}>
      <button type="button" className="ct-file" aria-current={on(k, id)} onClick={() => { onPick({ kind: k, id }); }}>
        <b>{name}</b><span>{sub}</span>
      </button>
      {del !== undefined && (
        <button type="button" className="ct-del" aria-label={`Delete ${del === 'delete-tag' ? 'tag' : 'list'} ${name}`} title="Delete"
          onClick={() => { onAskDelete(del, id); }}><X size={18} aria-hidden /></button>
      )}
    </div>
  );
  const people = (n: number): string => `${fmt(n)} ${n === 1 ? 'person' : 'people'}`;
  const [name, setName] = useState('');
  return (
    <>
      <h2>Imported files</h2>
      {row('all', '', 'All people', people(sources?.total ?? 0))}
      {sources?.files.map((f) => row('file', f.id, f.filename ?? 'Untitled file', `${day(f.importedAt)} · ${people(f.count)}`))}
      <p className="ct-small" style={{ margin: '4px 10px 8px' }}>Each file is also a tag, named after the file. Those cannot be deleted here.</p>
      <h2>Your tags</h2>
      {sources !== null && sources.tags.length === 0 && <p className="ct-small" style={{ margin: '0 10px' }}>No tags of your own yet.</p>}
      {sources?.tags.map((t) => row('tag', t.id, t.name, people(t.count), isAdmin ? 'delete-tag' : undefined))}
      {newTagOpen && (
        <input className="ct-in" autoFocus placeholder="Tag name, then Enter" aria-label="New tag name" style={{ margin: '6px 4px', width: 'calc(100% - 8px)' }}
          value={name} onChange={(e) => { setName(e.target.value); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { onMakeTag(name); setName(''); }
            else if (e.key === 'Escape') { onNewTag(false); setName(''); }
          }} />
      )}
      <button type="button" className="ct-btn ct-sm" style={{ margin: '6px 4px 2px' }} onClick={() => { onNewTag(!newTagOpen); }}>
        <Plus size={16} aria-hidden /> New tag
      </button>
      <h2 style={{ marginTop: 12 }}>Saved lists</h2>
      {sources !== null && sources.lists.length === 0 && <p className="ct-small" style={{ margin: '0 10px' }}>No lists yet.</p>}
      {sources?.lists.map((l) => row('list', l.id, l.name, people(l.count), 'delete-list'))}
      <p className="ct-small" style={{ margin: '4px 10px 8px' }}>A list is a saved filter. Unlike a tag, it updates by itself as people change. Set one up with Filters, then Save as a list.</p>
    </>
  );
}

/** The bar that appears when people are ticked: how many, Select all, Add tag, Clear. */
function BulkBar(
  { picked, everyone, total, pageAllTicked, tags, open, onOpen, onSelectAll, onClear, onPick, onCreate }: {
    picked: number; everyone: boolean; total: number; pageAllTicked: boolean;
    tags: ContactSources['tags']; open: boolean; onOpen: (o: boolean) => void;
    onSelectAll: () => void; onClear: () => void;
    onPick: (t: { id: string; name: string }) => void; onCreate: (name: string) => void;
  }
) {
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();
  const exact = tags.some((t) => t.name.toLowerCase() === ql);
  return (
    <div className="ct-bulk" role="region" aria-label="Selected people">
      <span><b>{fmt(picked)}</b> selected{everyone ? ' (everyone who matches)' : ''}</span>
      {!everyone && pageAllTicked && total > picked && (
        <button type="button" className="ct-btn ct-sm ct-g" style={{ color: 'var(--act)', textDecoration: 'underline' }} onClick={onSelectAll}>
          Select all {fmt(total)}
        </button>
      )}
      <span className="ct-sp" />
      <span style={{ position: 'relative' }}>
        <button className="ct-btn ct-sm ct-p" type="button" aria-expanded={open} onClick={() => { onOpen(!open); }}>Add tag</button>
        {open && (
          <div className="ct-card ct-pop ct-tagpop">
            <label className="ct-small" htmlFor="ct-tq">Find a tag, or type a new name</label>
            <input className="ct-in" id="ct-tq" placeholder="Tag name" autoComplete="off" autoFocus value={q}
              onChange={(e) => { setQ(e.target.value); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && ql !== '' && !exact) onCreate(q); }} />
            <div className="ct-menu" style={{ marginTop: 8 }}>
              {ql === '' && <button type="button" onClick={() => { document.getElementById('ct-tq')?.focus(); }}><b>+ Create a new tag</b><span>Type its name above</span></button>}
              {tags.filter((t) => ql === '' || t.name.toLowerCase().includes(ql)).map((t) => (
                <button type="button" key={t.id} onClick={() => { onPick(t); }}><b>{t.name}</b><span>{t.count} {t.count === 1 ? 'person' : 'people'}</span></button>
              ))}
              {ql !== '' && !exact && <button type="button" onClick={() => { onCreate(q); }}><b>Create tag “{q.trim()}”</b><span>New</span></button>}
            </div>
            <p className="ct-small" style={{ marginTop: 8 }}>Each imported file already has its own tag, added by the import, so those are not listed here.</p>
          </div>
        )}
      </span>
      <button className="ct-btn ct-sm ct-g" type="button" onClick={onClear}>Clear</button>
    </div>
  );
}

/** The two small dialogs: delete a tag or list (says who it affects), and name a saved list. */
function DialogBox(
  { dialog, sources, total, onCancel, onDelete, onSave }: {
    dialog: Exclude<Dialog, null>; sources: ContactSources | null; total: number;
    onCancel: () => void; onDelete: () => void; onSave: (name: string) => Promise<string | null>;
  }
) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  let body;
  if (dialog.kind === 'save-list') {
    const submit = async (): Promise<void> => {
      if (name.trim() === '') { document.getElementById('ct-ln')?.focus(); return; }
      setBusy(true);
      setError(await onSave(name));
      setBusy(false);
    };
    body = (
      <>
        <h3 id="ct-dt">Save this filter as a list</h3>
        <p>{total} {total === 1 ? 'person matches' : 'people match'} it now. The list keeps updating by itself as people change.</p>
        <label className="ct-small" htmlFor="ct-ln">List name</label>
        <input className="ct-in" id="ct-ln" autoFocus placeholder="For example, Waiting for us" autoComplete="off" maxLength={100}
          value={name} onChange={(e) => { setName(e.target.value); }} onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />
        {error !== null && <p role="alert" className="ct-hint ct-bad">{error}</p>}
        <div className="ct-row">
          <button className="ct-btn" type="button" onClick={onCancel}>Cancel</button>
          <button className="ct-btn ct-p" type="button" disabled={busy} onClick={() => { void submit(); }}>Save list</button>
        </div>
      </>
    );
  } else if (dialog.kind === 'delete-tag') {
    const t = sources?.tags.find((x) => x.id === dialog.id);
    const text = deleteTagText(t?.name ?? 'this tag', t?.count ?? 0);
    body = (
      <>
        <h3 id="ct-dt">{text.title}</h3><p>{text.body}</p>
        <div className="ct-row">
          <button className="ct-btn" type="button" autoFocus onClick={onCancel}>Cancel</button>
          <button className="ct-btn ct-danger" type="button" onClick={onDelete}>Delete tag</button>
        </div>
      </>
    );
  } else {
    const l = sources?.lists.find((x) => x.id === dialog.id);
    body = (
      <>
        <h3 id="ct-dt">Delete list “{l?.name ?? 'this list'}”?</h3>
        <p>Only the saved filter is deleted. The {l?.count ?? 0} {l?.count === 1 ? 'person' : 'people'} it shows now stay in your contacts. This cannot be undone.</p>
        <div className="ct-row">
          <button className="ct-btn" type="button" autoFocus onClick={onCancel}>Cancel</button>
          <button className="ct-btn ct-danger" type="button" onClick={onDelete}>Delete list</button>
        </div>
      </>
    );
  }
  return (
    <>
      <div className="ct-scrim ct-top" onClick={onCancel} aria-hidden />
      <div className="ct-dlg" role="alertdialog" aria-modal="true" aria-labelledby="ct-dt">{body}</div>
    </>
  );
}
