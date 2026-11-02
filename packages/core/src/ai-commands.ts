import { sql } from 'drizzle-orm';
import { setTenant, type Database } from '@crm/db';
import type { KmsDriver } from '@crm/kms-local';
import type { LlmDriver, LlmTool } from '@crm/llm';
import { AUDIT, writeAudit, type AuditActor } from './audit.js';
import { findCampaignPictures, type CampaignPicture } from './campaign-media.js';
import { createCampaignDraft, startCampaign, setCampaignStatus, editCampaign } from './campaign-actions.js';

/** One thing the assistant did (or was refused) while carrying out an instruction. */
export interface CommandAction {
  readonly tool: string;
  readonly ok: boolean;
  /** What happened, in plain words. */
  readonly detail: string;
  readonly campaignId?: string;
}

/** The answer to an instruction: what the assistant says, and exactly what it did. */
export interface CommandResult {
  readonly message: string;
  readonly actions: readonly CommandAction[];
}

/** Why an instruction could not be carried out at all. */
export class AiCommandError extends Error {
  /** `ai_off`: AI is not switched on for this org. `no_model`: the provider failed or is not configured. */
  constructor(readonly code: 'ai_off' | 'no_model', message: string) { super(message); this.name = 'AiCommandError'; }
}

/** Most things one instruction may do, so a confused model cannot run away with the org's campaigns. */
const MAX_ACTIONS = 5;

const TOOLS: readonly LlmTool[] = [
  {
    name: 'create_campaign',
    description: 'Prepare a new campaign (a bulk WhatsApp message) for an audience that already exists as a tag or a segment.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'A short internal name.' },
        body: { type: 'string', description: 'The message text. May use {{name}} for the contact\'s name and {option one|option two} to vary wording.' },
        senderId: { type: 'string', description: 'Id of the number to send from, from the context. Optional when there is only one.' },
        tagId: { type: 'string', description: 'Id of the tag whose contacts are the audience. Give this or segmentId, never both.' },
        segmentId: { type: 'string', description: 'Id of the segment that is the audience.' },
        pictureName: { type: 'string', description: 'Only if the instruction mentions a picture or GIF: words from the file name of one already uploaded for campaigns (for example "diwali"). The message becomes its caption. Never invent a file.' },
        start: { type: 'boolean', description: 'True only if the instruction says to send it now.' }
      },
      required: ['name', 'body']
    }
  },
  {
    name: 'send_message',
    description: 'Send one WhatsApp message to one existing contact, in the chat you already have with them. Use it for "message X", "ask X if...", "tell X that...". For many people use create_campaign instead.',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'The person to message: their NAME copied exactly as written in the instruction (for example "Test Phone Two"), or their phone number with country code. Never an id.' },
        text: { type: 'string', description: 'The final message, ready to send: short, polite, no placeholders like {{name}}.' }
      },
      required: ['to', 'text']
    }
  },
  {
    name: 'pause_campaign',
    description: 'Pause a running campaign. It can be resumed later.',
    parameters: { type: 'object', properties: { campaignId: { type: 'string' } }, required: ['campaignId'] }
  },
  {
    name: 'resume_campaign',
    description: 'Resume a paused campaign, or start a prepared draft.',
    parameters: { type: 'object', properties: { campaignId: { type: 'string' } }, required: ['campaignId'] }
  },
  {
    name: 'edit_campaign',
    description: 'Change the name or wording of a campaign that is a draft or paused. A running campaign must be paused first.',
    parameters: {
      type: 'object',
      properties: { campaignId: { type: 'string' }, name: { type: 'string' }, body: { type: 'string' } },
      required: ['campaignId']
    }
  }
];

/** Strings only, trimmed; anything else is treated as absent. */
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

/**
 * Carries out a plain-language instruction about campaigns, as the org's AI assistant.
 *
 * The model is shown the org's numbers, tags, segments and recent campaigns (names and ids, never contacts) and answers
 * with actions, which are run in order through the same code a person uses (`campaign-actions.ts`), each audited as the
 * assistant's own user. What it can never do: lift an anti-ban or do-not-contact gate (those have no path here), choose
 * an audience that does not exist, or start a campaign unless the org has allowed that. Every outcome is reported back, 
 * including refusals, and logged in `ai_run`. `db` must be pinned to the org.
 */
