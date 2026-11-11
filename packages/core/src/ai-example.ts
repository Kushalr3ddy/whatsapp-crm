import { sql } from 'drizzle-orm';
import { setTenant, type Database } from '@crm/db';
import type { LlmDriver } from '@crm/llm';
import { systemText } from './ai-reply.js';
import { AiTemplateError, buildInstructions, modelFailure, type SensitiveDetail } from './ai-templates.js';
import { recordAiRun } from './ai-usage.js';

/** The template as the editor holds it right now, saved or not. */
export interface ExampleDraft {
  readonly knowledge: string;
  readonly sensitive: readonly SensitiveDetail[];
  readonly fallbackUserId: string | null;
  readonly fallbackPhone: string;
  readonly visibleColumns: readonly string[];
  readonly templateId?: string | undefined;
}

/** One line of the example: who said it and what. `event` is the note the hand-over leaves. */
export interface ExampleLine {
  readonly from: 'ai' | 'customer' | 'event';
  readonly text: string;
}

const EXAMPLE_RULES = [
  'Write an EXAMPLE conversation between you (writing for the organisation) and the person described below, about 10 to 14 lines in all. You write BOTH sides.',
  'The first line is the opening message you would send this person: at most 2 short sentences, from the organisation, never "assistant". Then the person answers and asks a few ordinary questions the template can answer. Follow the conversation flow above: one short question at a time, and carry on to the end (the recap, their confirmation, the close).',
  'Include one question that the template does NOT cover, so the example shows what you do when you do not know: say who will confirm that point, take their name, number and email once, and carry on with the rest of the conversation. End with the closing and the hand-over note.',
  'Reply with ONE JSON object and nothing else: {"lines":[{"from":"ai"|"customer","text":"..."}],"note":"the note left for the colleague who takes the chat: the person\'s name, number and email as they gave them, and a short summary"}.',
  'Customer lines are made up and short. Never invent facts about the template that it does not state.'
].join('\n');

/**
 * Writes one example conversation from the template as it stands in the editor and one real person of the list. One AI call; nothing is
 * sent and nothing is stored except the credit it used. Needs the assistant switched on.
 */
export async function writeExample(
  deps: { db: Database; llm: LlmDriver }, orgId: string, draft: ExampleDraft, personId: string, userId: string | null = null
): Promise<ExampleLine[]> {
  const { db, llm } = deps;
  const setup = await db.transaction(async (tx) => {
    await setTenant(tx, orgId);
    const ai = (await tx.execute(sql`SELECT enabled FROM ai_setting WHERE org_id = ${orgId}`) as unknown as Array<{ enabled: boolean }>)[0];
    const org = (await tx.execute(sql`SELECT name FROM org WHERE id = ${orgId}`) as unknown as Array<{ name: string }>)[0];
    const person = (await tx.execute(sql`
      SELECT display_name AS "name", custom_fields AS "fields" FROM contact WHERE id = ${personId} AND org_id = ${orgId} AND deleted_at IS NULL`) as unknown as Array<{ name: string | null; fields: Record<string, unknown> | null }>)[0];
    const member = draft.fallbackUserId === null ? undefined : (await tx.execute(sql`
      SELECT u.display_name AS "name", u.email FROM app_user u JOIN org_membership m ON m.user_id = u.id AND m.org_id = ${orgId}
      WHERE u.id = ${draft.fallbackUserId}`) as unknown as Array<{ name: string; email: string }>)[0];
    return { on: ai?.enabled === true, orgName: org?.name ?? '', person, member };
  });
  if (!setup.on) throw new AiTemplateError('ai_off', 'The AI assistant is switched off for this organisation.');
  if (setup.person === undefined) throw new AiTemplateError('not_found', 'That person is not in your contacts.');
  if (draft.knowledge.trim() === '') throw new AiTemplateError('invalid', 'Write what the AI knows first.');

  const facts = [
    ...(setup.person.name === null || setup.person.name.trim() === '' ? [] : [`name: ${setup.person.name.slice(0, 200)}`]),
    ...Object.entries(setup.person.fields ?? {}).filter(([k, v]) => draft.visibleColumns.includes(k) && String(v).trim() !== '').map(([k, v]) => `${k}: ${String(v).slice(0, 200)}`)
  ].slice(0, 40);
  const system = `${systemText(setup.orgName, buildInstructions(draft.knowledge, draft.sensitive), {
    fallback: { name: setup.member?.name ?? null, phone: draft.fallbackPhone }, facts, output: 'plain'
  })}\n\n${EXAMPLE_RULES}`;

  let raw: string;
  try {
    const answer = await llm.complete({ system, messages: [{ role: 'user', content: 'Write the example conversation now.' }], maxTokens: 6000 });
    raw = answer.text;
    await recordAiRun(db, { orgId, kind: 'example', outcome: 'done', model: answer.model, usage: answer.usage, templateId: draft.templateId ?? null, userId });
  } catch (error) {
    throw new AiTemplateError('no_model', modelFailure(error));
  }
  return parseExample(raw, setup.member === undefined ? null : setup.member.name);
}

