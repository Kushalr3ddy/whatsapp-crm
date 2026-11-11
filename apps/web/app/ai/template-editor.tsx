'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { AiTemplate, ContactSources, ExampleLine, ReviewTarget, TeamMember } from '@/lib/crm';
import { detectSensitiveAction, duplicateTemplateAction, exampleAction, generateTemplateAction, peopleOfAction, rewriteKnowledgeAction, saveTemplateAction, suggestFillInsAction } from './actions';

/** A person of the list the example is written for. */
interface Person { id: string; name: string; columns: Record<string, string> }
/** One question of the AI, and what the owner did with it. */
interface Question { question: string; answer: string; skipped: boolean; done: boolean }
/** One sensitive detail: "label: value" and how the AI treats it. */
interface Sensitive { detail: string; mode: 'show' | 'general' }
/** The file or tag the template is for, as picked. */
interface Chosen { kind: 'tag' | 'import'; id: string; label: string; what: 'File' | 'Tag'; n: number; tagId: string | null; columns: string[] }

const EXAMPLES: Array<[string, string]> = [
  ['Job walk-in', 'Invite drivers in Pune to a walk-in interview this Saturday at our Baner office. Answer questions on salary and documents.'],
  ['Interested in a job?', 'Ask candidates if they are interested in a job with us. Ask about skills, years of experience, current pay and where they live.'],
  ['Interview reminder', 'Remind people about their interview tomorrow at 11 am and ask if they can make it.'],
  ['Showroom opening', 'Tell people our new car showroom opens on Sunday and invite them for a test drive.']
];

/** Credits for a template: each person's opening plus about three replies. An estimate. */
const REPLIES_PER_PERSON = 3;

/** The text the AI reads, built the same way the server builds it, so "See exactly what the AI gets" is true. */
function builtText(knowledge: string, sensitive: Sensitive[], who: string): string {
  const keep = sensitive.map((s) => (s.mode === 'show' ? `- ${s.detail}: you may state this when asked.` : `- ${s.detail}: keep it general. Give only a rough idea, never the exact figure or value, even if asked directly.`));
  return [`What you know (use only this):\n${knowledge.trim()}`, keep.length > 0 ? `Sensitive details:\n${keep.join('\n')}` : '',
    `If you do not know something, never guess: say ${who} will confirm that point and carry on with the conversation. Hand over only when it is finished, when they ask for a person, or when they are upset.`].filter((x) => x !== '').join('\n\n');
}

/**
 * The template editor: say what it is for, answer the AI's questions, choose who it is for, check the example, save. One text holds
 * everything the AI knows; the instructions the AI reads are built from it on every save. The opening message and the picture are set
 * on New campaign, not here.
 */
