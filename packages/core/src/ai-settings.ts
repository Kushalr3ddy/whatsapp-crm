import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { setTenant, type Database } from '@crm/db';
import { AUDIT, SYSTEM_ACTOR, writeAudit, type AuditActor } from './audit.js';

/** The assistant's settings as the settings page shows them. */
export interface AiSettings {
  readonly enabled: boolean;
  readonly instructions: string;
  readonly dailyMessageCap: number;
  /** True when the assistant may start and resume campaigns itself; otherwise it prepares them and an admin presses Start. */
  readonly mayStartCampaigns: boolean;
  /** When an admin accepted the data-sharing note; null until then. */
  readonly consentAcceptedAt: string | null;
  /** The assistant's own user, once it has been switched on at least once. Assign a conversation to it to hand the chat over. */
  readonly botUserId: string | null;
}

/** A change an admin asked for. `acceptConsent` must be true the first time AI is switched on. */
export interface AiSettingsChange {
  readonly enabled?: boolean | undefined;
  readonly instructions?: string | undefined;
  readonly dailyMessageCap?: number | undefined;
  readonly mayStartCampaigns?: boolean | undefined;
  readonly acceptConsent?: boolean | undefined;
}

/** Why the change was refused, in words the page can show as they are. */
export class AiSettingsRuleError extends Error {
  /** Builds the error with the reason. */
  constructor(readonly reason: string) { super(reason); this.name = 'AiSettingsRuleError'; }
}

/** What an org has before anyone touches it: everything off. */
const DEFAULTS: AiSettings = {
  enabled: false, instructions: '', dailyMessageCap: 200, mayStartCampaigns: false, consentAcceptedAt: null, botUserId: null
};

/** Reads the org's AI settings, or the all-off defaults when it has none. */
export async function getAiSettings(db: Database, orgId: string): Promise<AiSettings> {
  return db.transaction(async (tx) => {
    await setTenant(tx, orgId);
    return readSettings(tx, orgId);
  });
}

/** The executor shape shared by a transaction and the request's tenant executor. */
type Executor = Pick<Database, 'execute'>;

/** Reads settings inside an already-open tenant transaction. */
async function readSettings(tx: Executor, orgId: string): Promise<AiSettings> {
  const rows = await tx.execute(sql`
    SELECT enabled, instructions, daily_message_cap AS "dailyMessageCap", may_start_campaigns AS "mayStartCampaigns",
           consent_accepted_at AS "consentAcceptedAt", bot_user_id AS "botUserId"
    FROM ai_setting WHERE org_id = ${orgId}`);
  return (rows as unknown as AiSettings[])[0] ?? DEFAULTS;
}

/**
 * Saves the org's AI settings.
 *
 * Rules: switching AI on needs the consent note accepted (now, or earlier); the daily cap stays within a sane
 * range; and the first time it is switched on, the assistant's own user is created (no password, so it can never
 * sign in) and made a member, which is what lets a conversation be assigned to it. Every change is audited.
 */