/** Pulls the lines out of the model's answer; an answer with no usable lines is an error, not a guess. */
export function parseExample(raw: string, handedTo: string | null): ExampleLine[] {
  let json: { lines?: unknown; note?: unknown };
  try {
    json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as { lines?: unknown; note?: unknown };
  } catch {
    throw new AiTemplateError('no_model', 'The AI did not answer in a usable form. Try again.');
  }
  const lines: ExampleLine[] = [];
  if (Array.isArray(json.lines)) {
    for (const l of json.lines.slice(0, 30)) {
      const o = l as { from?: unknown; text?: unknown } | null;
      const text = typeof o?.text === 'string' ? o.text.trim().slice(0, 1000) : '';
      if (text !== '' && (o?.from === 'ai' || o?.from === 'customer')) lines.push({ from: o.from, text });
    }
  }
  if (lines.length === 0) throw new AiTemplateError('no_model', 'The AI wrote no example. Try again.');
  const note = typeof json.note === 'string' ? json.note.trim().slice(0, 800) : '';
  if (note !== '') lines.push({ from: 'event', text: `Chat given to ${handedTo ?? 'a colleague'}. Note: ${note}` });
  return lines;
}

/** The columns the AI suggests it may see, with the reason in words. */
export interface FillInSuggestion {
  readonly columns: readonly string[];
  readonly reason: string;
}

/** Whether the assistant is switched on (it is the org's AI budget and consent). */
async function aiIsOn(db: Database, orgId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    await setTenant(tx, orgId);
    return ((await tx.execute(sql`SELECT enabled FROM ai_setting WHERE org_id = ${orgId}`)) as unknown as Array<{ enabled: boolean }>)[0]?.enabled === true;
  });
}