export async function runAiCommand(
  deps: { db: Database; kms: KmsDriver; llm: LlmDriver },
  orgId: string, requestedBy: string | null, instruction: string
): Promise<CommandResult> {
  const { db, llm } = deps;
  const settings = (await db.execute(sql`
    SELECT enabled, instructions, may_start_campaigns AS "mayStart", bot_user_id AS "botUserId", daily_message_cap AS "cap"
    FROM ai_setting WHERE org_id = ${orgId}`) as unknown as Array<{
    enabled: boolean; instructions: string; mayStart: boolean; botUserId: string | null; cap: number;
  }>)[0];
  if (settings === undefined || !settings.enabled || settings.botUserId === null) {
    throw new AiCommandError('ai_off', 'The AI assistant is switched off for this organisation.');
  }
  const bot: AuditActor = { type: 'agent', id: settings.botUserId };

  const senders = await db.execute(sql`SELECT id, label, status FROM sender_identity WHERE org_id = ${orgId} ORDER BY created_at LIMIT 20`) as unknown as Array<{ id: string; label: string; status: string }>;
  const tags = await db.execute(sql`SELECT id, name FROM tag WHERE org_id = ${orgId} ORDER BY name LIMIT 100`) as unknown as Array<{ id: string; name: string }>;
  const segments = await db.execute(sql`SELECT id, name FROM segment WHERE org_id = ${orgId} ORDER BY name LIMIT 50`) as unknown as Array<{ id: string; name: string }>;
  const campaigns = await db.execute(sql`SELECT id, name, status FROM campaign WHERE org_id = ${orgId} ORDER BY created_at DESC LIMIT 20`) as unknown as Array<{ id: string; name: string; status: string }>;

  const system = [
    'You are the AI assistant of a WhatsApp CRM. A team member is asking you to run campaigns (bulk messages) or to message one contact.',
    'Do exactly what was asked, with the tools. Use only ids from the context below; never invent one. If the audience, number or campaign is unclear or missing, do not guess: reply in words asking what is needed.',
    'To message one person use send_message: `to` is the person\'s name copied from the instruction (or their phone number), never an id; write the whole message yourself. Ids in the context belong only to numbers, tags, segments and campaigns.',
    'Never claim a campaign or message was sent unless a tool did it. Keep your reply to one or two sentences. Plain text.',
    'Write campaign text that is short, polite and varied: use {{name}} for the contact\'s name, and {option one|option two} for wording that can differ between people.',
    settings.instructions.trim() === '' ? '' : `The organisation's own instructions:\n${settings.instructions.trim()}`,
    `Context (JSON): ${JSON.stringify({ numbers: senders, tags, segments, recentCampaigns: campaigns })}`
  ].filter((l) => l !== '').join('\n');

  let answer;
  try {
    answer = await llm.complete({ system, messages: [{ role: 'user', content: instruction }], tools: TOOLS, maxTokens: 900 });
  } catch (error) {
    throw providerFailure(error);
  }

  const actions: CommandAction[] = [];
  const known = (list: Array<{ id: string }>, id: string | undefined): id is string => id !== undefined && list.some((x) => x.id === id);
  /** Campaign pictures whose file name contains the words the model gave; the assistant never makes up a file. */
  const findPictures = (words: string): Promise<CampaignPicture[]> => db.transaction(async (tx) => { await setTenant(tx, orgId); return findCampaignPictures(tx, orgId, words); });

  for (const call of answer.toolCalls.slice(0, MAX_ACTIONS)) {
    const a = call.arguments;
    const id = str(a.campaignId);
    let action: CommandAction;
    try {
      if (call.name === 'create_campaign') {
        const name = str(a.name); const body = str(a.body);
        const tagId = str(a.tagId); const segmentId = str(a.segmentId);
        const senderId = str(a.senderId) ?? (senders.length === 1 ? senders[0]!.id : undefined);
        if (name === undefined || body === undefined) action = { tool: call.name, ok: false, detail: 'It needs a name and the message text.' };
        else if ((tagId === undefined) === (segmentId === undefined)) action = { tool: call.name, ok: false, detail: 'Name the audience: exactly one tag or one segment.' };
        else if (tagId !== undefined && !known(tags, tagId)) action = { tool: call.name, ok: false, detail: 'That tag does not exist.' };
        else if (segmentId !== undefined && !known(segments, segmentId)) action = { tool: call.name, ok: false, detail: 'That segment does not exist.' };
        else if (!known(senders, senderId)) action = { tool: call.name, ok: false, detail: 'Say which number to send from.' };
        else if (str(a.pictureName) !== undefined && (await findPictures(str(a.pictureName)!)).length !== 1) {
          const found = await findPictures(str(a.pictureName)!);
          action = {
            tool: call.name, ok: false,
            detail: found.length === 0
              ? `No picture or GIF with “${str(a.pictureName)!}” in its name has been uploaded for campaigns. Upload it on the new campaign form first; nothing was created.`
              : `${String(found.length)} pictures match “${str(a.pictureName)!}”: ${found.map((p) => p.filename ?? 'unnamed').join(', ')}. Say which one; nothing was created.`
          };
        }
        else {
          const picture = str(a.pictureName) === undefined ? undefined : (await findPictures(str(a.pictureName)!))[0];
          const created = await db.transaction((tx) => createCampaignDraft(tx, orgId, { actor: bot }, {
            name: name.slice(0, 200), body: body.slice(0, 4096), senderIdentityId: senderId, fromTagId: tagId, fromSegmentId: segmentId,
            mediaAssetId: picture?.id
          }));
          if ('error' in created) action = { tool: call.name, ok: false, detail: 'Could not create it: the number, tag, segment or picture was not found.' };
          else if (a.start === true && settings.mayStart) {
            const started = await db.transaction((tx) => startCampaign(tx, orgId, { actor: bot }, created.id));
            action = 'error' in started
              ? { tool: call.name, ok: false, detail: 'Created, but it could not be started.', campaignId: created.id }
              : { tool: call.name, ok: true, detail: `Created and started: ${String(started.progress.total)} people, ${String(started.progress.pending)} waiting to be sent at the safe rate.`, campaignId: created.id };
          } else {
            action = {
              tool: call.name, ok: true, campaignId: created.id,
              detail: a.start === true
                ? 'Created and ready, but not started: an admin must press Start (the organisation has not allowed the assistant to start campaigns).'
                : 'Created as a draft. Nothing is sent until it is started.'
            };
          }
        }
      } else if (call.name === 'send_message') {
        action = await sendOne(deps, settings.cap, orgId, bot, str(a.to), str(a.text));
      } else if (call.name === 'pause_campaign') {
        action = !known(campaigns, id) ? { tool: call.name, ok: false, detail: 'No such campaign.' }
          : await db.transaction((tx) => setCampaignStatus(tx, orgId, { actor: bot }, id, 'paused'))
            ? { tool: call.name, ok: true, detail: 'Paused. Nothing more is sent until it is resumed.', campaignId: id }
            : { tool: call.name, ok: false, detail: 'It has already finished, so it cannot be paused.', campaignId: id };
      } else if (call.name === 'resume_campaign') {
        if (!known(campaigns, id)) action = { tool: call.name, ok: false, detail: 'No such campaign.' };
        else if (!settings.mayStart) action = { tool: call.name, ok: false, campaignId: id, detail: 'Not done: the organisation has not allowed the assistant to start campaigns. An admin must press Start.' };
        else {
          const started = await db.transaction((tx) => startCampaign(tx, orgId, { actor: bot }, id));
          action = 'error' in started
            ? { tool: call.name, ok: false, campaignId: id, detail: started.error === 'already_running' ? 'It is already running.' : started.error === 'finished' ? 'It has finished and cannot restart.' : 'No such campaign.' }
            : { tool: call.name, ok: true, campaignId: id, detail: `Running: ${String(started.progress.pending)} people waiting to be sent at the safe rate.` };
        }
      } else if (call.name === 'edit_campaign') {
        const name = str(a.name); const body = str(a.body);
        if (!known(campaigns, id)) action = { tool: call.name, ok: false, detail: 'No such campaign.' };
        else if (name === undefined && body === undefined) action = { tool: call.name, ok: false, campaignId: id, detail: 'Nothing to change was given.' };
        else {
          const outcome = await db.transaction((tx) => editCampaign(tx, orgId, { actor: bot }, id, { name: name?.slice(0, 200), body: body?.slice(0, 4096) }));
          action = outcome === 'ok' ? { tool: call.name, ok: true, campaignId: id, detail: 'Updated.' }
            : outcome === 'not_editable' ? { tool: call.name, ok: false, campaignId: id, detail: 'It is running or finished. Pause it first, then edit.' }
            : { tool: call.name, ok: false, detail: 'No such campaign.' };
        }
      } else {
        action = { tool: call.name, ok: false, detail: 'That is not something the assistant can do.' };
      }
    } catch {
      action = { tool: call.name, ok: false, detail: 'Something went wrong; nothing was changed by this step.', ...(id === undefined ? {} : { campaignId: id }) };
    }
    actions.push(action);
    await db.execute(sql`
      INSERT INTO ai_run (org_id, campaign_id, kind, outcome, reason, model, input_tokens, output_tokens)
      VALUES (${orgId}, ${action.campaignId ?? null}, ${call.name === 'send_message' ? 'message' : 'campaign_action'}, ${action.ok ? 'sent' : 'blocked'}, ${action.ok ? call.name : `${call.name}: ${action.detail}`.slice(0, 300)},
              ${answer.model}, ${actions.length === 1 ? answer.usage.inputTokens : 0}, ${actions.length === 1 ? answer.usage.outputTokens : 0})`);
  }

  await db.transaction((tx) => writeAudit(tx, {
    orgId, actor: bot, action: AUDIT.aiCommand, targetType: 'ai_setting',
    // What was asked is not copied into the log, only who asked, how long it was, and what was done.
    after: { requestedBy, instructionLength: instruction.length, actions: actions.map((x) => ({ tool: x.tool, ok: x.ok, campaignId: x.campaignId ?? null })) }
  }));

  return { message: answer.text, actions };
}

