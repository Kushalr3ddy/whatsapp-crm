import { sql } from 'drizzle-orm';
import type { Database } from '@crm/db';

/** The part of a database handle this needs; a transaction has it too. */
type Executor = Pick<Database, 'execute'>;

/**
 * Writes one entry on a number's timeline: a refused connection (403), a session ended without being asked, a device removed
 * under Linked devices. The Numbers page reads these back so an operator sees what happened to a number and when.
 */
export async function recordHealthEvent(
  db: Executor,
  e: {
    orgId: string; senderIdentityId: string; kind: string;
    severity: 'info' | 'warning' | 'critical'; summary: string; evidence?: unknown; at?: Date;
  }
): Promise<void> {
  await db.execute(sql`
    INSERT INTO sender_health_event (org_id, sender_identity_id, at, kind, severity, summary, evidence)
    VALUES (${e.orgId}, ${e.senderIdentityId}, ${(e.at ?? new Date()).toISOString()}, ${e.kind},
            ${e.severity}, ${e.summary}, ${JSON.stringify(e.evidence ?? {})}::jsonb)`);
}
