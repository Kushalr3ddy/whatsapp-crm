import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import type { KmsDriver } from '@crm/kms-local';
import { writeAudit, AUDIT, storeOutboundMedia } from '@crm/core';
import type { StorageDriver } from '@crm/storage';
import { auditActor, requireRole, requireScope } from '../auth.js';
import { problem } from '../problem.js';
import { requireUuidParam } from '../params.js';
import { normalisePhone, detectMediaType } from '@crm/shared';

/**
 * Body for queueing an outbound message.
 *
 * Addressed **either** by phone (`to`, which starts a conversation if none exists) or by
 * `conversationId` (a reply in an existing thread). The second exists because not every
 * contact has a phone number: someone messaging from a WhatsApp privacy address arrives as a
 * `wa_lid` identity with no number at all, and `to` could never name them. The send path
 * already handles it — the gateway resolves whichever identity the conversation holds.
 */
const sendMessage = z.object({
  to: z.string().min(4).optional(),
  conversationId: z.string().uuid().optional(),
  body: z.string().min(1).max(4096),
  senderId: z.string().uuid().optional(),
  /** An admin knowingly messaging a do-not-contact person: explicit, with a reason, audited. */
  overrideDnc: z.boolean().optional(),
  overrideReason: z.string().trim().min(10).max(500).optional()
}).refine((v) => (v.to === undefined) !== (v.conversationId === undefined), {
  message: 'send exactly one of `to` or `conversationId`'
}).refine((v) => v.overrideDnc !== true || v.overrideReason !== undefined, {
  message: 'a reason of at least 10 characters is required to override do-not-contact', path: ['overrideReason']
});

/**
 * True when `userId` is one of the extra people on the thread. The thread lock lets the owner,
 * participants and admins reply; this is the participant half. Takes the request's tenant
 * transaction so row-level security scopes the lookup like every other query.
 */
async function isParticipant(
  tx: { execute: (q: ReturnType<typeof sql>) => PromiseLike<unknown> },
  conversationId: string, userId: string | null
): Promise<boolean> {
  if (userId === null) return false;
  const rows = (await tx.execute(sql`
    SELECT 1 FROM conversation_participant
    WHERE conversation_id = ${conversationId} AND user_id = ${userId}`)) as unknown[];
  return rows.length > 0;
}

/**
 * The person to credit as the author of an outbound message: the signed-in agent, or null for an
 * API key or the bootstrap credential, which are integrations rather than people. Stored in
 * `sent_by_user_id`, so the thread can say who sent each reply.
 */
function authorOf(req: Request): string | null {
  const ctx = req.crm!;
  return ctx.kind === 'session' ? ctx.userId : null;
}

/**
 * What to do about a send to someone who may be flagged do-not-contact. Not flagged: proceed. Flagged:
 * refuse, unless the caller is a signed-in admin who asked to override (`overrideDnc` + a reason), in
 * which case proceed and record the override. An agent or an API key can never override.
 */
function dncVerdict(
  req: Request, flagged: boolean, overrideDnc: boolean | undefined
): 'proceed' | 'override' | 'blocked' | 'forbidden' {
  if (!flagged) return 'proceed';
  if (overrideDnc !== true) return 'blocked';
  return req.crm!.kind === 'session' && req.crm!.role === 'admin' ? 'override' : 'forbidden';
}

/** Writes the audit row for an override, in the same transaction as the message it allowed. */
async function auditDncOverride(
  req: Request, tx: Parameters<Parameters<NonNullable<Request['tenant']>>[0]>[0], orgId: string,
  conversationId: string, reason: string | undefined
): Promise<void> {
  await writeAudit(tx, {
    orgId, actor: auditActor(req), action: AUDIT.messageDncOverridden,
    targetType: 'conversation', targetId: conversationId, after: { reason },
    ip: req.ip ?? null, requestId: String(req.id)
  });
}

/** The two refusals, shared by every send path. */
function sendDncRefusal(req: Request, res: Response, verdict: 'blocked' | 'forbidden'): void {
  if (verdict === 'blocked') {
    res.status(422).json(problem(req, 422, 'DO_NOT_CONTACT',
      'This contact is marked do-not-contact. An admin can send anyway with overrideDnc and a reason.'));
  } else {
    res.status(403).json(problem(req, 403, 'FORBIDDEN', 'Only a signed-in admin can override do-not-contact.'));
  }
}

/**
 * Filters for the conversation list.
 *
 * `assignee` is a small union rather than a plain UUID: `me` and `unassigned` are the two
 * views an agent lives in, and a UUID names one colleague. Anything else is refused so a typo
 * cannot silently widen the query to every thread.
 */
const listQuery = z.object({
  status: z.enum(['open', 'closed']).optional(),
  assignee: z.union([
    z.literal('me'), z.literal('unassigned'), z.string().uuid()
  ]).optional()
});

/**
 * Body for changing a conversation. Both fields optional, but the refine requires at least one:
 * an empty PATCH means the caller meant to change something and did not, which is a mistake
 * worth reporting rather than a no-op worth hiding. `assigneeUserId: null` unassigns.
 */
const patchConversation = z.object({
  status: z.enum(['open', 'closed']).optional(),
  assigneeUserId: z.string().uuid().nullable().optional()
}).refine((v) => v.status !== undefined || v.assigneeUserId !== undefined, {
  message: 'provide at least one of `status` or `assigneeUserId`'
});

/**
 * Body for an internal note. `mentions` is optional and holds the user ids @-referenced in the
 * body — stored for a later notifications feature, not acted on yet.
 */