/** Pulls the first JSON object out of a model answer, or null when there is none. */
function jsonOf(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Suggests which columns of the file are worth the AI seeing, from the column NAMES only: never a person, a value or a number.
 * Only names that are in the file come back, so the page can pre-select them.
 */
export async function suggestFillIns(
  deps: { db: Database; llm: LlmDriver }, orgId: string, input: { knowledge: string; columns: readonly string[]; userId?: string | null }
): Promise<FillInSuggestion> {
  const { db, llm } = deps;
  const columns = input.columns.map((c) => c.slice(0, 120)).slice(0, 400);
  if (columns.length === 0) throw new AiTemplateError('invalid', 'Choose a file or tag with columns first.');
  if (!(await aiIsOn(db, orgId))) throw new AiTemplateError('ai_off', 'The AI assistant is switched off for this organisation.');
  let raw: string;
  try {
    const answer = await llm.complete({
      system: 'You help set up a WhatsApp assistant. You are given what the assistant knows and the NAMES of the columns in the contact file (never any values). Pick the few columns (usually 2 to 8) that would help the assistant talk to each person better: to greet them, to tailor a question, or to check a fit. Skip identifiers, timestamps, audit and workflow columns, comments, and anything personal that the conversation does not need. Reply with ONE JSON object and nothing else: {"columns":["exact column name", ...],"reason":"one or two plain sentences on why"}. Use only names from the list.',
      messages: [{ role: 'user', content: `What the assistant knows:\n${input.knowledge.slice(0, 4000)}\n\nColumn names:\n${columns.map((c) => `- ${c}`).join('\n')}` }], maxTokens: 1500
    });
    await recordAiRun(db, { orgId, kind: 'fillins', outcome: 'done', model: answer.model, usage: answer.usage, userId: input.userId ?? null });
    raw = answer.text;
  } catch (error) {
    throw new AiTemplateError('no_model', modelFailure(error));
  }
  const json = jsonOf(raw);
  if (json === null) throw new AiTemplateError('no_model', 'The AI did not answer in a usable form. Try again.');
  const wanted = Array.isArray(json.columns) ? json.columns.filter((c): c is string => typeof c === 'string') : [];
  const picked = columns.filter((c) => wanted.some((w) => w.trim().toLowerCase() === c.trim().toLowerCase())).slice(0, 12);
  return { columns: picked, reason: typeof json.reason === 'string' ? json.reason.trim().slice(0, 500) : '' };
}

/** One detail the AI found in the text that the owner may want kept general. `suggested` is only the starting choice. */
export interface SensitiveCandidate {
  readonly detail: string;
  readonly value: string;
  readonly suggested: 'show' | 'general';
}

/**
 * Reads the text of what the AI knows and lists the specific details in it that could be sensitive: company or person names, pay and
 * money figures, dates, policy or account numbers, addresses, phone numbers and emails. The owner decides each one; a detail the text
 * itself marks as confidential starts as "keep it general". Nothing is decided here.
 */
export async function detectSensitive(
  deps: { db: Database; llm: LlmDriver }, orgId: string, knowledge: string, userId: string | null = null
): Promise<SensitiveCandidate[]> {
  const { db, llm } = deps;
  if (knowledge.trim() === '') throw new AiTemplateError('invalid', 'Write what the AI knows first.');
  if (!(await aiIsOn(db, orgId))) throw new AiTemplateError('ai_off', 'The AI assistant is switched off for this organisation.');
  let raw: string;
  try {
    const answer = await llm.complete({
      system: 'You read the text a WhatsApp assistant will be given and list every specific detail in it that someone might not want the assistant to say exactly: names of companies, clients or people; pay, CTC, salary, prices, fees, discounts and any money figure; dates and deadlines; policy, account, ID or reference numbers; addresses and locations; phone numbers and emails. Copy each value exactly as written. List details only, not whole sentences, and only ones that are really in the text. For each, set "suggested" to "general" ONLY when the text itself says it is confidential or private, or when it is a pay, CTC, salary, price, fee or discount figure, or a personal identifier (an ID, account or policy number, a person\'s phone or email). Everything else is "show", including the place, the date, the time and the company name of an event or offer, unless the text marks them confidential. Reply with ONE JSON object and nothing else: {"items":[{"detail":"short label","value":"the value as written","suggested":"show"|"general"}]}. Use an empty list when there is nothing.',
      messages: [{ role: 'user', content: knowledge.slice(0, 12000) }], maxTokens: 3000
    });
    await recordAiRun(db, { orgId, kind: 'sensitive', outcome: 'done', model: answer.model, usage: answer.usage, userId });
    raw = answer.text;
  } catch (error) {
    throw new AiTemplateError('no_model', modelFailure(error));
  }
  const json = jsonOf(raw);
  if (json === null || !Array.isArray(json.items)) throw new AiTemplateError('no_model', 'The AI did not answer in a usable form. Try again.');
  const seen = new Set<string>();
  const out: SensitiveCandidate[] = [];
  for (const it of json.items.slice(0, 40)) {
    const o = it as { detail?: unknown; value?: unknown; suggested?: unknown } | null;
    const detail = typeof o?.detail === 'string' ? o.detail.trim().slice(0, 100) : '';
    const value = typeof o?.value === 'string' ? o.value.trim().slice(0, 300) : '';
    const key = `${detail}|${value}`.toLowerCase();
    if (detail === '' || seen.has(key)) continue;
    seen.add(key);
    out.push({ detail, value, suggested: o?.suggested === 'general' ? 'general' : 'show' });
  }
  return out;
}

/** The exact value inside a detail written as "label: value"; a detail without a value (one the owner typed) has none to look for. */
function valueOf(detail: string): string {
  const at = detail.indexOf(': ');
  return at < 0 ? '' : detail.slice(at + 2).trim();
}

/** The values of the "keep it general" details that still appear in the text (compared without case). */
function leaked(text: string, sensitive: readonly SensitiveDetail[]): string[] {
  const low = text.toLowerCase();
  return sensitive.filter((d) => d.mode === 'general').map((d) => valueOf(d.detail)).filter((v) => v.length >= 3 && low.includes(v.toLowerCase()));
}

/**
 * Rewrites the text of what the AI knows so it matches the owner's choices: tidy bullet points, question-and-answer lines turned
 * into plain statements, the exact value of every "keep it general" detail replaced by a rough idea. The result is checked: if an
 * exact value is still in the text the AI is asked once more, and if it is still there the rewrite is refused rather than saved.
 */
export async function rewriteKnowledge(
  deps: { db: Database; llm: LlmDriver }, orgId: string, input: { knowledge: string; sensitive: readonly SensitiveDetail[]; userId?: string | null }
): Promise<string> {
  const { db, llm } = deps;
  if (input.knowledge.trim() === '') throw new AiTemplateError('invalid', 'Write what the AI knows first.');
  if (!(await aiIsOn(db, orgId))) throw new AiTemplateError('ai_off', 'The AI assistant is switched off for this organisation.');
  const general = input.sensitive.filter((d) => d.mode === 'general').map((d) => `- ${d.detail}`);
  const show = input.sensitive.filter((d) => d.mode === 'show').map((d) => `- ${d.detail}`);
  const system = 'You tidy the text a WhatsApp assistant will be given. Rewrite it as clean bullet points (each line starting with "- ") grouped under short plain headings on their own lines. Keep every fact the owner gave, in the owner\'s words where possible; turn a question followed by its answer into a plain statement; remove repeats; never add a fact that is not in the text. Details marked KEEP GENERAL: the exact value must not appear anywhere in your text. Replace it with a rough idea that reveals nothing exact, using only what the text lets you say (a company name becomes "a software company"; a pay figure becomes "a competitive salary that depends on experience"; a street becomes just the city or area), or say a colleague will confirm it. Details marked SHOW stay exactly as written. Reply with the rewritten text only: no preamble, no JSON, no quotes around it.';
  const user = `Text to rewrite:\n${input.knowledge.slice(0, 20000)}\n\nKEEP GENERAL (never write the exact value):\n${general.length > 0 ? general.join('\n') : '- none'}\n\nSHOW (may stay exactly as written):\n${show.length > 0 ? show.join('\n') : '- none'}`;

  let text = '';
  let remaining: string[] = [];
  let dropped: string[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fix = [
        remaining.length > 0 ? `Your last answer still contained these exact values: ${remaining.join(', ')}. Leave them out.` : '',
        dropped.length > 0 ? `Your last answer dropped lines the owner wrote that must stay, word for word: ${dropped.map((d) => `"${d}"`).join('; ')}. Keep every one.` : ''
      ].filter((x) => x !== '').join(' ');
      const answer = await llm.complete({
        system, maxTokens: 6000,
        messages: [{ role: 'user', content: attempt === 0 ? user : `${user}\n\n${fix} Rewrite it again.` }]
      });
      await recordAiRun(db, { orgId, kind: 'rewrite', outcome: 'done', model: answer.model, usage: answer.usage, userId: input.userId ?? null });
      text = answer.text.trim();
    } catch (error) {
      throw new AiTemplateError('no_model', modelFailure(error));
    }
    if (text === '') throw new AiTemplateError('no_model', 'The AI wrote nothing. Try again.');
    remaining = leaked(text, input.sensitive);
    dropped = droppedLines(input.knowledge, text);
    if (remaining.length === 0 && dropped.length === 0) return text.slice(0, 30000);
  }
  if (remaining.length > 0) throw new AiTemplateError('invalid', `The AI left ${remaining.map((v) => `“${v}”`).join(', ')} in the text. Try again, or take it out by hand.`);
  // The rewrite is clean but the model still dropped lines the owner wrote (a "never say" rule, the answer to a question): they are put back as written, never lost (#95).
  return `${text}\n\nKept as the owner wrote them\n${dropped.map((d) => `- ${d}`).join('\n')}`.slice(0, 30000);
}

