import { sql } from 'drizzle-orm';
import type { CappingStatus } from '../antiban.js';
import type { Queryable } from './holds.js';

/** WhatsApp says the number may not start new chats (or that the restriction ended). */
export interface TimelockNotice {
  readonly kind: 'timelock';
  readonly active: boolean;
  readonly until: Date | null;
  readonly enforcementType: string | null;
  readonly at: Date;
  readonly raw?: unknown;
}

/** WhatsApp reports how close the number is to its new-chat limit. */
export interface CappingNotice {
  readonly kind: 'capping';
  readonly status: CappingStatus | null;
  readonly totalQuota: number | null;
  readonly usedQuota: number | null;
  readonly cycleStart: Date | null;
  readonly cycleEnd: Date | null;
  readonly at: Date;
  readonly raw?: unknown;
}

/** A warning from WhatsApp about the number's limits. */
export type WhatsAppNotice = TimelockNotice | CappingNotice;

/**
 * Records one warning WhatsApp sent a number (S2): every raw one in `whatsapp_notice`, and the latest of each kind on the
 * number's connection row, where the lane and the number card read it (AC-2.5). A timelock that ends (an inactive update) clears
 * the stored lock, so the held messages go on the next pass (AC-2.2).
 */
export async function applyWhatsAppNotice(
  db: Queryable, orgId: string, senderIdentityId: string, notice: WhatsAppNotice
): Promise<void> {
  const payload = notice.kind === 'timelock'
    ? { active: notice.active, until: notice.until?.toISOString() ?? null, enforcementType: notice.enforcementType, raw: notice.raw ?? null }
    : {
      status: notice.status, totalQuota: notice.totalQuota, usedQuota: notice.usedQuota,
      cycleStart: notice.cycleStart?.toISOString() ?? null, cycleEnd: notice.cycleEnd?.toISOString() ?? null, raw: notice.raw ?? null
    };
  await db.execute(sql`
    INSERT INTO whatsapp_notice (org_id, sender_identity_id, kind, payload, received_at)
    VALUES (${orgId}, ${senderIdentityId}, ${notice.kind}, ${JSON.stringify(payload)}::jsonb, ${notice.at.toISOString()})`);

  if (notice.kind === 'timelock') {
    await db.execute(sql`
      INSERT INTO channel_session (sender_identity_id, timelock_active, timelock_until, timelock_type)
      VALUES (${senderIdentityId}, ${notice.active}, ${notice.active ? notice.until?.toISOString() ?? null : null},
              ${notice.active ? notice.enforcementType : null})
      ON CONFLICT (sender_identity_id) DO UPDATE
        SET timelock_active = EXCLUDED.timelock_active, timelock_until = EXCLUDED.timelock_until,
            timelock_type = EXCLUDED.timelock_type, updated_at = now()`);
    return;
  }
  await db.execute(sql`
    INSERT INTO channel_session (sender_identity_id, capping_status, capping_total_quota, capping_used_quota,
                                 capping_cycle_start, capping_cycle_end, capping_updated_at)
    VALUES (${senderIdentityId}, ${notice.status}, ${notice.totalQuota}, ${notice.usedQuota},
            ${notice.cycleStart?.toISOString() ?? null}, ${notice.cycleEnd?.toISOString() ?? null}, ${notice.at.toISOString()})
    ON CONFLICT (sender_identity_id) DO UPDATE
      SET capping_status = EXCLUDED.capping_status, capping_total_quota = EXCLUDED.capping_total_quota,
          capping_used_quota = EXCLUDED.capping_used_quota, capping_cycle_start = EXCLUDED.capping_cycle_start,
          capping_cycle_end = EXCLUDED.capping_cycle_end, capping_updated_at = EXCLUDED.capping_updated_at,
          updated_at = now()`);
}
