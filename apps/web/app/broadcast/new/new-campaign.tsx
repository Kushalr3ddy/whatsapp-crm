'use client';

import './new-campaign.css';
import { FormatButtons, useMessageBox } from '@/components/message-box';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import type { AiTemplate, AudienceHistory, BlankFillInChoice, CampaignReview, ImportRun, ReviewTarget, Segment, Sender, Tag } from '@/lib/crm';
import {
  applyVariations, BLANK_WORD, checkFillIns, esc, estimateFinish, lastUsedDay, monthHeading, monthOf,
  monthOptions, previewHtml, quietHoursText, removeVariations, shortDay, type BlankChoice, type Column
} from '@/lib/new-campaign';
import { blankListAction, createCampaignAction, reviewAction, saveCampaignAction, uploadPictureAction } from '../actions';

/** A draft being edited: everything it was made with, so the form opens with it all back. */
export interface EditingDraft {
  id: string; name: string; body: string; senderIdentityId: string; targets: ReviewTarget[];
  mediaAssetId: string | null; mediaFilename: string | null; mediaSizeBytes: number | null; mediaAfterReply: boolean;
  aiTemplateId: string | null; blankFillInChoice: BlankFillInChoice | null; recentDays: number | null; leaveOutRecent: boolean;
}

/** What the page hands the screen: everything it can pick from, already read on the server. */
export interface NewCampaignProps {
  senders: Sender[];
  imports: ImportRun[];
  tags: Tag[];
  templates: AiTemplate[];
  history: AudienceHistory;
  /** How many contacts there are, for "Send to everyone (530)". */
  everyoneCount: number;
  defaultImportId?: string | undefined;
  defaultTagId?: string | undefined;
  /** Saved lists, to name a pick of one when a draft is edited. */
  segments?: Segment[] | undefined;
  /** Set when a draft is being edited: the form opens with its values and saves back onto it. */
  editing?: EditingDraft | undefined;
}

/** One thing picked as the audience, with what the chip and the "Sending to" line say about it. */
interface Chosen { key: string; target: ReviewTarget; name: string; people: number; day: string | null }

/** The columns every contact has, before any file is chosen. */
const BUILT_IN: Column[] = [
  { key: 'name', label: 'Name', type: 'text', have: 0 },
  { key: 'first_name', label: 'First name', type: 'text', have: 0 }
];

/** A picture the person chose, already stored on the server. */
interface Picture { id: string; filename: string | null; sizeBytes: number }

/** The submit button: off until the review says the draft is ready, and off while it is being made. */
function CreateButton({ ready, label, pendingLabel }: { ready: boolean; label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="nc-btn nc-p" disabled={!ready || pending} aria-busy={pending} style={{ opacity: ready && !pending ? 1 : 0.5 }}>
      {pending ? pendingLabel : label}
    </button>
  );
}

/**
 * New campaign: three steps (Message, Who gets it, Send from) and a sticky review that updates as you go. The review reads the same
 * audience rule the draft will freeze, so the people it counts, the ones it leaves out and why, and the fill-in table are the real ones.
 * Nothing is sent: it only makes a draft.
 */
