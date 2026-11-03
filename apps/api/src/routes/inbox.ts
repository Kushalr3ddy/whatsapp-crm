import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { sql, type SQL } from 'drizzle-orm';
import type { KmsDriver } from '@crm/kms-local';
import { loadCustomFields, sampleText } from '@crm/core';
import { requireScope } from '../auth.js';
import { problem } from '../problem.js';
import { requireUuidParam } from '../params.js';

/** A comma-separated list of ids from a query string ("a,b,c"), each of them a UUID. */
const idList = z.string().max(2000).transform((s) => s.split(',').map((x) => x.trim()).filter((x) => x !== ''))
  .pipe(z.array(z.string().uuid()).max(50));

/**
 * What the Inbox can be narrowed by. `owner` is `me` (chats I own or am on), `unassigned`, or one colleague's id; `view` is one of the
 * quick chips under the search. `status` defaults to open, like the screen.
 */
const listQuery = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(['open', 'closed', 'any']).default('open'),
  owner: z.union([z.enum(['all', 'me', 'unassigned']), z.string().uuid()]).default('all'),
  view: z.enum(['all', 'needs', 'unread', 'ai', 'you']).default('all'),
  campaigns: idList.optional(),
  files: idList.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0)
});

/** How many chats a search looks through. Message bodies are encrypted, so a search of the last message reads them here, not in SQL. */
const SEARCH_SCAN_LIMIT = 3000;
/** The longest piece of the last message sent to the list. */
const SNIPPET_CHARS = 400;

/** Escapes `%`, `_` and `\` so a search word is matched as typed. */
function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** One row as the query returns it, before the last message is decrypted. */
interface ChatRow {
  id: string; status: string; unreadCount: number; lastAt: string;
  assigneeUserId: string | null; assigneeName: string | null; isAi: boolean;
  contactId: string; contactName: string | null; contactPhone: string | null; doNotContact: boolean;
  senderLabel: string | null; needsYou: boolean;
  lastDirection: string | null; lastContentType: string | null; lastBodyEnc: Uint8Array | null; lastMessageAt: string | null;
}

/** The shape the screen reads: a row with the last message readable. */
type ChatListRow = Omit<ChatRow, 'lastBodyEnc' | 'lastDirection' | 'lastContentType' | 'lastMessageAt'> & {
  lastMessage: { text: string | null; kind: string; direction: string; at: string } | null;
};

/** The chips under the search, each with how many chats it would show right now (the other filters applied, the chip itself not). */
interface ChipCounts { all: number; needs: number; unread: number; ai: number; you: number }

/**
 * The chat list behind the Inbox screen: search, filters, the five quick views with their counts, and paging.
 *
 * A chat is "AI answering" when its owner is the AI assistant's user, and "You answering" otherwise (a person or nobody). "Needs you"
 * is an open chat where a person is meant to answer and the customer spoke last, or where the AI is stuck on the customer's last message
 * (blocked, failed or empty answer: the same reasons `getAiNotice` reports), so it is read from what the app already records.
 */