export async function saveAiSettings(
  db: Database, orgId: string, change: AiSettingsChange, actor: AuditActor = SYSTEM_ACTOR
): Promise<AiSettings> {
  if (change.dailyMessageCap !== undefined && (!Number.isInteger(change.dailyMessageCap) || change.dailyMessageCap < 1 || change.dailyMessageCap > 5000)) {
    throw new AiSettingsRuleError('The daily message limit must be a whole number from 1 to 5000.');
  }
  return db.transaction(async (tx) => {
    await setTenant(tx, orgId);
    const before = await readSettings(tx, orgId);

    const consentNow = change.acceptConsent === true && before.consentAcceptedAt === null;
    const hasConsent = before.consentAcceptedAt !== null || consentNow;
    const enabled = change.enabled ?? before.enabled;
    if (enabled && !hasConsent) {
      throw new AiSettingsRuleError('Accept the data-sharing note first: the assistant sends contact messages to the AI provider.');
    }

    let botUserId = before.botUserId;
    if (enabled && botUserId === null) botUserId = await createBot(tx, orgId, actor);

    const next = {
      enabled,
      instructions: (change.instructions ?? before.instructions).trim(),
      dailyMessageCap: change.dailyMessageCap ?? before.dailyMessageCap,
      mayStartCampaigns: change.mayStartCampaigns ?? before.mayStartCampaigns
    };
    await tx.execute(sql`
      INSERT INTO ai_setting (org_id, enabled, instructions, daily_message_cap, may_start_campaigns, bot_user_id,
                              consent_accepted_at, consent_accepted_by, updated_at)
      VALUES (${orgId}, ${next.enabled}, ${next.instructions}, ${next.dailyMessageCap}, ${next.mayStartCampaigns}, ${botUserId},
              ${consentNow ? sql`now()` : null}, ${consentNow && actor.type === 'user' ? actor.id : null}, now())
      ON CONFLICT (org_id) DO UPDATE SET
        enabled = EXCLUDED.enabled, instructions = EXCLUDED.instructions,
        daily_message_cap = EXCLUDED.daily_message_cap, may_start_campaigns = EXCLUDED.may_start_campaigns, bot_user_id = EXCLUDED.bot_user_id,
        consent_accepted_at = COALESCE(ai_setting.consent_accepted_at, EXCLUDED.consent_accepted_at),
        consent_accepted_by = COALESCE(ai_setting.consent_accepted_by, EXCLUDED.consent_accepted_by),
        updated_at = now()`);

    if (next.enabled !== before.enabled) {
      await writeAudit(tx, {
        orgId, actor, action: next.enabled ? AUDIT.aiEnabled : AUDIT.aiDisabled, targetType: 'ai_setting',
        after: { enabled: next.enabled, consentAccepted: hasConsent }
      });
    }
    if (next.instructions !== before.instructions || next.dailyMessageCap !== before.dailyMessageCap || next.mayStartCampaigns !== before.mayStartCampaigns) {
      // The instructions text is not copied into the log; its length says enough about what changed.
      await writeAudit(tx, {
        orgId, actor, action: AUDIT.aiSettingsChanged, targetType: 'ai_setting',
        before: { dailyMessageCap: before.dailyMessageCap, mayStartCampaigns: before.mayStartCampaigns, instructionsLength: before.instructions.length },
        after: { dailyMessageCap: next.dailyMessageCap, mayStartCampaigns: next.mayStartCampaigns, instructionsLength: next.instructions.length }
      });
    }
    return readSettings(tx, orgId);
  });
}

/** Creates the org's assistant user: no password, flagged as a bot, a member with the agent role. */
async function createBot(tx: Executor, orgId: string, actor: AuditActor): Promise<string> {
  // `.invalid` can never receive mail or match a real sign-in; the random part keeps one per org.
  const email = `ai-assistant-${randomUUID()}@bot.invalid`;
  const created = await tx.execute(sql`
    INSERT INTO app_user (email, password_hash, display_name, is_bot)
    VALUES (${email}, NULL, 'AI assistant', true) RETURNING id`);
  const userId = (created as unknown as Array<{ id: string }>)[0]!.id;
  await tx.execute(sql`INSERT INTO org_membership (org_id, user_id, role) VALUES (${orgId}, ${userId}, 'agent')`);
  await writeAudit(tx as Parameters<typeof writeAudit>[0], {
    orgId, actor, action: AUDIT.userAdded, targetType: 'app_user', targetId: userId, after: { email, role: 'agent', bot: true }
  });
  return userId;
}

/**
 * Records that the AI provider or model was changed from the AI settings tab. The key is never part of it: only who, which provider and
 * model, whether the key was replaced, and whether it was tested first.
 */
export async function auditLlmChange(
  db: Database, orgId: string, actor: AuditActor,
  change: { provider: string; model: string | null; baseUrlHost: string | null; keyReplaced: boolean; tested: boolean }
): Promise<void> {
  await db.transaction(async (tx) => {
    await setTenant(tx, orgId);
    await writeAudit(tx, { orgId, actor, action: AUDIT.aiLlmChanged, targetType: 'ai_llm', after: change });
  });
}