/**
 * Writes the wording of a campaign message from a short goal ("remind people about Friday's walk-in interview"). Nothing
 * is created or sent: the text goes into the campaign form for a person to read and change. No contact data is shared,
 * only the goal and the org's own instructions.
 */
export async function draftCampaignText(deps: { db: Database; llm: LlmDriver }, orgId: string, goal: string): Promise<string> {
  const settings = (await deps.db.execute(sql`
    SELECT enabled, instructions FROM ai_setting WHERE org_id = ${orgId}`) as unknown as Array<{ enabled: boolean; instructions: string }>)[0];
  if (settings === undefined || !settings.enabled) throw new AiCommandError('ai_off', 'The AI assistant is switched off for this organisation.');
  try {
    const answer = await deps.llm.complete({
      system: [
        'You write WhatsApp campaign messages for a business. Reply with only the message text: plain text, no quotes, no markdown, under 600 characters.',
        'Be warm and specific, and make clear what the reader should do. Use {{name}} where the contact\'s name fits, and {option one|option two} for a few words that can vary between people.',
        settings.instructions.trim() === '' ? '' : `The organisation's own instructions:\n${settings.instructions.trim()}`
      ].filter((l) => l !== '').join('\n'),
      messages: [{ role: 'user', content: goal }], maxTokens: 400
    });
    const text = answer.text.trim();
    if (text === '') throw new AiCommandError('no_model', 'The AI gave no text. Try describing the goal differently.');
    return text.slice(0, 4096);
  } catch (error) {
    if (error instanceof AiCommandError) throw error;
    throw providerFailure(error);
  }
}