export function inboxRouter(kms: KmsDriver): Router {
  const router = Router();

  /** The tables every list query reads, with the last message of each chat and, for an AI-owned chat, the AI's last unanswered attempt. */
  const FROM = sql`
    FROM conversation v
    JOIN contact c ON c.id = v.contact_id
    JOIN sender_identity si ON si.id = v.sender_identity_id
    LEFT JOIN app_user au ON au.id = v.assignee_user_id
    LEFT JOIN LATERAL (
      SELECT m.direction, m.content_type, m.body_enc, m.created_at
      FROM message m WHERE m.conversation_id = v.id ORDER BY m.created_at DESC LIMIT 1) lm ON true
    LEFT JOIN LATERAL (
      SELECT r.outcome, r.reason FROM ai_run r
      WHERE COALESCE(au.is_bot, false) AND r.conversation_id = v.id AND r.kind = 'reply'
        AND NOT EXISTS (SELECT 1 FROM message mo WHERE mo.conversation_id = v.id AND mo.direction = 'outbound' AND mo.created_at > r.created_at)
      ORDER BY r.created_at DESC LIMIT 1) ar ON true`;
  const IS_AI = sql`COALESCE(au.is_bot, false)`;
  const NEEDS = sql`(v.status = 'open' AND (
      (NOT ${IS_AI} AND lm.direction = 'inbound')
      OR (${IS_AI} AND ((ar.outcome = 'blocked' AND ar.reason IN ('do_not_contact', 'daily_cap'))
                       OR ar.outcome = 'failed' OR (ar.outcome = 'skipped' AND ar.reason = 'empty_answer')))))`;
  /** The last activity is the latest message either way (GREATEST skips a missing side); a chat with none yet counts from when it was made. */
  const COLUMNS = sql`
    v.id, v.status, v.unread_count AS "unreadCount",
    COALESCE(GREATEST(v.last_inbound_at, v.last_outbound_at), v.created_at) AS "lastAt",
    v.assignee_user_id AS "assigneeUserId", au.display_name AS "assigneeName", ${IS_AI} AS "isAi",
    c.id AS "contactId", c.display_name AS "contactName", c.do_not_contact AS "doNotContact",
    (SELECT ci.value_normalized FROM contact_identity ci
      WHERE ci.contact_id = c.id AND ci.kind = 'phone' ORDER BY ci.is_primary DESC, ci.created_at ASC LIMIT 1) AS "contactPhone",
    si.label AS "senderLabel", ${NEEDS} AS "needsYou",
    lm.direction AS "lastDirection", lm.content_type AS "lastContentType", lm.body_enc AS "lastBodyEnc", lm.created_at AS "lastMessageAt"`;

  /** Turns a row's last message into text a person can read. A body that cannot be decrypted is left empty, not shown as an error. */
  function readable(row: ChatRow): ChatListRow {
    const { lastBodyEnc, lastDirection, lastContentType, lastMessageAt, ...rest } = row;
    let text: string | null = null;
    if (lastBodyEnc !== null) {
      try { text = new TextDecoder().decode(kms.decrypt(lastBodyEnc)).slice(0, SNIPPET_CHARS); } catch { text = null; }
    }
    return {
      ...rest,
      lastMessage: lastDirection === null || lastMessageAt === null
        ? null : { text, kind: lastContentType ?? 'text', direction: lastDirection, at: new Date(lastMessageAt).toISOString() }
    };
  }

  /** The SQL for one quick view. */
  function viewCondition(view: string): SQL | null {
    if (view === 'needs') return NEEDS;
    if (view === 'unread') return sql`v.unread_count > 0`;
    if (view === 'ai') return IS_AI;
    if (view === 'you') return sql`NOT ${IS_AI}`;
    return null;
  }

  /**
   * Lists chats, newest activity first.
   *
   * With `q`, a chat matches on the contact's name, any of their numbers, or the text of the last message; the last message is
   * decrypted here and compared, so a search looks through the newest {@link SEARCH_SCAN_LIMIT} chats that pass the other filters.
   * Without `q` everything is paged in SQL. `meta.counts` are for the chips; `meta.total` is how many chats the chosen chip has.
   */
  router.get('/inbox', requireScope('conversations:read'), async (req: Request, res: Response) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }
    const { q, status, owner, view, campaigns, files, limit, offset } = parsed.data;
    const orgId = req.crm!.orgId;
    if (owner === 'me' && req.crm!.userId === null) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', 'owner=me needs a signed-in user; an API key has no "mine".'));
      return;
    }

    const conds: SQL[] = [sql`v.org_id = ${orgId}`];
    if (status !== 'any') conds.push(sql`v.status = ${status}`);
    if (owner === 'me') {
      conds.push(sql`(v.assignee_user_id = ${req.crm!.userId} OR EXISTS (
        SELECT 1 FROM conversation_participant p WHERE p.conversation_id = v.id AND p.user_id = ${req.crm!.userId}))`);
    } else if (owner === 'unassigned') conds.push(sql`v.assignee_user_id IS NULL`);
    else if (owner !== 'all') conds.push(sql`v.assignee_user_id = ${owner}`);
    if (campaigns !== undefined && campaigns.length > 0) {
      conds.push(sql`EXISTS (SELECT 1 FROM message mc WHERE mc.conversation_id = v.id
        AND mc.campaign_id IN (${sql.join(campaigns.map((id) => sql`${id}::uuid`), sql`, `)}))`);
    }
    if (files !== undefined && files.length > 0) {
      conds.push(sql`EXISTS (SELECT 1 FROM import_row ir WHERE ir.contact_id = c.id
        AND ir.import_run_id IN (${sql.join(files.map((id) => sql`${id}::uuid`), sql`, `)}))`);
    }
    const where = sql.join(conds, sql` AND `);
    const ORDER = sql`ORDER BY COALESCE(GREATEST(v.last_inbound_at, v.last_outbound_at), v.created_at) DESC, v.id`;
    const chosen = viewCondition(view);

    const out = await req.tenant!(async (tx) => {
      const orgTotal = ((await tx.execute(sql`SELECT count(*)::int AS n FROM conversation WHERE org_id = ${orgId}`)) as unknown as Array<{ n: number }>)[0]?.n ?? 0;

      if (q === undefined || q === '') {
        const counts = ((await tx.execute(sql`
          SELECT count(*)::int AS "all", count(*) FILTER (WHERE ${NEEDS})::int AS "needs",
                 count(*) FILTER (WHERE v.unread_count > 0)::int AS "unread",
                 count(*) FILTER (WHERE ${IS_AI})::int AS "ai", count(*) FILTER (WHERE NOT ${IS_AI})::int AS "you"
          ${FROM} WHERE ${where}`)) as unknown as ChipCounts[])[0] ?? { all: 0, needs: 0, unread: 0, ai: 0, you: 0 };
        const rows = (await tx.execute(sql`
          SELECT ${COLUMNS} ${FROM} WHERE ${chosen === null ? where : sql`${where} AND ${chosen}`}
          ${ORDER} LIMIT ${limit} OFFSET ${offset}`)) as unknown as ChatRow[];
        return { rows: rows.map(readable), counts, orgTotal, total: counts[view] };
      }

      // A search: the name and number match in SQL, the last message is read here, so take the newest chats and look through them.
      const rows = (await tx.execute(sql`
        SELECT ${COLUMNS} ${FROM} WHERE ${where} ${ORDER} LIMIT ${SEARCH_SCAN_LIMIT}`)) as unknown as ChatRow[];
      const word = q.toLowerCase();
      const digits = q.replace(/[^\d]/g, '');
      const phoneHits = new Set<string>();
      if (digits.length >= 3) {
        const found = (await tx.execute(sql`
          SELECT DISTINCT contact_id AS id FROM contact_identity
          WHERE org_id = ${orgId} AND kind IN ('phone', 'wa_jid') AND value_normalized LIKE ${`%${likeEscape(digits)}%`}`)) as unknown as Array<{ id: string }>;
        for (const f of found) phoneHits.add(f.id);
      }
      const matched = rows.map(readable).filter((r) =>
        (r.contactName ?? '').toLowerCase().includes(word) || (r.contactPhone ?? '').includes(word)
        || phoneHits.has(r.contactId) || (r.lastMessage?.text ?? '').toLowerCase().includes(word));
      const counts: ChipCounts = {
        all: matched.length, needs: matched.filter((r) => r.needsYou).length, unread: matched.filter((r) => r.unreadCount > 0).length,
        ai: matched.filter((r) => r.isAi).length, you: matched.filter((r) => !r.isAi).length
      };
      const shown = matched.filter((r) => view === 'all' || (view === 'needs' ? r.needsYou : view === 'unread' ? r.unreadCount > 0 : view === 'ai' ? r.isAi : !r.isAi));
      return { rows: shown.slice(offset, offset + limit), counts, orgTotal, total: shown.length };
    });

    res.json({ data: out.rows, meta: { total: out.total, counts: out.counts, orgTotal: out.orgTotal } });
  });

  /** The campaigns and imported files that chats came from, each with how many chats, for the Filters panel. */
  router.get('/inbox/filters', requireScope('conversations:read'), async (req: Request, res: Response) => {
    const orgId = req.crm!.orgId;
    const out = await req.tenant!(async (tx) => {
      const campaigns = await tx.execute(sql`
        SELECT ca.id, ca.name, count(DISTINCT m.conversation_id)::int AS chats
        FROM campaign ca JOIN message m ON m.campaign_id = ca.id AND m.org_id = ca.org_id
        WHERE ca.org_id = ${orgId}
        GROUP BY ca.id, ca.name ORDER BY max(m.created_at) DESC LIMIT 100`);
      const files = await tx.execute(sql`
        SELECT r.id, coalesce(r.filename, 'import') AS name, count(DISTINCT v.id)::int AS chats
        FROM import_run r
        JOIN import_row ir ON ir.import_run_id = r.id
        JOIN conversation v ON v.contact_id = ir.contact_id AND v.org_id = r.org_id
        WHERE r.org_id = ${orgId} AND r.superseded_at IS NULL
        GROUP BY r.id, r.filename ORDER BY max(r.created_at) DESC LIMIT 100`);
      return { campaigns, files };
    });
    res.json({ data: out });
  });

  /**
   * The person behind a chat, for Details and for fill-ins in a reply: their name, number, email and every saved column they have a value
   * for, the files they came from, and the campaigns that messaged them in this chat.
   */
  router.get('/conversations/:id/person', requireUuidParam('id'), requireScope('conversations:read'), async (req: Request, res: Response) => {
    const orgId = req.crm!.orgId;
    const conversationId = String(req.params.id);
    const out = await req.tenant!(async (tx) => {
      const who = (await tx.execute(sql`
        SELECT c.id, nullif(trim(c.display_name), '') AS name, c.custom_fields AS "fields",
               (SELECT ci.value_normalized FROM contact_identity ci WHERE ci.contact_id = c.id AND ci.kind = 'phone'
                 ORDER BY ci.is_primary DESC, ci.created_at ASC LIMIT 1) AS phone,
               (SELECT ci.value_normalized FROM contact_identity ci WHERE ci.contact_id = c.id AND ci.kind = 'email'
                 ORDER BY ci.is_primary DESC, ci.created_at ASC LIMIT 1) AS email
        FROM conversation v JOIN contact c ON c.id = v.contact_id
        WHERE v.id = ${conversationId} AND v.org_id = ${orgId}`)) as unknown as Array<{
        id: string; name: string | null; fields: Record<string, unknown> | null; phone: string | null; email: string | null }>;
      const person = who[0];
      if (person === undefined) return null;

      const defs = await loadCustomFields(tx, orgId);
      const files = await tx.execute(sql`
        SELECT DISTINCT r.id, coalesce(r.filename, 'import') AS name
        FROM import_row ir JOIN import_run r ON r.id = ir.import_run_id
        WHERE ir.contact_id = ${person.id} AND r.org_id = ${orgId} AND r.superseded_at IS NULL`);
      const campaigns = await tx.execute(sql`
        SELECT ca.id, ca.name, min(m.created_at) AS "startedAt",
               EXISTS (SELECT 1 FROM message i WHERE i.conversation_id = ${conversationId} AND i.direction = 'inbound'
                         AND i.created_at > min(m.created_at)) AS replied
        FROM message m JOIN campaign ca ON ca.id = m.campaign_id
        WHERE m.conversation_id = ${conversationId} AND m.org_id = ${orgId} AND m.direction = 'outbound'
        GROUP BY ca.id, ca.name ORDER BY min(m.created_at) DESC LIMIT 50`);

      // The built-in fill-ins first, then every saved column this person has a value for. A fill-in without a value is not offered.
      const fillIns: Array<{ key: string; label: string; value: string }> = [];
      if (person.name !== null) {
        fillIns.push({ key: 'name', label: 'Name', value: person.name });
        fillIns.push({ key: 'first_name', label: 'First name', value: person.name.split(/\s+/)[0] ?? person.name });
      }
      if (person.phone !== null) fillIns.push({ key: 'phone', label: 'Phone', value: person.phone });
      if (person.email !== null) fillIns.push({ key: 'email', label: 'Email', value: person.email });
      // The columns that exist but this person has no value for: a reply that uses one is shown as "blank", not as a mistyped key.
      const blankKeys: string[] = [];
      if (person.phone === null) blankKeys.push('phone');
      if (person.email === null) blankKeys.push('email');
      for (const d of defs) {
        const v = person.fields?.[d.key];
        if (v !== undefined && v !== null && String(v).trim() !== '') fillIns.push({ key: d.key, label: d.label, value: sampleText(d.type, String(v)) });
        else blankKeys.push(d.key);
      }
      return { contactId: person.id, name: person.name, phone: person.phone, email: person.email, fillIns, blankKeys, files, campaigns };
    });
    if (out === null) {
      res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such conversation.'));
      return;
    }
    res.json({ data: out });
  });

  return router;
}