export function NewCampaign(props: NewCampaignProps) {
  const { senders, imports, tags, templates, history, everyoneCount, editing } = props;

  const startPicture: Picture | null = editing?.mediaAssetId ? { id: editing.mediaAssetId, filename: editing.mediaFilename, sizeBytes: editing.mediaSizeBytes ?? 0 } : null;
  const firstLinked = senders.find((s) => s.linked) ?? senders[0];
  const [mode, setMode] = useState<'own' | 'tpl'>((editing?.aiTemplateId ?? null) !== null ? 'tpl' : 'own');
  const [templateId, setTemplateId] = useState<string | null>(editing?.aiTemplateId ?? null);
  const [name, setName] = useState(editing?.name ?? '');
  const [body, setBody] = useState(editing?.body ?? '');
  const [varsOpen, setVarsOpen] = useState(false);
  const [varsText, setVarsText] = useState('Hi, Hey, Hello');
  const [menuOpen, setMenuOpen] = useState(false);
  const [picture, setPicture] = useState<Picture | null>(startPicture);
  const [picNote, setPicNote] = useState<string | null>(startPicture === null ? null : `${startPicture.filename ?? 'picture'} · ${(startPicture.sizeBytes / 1048576).toFixed(2)} MB`);
  const [uploading, startUpload] = useTransition();
  const [after, setAfter] = useState(editing?.mediaAfterReply ?? true);
  const [senderId, setSenderId] = useState(editing !== undefined && senders.some((s) => s.id === editing.senderIdentityId) ? editing.senderIdentityId : firstLinked?.id ?? '');

  const startPick = (): Chosen[] => {
    const run = props.defaultImportId === undefined ? undefined : imports.find((r) => r.id === props.defaultImportId);
    if (run !== undefined) return [importPick(run)];
    const tag = props.defaultTagId === undefined ? undefined : tags.find((t) => t.id === props.defaultTagId);
    return tag === undefined ? [] : [tagPick(tag)];
  };
  const [picks, setPicks] = useState<Chosen[]>(() => (editing === undefined ? startPick() : editing.targets.map(chosenFor)));
  const [source, setSource] = useState<'file' | 'tag'>(props.defaultTagId !== undefined && props.defaultImportId === undefined ? 'tag' : 'file');
  const [month, setMonth] = useState('all');
  const [query, setQuery] = useState('');
  const [listOpen, setListOpen] = useState(false);

  const [review, setReview] = useState<CampaignReview | null>(null);
  const [person, setPerson] = useState(0);
  const [choice, setChoice] = useState<BlankChoice>(editing === undefined || editing.blankFillInChoice === 'skip' ? 'skip' : editing.blankFillInChoice === 'fallback' ? 'word' : 'any');
  const [days, setDays] = useState<number | null>(editing?.recentDays ?? null);
  const [leaveOut, setLeaveOut] = useState(editing?.leaveOutRecent ?? false);
  const [saved, setSaved] = useState<string | null>(null);
  const [clock, setClock] = useState('');

  const fileRef = useRef<HTMLInputElement>(null);
  const comboRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setClock(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date()).replace(/\s?([ap])m/i, (_m, x: string) => ` ${x.toLowerCase()}m`));
  }, []);

  const targets = useMemo(() => picks.map((p) => p.target), [picks]);
  const targetsKey = JSON.stringify(targets);

  // The review is read again whenever the picks, the number or "recently" change. The last answer stays up while the next one loads.
  useEffect(() => {
    if (targets.length === 0 || senderId === '') { setReview(null); return; }
    let live = true;
    const timer = setTimeout(() => {
      void reviewAction(targets, senderId, days ?? undefined).then((r) => { if (live) { setReview(r); setPerson(0); } });
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [targetsKey, senderId, days]);

  // Close the pick list when you click away from it.
  useEffect(() => {
    const away = (e: MouseEvent): void => { if (comboRef.current !== null && !comboRef.current.contains(e.target as Node)) setListOpen(false); };
    document.addEventListener('click', away);
    return () => { document.removeEventListener('click', away); };
  }, []);

  const columns: Column[] = review === null ? BUILT_IN : review.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, have: f.have }));
  const total = review?.total ?? 0;
  const check = useMemo(() => (review === null ? null : checkFillIns(body, columns, total)),
    [body, review, total]);
  const blank = check?.mostMissing ?? null;
  const skipBlank = blank !== null && choice === 'skip' ? blank.missing : 0;
  const hard = (review?.askedToStop ?? 0) + (review?.noNumber ?? 0);
  const recent = review?.recentlyMessaged ?? 0;
  const reach = review === null ? 0 : Math.max(0, total - hard - skipBlank - (leaveOut ? recent : 0));
  const skipped = review === null ? 0 : total - reach;
  const sender = senders.find((s) => s.id === senderId);
  const people = review?.people ?? [];
  const who = people.length > 0 ? people[person % people.length]! : null;
  const unknownKeys = check?.unknown ?? [];

  const finish = review !== null && reach > 0
    ? estimateFinish(reach, new Date(), { minMs: review.gapMinMs, maxMs: review.gapMaxMs }, review.quietHours)
    : null;
  const quiet = review?.quietHours ?? { enabled: true, start: '22:00', end: '08:00', timeZone: 'Asia/Kolkata' };

  const ready = name.trim() !== '' && body.trim() !== '' && unknownKeys.length === 0 && reach > 0 && sender !== undefined;

  // ---- the message box -------------------------------------------------------------------------------------------------------
  // The toolbar, Ctrl+B / Ctrl+I, the fill-in list and the cursor handling are the shared message box (`components/message-box.tsx`).
  const box = useMessageBox(body, setBody, setMenuOpen);

  // ---- the picture -----------------------------------------------------------------------------------------------------------
  /** Checks the size, then uploads the chosen picture; the server checks everything else from its bytes. */
  function takePicture(file: File | undefined): void {
    if (file === undefined) return;
    if (file.type === 'video/mp4' || /\.mp4$/i.test(file.name)) { setPicNote('MP4 videos are not supported yet. Use a picture or a GIF.'); return; }
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) { setPicNote('That file type is not supported. Use a JPG, PNG, WebP or GIF.'); return; }
    if (file.size > 5 * 1024 * 1024) { setPicNote(`That file is ${(file.size / 1048576).toFixed(1)} MB. The limit is 5 MB.`); return; }
    const fd = new FormData();
    fd.set('file', file);
    setPicNote('Uploading…');
    startUpload(async () => {
      const r = await uploadPictureAction(fd);
      if (!r.ok || r.picture === undefined) { setPicNote(r.error ?? 'Could not upload it.'); return; }
      setPicture({ id: r.picture.id, filename: r.picture.filename, sizeBytes: r.picture.sizeBytes });
      setPicNote(`${r.picture.filename ?? 'picture'} · ${(r.picture.sizeBytes / 1048576).toFixed(2)} MB`);
    });
  }
  /** Takes the picture off the campaign. */
  function clearPicture(): void { setPicture(null); setPicNote(null); if (fileRef.current !== null) fileRef.current.value = ''; }

  // ---- who gets it -----------------------------------------------------------------------------------------------------------
  const files = useMemo(() => imports.map((r) => ({ id: r.id, name: r.filename ?? 'import', at: r.createdAt, people: r.contactCount }))
    .sort((a, b) => (a.at < b.at ? 1 : -1)), [imports]);
  const months = useMemo(() => monthOptions(files), [files]);
  const has = (key: string): boolean => picks.some((p) => p.key === key);
  /** Adds a pick, or removes it when it is already chosen. "Everyone" cannot sit beside other picks. */
  function toggle(p: Chosen): void { setPicks((cur) => (cur.some((x) => x.key === p.key) ? cur.filter((x) => x.key !== p.key) : [...cur.filter((x) => x.target.kind !== 'everyone'), p])); }
  /** A saved pick of a draft as the chip and the "Sending to" line show it. */
  function chosenFor(t: ReviewTarget): Chosen {
    if (t.kind === 'import') { const r = imports.find((x) => x.id === t.id); return r === undefined ? { key: `i:${t.id}`, target: t, name: 'a file', people: 0, day: null } : importPick(r); }
    if (t.kind === 'tag') { const g = tags.find((x) => x.id === t.id); return g === undefined ? { key: `t:${t.id}`, target: t, name: 'a tag', people: 0, day: null } : tagPick(g); }
    if (t.kind === 'segment') { const g = props.segments?.find((x) => x.id === t.id); return { key: `s:${t.id}`, target: t, name: g?.name ?? 'a saved list', people: g?.contactCount ?? 0, day: null }; }
    if (t.kind === 'people') return { key: 'people', target: t, name: 'People picked in Contacts', people: t.ids.length, day: null };
    return { key: 'everyone', target: t, name: 'Everyone', people: everyoneCount, day: null };
  }
  /** A file as a pick. */
  function importPick(r: ImportRun): Chosen { return { key: `i:${r.id}`, target: { kind: 'import', id: r.id }, name: r.filename ?? 'import', people: r.contactCount, day: shortDay(r.createdAt) }; }
  /** A tag as a pick. */
  function tagPick(t: Tag): Chosen { return { key: `t:${t.id}`, target: { kind: 'tag', id: t.id }, name: t.name, people: t.contactCount ?? 0, day: null }; }
  const q = query.trim().toLowerCase();
  const fileRows = files.filter((f) => (month === 'all' || monthOf(f.at) === month) && (q === '' || f.name.toLowerCase().includes(q)));
  const tagRows = tags.filter((t) => q === '' || t.name.toLowerCase().includes(q));

  /** "last campaign: Diwali offer, 2 Nov" or "not used in a campaign yet". */
  function lastUsed(entry: { name: string; at: string } | undefined): string {
    return entry === undefined ? 'not used in a campaign yet' : `last campaign: ${entry.name}, ${lastUsedDay(entry.at)}`;
  }

  /** Saves the people with no value for a fill-in as a spreadsheet file. */
  async function download(key: string): Promise<void> {
    const r = await blankListAction(targets, key);
    if (!r.ok || r.csv === undefined) { setSaved('Could not make the list. Try again.'); return; }
    const url = URL.createObjectURL(new Blob([r.csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `people-without-${key}.csv`; a.click();
    URL.revokeObjectURL(url);
    setSaved(`Saved as a list: people-without-${key}.csv`);
  }

  // ---- the review ------------------------------------------------------------------------------------------------------------
  const previewBody = previewHtml(body === '' ? '' : body, who, columns, person, choice);
  const picHtml = picture === null ? '' : `<img src="/media/${esc(picture.id)}/thumb" alt="Attached picture" class="nc-pimg">`;
  const bubble = picture !== null && !after ? `${picHtml}<div>${previewBody}</div>` : previewBody;
  const sendingTo = picks.length === 0 ? 'nobody yet' : picks.map((p) => (p.day !== null ? `${p.name} (${p.day})` : p.name)).join(', ');
  const whyParts: string[] = [];
  if (review !== null) {
    if (review.askedToStop > 0) whyParts.push(`${String(review.askedToStop)} asked to stop`);
    if (review.noNumber > 0) whyParts.push(`${String(review.noNumber)} with no number`);
    if (skipBlank > 0 && blank !== null) whyParts.push(`${String(skipBlank)} with no ${blank.label.toLowerCase()}`);
    if (leaveOut && recent > 0) whyParts.push(`${String(recent)} messaged recently`);
  }

  const lines: Array<['y' | 'n' | 'x', string]> = [];
  lines.push(name.trim() !== '' ? ['y', 'Named'] : ['x', 'Give it a name']);
  lines.push(body.trim() !== '' && unknownKeys.length === 0 ? ['y', 'Message is written'] : ['x', unknownKeys.length > 0 ? `Fix the fill-in “${unknownKeys[0]!.key}”` : 'Write the message']);
  lines.push(reach > 0 ? ['y', `${reach.toLocaleString('en-US')} people will get it`] : ['x', 'Choose who gets it']);
  if (sender !== undefined) lines.push(sender.linked ? ['y', `Sending from ${sender.label ?? 'number'}`] : ['n', `${sender.label ?? 'number'} is not linked: it will wait until you link it`]);
  if (blank !== null && choice === 'skip') lines.push(['y', `${String(blank.missing)} people with a blank fill-in are left out`]);
  if (blank !== null && choice === 'any') lines.push(['n', `${String(blank.missing)} people will see a blank where the fill-in goes`]);
  if (recent > 0) lines.push(leaveOut ? ['y', `${String(recent)} recently messaged people will not get it`] : ['n', `${String(recent)} recently messaged people will get it (last ${String(review?.recentDays ?? 14)} days)`]);

  const shownDays = days ?? review?.recentDays ?? 14;

  /** The example for one fill-in in the table: the previewed person's value, or "blank for Priya". */
  /** The previewed person value for one fill-in, or "blank for Priya". */
  function example(key: string): { text: string; blank: boolean } {
    const v = who?.values[key];
    if (v !== undefined && v !== '') return { text: v, blank: false };
    return { text: `blank for ${(who?.name ?? 'this person').split(' ')[0]!}`, blank: true };
  }

  const nameDone = body.trim() !== '' && name.trim() !== '' && unknownKeys.length === 0;

  return (
    <div className="nc nc-wrap">
      <form action={editing === undefined ? createCampaignAction : saveCampaignAction} className="nc-app">
        {editing !== undefined && <input type="hidden" name="campaignId" value={editing.id} />}
        <input type="hidden" name="name" value={name} />
        <input type="hidden" name="body" value={body} />
        <input type="hidden" name="senderIdentityId" value={senderId} />
        <input type="hidden" name="targets" value={targetsKey} />
        <input type="hidden" name="mediaAssetId" value={picture?.id ?? ''} />
        <input type="hidden" name="aiTemplateId" value={mode === 'tpl' ? templateId ?? '' : ''} />
        <input type="hidden" name="blankFillInChoice" value={choice === 'skip' ? 'skip' : choice === 'word' ? 'fallback' : ''} />
        <input type="hidden" name="fillInFallback" value={choice === 'word' ? BLANK_WORD : ''} />
        <input type="hidden" name="recentDays" value={shownDays} />
        {leaveOut && <input type="hidden" name="leaveOutRecent" value="on" />}
        {after && <input type="hidden" name="mediaAfterReply" value="on" />}

        <div className="nc-grid">
          <div className="nc-col">
            {/* 1 */}
            <section className="nc-card nc-step" aria-labelledby="nc-s1">
              <div className="nc-sh"><span className="nc-n">1</span><h3 id="nc-s1">Message</h3><span className="nc-done">{nameDone ? '✓ ready' : ''}</span></div>
              <div className="nc-seg" role="group" aria-label="How to write it">
                <button type="button" aria-pressed={mode === 'own'} onClick={() => { setMode('own'); setTemplateId(null); }}>Write it myself</button>
                <button type="button" aria-pressed={mode === 'tpl'} onClick={() => { setMode('tpl'); }}>Use a template</button>
              </div>

              {mode === 'tpl' && (
                <>
                  {templates.length > 0 && (
                    <div className="nc-cards">
                      {templates.map((t) => (
                        <button key={t.id} type="button" className="nc-opt" aria-pressed={templateId === t.id}
                          onClick={() => { setTemplateId(t.id); setBody(t.firstMessage); }}>
                          <b>{t.name}</b><span>{t.description}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {templates.length === 0 && <p className="nc-small">No saved templates yet.</p>}
                  <div className="nc-hint nc-ok"><span>The opening goes into the message box (you can still change it), and <b>this template answers their replies</b>. It stays attached to the campaign.</span></div>
                  <p className="nc-small">Need one that isn&apos;t here? <Link href="/ai" className="nc-link">Write a template with AI</Link>. You describe it once, review it, and it is saved here for every later campaign.</p>
                </>
              )}

              <div>
                <label className="nc-l" htmlFor="nc-nm">Name</label>
                <input className="nc-in" id="nc-nm" value={name} onChange={(e) => { setName(e.target.value); }} autoComplete="off" maxLength={200}
                  placeholder="e.g. October Pune outreach" data-lpignore="true" data-1p-ignore="true" />
              </div>
              <div>
                <div className="nc-tools">
                  <label className="nc-l" htmlFor="nc-body" style={{ margin: 0 }}>Message</label>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <FormatButtons className="nc-fmt" onWrap={box.wrap} />
                    <button type="button" className="nc-chipbtn" onClick={() => { box.setBraceTyped(false); setMenuOpen(!menuOpen); }}>{'{ }'} Insert fill-in</button>
                    <button type="button" className="nc-chipbtn" style={{ color: 'var(--mu)', fontFamily: 'var(--fu)' }} onClick={() => { setVarsOpen(!varsOpen); }}>Add wording variations</button>
                  </div>
                </div>
                {menuOpen && (
                  <div className="nc-menu" style={{ margin: '8px 0' }}>
                    {columns.map((c) => (
                      <button key={c.key} type="button" onClick={() => { box.insert(c.key, box.braceTyped); }}>
                        <b>{`{{${c.key}}}`}</b><span>{c.label}{review !== null ? ` · ${c.have.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} have it` : ''}</span>
                      </button>
                    ))}
                  </div>
                )}
                {varsOpen && (
                  <div className="nc-hint nc-ok" style={{ margin: '8px 0' }}>
                    <span><b>Wording variations.</b> Each person gets one of these greetings, so 500 messages are not word for word the same. Use the arrows in the preview to see them.</span>
                    <span className="nc-acts">
                      <input className="nc-in" value={varsText} onChange={(e) => { setVarsText(e.target.value); }} aria-label="Greeting options, separated by commas" style={{ width: 210, minHeight: 36 }} />
                      <button className="nc-btn nc-sm" type="button" onClick={() => { setBody(applyVariations(body, varsText.split(','))); }}>Apply</button>
                      <button className="nc-btn nc-sm nc-g" type="button" onClick={() => { setBody(removeVariations(body)); }}>Remove</button>
                    </span>
                  </div>
                )}
                <textarea ref={box.ref} className="nc-in" id="nc-body" value={body} style={{ marginTop: 8 }} maxLength={4096}
                  placeholder="What every recipient receives…"
                  onChange={(e) => { box.onChange(e.target.value, e.target.selectionStart); }}
                  onKeyDown={(e) => { box.onKeyDown(e); }} />
                <div className="nc-meter" style={{ marginTop: 6 }}>
                  <span>{body.length.toLocaleString('en-US')} characters</span>
                  <span>Like WhatsApp: <code>*bold*</code> <code>_italic_</code> <code>~strike~</code> · type <code>{'{'}</code> for a fill-in</span>
                </div>
              </div>

              <FillHint
                review={review} check={check} choice={choice} setChoice={setChoice} saved={saved}
                onDownload={(k) => { void download(k); }} total={total} />

              <p className="nc-small">Every column you can use is listed in the table under the review, with an example for each.</p>
              <div className="nc-drop">
                <span>{picNote ?? 'Picture or GIF (optional, up to 5 MB)'}</span>
                <button className="nc-btn nc-sm" type="button" disabled={uploading} onClick={() => { if (picture !== null) clearPicture(); else fileRef.current?.click(); }}>
                  {picture !== null ? 'Remove' : 'Choose a file'}
                </button>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden aria-label="Picture or GIF"
                  onChange={(e) => { takePicture(e.target.files?.[0]); }} />
              </div>
              <label className="nc-sw">
                <input type="checkbox" checked={after} onChange={(e) => { setAfter(e.target.checked); }} />
                <span className="nc-t" />
                <span><b style={{ fontWeight: 500 }}>Send the picture after they reply</b><br /><span className="nc-small">People who don&apos;t reply won&apos;t get the picture.</span></span>
              </label>
            </section>

            {/* 2 */}
            <section className="nc-card nc-step" aria-labelledby="nc-s2">
              <div className="nc-sh"><span className="nc-n">2</span><h3 id="nc-s2">Who gets it</h3><span className="nc-done">{reach > 0 ? `✓ ${reach.toLocaleString('en-US')} people` : ''}</span></div>
              <div className="nc-chosen" aria-live="polite">
                {picks.length === 0 && <span className="nc-small">Nothing chosen yet.</span>}
                {picks.map((p) => (
                  <span key={p.key} className="nc-pill">{p.name} <span className="nc-small">· {p.people.toLocaleString('en-US')}</span>
                    <button type="button" aria-label={`Remove ${p.name}`} onClick={() => { toggle(p); }}>×</button>
                  </span>
                ))}
              </div>
              <div className="nc-seg" role="group" aria-label="Chosen from">
                <button type="button" aria-pressed={source === 'file'} onClick={() => { setSource('file'); setMonth('all'); setQuery(''); setListOpen(false); }}>A file</button>
                <button type="button" aria-pressed={source === 'tag'} onClick={() => { setSource('tag'); setQuery(''); setListOpen(false); }}>A tag</button>
              </div>
              {source === 'file' && (
                <div className="nc-row2" style={{ justifyContent: 'flex-start' }}>
                  <label className="nc-l" htmlFor="nc-mon" style={{ margin: 0 }}>Month</label>
                  <select className="nc-in" id="nc-mon" style={{ width: 'auto' }} value={month} onChange={(e) => { setMonth(e.target.value); setListOpen(true); }}>
                    <option value="all">All months · {files.length} {files.length === 1 ? 'file' : 'files'}</option>
                    {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
              )}
              <p className="nc-small">{source === 'file' ? 'Files are the spreadsheets you imported on the Import page, newest first.' : 'Tags are the labels you added to contacts.'}</p>
              <label className="nc-l" htmlFor="nc-aq" style={{ margin: '0 0 -8px' }}>{source === 'tag' ? 'Tag' : 'File'}</label>
              <div className="nc-cbx" style={{ position: 'relative' }} ref={comboRef}>
                <input className="nc-in nc-aq" id="nc-aq" role="combobox" aria-expanded={listOpen} aria-controls="nc-alist" value={query}
                  placeholder={source === 'tag' ? 'Type to search, or pick a tag…' : 'Type to search, or pick a file…'} autoComplete="off"
                  onFocus={() => { setListOpen(true); }} onChange={(e) => { setQuery(e.target.value); setListOpen(true); }}
                  onKeyDown={(e) => { if (e.key === 'Escape') setListOpen(false); }} />
                {listOpen && (
                  <div id="nc-alist" className="nc-menu" role="listbox" style={{ position: 'absolute', left: 0, right: 0, top: 48, zIndex: 5, maxHeight: 320, overflow: 'auto' }}>
                    {source === 'file' && fileRows.map((f, i) => {
                      const p = importPick({ id: f.id, filename: f.name, status: 'committed', createdAt: f.at, contactCount: f.people });
                      return (
                        <div key={f.id}>
                          {(i === 0 || monthOf(fileRows[i - 1]!.at) !== monthOf(f.at)) && <span className="nc-small nc-mh">{monthHeading(monthOf(f.at))}</span>}
                          <button type="button" role="option" aria-selected={has(p.key)} onClick={() => { toggle(p); setQuery(''); setListOpen(false); }}>
                            <b>{f.name}{has(p.key) ? ' ✓' : ''}</b><span>{shortDay(f.at)} · {f.people.toLocaleString('en-US')} people · {lastUsed(history.imports[f.id])}</span>
                          </button>
                        </div>
                      );
                    })}
                    {source === 'tag' && tagRows.map((t) => {
                      const p = tagPick(t);
                      return (
                        <button key={t.id} type="button" role="option" aria-selected={has(p.key)} onClick={() => { toggle(p); setQuery(''); setListOpen(false); }}>
                          <b>{t.name}{has(p.key) ? ' ✓' : ''}</b><span>{(t.contactCount ?? 0).toLocaleString('en-US')} people · {lastUsed(history.tags[t.id])}</span>
                        </button>
                      );
                    })}
                    {((source === 'file' && fileRows.length === 0) || (source === 'tag' && tagRows.length === 0)) && (
                      <span className="nc-small" style={{ display: 'block', padding: '12px 14px' }}>Nothing matches.</span>
                    )}
                  </div>
                )}
              </div>
              <div className="nc-row2">
                <span className="nc-small">{picks.length > 1 ? 'People who are in more than one are counted once.' : 'Add as many as you like.'}</span>
                <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button className="nc-btn nc-g nc-sm" type="button"
                    onClick={() => { setPicks([{ key: 'everyone', target: { kind: 'everyone' }, name: 'Everyone', people: everyoneCount, day: null }]); }}>
                    Send to everyone ({everyoneCount.toLocaleString('en-US')})
                  </button>
                  <Link className="nc-btn nc-g nc-sm" href="/contacts">Chosen people in Contacts</Link>
                </span>
              </div>
            </section>

            {/* 3 */}
            <section className="nc-card nc-step" aria-labelledby="nc-s3">
              <div className="nc-sh"><span className="nc-n">3</span><h3 id="nc-s3">Send from</h3><span className="nc-done">{sender?.linked === true ? '✓ linked' : ''}</span></div>
              <div className="nc-cards">
                {senders.map((s) => (
                  <button key={s.id} type="button" className="nc-opt" aria-pressed={senderId === s.id} onClick={() => { setSenderId(s.id); }}>
                    <b>{s.label ?? 'number'}</b><span>{s.phoneE164 ?? 'not linked yet'}</span>
                    <span className={`nc-st ${s.linked ? 'nc-ok' : 'nc-bd'}`}><i />{s.linked ? 'Linked' : 'Not linked'}</span>
                  </button>
                ))}
              </div>
              <div className="nc-row2">
                <span className="nc-small">Quiet hours: no sending <b style={{ color: 'var(--ink)', fontWeight: 500 }}>{quietHoursText(quiet)}</b>, India time. Set once for your organisation.</span>
                <Link className="nc-btn nc-g nc-sm" href="/numbers">Change in Sending rules</Link>
              </div>
            </section>
          </div>

          {/* review */}
          <aside className="nc-card nc-side" aria-label="Review">
            <h3>Review</h3>
            <div className="nc-phone">
              <div className="nc-who"><span>Campaign <b>{name.trim() === '' ? 'Untitled' : name.trim()}</b></span></div>
              <div className="nc-who"><span>Sending to <b>{sendingTo}</b></span></div>
              <div className="nc-who">
                <span>Preview for <b>{who === null ? '—' : who.name ?? 'No name saved'}</b></span>
                <span className="nc-arrows">
                  <button type="button" aria-label="Previous person" disabled={people.length < 2} onClick={() => { setPerson((person + people.length - 1) % people.length); }}>‹</button>
                  <button type="button" aria-label="Next person" disabled={people.length < 2} onClick={() => { setPerson((person + 1) % people.length); }}>›</button>
                </span>
              </div>
              <div className="nc-wa">
                <div className="nc-wa-head">
                  <span className="nc-wa-av" aria-hidden="true">{(sender?.label ?? 'B').slice(0, 1).toUpperCase()}</span>
                  <span><b>{sender?.label ?? 'number'}</b><small>business account</small></span>
                  <span className="nc-wa-ic" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><rect x="3" y="6" width="12" height="12" rx="2" /><path d="m15 10 6-3v10l-6-3z" /></svg>
                    <svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z" /></svg>
                    <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6" /><path d="m20 20-4.2-4.2" /></svg>
                  </span>
                </div>
                <div className="nc-wa-body">
                  <span className="nc-wa-day">Today</span>
                  <div className="nc-bub nc-wa-out">
                    <span dangerouslySetInnerHTML={{ __html: bubble }} />
                    <small>{clock} <span className="nc-tk" aria-label="delivered">✓✓</span></small>
                  </div>
                  {picture !== null && after && (
                    <div className="nc-bub nc-wa-out">
                      <div className="nc-wa-note">Sent after they reply</div>
                      <span dangerouslySetInnerHTML={{ __html: picHtml }} />
                      <small>{clock} <span className="nc-tk">✓✓</span></small>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="nc-facts">
              <div className="nc-fact"><b>{reach.toLocaleString('en-US')}</b><span>people it reaches</span></div>
              <div className="nc-fact"><b>{skipped.toLocaleString('en-US')}</b><span>skipped</span></div>
              <div className="nc-fact nc-wide"><span>Why they are skipped</span><span style={{ fontSize: 14, color: 'var(--ink)' }}>{review === null ? 'Choose who it goes to' : whyParts.length > 0 ? whyParts.join(', ') : 'Nobody is left out'}</span></div>
              <div className="nc-fact nc-wide"><span>How long</span><b>{finish === null ? 'Nothing to send' : finish.duration}</b><span>{finish === null ? 'Choose who it goes to' : finish.finish}</span></div>
            </div>
            {recent > 0 && (
              <div className={`nc-hint${leaveOut ? ' nc-ok' : ''}`}>
                <span><b>{recent.toLocaleString('en-US')} people</b> were messaged in the last {shownDays} days. <b>{leaveOut ? 'They will NOT get this message.' : 'They WILL get this message.'}</b></span>
                <span className="nc-seg" role="group" aria-label="What to do with them">
                  <button type="button" aria-pressed={!leaveOut} onClick={() => { setLeaveOut(false); }}>Send to them</button>
                  <button type="button" aria-pressed={leaveOut} onClick={() => { setLeaveOut(true); }}>Do not send to them</button>
                </span>
                <label className="nc-small" htmlFor="nc-rdays" style={{ width: '100%' }}>“Recently” means within{' '}
                  <input className="nc-in" id="nc-rdays" type="number" min={1} max={60} value={shownDays} style={{ width: 68, minHeight: 36, display: 'inline-block' }}
                    onChange={(e) => { const v = parseInt(e.target.value, 10); if (v >= 1 && v <= 60) setDays(v); }} /> days. Your default, set once in Settings.
                </label>
              </div>
            )}
            <div className="nc-checks" aria-live="polite">
              {lines.map(([tone, text]) => <div key={text} className={`nc-${tone}`}><i>{tone === 'y' ? '✓' : tone === 'n' ? '!' : '×'}</i><span>{text}</span></div>)}
            </div>
            <div className="nc-go">
              <CreateButton ready={ready} label={editing === undefined ? 'Create draft' : 'Save changes'} pendingLabel={editing === undefined ? 'Creating…' : 'Saving…'} />
              <Link href={editing === undefined ? '/broadcast' : `/broadcast/${editing.id}`} className="nc-btn">Cancel</Link>
            </div>
          </aside>
        </div>
      </form>

      <section className="nc-card nc-tablecard" aria-labelledby="nc-ft-h">
        <h2 id="nc-ft-h">Fill-ins from your file <span className="nc-small">{review === null ? '' : `· ${String(columns.length)} columns`}</span></h2>
        <p className="nc-small">
          {review === null
            ? 'Choose who gets it and every column of your file shows up here, with an example.'
            : `Click a row to put it in the message. The examples are from ${who?.name ?? 'this person'}’s row; use the arrows in the review panel to see another person’s.`}
        </p>
        <table className="nc-ft">
          <thead><tr><th>Fill-in</th><th>Column in your file</th><th>Example</th><th>People who have it</th></tr></thead>
          <tbody>
            {review !== null && columns.map((c) => {
              const ex = example(c.key);
              const click = (): void => { box.insert(c.key, false); };
              return (
                <tr key={c.key}>
                  <td><button type="button" onClick={click}><code>{`{{${c.key}}}`}</code></button></td>
                  <td><button type="button" onClick={click}>{c.label}<span className="nc-ty">{c.type}</span></button></td>
                  <td><button type="button" onClick={click}>{ex.blank ? <span className="nc-no">{ex.text}</span> : <span className="nc-e">{ex.text}</span>}</button></td>
                  <td><button type="button" onClick={click}>{c.have.toLocaleString('en-US')} of {total.toLocaleString('en-US')}</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/** The line under the message box: what is wrong with a fill-in, or the question about people who have no value for one. */
function FillHint(props: {
  review: CampaignReview | null; check: ReturnType<typeof checkFillIns> | null; choice: BlankChoice; setChoice: (c: BlankChoice) => void;
  saved: string | null; onDownload: (key: string) => void; total: number;
}) {
  const { check, choice, setChoice, total } = props;
  if (check === null) return null;
  const bad = check.unknown[0];
  const blank = check.mostMissing;
  const parts: ReactNode[] = [];

  if (check.noName > 0) {
    parts.push(<div key="nm" className="nc-hint nc-ok"><span><b>{check.noName.toLocaleString('en-US')} people</b> have no name saved. They will read “Hi there”. Nothing to decide.</span></div>);
  }
  if (bad !== undefined) {
    parts.push(
      <div key="bad" className="nc-hint">
        <span>{bad.everyoneLacks ? <>Nobody in these people has <b>{bad.key}</b>.</> : <>No column called <b>{bad.key}</b>.{bad.suggestion !== null ? ` Did you mean ${bad.suggestion}?` : ''}</>}</span>
      </div>
    );
  } else if (blank !== null && choice === 'skip') {
    const sparse = blank.have * 2 < total;
    const col = blank.label.toLowerCase();
    parts.push(
      <div key="blank" className={`nc-hint${sparse ? '' : ' nc-ok'}`}>
        <span><b>{blank.missing.toLocaleString('en-US')} people</b> have no {col}, so they will not get this message.{' '}
          {sparse ? `Only ${blank.have.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} have it, so this leaves ${blank.have.toLocaleString('en-US')} ${blank.have === 1 ? 'person' : 'people'}. Taking it out of the message may be better.` : 'Nobody is sent a message with a gap in it.'}</span>
        <span className="nc-acts">
          <button className="nc-btn nc-sm" type="button" onClick={() => { props.onDownload(blank.key); }}>Download the {blank.missing.toLocaleString('en-US')} to fix</button>
          <button className="nc-btn nc-sm nc-g" type="button" onClick={() => { setChoice('word'); }}>Use “{BLANK_WORD}” instead</button>
          <button className="nc-btn nc-sm nc-g" type="button" onClick={() => { setChoice('any'); }}>Send them anyway</button>
        </span>
      </div>
    );
  } else if (blank !== null) {
    parts.push(
      <div key="other" className="nc-hint">
        <span>{choice === 'word' ? `The gap will read “${BLANK_WORD}” for ${blank.missing.toLocaleString('en-US')} people.` : `Sent as is: ${blank.missing.toLocaleString('en-US')} people will see a blank.`}</span>
        <button className="nc-btn nc-sm" type="button" onClick={() => { setChoice('skip'); }}>Go back to skipping them</button>
      </div>
    );
  }
  if (props.saved !== null) parts.push(<p key="saved" className="nc-small" role="status">{props.saved}</p>);
  return <div>{parts}</div>;
}