/** Turns a model failure into words that say what to do: not configured, slow, busy, or refused. */
function providerFailure(error: unknown): AiCommandError {
  const code = error instanceof Error && 'code' in error ? String((error as { code: unknown }).code) : 'error';
  const status = error instanceof Error && 'statusCode' in error ? Number((error as { statusCode: unknown }).statusCode) : undefined;
  if (code === 'disabled') return new AiCommandError('no_model', 'No AI model is configured on this server.');
  if (code === 'timeout') return new AiCommandError('no_model', 'The AI provider took too long to answer. Try again in a moment.');
  if (status === 429 || status === 503) return new AiCommandError('no_model', `The AI provider is busy or rate-limiting this key (${String(status)}). Try again in a minute.`);
  if (status === 401 || status === 403) return new AiCommandError('no_model', `The AI provider refused the API key (${String(status)}). Check LLM_API_KEY.`);
  return new AiCommandError('no_model', `The AI provider did not answer (${status === undefined ? code : String(status)}).`);
}


/**
 * Sends one message to one existing contact as the assistant, in the chat that already exists with them.
 *
 * Refused, with the reason, when: the contact cannot be found or the name is ambiguous; they are do-not-contact (the
 * assistant has no override; an admin must send it themselves); there is no chat with them yet; the chat belongs to a
 * person (the assistant does not barge into someone else's conversation); or the org's daily AI limit is used up.
 * Otherwise the message is queued like any other (the gateway's gates and the anti-ban policy still decide when it goes out)
 * and the chat is assigned to the assistant, so the contact's reply is answered by it.
 */