/** Words too common to show a line is still there. */
const STOP_WORDS = new Set(['the', 'and', 'that', 'this', 'with', 'for', 'you', 'your', 'are', 'not', 'any', 'have', 'from', 'will', 'they', 'them', 'when', 'what', 'say', 'tell']);

/** A line the owner wrote that is a rule (never, do not, avoid, must not, only if) or the answer of a question and answer pair. */
function mustKeep(line: string): boolean {
  return /\b(never|don'?t|do not|must not|should not|avoid|not allowed|only if|always)\b/i.test(line) || /^\s*[-*]?\s*(a|answer)\s*[:.)-]\s*\S/i.test(line);
}

/** The words that identify a line: lower case, four letters or more, not a common word. */
function keyWords(line: string): string[] {
  return (line.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []).filter((w) => !STOP_WORDS.has(w));
}

/**
 * The lines the owner wrote that must stay (rules and answers) that the rewritten text no longer holds: fewer than six in ten of the line's own
 * words are left in it. Exact wording is not needed (the rewrite tidies), but a rule that vanished must not go unnoticed (#95).
 */
export function droppedLines(original: string, rewritten: string): string[] {
  const kept = new Set(keyWords(rewritten));
  const out: string[] = [];
  for (const raw of original.split(/\r?\n/)) {
    const line = raw.replace(/^\s*[-*]\s*/, '').trim();
    if (line.length < 8 || !mustKeep(line)) continue;
    const words = keyWords(line.replace(/^\s*(a|answer)\s*[:.)-]\s*/i, ''));
    if (words.length === 0) continue;
    const present = words.filter((w) => kept.has(w)).length;
    if (present / words.length < 0.6) out.push(line.replace(/^\s*(a|answer)\s*[:.)-]\s*/i, ''));
  }
  return out;
}