const createNote = z.object({
  body: z.string().min(1).max(4096),
  mentions: z.array(z.string().uuid()).max(50).optional()
});

/** Body for a saved reply. `shortcut` is unique per org; `locale` defaults to `en`. */
const createCannedReply = z.object({
  shortcut: z.string().min(1).max(64),
  body: z.string().min(1).max(4096),
  locale: z.string().min(2).max(10).optional()
});

/**
 * Conversations and messages.
 *
 * `POST /messages` **queues**, it does not send. The socket lives in the gateway, and more
 * importantly every outbound message must pass the pacing and policy gates that will live in
 * the dispatcher (P6) — a route that could reach a provider directly would be a way to bypass
 * them, which is precisely the hole the previous system had (docs/00-prior-art.md, M12).
 */
export function messagesRouter(
  kms: KmsDriver, defaultCountry: string, storage: StorageDriver, maxUploadBytes: number
): Router {
  const router = Router();

  /**
   * Lists conversations, most recently active first.
   *
   * Filters narrow by `status` (open/closed) and by `assignee`, where `me` is the signed-in
   * user, `unassigned` is a null assignee, and a UUID is a specific member. The filters are the
   * difference between one shared queue and a team that can divide work — without them an agent
   * and an admin see the identical list (F3, AC-1).
   */
  router.get('/conversations', requireScope('conversations:read'), async (req: Request, res: Response) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', parsed.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }
    const { status, assignee } = parsed.data;
    const orgId = req.crm!.orgId;

    // `me` names the caller, so it needs a person. An API key is not one — it holds scopes, not
    // an identity — so it cannot ask for "mine" and is told plainly rather than shown an empty
    // list, which would look like a bug.
    if (assignee === 'me' && req.crm!.userId === null) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED',
        'assignee=me needs a signed-in user; an API key has no "mine".'));
      return;
    }

    const conditions = [sql`v.org_id = ${orgId}`];
    if (status !== undefined) conditions.push(sql`v.status = ${status}`);
    // "Mine" is a chat I own or am a participant on — otherwise one I was pulled into would
    // never reach my queue.
    if (assignee === 'me') {
      conditions.push(sql`(v.assignee_user_id = ${req.crm!.userId} OR EXISTS (
        SELECT 1 FROM conversation_participant p
        WHERE p.conversation_id = v.id AND p.user_id = ${req.crm!.userId}))`);
    }
    else if (assignee === 'unassigned') conditions.push(sql`v.assignee_user_id IS NULL`);
    else if (assignee !== undefined) conditions.push(sql`v.assignee_user_id = ${assignee}`);
    const where = sql.join(conditions, sql` AND `);

    const rows = await req.tenant!((tx) => tx.execute(sql`
      SELECT v.id, v.status, v.unread_count AS "unreadCount",
             v.last_inbound_at AS "lastInboundAt", v.last_outbound_at AS "lastOutboundAt",
             v.assignee_user_id AS "assigneeUserId", au.display_name AS "assigneeName",
             COALESCE((SELECT json_agg(json_build_object('userId', pu.id, 'name', pu.display_name)
                                       ORDER BY pu.display_name)
                       FROM conversation_participant p
                       JOIN app_user pu ON pu.id = p.user_id
                       WHERE p.conversation_id = v.id), '[]'::json) AS "participants",
             c.id AS "contactId", c.display_name AS "contactName",
             c.do_not_contact AS "doNotContact",
             -- A subquery rather than a join: a contact may hold more than one phone
             -- identity, and joining would silently duplicate the conversation row.
             -- Prefers the primary, falls back to the oldest, always yields exactly one.
             (SELECT ci.value_normalized FROM contact_identity ci
               WHERE ci.contact_id = c.id AND ci.kind = 'phone'
               ORDER BY ci.is_primary DESC, ci.created_at ASC
               LIMIT 1) AS "contactPhone",
             si.label AS "senderLabel",
             (SELECT count(*)::int FROM message m WHERE m.conversation_id = v.id) AS "messageCount",
             -- Outbound messages accepted but not yet sent. Surfaced so the inbox can warn
             -- rather than leave someone believing a reply has gone out when it has not.
             (SELECT count(*)::int FROM message m
               WHERE m.conversation_id = v.id
                 AND m.direction = 'outbound' AND m.status = 'queued') AS "queuedCount"
      FROM conversation v
      JOIN contact c ON c.id = v.contact_id
      JOIN sender_identity si ON si.id = v.sender_identity_id
      -- app_user carries no RLS (resolving a credential is what sets the tenant), so the
      -- assignee's name is fetched by a plain join; the assignee id itself is only ever set to
      -- an org member by PATCH below, so this cannot surface a name from another tenant.
      LEFT JOIN app_user au ON au.id = v.assignee_user_id
      WHERE ${where}
      ORDER BY GREATEST(COALESCE(v.last_inbound_at, v.created_at),
                        COALESCE(v.last_outbound_at, v.created_at)) DESC
      LIMIT 100`));
    res.json({ data: rows });
  });

  /**
   * Lists the org's members, so the inbox can offer an assignee.
   *
   * Read access rather than admin: any agent may hand a thread to a colleague, and the whole
   * point of assignment is that they can. Returns only what an assignee picker needs — never a
   * password hash or an email, which are not this endpoint's business.
   */
  router.get('/users', requireScope('conversations:read'), async (req: Request, res: Response) => {
    const rows = await req.tenant!((tx) => tx.execute(sql`
      SELECT u.id, u.display_name AS "displayName", m.role
      FROM org_membership m
      JOIN app_user u ON u.id = m.user_id
      WHERE m.org_id = ${req.crm!.orgId} AND u.status = 'active'
      ORDER BY u.display_name ASC`));
    res.json({ data: rows });
  });

  /**
   * Returns one conversation on its own.
   *
   * The list is capped at 100, so a thread older than that could be found by id but not opened —
   * the UI read the conversation's own details (title, status, assignee) out of the list. This
   * fetches exactly one, by id, so any thread can be opened regardless of how many are ahead of
   * it. Same shape as a list row.
   */
  router.get('/conversations/:id', requireUuidParam('id'), requireScope('conversations:read'),
    async (req: Request, res: Response) => {
    const rows = (await req.tenant!((tx) => tx.execute(sql`
      SELECT v.id, v.status, v.unread_count AS "unreadCount",
             v.last_inbound_at AS "lastInboundAt", v.last_outbound_at AS "lastOutboundAt",
             v.assignee_user_id AS "assigneeUserId", au.display_name AS "assigneeName",
             COALESCE((SELECT json_agg(json_build_object('userId', pu.id, 'name', pu.display_name)
                                       ORDER BY pu.display_name)
                       FROM conversation_participant p
                       JOIN app_user pu ON pu.id = p.user_id
                       WHERE p.conversation_id = v.id), '[]'::json) AS "participants",
             c.id AS "contactId", c.display_name AS "contactName",
             c.do_not_contact AS "doNotContact",
             (SELECT ci.value_normalized FROM contact_identity ci
               WHERE ci.contact_id = c.id AND ci.kind = 'phone'
               ORDER BY ci.is_primary DESC, ci.created_at ASC
               LIMIT 1) AS "contactPhone",
             si.label AS "senderLabel",
             (SELECT count(*)::int FROM message m WHERE m.conversation_id = v.id) AS "messageCount",
             (SELECT count(*)::int FROM message m
               WHERE m.conversation_id = v.id
                 AND m.direction = 'outbound' AND m.status = 'queued') AS "queuedCount"
      FROM conversation v
      JOIN contact c ON c.id = v.contact_id
      JOIN sender_identity si ON si.id = v.sender_identity_id
      LEFT JOIN app_user au ON au.id = v.assignee_user_id
      WHERE v.id = ${String(req.params.id)} AND v.org_id = ${req.crm!.orgId}`))
    ) as unknown as Array<Record<string, unknown>>;

    if (rows.length === 0) {
      res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such conversation.'));
      return;
    }
    res.json({ data: rows[0] });
  });

  /**
   * Marks a conversation read, clearing its unread badge.
   *
   * Opening a thread already does this as a side effect of fetching its messages; this is the
   * explicit form for a client that clears the badge without loading the whole thread. Idempotent.
   */
  router.post('/conversations/:id/read', requireUuidParam('id'), requireScope('conversations:read'),
    async (req: Request, res: Response) => {
    const orgId = req.crm!.orgId;
    const conversationId = String(req.params.id);
    const updated = (await req.tenant!((tx) => tx.execute(sql`
      UPDATE conversation SET unread_count = 0
      WHERE id = ${conversationId} AND org_id = ${orgId}
      RETURNING id, unread_count AS "unreadCount"`)
    ) as unknown as Array<{ id: string; unreadCount: number }>);
    if (updated.length === 0) {
      res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such conversation.'));
      return;
    }
    res.json({ data: updated[0] });
  });

  /**
   * Changes a conversation's status or assignee.
   *
   * At least one field, so an empty PATCH is a caller error rather than a silent no-op. A new
   * assignee must belong to the org — `assignee_user_id` references `app_user`, which has no
   * tenancy of its own, so nothing but this check stops a thread being handed to a user from
   * another org. Each change writes its own audit row with the value on both sides (F3, TC-3.8).
   */
  router.patch('/conversations/:id', requireUuidParam('id'), requireScope('conversations:write'),
    async (req: Request, res: Response) => {
    const parsed = patchConversation.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', parsed.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }
    const orgId = req.crm!.orgId;
    const conversationId = String(req.params.id);
    const { status, assigneeUserId } = parsed.data;

    const result = await req.tenant!(async (tx) => {
      // The state before the change, which is also the existence check: RLS scopes it to this
      // org, so a missing row means "not here" without confirming it exists elsewhere.
      const before = (await tx.execute(sql`
        SELECT status, assignee_user_id AS "assigneeUserId"
        FROM conversation WHERE id = ${conversationId} AND org_id = ${orgId}`)
      ) as unknown as Array<{ status: string; assigneeUserId: string | null }>;
      if (before.length === 0) return { notFound: true as const };

      // Assigning to someone outside the org is a caller error, not a 404: the conversation is
      // real and here, the assignee is the problem, so name it.
      if (assigneeUserId !== undefined && assigneeUserId !== null) {
        const member = (await tx.execute(sql`
          SELECT 1 FROM org_membership WHERE org_id = ${orgId} AND user_id = ${assigneeUserId}`)
        ) as unknown as unknown[];
        if (member.length === 0) return { notMember: true as const };
      }

      const updated = (await tx.execute(sql`
        UPDATE conversation SET
          status = ${status ?? sql`status`},
          assignee_user_id = ${assigneeUserId === undefined ? sql`assignee_user_id` : assigneeUserId},
          updated_at = now()
        WHERE id = ${conversationId} AND org_id = ${orgId}
        RETURNING id, status, assignee_user_id AS "assigneeUserId"`)
      ) as unknown as Array<{ id: string; status: string; assigneeUserId: string | null }>;

      // An owner who was also a participant is no longer listed twice.
      if (assigneeUserId !== undefined && assigneeUserId !== null) {
        await tx.execute(sql`
          DELETE FROM conversation_participant
          WHERE conversation_id = ${conversationId} AND user_id = ${assigneeUserId}`);
      }

      const prev = before[0]!;
      // One row per field that actually moved. A PATCH that sets the value already held is not
      // a change and is not audited — otherwise the log fills with re-assignments to the same
      // person, which is noise in exactly the place clarity matters.
      if (assigneeUserId !== undefined && assigneeUserId !== prev.assigneeUserId) {
        await writeAudit(tx, {
          orgId, actor: auditActor(req), action: AUDIT.conversationAssigned,
          targetType: 'conversation', targetId: conversationId,
          before: { assigneeUserId: prev.assigneeUserId },
          after: { assigneeUserId },
          ip: req.ip ?? null, requestId: String(req.id)
        });
      }
      if (status !== undefined && status !== prev.status) {
        await writeAudit(tx, {
          orgId, actor: auditActor(req), action: AUDIT.conversationStatusChanged,
          targetType: 'conversation', targetId: conversationId,
          before: { status: prev.status }, after: { status },
          ip: req.ip ?? null, requestId: String(req.id)
        });
      }
      return { row: updated[0]! };
    });

    if ('notFound' in result) {
      res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such conversation.'));
      return;
    }
    if ('notMember' in result) {
      res.status(422).json(problem(req, 422, 'NOT_A_MEMBER',
        'That user is not a member of this organisation and cannot be assigned the thread.'));
      return;
    }
    res.json({ data: result.row });
  });

  /**
   * Adds a participant to a thread. Admin only: the owner stays accountable, and who else is
   * on a customer's chat is a call for the people who run the workspace. Idempotent — adding
   * someone already there changes nothing and writes no audit row. The owner cannot be added
   * as their own participant.
   */
  router.post('/conversations/:id/participants', requireUuidParam('id'), requireRole('admin'),
    async (req: Request, res: Response) => {
    const parsed = z.object({ userId: z.string().uuid() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', parsed.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }
    const orgId = req.crm!.orgId;
    const conversationId = String(req.params.id);
    const { userId } = parsed.data;

    const result = await req.tenant!(async (tx) => {
      const conv = (await tx.execute(sql`
        SELECT assignee_user_id AS "assigneeUserId" FROM conversation
        WHERE id = ${conversationId} AND org_id = ${orgId}`)
      ) as unknown as Array<{ assigneeUserId: string | null }>;
      if (conv.length === 0) return { notFound: true as const };
      const member = (await tx.execute(sql`
        SELECT 1 FROM org_membership WHERE org_id = ${orgId} AND user_id = ${userId}`)
      ) as unknown as unknown[];
      if (member.length === 0) return { notMember: true as const };
      if (conv[0]!.assigneeUserId === userId) return { isOwner: true as const };

      const inserted = (await tx.execute(sql`
        INSERT INTO conversation_participant (org_id, conversation_id, user_id, added_by_user_id)
        VALUES (${orgId}, ${conversationId}, ${userId}, ${req.crm!.userId})
        ON CONFLICT (conversation_id, user_id) DO NOTHING
        RETURNING user_id AS "userId"`)) as unknown as unknown[];
      if (inserted.length > 0) {
        await writeAudit(tx, {
          orgId, actor: auditActor(req), action: AUDIT.conversationParticipantAdded,
          targetType: 'conversation', targetId: conversationId,
          after: { userId }, ip: req.ip ?? null, requestId: String(req.id)
        });
      }
      return { row: { conversationId, userId } };
    });

    if ('notFound' in result) {
      res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such conversation.'));
      return;
    }
    if ('notMember' in result) {
      res.status(422).json(problem(req, 422, 'NOT_A_MEMBER',
        'That user is not a member of this organisation.'));
      return;
    }
    if ('isOwner' in result) {
      res.status(422).json(problem(req, 422, 'ALREADY_OWNER',
        'That user already owns this thread; participants are the other people on it.'));
      return;
    }
    res.status(201).json({ data: result.row });
  });

  /** Removes a participant from a thread. Admin only; removing someone not there is a no-op. */
  router.delete('/conversations/:id/participants/:userId', requireUuidParam('id', 'userId'),
    requireRole('admin'), async (req: Request, res: Response) => {
    const orgId = req.crm!.orgId;
    const conversationId = String(req.params.id);
    const userId = String(req.params.userId);

    const found = await req.tenant!(async (tx) => {
      const conv = (await tx.execute(sql`
        SELECT 1 FROM conversation WHERE id = ${conversationId} AND org_id = ${orgId}`)
      ) as unknown as unknown[];
      if (conv.length === 0) return false;
      const removed = (await tx.execute(sql`
        DELETE FROM conversation_participant
        WHERE conversation_id = ${conversationId} AND user_id = ${userId} AND org_id = ${orgId}
        RETURNING user_id`)) as unknown as unknown[];
      if (removed.length > 0) {
        await writeAudit(tx, {
          orgId, actor: auditActor(req), action: AUDIT.conversationParticipantRemoved,
          targetType: 'conversation', targetId: conversationId,
          before: { userId }, ip: req.ip ?? null, requestId: String(req.id)
        });
      }
      return true;
    });
    if (!found) {
      res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such conversation.'));
      return;
    }
    res.status(204).end();
  });

  /** Lists a thread's internal notes, oldest first, with the author's name resolved. */
  router.get('/conversations/:id/notes', requireUuidParam('id'), requireScope('conversations:read'),
    async (req: Request, res: Response) => {
    const rows = await req.tenant!((tx) => tx.execute(sql`
      SELECT n.id, n.body, n.mentions, n.author_user_id AS "authorUserId",
             au.display_name AS "authorName", n.created_at AS "createdAt"
      FROM internal_note n
      LEFT JOIN app_user au ON au.id = n.author_user_id
      WHERE n.conversation_id = ${String(req.params.id)} AND n.org_id = ${req.crm!.orgId}
      ORDER BY n.created_at ASC
      LIMIT 500`));
    res.json({ data: rows });
  });

  /**
   * Adds an internal note to a thread.
   *
   * A note lives in `internal_note`, never `message`, so it cannot enter the send path — the
   * gateway only ever reads `message`. That is what makes "a note is never transmitted" true by
   * construction rather than by a check that could be forgotten (F3, AC-4). The conversation is
   * verified in-org first so a note cannot be pinned to another tenant's thread through its FK,
   * which does not carry the org.
   */
  router.post('/conversations/:id/notes', requireUuidParam('id'), requireScope('conversations:write'),
    async (req: Request, res: Response) => {
    const parsed = createNote.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', parsed.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }
    const orgId = req.crm!.orgId;
    const conversationId = String(req.params.id);
    const { body, mentions } = parsed.data;

    const result = await req.tenant!(async (tx) => {
      const found = (await tx.execute(sql`
        SELECT 1 FROM conversation WHERE id = ${conversationId} AND org_id = ${orgId}`)
      ) as unknown as unknown[];
      if (found.length === 0) return { notFound: true as const };

      // Build the uuid[] literal explicitly. A bound empty JS array has no type for Postgres to
      // infer, so it cannot cast to uuid[] — spelling the array out avoids that entirely.
      const mentionsSql = mentions === undefined || mentions.length === 0
        ? sql`'{}'::uuid[]`
        : sql`ARRAY[${sql.join(mentions.map((m) => sql`${m}`), sql`, `)}]::uuid[]`;
      const inserted = (await tx.execute(sql`
        INSERT INTO internal_note (org_id, conversation_id, author_user_id, body, mentions)
        VALUES (${orgId}, ${conversationId}, ${req.crm!.userId}, ${body}, ${mentionsSql})
        RETURNING id, body, mentions, author_user_id AS "authorUserId", created_at AS "createdAt"`)
      ) as unknown as Array<Record<string, unknown>>;
      return { row: inserted[0]! };
    });

    if ('notFound' in result) {
      res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such conversation.'));
      return;
    }
    res.status(201).json({ data: result.row });
  });

  /** Lists the org's saved replies, most recently updated first. */
  router.get('/canned-replies', requireScope('conversations:read'), async (req: Request, res: Response) => {
    const rows = await req.tenant!((tx) => tx.execute(sql`
      SELECT id, shortcut, body, locale, updated_at AS "updatedAt"
      FROM canned_reply WHERE org_id = ${req.crm!.orgId}
      ORDER BY updated_at DESC
      LIMIT 200`));
    res.json({ data: rows });
  });

  /**
   * Creates a saved reply. `shortcut` is unique per org — a duplicate is a 409 rather than a
   * silent overwrite, because two replies answering to the same shortcut is an ambiguity the
   * agent should resolve, not a race for the database to pick a winner of.
   */
  router.post('/canned-replies', requireScope('conversations:write'), async (req: Request, res: Response) => {
    const parsed = createCannedReply.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', parsed.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }
    const orgId = req.crm!.orgId;
    const { shortcut, body, locale } = parsed.data;

    const inserted = (await req.tenant!((tx) => tx.execute(sql`
      INSERT INTO canned_reply (org_id, shortcut, body, locale)
      VALUES (${orgId}, ${shortcut}, ${body}, ${locale ?? 'en'})
      ON CONFLICT (org_id, shortcut) DO NOTHING
      RETURNING id, shortcut, body, locale, updated_at AS "updatedAt"`))
    ) as unknown as Array<Record<string, unknown>>;

    if (inserted.length === 0) {
      res.status(409).json(problem(req, 409, 'SHORTCUT_TAKEN',
        `A saved reply with the shortcut "${shortcut}" already exists.`));
      return;
    }
    res.status(201).json({ data: inserted[0] });
  });

  /**
   * Whether the number this thread sends from can send right now. The composer polls it so an
   * agent is told *before* typing that a message would only sit waiting. `canSend` is true only
   * when the socket is open and the number is not quarantined; `reason` says what is wrong.
   */
  router.get('/conversations/:id/sender-status', requireUuidParam('id'), requireScope('conversations:read'),
    async (req: Request, res: Response) => {
      const rows = await req.tenant!((tx) => tx.execute(sql`
        SELECT si.label, si.status, si.enforcement, si.restriction_state AS "restrictionState",
               cs.connection_state AS "connectionState"
        FROM conversation v
        JOIN sender_identity si ON si.id = v.sender_identity_id
        LEFT JOIN channel_session cs ON cs.sender_identity_id = si.id
        WHERE v.id = ${String(req.params.id)} AND v.org_id = ${req.crm!.orgId}`));
      const s = (rows as unknown as Array<{
        label: string; status: string; enforcement: string; restrictionState: string;
        connectionState: string | null;
      }>)[0];
      if (!s) { res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such conversation.')); return; }
      const connected = s.connectionState === 'open';
      const reason = !connected ? 'not_connected' : s.status === 'quarantined' ? 'quarantined' : null;
      res.json({ data: {
        label: s.label, connectionState: s.connectionState, status: s.status,
        restrictionState: s.restrictionState,
        canSend: reason === null || s.enforcement === 'advisory' && connected, reason
      } });
    });

  /** Returns one thread, oldest first, with bodies decrypted for display. */
  router.get('/conversations/:id/messages', requireUuidParam('id'), requireScope('conversations:read'), async (req: Request, res: Response) => {
    const orgId = req.crm!.orgId;
    const conversationId = String(req.params.id);

    const rows = await req.tenant!(async (tx) => {
      const found = await tx.execute(sql`
        SELECT m.id, m.direction, m.content_type AS "contentType", m.status,
               m.error_code AS "errorCode", m.hold_reason AS "holdReason",
               m.body_enc AS "bodyEnc", m.sent_by AS "sentBy",
               m.sent_by_user_id AS "sentByUserId", u.display_name AS "sentByName",
               m.created_at AS "createdAt", m.sent_at AS "sentAt", m.read_at AS "readAt",
               m.media_id AS "mediaId", ma.content_type AS "mediaContentType",
               ma.size_bytes AS "mediaSizeBytes", ma.filename AS "mediaFilename"
        FROM message m
        JOIN conversation v ON v.id = m.conversation_id
        LEFT JOIN media_asset ma ON ma.id = m.media_id
        LEFT JOIN app_user u ON u.id = m.sent_by_user_id
        WHERE v.id = ${conversationId} AND v.org_id = ${orgId}
        ORDER BY m.created_at ASC
        LIMIT 500`);

      // Opening a thread is a read worth recording, now that a thread can hold a CV (D-13).
      // Listing the inbox is not, and is deliberately left unaudited: an access log that
      // records every pagination is too noisy to answer the question it exists for.
      //
      // One row per open, because nothing polls this endpoint. If P4's realtime work turns
      // it into a poll, this becomes a row every few seconds and needs revisiting.
      if ((found as unknown as unknown[]).length > 0) {
        await writeAudit(tx, {
          orgId, actor: auditActor(req), action: AUDIT.conversationRead,
          targetType: 'conversation', targetId: conversationId,
          ip: req.ip ?? null, requestId: String(req.id)
        });
        // Opening a thread reads it: clear the unread badge. Without this the count only ever
        // grew — it was incremented on every inbound and reset nowhere. Idempotent, so the
        // 5-second inbox poll reopening the same thread costs nothing.
        await tx.execute(sql`
          UPDATE conversation SET unread_count = 0
          WHERE id = ${conversationId} AND org_id = ${orgId} AND unread_count <> 0`);
      }
      return found;
    });

    const messages = (rows as unknown as Array<{
      bodyEnc: Uint8Array | null; contentType: string; mediaId: string | null;
      mediaContentType: string | null; mediaSizeBytes: number | null;
      mediaFilename: string | null;
    }>).map((m) => {
      const { bodyEnc, mediaId, mediaContentType, mediaSizeBytes, mediaFilename, ...rest } = m;
      // Decrypt for display only. A body that cannot be decrypted is reported rather than
      // hidden — usually it means the encryption key has changed, and silently showing an
      // empty message would make that look like data loss.
      let body: string | null = null;
      let undecryptable = false;
      if (bodyEnc !== null) {
        try { body = new TextDecoder().decode(kms.decrypt(bodyEnc)); }
        catch { undecryptable = true; }
      }
      return {
        ...rest, body, undecryptable,
        // The path rather than a bare id, so a client never has to know how to build one —
        // and never invents a public one. There is no unauthenticated way to reach a file.
        media: mediaId === null ? null : {
          id: mediaId,
          url: `/api/v1/media/${mediaId}`,
          contentType: mediaContentType,
          sizeBytes: mediaSizeBytes,
          filename: mediaFilename
        },
        // A media message with no stored file: the attachment existed and could not be
        // fetched. Said explicitly so the inbox can show that rather than an empty bubble,
        // which would look like the person sent nothing.
        mediaUnavailable: m.contentType !== 'text' && mediaId === null
      };
    });
    res.json({ data: messages });
  });

  /** Queues an outbound message. The gateway sends it; poll the thread for status. */
  /**
   * Sends a file into an existing thread (D-25). The bytes are the request body — not JSON, not
   * multipart — so the file never takes a second trip through a client-side encoder (the same shape
   * as the import upload, M3). `?filename=` names it and `?caption=` is optional text under it.
   *
   * Everything about the file is decided here from its bytes, never from what the client claims:
   * only images, video, audio, PDFs and ZIP/Office containers are accepted, because those are what
   * WhatsApp carries and what `detectMediaType` can vouch for. HTML, SVG and anything unrecognised
   * is refused outright rather than stored and sent. The thread lock applies exactly as it does to
   * a text reply. The message is queued like any other: the gateway reads the file from storage
   * and sends it, paced by the same anti-ban engine.
   */
  router.post('/conversations/:id/attachments', requireUuidParam('id'),
    requireScope('messages:send'), async (req: Request, res: Response) => {
      const bytes = req.body as unknown;
      if (!Buffer.isBuffer(bytes) || bytes.byteLength === 0) {
        res.status(415).json(problem(req, 415, 'UNSUPPORTED_MEDIA_TYPE',
          'POST the file itself as the request body (Content-Type: application/octet-stream).'));
        return;
      }
      if (bytes.byteLength > maxUploadBytes) {
        res.status(413).json(problem(req, 413, 'FILE_TOO_LARGE',
          `This file is ${String(bytes.byteLength)} bytes; the limit is ${String(maxUploadBytes)}.`));
        return;
      }
      const detected = detectMediaType(bytes);
      if (!detected.recognised) {
        res.status(415).json(problem(req, 415, 'UNSUPPORTED_FILE_TYPE',
          'Only images, video, audio, PDFs and ZIP/Office documents can be sent. ' +
          'The file type is decided from its contents, not its name.'));
        return;
      }
      const filename = typeof req.query.filename === 'string' ? req.query.filename : null;
      const caption = typeof req.query.caption === 'string' ? req.query.caption.slice(0, 1024) : '';
      const conversationId = req.params.id as string;
      const orgId = req.crm!.orgId;
      const contentType = detected.contentType.startsWith('image/') ? 'image'
        : detected.contentType.startsWith('video/') ? 'video'
        : detected.contentType.startsWith('audio/') ? 'audio' : 'document';

      const result = await req.tenant!(async (tx) => {
        const conv = (await tx.execute(sql`
          SELECT assignee_user_id AS "assigneeUserId" FROM conversation
          WHERE id = ${conversationId} AND org_id = ${orgId}`)
        ) as unknown as Array<{ assigneeUserId: string | null }>;
        if (conv.length === 0) return { notFound: true as const };
        const ctx = req.crm!;
        if (ctx.kind === 'session' && ctx.role !== 'admin'
          && conv[0]!.assigneeUserId !== null && conv[0]!.assigneeUserId !== ctx.userId
          && !(await isParticipant(tx, conversationId, ctx.userId))) {
          return { locked: true as const };
        }

        const flagged = (await tx.execute(sql`
          SELECT c.do_not_contact AS flagged FROM conversation v JOIN contact c ON c.id = v.contact_id
          WHERE v.id = ${conversationId} AND v.org_id = ${orgId}`)
        ) as unknown as Array<{ flagged: boolean }>;
        if (flagged[0]?.flagged === true) return { dnc: true as const };

        const stored = await storeOutboundMedia(tx, storage, { orgId, bytes, filename });
        const inserted = (await tx.execute(sql`
          INSERT INTO message (org_id, conversation_id, direction, status, content_type,
                               body_enc, body_hmac, media_id, sent_by, sent_by_user_id)
          VALUES (${orgId}, ${conversationId}, 'outbound', 'queued', ${contentType},
                  ${Buffer.from(kms.encrypt(new TextEncoder().encode(caption)))},
                  ${kms.blindIndex(caption)}, ${stored.mediaId}, 'api', ${authorOf(req)})
          RETURNING id, conversation_id AS "conversationId", status, media_id AS "mediaId"`)
        ) as unknown as Array<{ id: string; conversationId: string; status: string; mediaId: string }>;
        return { row: { ...inserted[0]!, contentType, sizeBytes: stored.sizeBytes } };
      });

      if ('notFound' in result) {
        res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such conversation.'));
        return;
      }
      if ('locked' in result) {
        res.status(409).json(problem(req, 409, 'THREAD_ASSIGNED',
          'This thread is assigned to another agent. Reassign it to yourself, or ask an admin, to reply.'));
        return;
      }
      if ('dnc' in result) {
        res.status(422).json(problem(req, 422, 'DO_NOT_CONTACT',
          'This contact is marked do-not-contact; files cannot be sent to them.'));
        return;
      }
      res.status(202).json({ data: result.row });
    });

  router.post('/messages', requireScope('messages:send'), async (req: Request, res: Response) => {
    const parsed = sendMessage.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json(problem(req, 422, 'VALIDATION_FAILED', parsed.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }
    const { to, conversationId, body, senderId, overrideDnc, overrideReason } = parsed.data;
    const orgIdEarly = req.crm!.orgId;

    // Replying into an existing thread. No phone is involved, so no normalisation applies —
    // the conversation already knows which identity it belongs to, phone or privacy address.
    if (conversationId !== undefined) {
      // The thread lock: a thread assigned to one agent is theirs to answer until they release
      // it, so two people cannot reply to the same contact at once (a light stand-in for the
      // presence/collision work parked in D-17). It applies only to signed-in agents — an admin
      // overrides it, and an API key is an integration, not a person claiming a thread, so
      // neither is bound by it.
      const result = await req.tenant!(async (tx) => {
        const conv = (await tx.execute(sql`
          SELECT assignee_user_id AS "assigneeUserId" FROM conversation
          WHERE id = ${conversationId} AND org_id = ${orgIdEarly}`)
        ) as unknown as Array<{ assigneeUserId: string | null }>;
        if (conv.length === 0) return { notFound: true as const };

        const ctx = req.crm!;
        const lockedToSomeoneElse = conv[0]!.assigneeUserId !== null
          && conv[0]!.assigneeUserId !== ctx.userId
          && !(await isParticipant(tx, conversationId, ctx.userId));
        if (ctx.kind === 'session' && ctx.role !== 'admin' && lockedToSomeoneElse) {
          return { locked: true as const };
        }

        const flagged = (await tx.execute(sql`
          SELECT c.do_not_contact AS flagged FROM conversation v JOIN contact c ON c.id = v.contact_id
          WHERE v.id = ${conversationId} AND v.org_id = ${orgIdEarly}`)
        ) as unknown as Array<{ flagged: boolean }>;
        const verdict = dncVerdict(req, flagged[0]?.flagged === true, overrideDnc);
        if (verdict === 'blocked' || verdict === 'forbidden') return { dncRefused: verdict };

        const inserted = (await tx.execute(sql`
          INSERT INTO message (org_id, conversation_id, direction, status, content_type,
                               body_enc, body_hmac, sent_by, sent_by_user_id,
                               dnc_override, dnc_override_reason)
          SELECT ${orgIdEarly}, v.id, 'outbound', 'queued', 'text',
                 ${Buffer.from(kms.encrypt(new TextEncoder().encode(body)))},
                 ${kms.blindIndex(body)}, 'api', ${authorOf(req)}, ${verdict === 'override'},
                 ${verdict === 'override' ? overrideReason ?? null : null}
          FROM conversation v
          WHERE v.id = ${conversationId} AND v.org_id = ${orgIdEarly}
          RETURNING id, conversation_id AS "conversationId", status`)
        ) as unknown as Array<{ id: string; conversationId: string; status: string }>;
        if (verdict === 'override') await auditDncOverride(req, tx, orgIdEarly, conversationId, overrideReason);
        return { row: inserted[0]! };
      });

      if ('notFound' in result) {
        // 404 rather than 403: confirming a conversation exists in another tenant is a leak.
        res.status(404).json(problem(req, 404, 'NOT_FOUND', 'No such conversation.'));
        return;
      }
      if ('locked' in result) {
        res.status(409).json(problem(req, 409, 'THREAD_ASSIGNED',
          'This thread is assigned to another agent. Reassign it to yourself, or ask an admin, to reply.'));
        return;
      }
      if ('dncRefused' in result) { sendDncRefusal(req, res, result.dncRefused); return; }
      res.status(202).json({ data: result.row });
      return;
    }

    // One normalisation boundary for the whole system. The previous system had this function
    // and never called it on the way in, so one person became several contacts (M8).
    const phone = normalisePhone(to!, defaultCountry);
    if (!phone.ok) {
      res.status(422).json(problem(req, 422, `PHONE_${phone.reason.toUpperCase()}`, phone.message));
      return;
    }
    if (!phone.value.reachableOnWhatsApp) {
      // Caught here rather than at send time: a doomed send costs the sender's delivery ratio,
      // which feeds its health score (docs/08-antiban.md).
      res.status(422).json(problem(req, 422, 'NOT_REACHABLE',
        `${phone.value.e164} looks like a ${phone.value.type} number, which cannot receive WhatsApp.`));
      return;
    }

    const orgId = req.crm!.orgId;
    const outcome = await req.tenant!(async (tx) => {
      const known = (await tx.execute(sql`
        SELECT c.do_not_contact AS flagged FROM contact_identity ci JOIN contact c ON c.id = ci.contact_id
        WHERE ci.org_id = ${orgId} AND ci.kind = 'phone' AND ci.value_normalized = ${phone.value.e164}`)
      ) as unknown as Array<{ flagged: boolean }>;
      const verdict = dncVerdict(req, known[0]?.flagged === true, overrideDnc);
      if (verdict === 'blocked' || verdict === 'forbidden') return { dncRefused: verdict };
      const rows = await tx.execute(sql`
      WITH chosen_sender AS (
        SELECT id FROM sender_identity
        WHERE org_id = ${orgId}
          AND (${senderId ?? null}::uuid IS NULL OR id = ${senderId ?? null}::uuid)
          AND status IN ('active','degraded')
        ORDER BY created_at ASC LIMIT 1
      ), existing AS (
        SELECT contact_id FROM contact_identity
        WHERE org_id = ${orgId} AND kind = 'phone' AND value_normalized = ${phone.value.e164}
      ), new_contact AS (
        INSERT INTO contact (org_id, display_name, source)
        SELECT ${orgId}, ${phone.value.e164}, 'api'
        WHERE NOT EXISTS (SELECT 1 FROM existing) AND EXISTS (SELECT 1 FROM chosen_sender)
        RETURNING id
      ), new_identity AS (
        INSERT INTO contact_identity (org_id, contact_id, kind, value_normalized, is_primary)
        SELECT ${orgId}, id, 'phone', ${phone.value.e164}, true FROM new_contact
        RETURNING contact_id
      ), resolved AS (
        SELECT contact_id FROM existing UNION ALL SELECT contact_id FROM new_identity
      ), conv AS (
        INSERT INTO conversation (org_id, contact_id, sender_identity_id)
        SELECT ${orgId}, r.contact_id, s.id FROM resolved r, chosen_sender s
        ON CONFLICT (contact_id, sender_identity_id) DO UPDATE SET updated_at = now()
        RETURNING id
      )
      INSERT INTO message (org_id, conversation_id, direction, status, content_type,
                           body_enc, body_hmac, sent_by, sent_by_user_id,
                           dnc_override, dnc_override_reason)
      SELECT ${orgId}, conv.id, 'outbound', 'queued', 'text',
             ${Buffer.from(kms.encrypt(new TextEncoder().encode(body)))},
             ${kms.blindIndex(body)}, 'api', ${authorOf(req)}, ${verdict === 'override'},
             ${verdict === 'override' ? overrideReason ?? null : null}
      FROM conv
      RETURNING id, conversation_id AS "conversationId", status`);
      const made = (rows as unknown as Array<{ id: string; conversationId: string; status: string }>)[0];
      if (made && verdict === 'override') await auditDncOverride(req, tx, orgId, made.conversationId, overrideReason);
      return { made };
    });
    if ('dncRefused' in outcome) { sendDncRefusal(req, res, outcome.dncRefused); return; }

    const created = outcome.made;
    if (!created) {
      // The only way the chain produces nothing is having no usable sender.
      res.status(409).json(problem(req, 409, 'NO_ACTIVE_SENDER',
        'No linked WhatsApp number is available to send from. Link one first: POST /api/v1/senders/:id/link'));
      return;
    }

    // 202, not 201: accepted for sending, not sent. The gateway decides when it actually goes.
    res.status(202).json({ data: { ...created, to: phone.value.e164 } });
  });

  return router;
}