async function sendOne(
  deps: { db: Database; kms: KmsDriver }, cap: number, orgId: string, bot: AuditActor, to: string | undefined, text: string | undefined
): Promise<CommandAction> {
  const tool = 'send_message';
  if (to === undefined || text === undefined) return { tool, ok: false, detail: 'It needs who to message and what to say.' };
  const { db, kms } = deps;
  // A number is recognised by looking like one (with its country code); anything else is a name.
  const phone = /^\+?[\d\s().-]{7,}$/.test(to) ? `+${to.replace(/\D/g, '')}` : null;
  const found = await db.execute(sql`
    SELECT DISTINCT c.id, c.display_name AS "name", c.do_not_contact AS "dnc"
    FROM contact c LEFT JOIN contact_identity ci ON ci.contact_id = c.id AND ci.kind = 'phone'
    WHERE c.org_id = ${orgId} AND (lower(c.display_name) = lower(${to}) OR (${phone}::text IS NOT NULL AND ci.value_normalized = ${phone}))
    LIMIT 3`) as unknown as Array<{ id: string; name: string; dnc: boolean }>;
  if (found.length === 0) return { tool, ok: false, detail: `No contact matches "${to}". Use the name exactly as it appears, or the phone number with country code.` };
  if (found.length > 1) return { tool, ok: false, detail: `More than one contact matches "${to}". Use the phone number instead.` };
  const contact = found[0]!;
  if (contact.dnc) return { tool, ok: false, detail: `${contact.name} is marked do-not-contact. The assistant cannot message them; an admin has to send it from the inbox.` };

  const chat = (await db.execute(sql`
    SELECT v.id, v.assignee_user_id AS "assignee", u.display_name AS "assigneeName", u.is_bot AS "assigneeIsBot"
    FROM conversation v LEFT JOIN app_user u ON u.id = v.assignee_user_id
    WHERE v.org_id = ${orgId} AND v.contact_id = ${contact.id}
    ORDER BY v.last_inbound_at DESC NULLS LAST, v.created_at DESC LIMIT 1`) as unknown as Array<{
    id: string; assignee: string | null; assigneeName: string | null; assigneeIsBot: boolean | null;
  }>)[0];
  if (chat === undefined) return { tool, ok: false, detail: `There is no chat with ${contact.name} yet. Start one from the inbox first.` };
  if (chat.assignee !== null && chat.assigneeIsBot !== true) {
    return { tool, ok: false, detail: `${contact.name}'s chat is assigned to ${chat.assigneeName ?? 'a team member'}, so the assistant will not message into it.` };
  }

  const today = (await db.execute(sql`
    SELECT count(*)::int AS n FROM ai_run WHERE org_id = ${orgId} AND outcome = 'sent' AND created_at > now() - interval '24 hours'`) as unknown as Array<{ n: number }>)[0]?.n ?? 0;
  if (today >= cap) return { tool, ok: false, detail: 'The assistant has reached its daily message limit.' };

  const body = text.slice(0, 1500);
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO message (org_id, conversation_id, direction, status, content_type, body_enc, body_hmac, sent_by, sent_by_user_id)
      VALUES (${orgId}, ${chat.id}, 'outbound', 'queued', 'text', ${Buffer.from(kms.encrypt(new TextEncoder().encode(body)))}, ${kms.blindIndex(body)}, 'agent', ${bot.id})`);
    if (chat.assignee === null) {
      await tx.execute(sql`UPDATE conversation SET assignee_user_id = ${bot.id}, status = 'open', updated_at = now() WHERE id = ${chat.id} AND org_id = ${orgId}`);
      await writeAudit(tx, {
        orgId, actor: bot, action: AUDIT.conversationAssigned, targetType: 'conversation', targetId: chat.id,
        before: { assigneeUserId: null }, after: { assigneeUserId: bot.id, reason: 'assistant started the conversation' }
      });
    }
  });
  return { tool, ok: true, detail: `Queued for ${contact.name}. It goes out at the number's safe pace, and the assistant will handle their reply.` };
}