export function TemplateEditor(props: { template: AiTemplate | null; members: TeamMember[]; sources: ContactSources; rules: string[]; usedLine: string }) {
  const { template, members, sources, rules } = props;
  const isNew = template === null;
  const router = useRouter();
  const [pending, start] = useTransition();

  const [desc, setDesc] = useState(template?.description ?? '');
  const [written, setWritten] = useState(!isNew);
  const [descOpen, setDescOpen] = useState(false);
  const [name, setName] = useState(template?.name ?? '');
  const [knowledge, setKnowledge] = useState(template === null ? '' : (template.knowledge !== '' ? template.knowledge : template.instructions));
  const [firstMessage, setFirstMessage] = useState(template?.firstMessage ?? '');
  const [audience, setAudience] = useState(template?.audience ?? '');
  const [questions, setQuestions] = useState<Question[]>((template?.questions ?? []).map((q) => ({ ...q, done: q.answer.trim() !== '' })));
  const [sensitive, setSensitive] = useState<Sensitive[]>(template?.sensitive ?? []);
  const [fbUser, setFbUser] = useState(template?.fallbackUserId ?? '');
  const [fbPhone, setFbPhone] = useState(template?.fallbackPhone ?? '');
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [visible, setVisible] = useState<string[]>(template?.visibleColumns ?? []);
  const [people, setPeople] = useState<Person[]>([]);
  const [personId, setPersonId] = useState('');
  const [pickOpen, setPickOpen] = useState(false);
  const [search, setSearch] = useState('');
  // What the AI suggested it may see, and how that went: shown next to the buttons, not at the top of the page.
  const [reason, setReason] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<string[]>([]);
  const [suggestErr, setSuggestErr] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [allCols, setAllCols] = useState(false);
  const [colSearch, setColSearch] = useState('');
  const [detecting, setDetecting] = useState(false);
  const [sensErr, setSensErr] = useState<string | null>(null);
  const [extra, setExtra] = useState('');
  // The text only matches the sensitive choices after a rewrite: `stale` says it has not been rewritten since they changed.
  const [stale2, setStale2] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  const [rewriteErr, setRewriteErr] = useState<string | null>(null);
  const [before, setBefore] = useState<{ text: string; sensitive: Sensitive[] } | null>(null);
  const [advOpen, setAdvOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fbBad, setFbBad] = useState(false);
  const [askSave, setAskSave] = useState<null | 'save' | 'start'>(null);
  // The example: nothing is called until the owner asks. `rev` counts changes to what the example depends on.
  const [lines, setLines] = useState<ExampleLine[] | null>(null);
  const [exampleRev, setExampleRev] = useState(-1);
  const [rev, setRev] = useState(0);
  const fbRef = useRef<HTMLDivElement>(null);
  const qsRef = useRef<HTMLDivElement>(null);
  const bump = (): void => { setRev((r) => r + 1); };

  const member = members.find((m) => m.userId === fbUser) ?? null;
  const fbOk = fbUser !== '' && fbPhone.trim() !== '';
  const open = questions.filter((q) => !q.done);
  const stale = lines !== null && exampleRev !== rev;

  // The chosen file or tag of a saved template, found again among the sources.
  useEffect(() => {
    const t = template?.audienceTargets?.[0];
    if (t === undefined || (t.kind !== 'tag' && t.kind !== 'import')) return;
    const file = sources.files.find((f) => (t.kind === 'tag' ? f.tagId === t.id : f.id === t.id));
    const tag = t.kind === 'tag' ? sources.tags.find((x) => x.id === t.id) : undefined;
    if (file !== undefined) void pick({ kind: t.kind, id: t.id, label: file.filename ?? file.tagName ?? 'File', what: 'File', n: file.count, tagId: file.tagId, columns: file.columns }, true);
    else if (tag !== undefined) void pick({ kind: 'tag', id: tag.id, label: tag.name, what: 'Tag', n: tag.count, tagId: tag.id, columns: [] }, true);
  }, []);

  /** Picks the file or tag: loads a few of its people (for the example and, for a tag, its columns). */
  async function pick(c: Chosen, keepColumns = false): Promise<void> {
    const found = await peopleOfAction(c.tagId);
    const cols = c.what === 'File' && c.columns.length > 0 ? c.columns : [...new Set(found.people.flatMap((p) => Object.keys(p.columns)))];
    const withCols: Chosen = { ...c, columns: cols };
    setChosen(withCols); setPeople(found.people); setPersonId(found.people[0]?.id ?? ''); setPickOpen(false); setReason(null); setSuggested([]); setSuggestErr(null); setAllCols(false);
    if (!keepColumns) {
      setVisible([]);
      if (knowledge.trim() !== '' && cols.length > 0) void suggest(cols, knowledge);
    }
    bump();
  }

  /** The AI writes the template from the sentence. */
  function write(): void {
    setError(null); setNotice(null);
    start(async () => {
      const r = await generateTemplateAction(desc, []);
      if (!r.ok || r.template === undefined) { setError(r.error ?? 'The AI could not write that. Try again.'); return; }
      const t = r.template;
      setName(t.name); setKnowledge(t.knowledge !== '' ? t.knowledge : t.instructions); setFirstMessage(t.firstMessage); setAudience(t.audience);
      setQuestions(t.missing.map((q) => ({ question: q, answer: '', skipped: false, done: false })));
      setSensitive([]);
      setWritten(true); setDescOpen(false); setLines(null); bump();
      const k = t.knowledge !== '' ? t.knowledge : t.instructions;
      void detect(k, true);
      if (chosen !== null && chosen.columns.length > 0) void suggest(chosen.columns, k);
    });
  }

  /** An answer joins the one text and its row goes away. */
  function answer(i: number): void {
    const q = questions[i];
    if (q === undefined || q.answer.trim() === '') return;
    setKnowledge((k) => `${k.trimEnd()}\n- ${q.question} ${q.answer.trim()}`);
    setQuestions((qs) => qs.map((x, j) => (j === i ? { ...x, done: true } : x)));
    setStale2(true); bump();
  }

  /** Asks the AI which columns would help, sending the column names only. The ones it picks become what the AI may see. */
  async function suggest(columns: string[], text: string): Promise<void> {
    setSuggesting(true); setSuggestErr(null);
    const r = await suggestFillInsAction(text, columns);
    setSuggesting(false);
    if (!r.ok || r.suggestion === undefined) { setSuggestErr(r.error ?? 'Could not suggest columns. Try again.'); return; }
    setSuggested(r.suggestion.columns); setReason(r.suggestion.reason); setVisible(r.suggestion.columns); bump();
  }

  /**
   * Asks the AI to list the details in the text that could be sensitive. The owner decides each one. `fresh` replaces the list;
   * otherwise details already decided (and the owner's own) stay as they are and only new ones are added.
   */
  async function detect(text: string, fresh = false): Promise<void> {
    setDetecting(true); setSensErr(null);
    const r = await detectSensitiveAction(text);
    setDetecting(false);
    if (!r.ok || r.items === undefined) { setSensErr(r.error ?? 'Could not look for sensitive details. Try again.'); return; }
    const found: Sensitive[] = r.items.map((s) => ({ detail: s.value === '' ? s.detail : `${s.detail}: ${s.value}`, mode: s.suggested }));
    setSensitive((cur) => (fresh ? found : [...cur, ...found.filter((f) => !cur.some((c) => c.detail.toLowerCase() === f.detail.toLowerCase()))]));
    setStale2(found.length > 0);
    bump();
  }

  /** Adds something the owner says is sensitive, in their own words, to the list. */
  function addExtra(): void {
    const t = extra.trim();
    if (t === '' || sensitive.some((s) => s.detail.toLowerCase() === t.toLowerCase())) { setExtra(''); return; }
    setSensitive((cur) => [...cur, { detail: t.slice(0, 300), mode: 'general' }]);
    setExtra(''); setStale2(true); bump();
  }

  /**
   * Rewrites the text to match the choices: tidy bullet points, and the exact value of every "keep it general" detail replaced by a rough
   * idea. The values of those details are dropped from the list too, so they are not sent to the AI either. One step back is kept.
   */
  async function rewrite(): Promise<void> {
    setRewriting(true); setRewriteErr(null);
    const r = await rewriteKnowledgeAction(knowledge, sensitive);
    setRewriting(false);
    if (!r.ok || r.knowledge === undefined) { setRewriteErr(r.error ?? 'Could not rewrite. Try again.'); return; }
    setBefore({ text: knowledge, sensitive });
    setKnowledge(r.knowledge);
    // A detail kept general is now only a label: its exact value is no longer in the text and is not sent to the AI.
    setSensitive((cur) => cur.map((d) => (d.mode === 'general' && d.detail.includes(': ') ? { ...d, detail: d.detail.slice(0, d.detail.indexOf(': ')) } : d)));
    setStale2(false); bump();
  }

  /** Goes back to the text and choices from before the last rewrite. */
  function undoRewrite(): void {
    if (before === null) return;
    setKnowledge(before.text); setSensitive(before.sensitive); setBefore(null); setStale2(true); bump();
  }

  /** Writes the example from the template as it stands now. */
  function example(): void {
    setError(null);
    start(async () => {
      const r = await exampleAction({
        ...(template === null ? {} : { templateId: template.id }), knowledge, sensitive, fallbackUserId: fbUser === '' ? null : fbUser, fallbackPhone: fbPhone, visibleColumns: visible
      }, personId);
      if (!r.ok || r.lines === undefined) { setError(r.error ?? 'Could not write the example.'); return; }
      setLines(r.lines); setExampleRev(rev);
    });
  }

  /** Saves. Needs the fallback; open questions only warn. */
  function save(then: 'save' | 'start', force = false): void {
    setError(null); setNotice(null);
    if (name.trim() === '' || knowledge.trim() === '') { setError('Give it a name and write what the AI knows.'); return; }
    if (!fbOk) { setFbBad(true); setAskSave(null); fbRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    if (open.length > 0 && !force) { setAskSave(then); return; }
    setAskSave(null);
    start(async () => {
      const targets: ReviewTarget[] | null = chosen === null ? null : [{ kind: chosen.kind, id: chosen.id }];
      const r = await saveTemplateAction({
        ...(template === null ? {} : { id: template.id }), name: name.trim(), description: desc, instructions: '', audience, firstMessage, knowledge,
        questions: questions.map((q) => ({ question: q.question, answer: q.answer, skipped: q.skipped })), sensitive,
        fallbackUserId: fbUser, fallbackPhone: fbPhone, visibleColumns: visible, audienceTargets: targets
      });
      if (!r.ok || r.template === undefined) { setError(r.error ?? 'Could not save.'); return; }
      if (then === 'start') { router.push(`/broadcast/new?template=${r.template.id}`); return; }
      setNotice('Saved.');
      if (isNew) router.replace(`/ai/t/${r.template.id}`); else router.refresh();
    });
  }

  /** Copies this template as "(copy)" and goes back to the list. */
  function duplicate(): void {
    if (template === null) return;
    start(async () => {
      const r = await duplicateTemplateAction(template.id);
      if (!r.ok) { setError(r.error ?? 'Could not duplicate.'); return; }
      router.push('/ai');
    });
  }

  const who = member?.displayName ?? 'a colleague';
  const files = sources.files.filter((f) => f.count > 0 && (search === '' || (f.filename ?? '').toLowerCase().includes(search.toLowerCase())));
  const tags = sources.tags.filter((t) => t.count > 0 && (search === '' || t.name.toLowerCase().includes(search.toLowerCase())));
  const credits = useMemo(() => (chosen === null ? 0 : chosen.n * (1 + REPLIES_PER_PERSON)), [chosen]);
  const person = people.find((p) => p.id === personId);

  const seg = (on: boolean): string => `min-h-11 rounded-md px-3 text-sm font-medium ${on ? 'bg-surface text-accent shadow-sm' : 'text-muted'}`;
  const chip = (on: boolean): string => `min-h-10 rounded-full border px-3 text-sm font-medium ${on ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-surface'}`;
  const sec = 'flex flex-col gap-3 border-t border-border p-5 first:border-t-0';

  return (
    <div className="mt-4 flex flex-col gap-4">
      {/* what it would cost */}
      <section className="card flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3" role="status" aria-label="AI credits">
        {chosen === null
          ? <><span className="text-xs font-semibold uppercase tracking-wider text-muted">AI credits</span><span className="text-sm">Pick who it is for (section 2) to see how many credits it would use.</span></>
          : (
            <>
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-muted">AI credits estimate</span>
                <div className="text-xl font-semibold">About {credits.toLocaleString('en-US')} credits</div>
                <span className="text-sm">for {chosen.n.toLocaleString('en-US')} people</span>
              </div>
              <span className="min-w-0 flex-1 basis-72 text-sm text-muted">
                1 credit = 1 AI message the AI writes. {chosen.n.toLocaleString('en-US')} openings plus about {REPLIES_PER_PERSON} replies each. Replies are not known in advance, so it is an estimate. What it really used is shown on the campaign page.
              </span>
            </>
          )}
      </section>

      {/* what is it for */}
      {(isNew || desc.trim() !== '') && (written && !descOpen
        ? (
          <section className="card flex flex-wrap items-center justify-between gap-3 p-5">
            <div className="min-w-0"><span className="text-xs font-semibold uppercase tracking-wider text-muted">{isNew ? 'What it is for' : 'What it was written from'}</span><p className="mt-1">{desc}</p><p className="mt-1 text-sm text-muted">To change what the AI says, edit “What the AI knows” below. Write again only to start over from a new sentence.</p></div>
            <button type="button" className="btn btn-sm" onClick={() => { setDescOpen(true); }}>Change and write again</button>
          </section>
        )
        : (
          <section className="card flex flex-col gap-3 p-5">
            <h2 className="text-base font-semibold">What is this template for?</h2>
            <p className="text-sm text-muted">Say it in plain words, or paste a job description. The AI asks you for anything it is missing and assumes nothing.</p>
            {!isNew && <p className="notice notice-warning">Writing again replaces “What the AI knows”, the questions and the sensitive details below with new ones. Your name, hand-over person and file stay.</p>}
            <div className="flex flex-wrap gap-2">{EXAMPLES.map(([label, text]) => <button key={label} type="button" className={chip(false)} onClick={() => { setDesc(text); }}>{label}</button>)}</div>
            <textarea className="field" rows={3} value={desc} maxLength={8000} aria-label="What is this template for" onChange={(e) => { setDesc(e.target.value); }} />
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="btn btn-primary" disabled={pending || desc.trim().length < 3} onClick={write}>{pending ? 'Writing…' : written ? 'Write it again' : 'Write my template'}</button>
              <span className="text-sm text-muted">The AI sees only what you write here, never your contacts.</span>
            </div>
          </section>
        ))}

      {error !== null && <p role="alert" className="notice notice-danger">{error}</p>}
      {notice !== null && <p role="status" className="notice notice-success">{notice}</p>}

      {written && (
        <>
          {isNew && <p className="notice notice-warning"><b>Written by AI.</b> Read each section before you use it. It may be wrong or off in tone.</p>}
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,30%)]">
            <div className="card">
              <div className={sec}>
                <label htmlFor="tname" className="text-sm font-medium">Template name</label>
                <input id="tname" className="field" value={name} maxLength={80} onChange={(e) => { setName(e.target.value); }} />
              </div>

              {/* 1 — if it isn't sure */}
              <div ref={fbRef} className={`${sec} border-l-4 border-l-accent bg-accent-soft/30`}>
                <h2 className="flex items-center gap-2 text-base font-semibold"><span className="grid h-6 w-6 place-items-center rounded-full bg-accent-soft text-xs text-accent">1</span>If it isn’t sure <span className="text-sm font-normal text-muted">always on · required</span></h2>
                <p className="text-sm text-muted">It never guesses. It tells the customer this person will get in touch, asks for the customer’s name, number and email, and gives this person the chat with those in the note.</p>
                {!fbOk && <p role="alert" className="notice notice-warning"><b>This isn’t filled in.</b> Without it the AI can’t say who will get in touch, nobody gets the chat, and the template can’t be saved.</p>}
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="flex flex-col gap-1">
                    <label htmlFor="fbu" className="text-sm font-medium">Who gets the chat *</label>
                    <select id="fbu" className="field" value={fbUser} aria-invalid={fbBad && fbUser === ''} onChange={(e) => { setFbUser(e.target.value); bump(); }}>
                      <option value="">Choose a person</option>
                      {members.map((m) => <option key={m.userId} value={m.userId}>{m.displayName} · {m.role}</option>)}
                    </select>
                    {members.length === 0 && <span className="text-xs text-warning">Nobody is in your team yet. <Link href="/team" className="underline">Add a person</Link> first.</span>}
                    {fbBad && fbUser === '' && <span className="text-xs text-danger">Choose who gets the chat.</span>}
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor="fbp" className="text-sm font-medium">Their number *</label>
                    <input id="fbp" className="field" value={fbPhone} placeholder="+91 …" inputMode="tel" aria-invalid={fbBad && fbPhone.trim() === ''} onChange={(e) => { setFbPhone(e.target.value); bump(); }} />
                    {fbBad && fbPhone.trim() === '' && <span className="text-xs text-danger">Needed, so the customer can reach them.</span>}
                  </div>
                  <div className="flex flex-col gap-1"><span className="text-sm font-medium">Their email</span><span className="min-h-11 py-2 text-sm">{member?.email ?? <span className="text-muted">Shown after you choose a person.</span>}</span></div>
                </div>
              </div>

              {/* the AI's questions */}
              {open.length > 0 && (
                <div ref={qsRef} className={sec}>
                  <h2 className="flex items-center gap-2 text-base font-semibold">Questions from the AI <span className="badge badge-warning">{open.length} not answered</span></h2>
                  <p className="text-sm text-muted">Each answer is added to “What the AI knows”. Skip the rest: a colleague will confirm.</p>
                  {questions.map((q, i) => q.done ? null : (
                    <div key={q.question} className="flex flex-col gap-1">
                      <label htmlFor={`qa${String(i)}`} className="text-sm font-medium">{q.question}</label>
                      <div className="flex gap-2">
                        <input
                          id={`qa${String(i)}`} className="field" value={q.answer} placeholder={q.skipped ? 'Skipped' : 'Type the answer'}
                          onChange={(e) => { setQuestions((qs) => qs.map((x, j) => (j === i ? { ...x, answer: e.target.value, skipped: false } : x))); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); answer(i); } }}
                        />
                        <button type="button" className="btn btn-sm" disabled={q.answer.trim() === ''} onClick={() => { answer(i); }}>Add</button>
                        {!q.skipped && <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setQuestions((qs) => qs.map((x, j) => (j === i ? { ...x, skipped: true, answer: '' } : x))); }}>Skip</button>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 2 — who it is for */}
              <div className={sec}>
                <h2 className="flex items-center gap-2 text-base font-semibold"><span className="grid h-6 w-6 place-items-center rounded-full bg-accent-soft text-xs text-accent">2</span>Who it is for</h2>
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted">People</span>
                  {chosen !== null
                    ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="badge badge-success">{chosen.what}</span><b className="font-medium">{chosen.label}</b><span className="text-sm text-muted">{chosen.n} people</span>
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setPickOpen(!pickOpen); }}>Change</button>
                      </div>
                    )
                    : <div><button type="button" className="btn btn-sm" onClick={() => { setPickOpen(!pickOpen); }}>Choose a file or tag</button></div>}
                  {pickOpen && (
                    <div className="flex max-h-72 flex-col gap-1 overflow-auto rounded-lg border border-border p-2">
                      <input className="field" placeholder="Search files and tags" aria-label="Search files and tags" value={search} onChange={(e) => { setSearch(e.target.value); }} />
                      {files.map((f) => (
                        <button key={f.id} type="button" className="flex min-h-10 items-center justify-between gap-3 rounded-md px-2 text-left text-sm hover:bg-accent-soft"
                          onClick={() => { void pick(f.tagId !== null ? { kind: 'tag', id: f.tagId, label: f.filename ?? f.tagName ?? 'File', what: 'File', n: f.count, tagId: f.tagId, columns: f.columns } : { kind: 'import', id: f.id, label: f.filename ?? 'File', what: 'File', n: f.count, tagId: null, columns: f.columns }); }}>
                          <span><b className="font-medium">{f.filename ?? f.tagName}</b> · file</span><span className="text-muted">{f.count} people</span>
                        </button>
                      ))}
                      {tags.map((t) => (
                        <button key={t.id} type="button" className="flex min-h-10 items-center justify-between gap-3 rounded-md px-2 text-left text-sm hover:bg-accent-soft"
                          onClick={() => { void pick({ kind: 'tag', id: t.id, label: t.name, what: 'Tag', n: t.count, tagId: t.id, columns: [] }); }}>
                          <span><b className="font-medium">{t.name}</b> · tag</span><span className="text-muted">{t.count} people</span>
                        </button>
                      ))}
                      {files.length === 0 && tags.length === 0 && <p className="p-2 text-sm text-muted">Nothing found. Import a file on the Import page first.</p>}
                    </div>
                  )}
                </div>
                {chosen !== null && (
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium">What the AI can see about each person</span>
                      <button type="button" className="btn btn-sm" disabled={suggesting || chosen.columns.length === 0 || knowledge.trim() === ''} onClick={() => { void suggest(chosen.columns, knowledge); }}>
                        {suggesting ? 'Looking…' : suggested.length > 0 ? 'Suggest again' : 'Suggest fill-ins'}
                      </button>
                    </div>
                    <p className="text-sm text-muted">
                      {chosen.columns.length === 0
                        ? 'This file has no columns beyond the name.'
                        : `This file has ${String(chosen.columns.length)} columns. Only the column names go to the AI to suggest which ones help, never a person’s data. Nothing is shown to the AI until a column is chosen here.`}
                    </p>
                    {suggestErr !== null && <p role="alert" className="notice notice-danger">{suggestErr}</p>}
                    {suggesting && <p className="text-sm text-muted">The AI is reading the column names…</p>}
                    {reason !== null && reason !== '' && <p className="rounded-lg bg-accent-soft/40 px-3 py-2 text-sm">{reason}</p>}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={chip(true)}>name</span>
                      {visible.map((c) => (
                        <button key={c} type="button" className={chip(true)} aria-pressed title="Click to stop the AI seeing this" onClick={() => { setVisible((v) => v.filter((x) => x !== c)); bump(); }}>{c} ×</button>
                      ))}
                      {visible.length === 0 && !suggesting && <span className="text-sm text-muted">No other column is shown to the AI yet.</span>}
                    </div>
                    {chosen.columns.length > 0 && (
                      <div className="flex flex-col gap-2">
                        <button type="button" className="btn btn-sm btn-ghost self-start" aria-expanded={allCols} onClick={() => { setAllCols(!allCols); }}>
                          {allCols ? 'Hide the other columns' : `Choose other columns (${String(chosen.columns.length - visible.length)} more)`}
                        </button>
                        {allCols && (
                          <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                            <input className="field" placeholder="Search columns" aria-label="Search columns" value={colSearch} onChange={(e) => { setColSearch(e.target.value); }} />
                            <div className="grid max-h-64 gap-x-4 gap-y-1 overflow-auto sm:grid-cols-2">
                              {chosen.columns.filter((c) => colSearch === '' || c.toLowerCase().includes(colSearch.toLowerCase())).map((c) => (
                                <label key={c} className="flex min-h-9 items-center gap-2 text-sm">
                                  <input type="checkbox" className="h-4 w-4" checked={visible.includes(c)} onChange={() => { setVisible((v) => (v.includes(c) ? v.filter((x) => x !== c) : [...v, c])); bump(); }} />
                                  <span className="[overflow-wrap:anywhere]">{c}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 3 — what the AI knows */}
              <div className={sec}>
                <h2 className="flex items-center gap-2 text-base font-semibold"><span className="grid h-6 w-6 place-items-center rounded-full bg-accent-soft text-xs text-accent">3</span>What the AI knows</h2>
                <p className="text-sm text-muted">One text, written by the AI from your sentence. Change it here once: the example, the campaigns that use this template and the inbox all follow it.</p>
                <textarea className="field min-h-80" rows={14} value={knowledge} maxLength={30000} aria-label="What the AI knows" onChange={(e) => { setKnowledge(e.target.value); bump(); }} />
                <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className={`btn btn-sm ${stale2 ? 'btn-primary' : ''}`} disabled={rewriting || knowledge.trim() === ''} onClick={() => { void rewrite(); }}>{rewriting ? 'Rewriting…' : 'Rewrite with my choices'}</button>
                    {before !== null && <button type="button" className="btn btn-sm btn-ghost" onClick={undoRewrite}>Undo the rewrite</button>}
                    <span className="min-w-0 flex-1 basis-64 text-sm text-muted">Uses 1 credit. Tidies this text, turns each answer into a plain sentence, and takes the exact value out of every detail you keep general, so this text is what the AI really gets.</span>
                  </div>
                  {stale2 && !rewriting && <p className="text-sm text-warning">You changed the sensitive details or added answers. Rewrite so this text matches, then read it before saving.</p>}
                  {rewriteErr !== null && <p role="alert" className="notice notice-danger">{rewriteErr}</p>}
                </div>
                <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <b>Sensitive details</b>
                    <button type="button" className="btn btn-sm" disabled={detecting || knowledge.trim() === ''} onClick={() => { void detect(knowledge); }}>{detecting ? 'Looking…' : sensitive.length > 0 ? 'Look again' : 'Find sensitive details'}</button>
                  </div>
                  <span className="text-sm text-muted">The AI lists the names, money, dates and numbers it finds in the text above. You decide for each one: it may state it exactly (Show it) or only give a rough idea (Keep it general). Anything in a prompt can sometimes be pulled out by a determined person, so numbers that must never leak should not be entered.</span>
                  {sensErr !== null && <p role="alert" className="notice notice-danger">{sensErr}</p>}
                  {detecting && <p className="text-sm text-muted">The AI is reading the text…</p>}
                  {!detecting && sensitive.length === 0 && sensErr === null && <p className="text-sm text-muted">Nothing is listed yet. Press “Find sensitive details”, or add your own below.</p>}
                  {sensitive.map((s, i) => (
                    <div key={s.detail} className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1">
                        <span className="rounded-md bg-warning-soft px-2 py-0.5 text-sm font-medium text-warning [overflow-wrap:anywhere]">{s.detail}</span>
                        <button type="button" className="btn btn-sm btn-ghost px-2" aria-label={`Remove ${s.detail}`} onClick={() => { setSensitive((x) => x.filter((_, j) => j !== i)); setStale2(true); bump(); }}>×</button>
                      </span>
                      <div className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5" role="group" aria-label={s.detail}>
                        <button type="button" className={seg(s.mode === 'show')} aria-pressed={s.mode === 'show'} onClick={() => { setSensitive((x) => x.map((y, j) => (j === i ? { ...y, mode: 'show' } : y))); setStale2(true); bump(); }}>Show it</button>
                        <button type="button" className={seg(s.mode === 'general')} aria-pressed={s.mode === 'general'} onClick={() => { setSensitive((x) => x.map((y, j) => (j === i ? { ...y, mode: 'general' } : y))); setStale2(true); bump(); }}>Keep it general</button>
                      </div>
                    </div>
                  ))}
                  <div className="flex flex-col gap-1 border-t border-border pt-3">
                    <label htmlFor="extra" className="text-sm font-medium">Anything else that is sensitive? Say it in your words</label>
                    <div className="flex gap-2">
                      <input
                        id="extra" className="field" value={extra} placeholder="For example: the client’s name, or the exact notice period" maxLength={300}
                        onChange={(e) => { setExtra(e.target.value); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addExtra(); } }}
                      />
                      <button type="button" className="btn btn-sm" disabled={extra.trim() === ''} onClick={addExtra}>Add</button>
                    </div>
                    <span className="text-xs text-muted">It is added to the list above, kept general by default, and the AI will not state it exactly.</span>
                  </div>
                </div>
              </div>

              <div className={sec}>
                <details className="rounded-lg border border-border bg-surface-2" open={advOpen} onToggle={(e) => { setAdvOpen((e.target as HTMLDetailsElement).open); }}>
                  <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium">See exactly what the AI gets</summary>
                  <div className="flex flex-col gap-3 px-3 pb-3">
                    <span className="text-sm text-muted">Built from the text above every time you save. It can’t be edited separately, so there is only one place to change.</span>
                    <textarea className="field" rows={9} readOnly aria-label="What the AI gets" value={builtText(knowledge, sensitive, who)} />
                    <ul className="list-disc pl-5 text-sm text-muted">{rules.map((r) => <li key={r}>{r}</li>)}</ul>
                  </div>
                </details>
              </div>

              {fbBad && !fbOk && (
                <p role="alert" className="notice notice-danger m-5 mt-0"><b>Not saved.</b> Fill in “If it isn’t sure” first (section 1): who gets the chat, and their number.</p>
              )}
              {askSave !== null && (
                <div role="status" className="notice notice-warning m-5 mt-0 flex flex-wrap items-center justify-between gap-3">
                  <span><b>{open.length === 1 ? '1 question is not answered.' : `${String(open.length)} questions are not answered.`}</b> The AI will tell people a colleague will confirm those.</span>
                  <span className="flex gap-2">
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => { save(askSave, true); }}>Save anyway</button>
                    <button type="button" className="btn btn-sm" onClick={() => { setAskSave(null); qsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>Answer them</button>
                  </span>
                </div>
              )}

              <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-b-xl border-t border-border bg-surface px-5 py-3">
                <Link href="/ai" className="btn btn-ghost">Cancel</Link>
                <div className="ml-auto flex flex-wrap gap-2">
                  {!isNew && <button type="button" className="btn" disabled={pending} onClick={duplicate}>Duplicate</button>}
                  <button type="button" className="btn" disabled={pending} onClick={() => { save('save'); }}>{pending ? 'Saving…' : 'Save'}</button>
                  <button type="button" className="btn btn-primary" disabled={pending} onClick={() => { save('start'); }}>Save and start a campaign</button>
                </div>
              </div>
            </div>

            {/* the example conversation */}
            <aside className="flex flex-col gap-3 xl:sticky xl:top-3" aria-label="Example conversation">
              {firstMessage.trim() !== '' && (
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted">Opening message (the AI’s draft)</span>
                  <div className="rounded-xl border border-border bg-surface-2 p-3">
                    <div className="ml-auto w-fit max-w-[92%] whitespace-pre-wrap rounded-lg bg-accent-soft px-3 py-2 text-sm [overflow-wrap:anywhere]">
                      {firstMessage.replace(/\{\{\s*(name|first_name)\s*\}\}/g, (person?.name ?? 'Name').split(' ')[0] ?? 'Name')}
                    </div>
                  </div>
                  <span className="text-xs text-muted">This is copied into the message box on New campaign, where you also add the picture and see the real preview.</span>
                </div>
              )}
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">Example conversation</span>
              {people.length > 0 && (
                <div className="flex flex-col gap-1">
                  <label htmlFor="exsel" className="text-sm text-muted">Example person from this list</label>
                  <select id="exsel" className="field" value={personId} onChange={(e) => { setPersonId(e.target.value); }}>
                    {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.columns.city !== undefined ? ` · ${p.columns.city}` : ''}</option>)}
                  </select>
                </div>
              )}
              {lines === null
                ? (
                  <div className="card flex flex-col gap-3 p-4">
                    <p className="text-sm text-muted">See how the AI would talk to a person from your list, using this template. The AI writes both sides. Nothing is sent.</p>
                    <button type="button" className="btn btn-primary" disabled={pending || !fbOk || personId === '' || knowledge.trim() === ''} onClick={example}>{pending ? 'Writing…' : 'Generate an example'}</button>
                    <span className="text-sm text-muted">
                      {!fbOk ? 'Fill in section 1 first: the example shows who gets the chat.' : personId === '' ? 'Choose a file or tag in section 2 first: the example is written for one of its people.' : 'Uses 1 credit.'}
                    </span>
                  </div>
                )
                : (
                  <>
                    <div className="flex h-[38rem] flex-col overflow-hidden rounded-xl border border-border bg-surface">
                      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                        <span className="grid h-8 w-8 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{(person?.name ?? '?').split(' ').map((w) => w.charAt(0)).join('').slice(0, 2).toUpperCase()}</span>
                        <span className="flex flex-col leading-tight"><b className="text-sm">{person?.name ?? 'Example'}</b><span className="text-xs text-muted">Example · nothing is sent</span></span>
                      </div>
                      <div className="flex flex-1 flex-col gap-2 overflow-y-auto bg-surface-2 p-3">
                        {lines.map((l, i) => l.from === 'event'
                          ? <div key={i} className="self-center rounded-lg bg-warning-soft px-3 py-1.5 text-center text-xs text-warning">{l.text}</div>
                          : (
                            <div key={i} className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-1.5 text-sm [overflow-wrap:anywhere] ${l.from === 'ai' ? 'self-end bg-accent-soft' : 'self-start border border-border bg-surface'}`}>
                              <span className="mb-0.5 block text-[11px] font-semibold opacity-70">{l.from === 'ai' ? (i === 0 ? 'Opening, written by the AI' : 'AI') : person?.name ?? 'Customer'}</span>{l.text}
                            </div>
                          ))}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" className={`btn btn-sm ${stale ? 'btn-primary' : ''}`} disabled={pending} onClick={example}>{pending ? 'Writing…' : 'Refresh example'}</button>
                      {stale && <span className="text-sm text-warning">You changed the template. Refresh the example.</span>}
                    </div>
                    <span className="text-sm text-muted">Example only. The customer’s lines are made up, so real replies will differ. Each update uses 1 credit.</span>
                  </>
                )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
