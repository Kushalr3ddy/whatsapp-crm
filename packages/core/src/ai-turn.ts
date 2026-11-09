import { sql } from 'drizzle-orm';
import type { Database, Transaction } from '@crm/db';

/**
 * What the AI reports after each turn of a campaign chat, besides the message it sends: where the conversation stands and a short
 * note for the colleague. Kept on the person's row of the campaign (`campaign_recipient`), so the campaign page can show who is
 * interested without anyone reading every chat.
 */

/** Where a conversation stands. */
export const AI_STATUSES = ['talking', 'interested', 'not_interested', 'needs_person'] as const;
/** One of the states above. */
export type AiStatus = (typeof AI_STATUSES)[number];

/** One turn as the model answered it. `reply` is the only text that is ever sent to the customer. */
export interface AiTurn {
  readonly reply: string;
  readonly status: AiStatus | null;
  readonly summary: string | null;
  /** The model says the conversation is finished (or a person is needed): the chat goes to the person the template names. */
  readonly handover: boolean;
}

/** The longest summary kept, in characters. */
const MAX_SUMMARY = 600;

/** The first JSON object in a text, ignoring a code fence around it; null when there is none or it does not parse. */
function jsonObject(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * Reads the model's answer. It asks for a JSON object with `reply`, `status` and `summary`; a plain text answer is just the reply (the
 * model may ignore the format, and the customer should still get an answer). JSON that did not finish is never sent: it gives an empty
 * reply, so nothing goes out rather than half a brace.
 */
export function parseAiTurn(raw: string): AiTurn {
  const text = raw.trim();
  const json = jsonObject(text);
  if (json !== null && typeof json.reply === 'string') {
    const status = AI_STATUSES.find((s) => s === json.status) ?? null;
    const summary = typeof json.summary === 'string' && json.summary.trim() !== '' ? json.summary.trim().slice(0, MAX_SUMMARY) : null;
    return { reply: json.reply.trim(), status, summary, handover: json.handover === true };
  }
  // Something that starts like our format but is not usable (cut off, or no reply in it) must not reach the customer.
  if (text.startsWith('{') || text.startsWith('```')) return { reply: '', status: null, summary: null, handover: false };
  return { reply: text, status: null, summary: null, handover: false };
}

/**
 * Saves what the AI reported for the person this chat is with, in the campaign it belongs to. A turn with no status or no summary
 * leaves the earlier one as it was. When the chat is being handed to a person and the model gave no status, a person is now needed,
 * unless the chat already ended as interested or not interested.
 */
export async function recordTurn(
  db: Database,
  input: { orgId: string; conversationId: string; campaignId: string; turn: AiTurn; handedOver: boolean }
): Promise<void> {
  const { orgId, conversationId, campaignId, turn, handedOver } = input;
  if (turn.status === null && turn.summary === null && !handedOver) return;
  await db.execute(sql`
    UPDATE campaign_recipient cr SET
      ai_status = COALESCE(${turn.status}, CASE WHEN ${handedOver} AND (cr.ai_status IS NULL OR cr.ai_status = 'talking') THEN 'needs_person' ELSE cr.ai_status END),
      ai_summary = COALESCE(${turn.summary}, cr.ai_summary),
      ai_status_at = now()
    FROM conversation v
    WHERE v.id = ${conversationId} AND v.org_id = ${orgId}
      AND cr.org_id = ${orgId} AND cr.campaign_id = ${campaignId} AND cr.contact_id = v.contact_id`);
}

/** How many people of a campaign are in each state. */
export interface CampaignAiStatus {
  readonly interested: number;
  readonly not_interested: number;
  readonly needs_person: number;
  readonly talking: number;
  /** Messaged, and nothing back yet. */
  readonly noAnswer: number;
}

/**
 * The people of a campaign by where their conversation stands. Someone who wrote back but has no status yet counts as talking;
 * someone who was messaged and never wrote back counts as no answer.
 */
export async function listCampaignAiStatus(db: Database | Transaction, orgId: string, campaignId: string): Promise<CampaignAiStatus> {
  const row = (await db.execute(sql`
    SELECT count(*) FILTER (WHERE s = 'interested')::int AS interested,
           count(*) FILTER (WHERE s = 'not_interested')::int AS not_interested,
           count(*) FILTER (WHERE s = 'needs_person')::int AS needs_person,
           count(*) FILTER (WHERE s = 'talking' OR (s IS NULL AND replied))::int AS talking,
           count(*) FILTER (WHERE s IS NULL AND NOT replied AND st = 'sent')::int AS "noAnswer"
    FROM (
      SELECT cr.ai_status AS s, cr.status AS st,
             EXISTS (SELECT 1 FROM message m JOIN conversation v ON v.id = m.conversation_id AND v.org_id = m.org_id
                     WHERE v.contact_id = cr.contact_id AND m.org_id = cr.org_id AND m.direction = 'inbound'
                       AND m.created_at > COALESCE(cr.attempted_at, '-infinity'::timestamptz)) AS replied
      FROM campaign_recipient cr WHERE cr.campaign_id = ${campaignId} AND cr.org_id = ${orgId}
    ) x`) as unknown as CampaignAiStatus[])[0];
  return row ?? { interested: 0, not_interested: 0, needs_person: 0, talking: 0, noAnswer: 0 };
}
