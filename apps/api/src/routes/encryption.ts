import { randomBytes } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { sql } from 'drizzle-orm';
import type { KmsDriver } from '@crm/kms-local';
import {
  keyVersionCounts, versionsMissingFromKeyRing, verifySample, writeAudit, AUDIT
} from '@crm/core';
import { auditActor, requireRole } from '../auth.js';

/**
 * Where a key rotation stands, for the Security wizard (D-31).
 *
 * `idle`: one key, everything on it. `key_missing`: data exists under a version the ring cannot
 * read (a retired key was dropped too early; the loudest state). `reencrypting`: a retired key is
 * configured and values remain on it. `paused`: the same, but the operator stopped the job.
 * `ready_to_retire`: a retired key is still configured but nothing uses it any more.
 */
type RotationStage = 'idle' | 'key_missing' | 'reencrypting' | 'paused' | 'ready_to_retire';

/**
 * The key-rotation wizard's API. Admin only: it reveals how the install's data is protected and
 * can pause the background job. It never touches key material, which lives in the process
 * environment and is changed by the operator on the server, not through the web.
 *
 * Counts are the caller's own org's (row-level security applies); the pause switch and the
 * re-encryption job are instance-wide, because the key is.
 */
export function encryptionRouter(deps: { kms: KmsDriver }): Router {
  const router = Router();
  const { kms } = deps;

  /** Everything the wizard shows, read in one go. */
  async function status(req: Request) {
    return req.tenant!(async (tx) => {
      const counts = await keyVersionCounts(tx);
      const state = (await tx.execute(sql`
        SELECT paused, last_run_at AS "lastRunAt", reencrypted_total AS "reencryptedTotal",
               last_unreadable AS "lastUnreadable"
        FROM key_rotation_state WHERE id = 1`)) as unknown as Array<{
        paused: boolean; lastRunAt: string | null; reencryptedTotal: number; lastUnreadable: number;
      }>;
      return { counts, state: state[0] ?? { paused: false, lastRunAt: null, reencryptedTotal: 0, lastUnreadable: 0 } };
    });
  }

  router.get('/', requireRole('admin'), async (req: Request, res: Response) => {
    const { counts, state } = await status(req);
    const current = kms.keyVersion;
    const retired = kms.knownKeyVersions().filter((v) => v !== current);
    const sum = (o: Record<number, number>, pick: (v: number) => boolean) =>
      Object.entries(o).reduce((n, [v, c]) => (pick(Number(v)) ? n + c : n), 0);
    const total = sum(counts.message, () => true) + sum(counts.authState, () => true);
    const onCurrent = sum(counts.message, (v) => v === current) + sum(counts.authState, (v) => v === current);
    const missing = versionsMissingFromKeyRing(counts, kms);
    const onOld = total - onCurrent;

    let stage: RotationStage = 'idle';
    if (missing.length > 0) stage = 'key_missing';
    else if (retired.length > 0 && onOld > 0) stage = state.paused ? 'paused' : 'reencrypting';
    else if (retired.length > 0) stage = 'ready_to_retire';

    res.json({ data: {
      stage,
      currentVersion: current,
      retiredVersions: retired,
      missingVersions: missing,
      counts,
      total, onCurrent, onOld,
      paused: state.paused,
      lastRunAt: state.lastRunAt,
      reencryptedTotal: state.reencryptedTotal,
      lastUnreadable: state.lastUnreadable
    } });
  });

  /** Sets the operator's brake on the background re-encryption, and records who and why. */
  async function setPaused(req: Request, res: Response, paused: boolean): Promise<void> {
    await req.tenant!(async (tx) => {
      await tx.execute(sql`
        UPDATE key_rotation_state
        SET paused = ${paused}, paused_by_user_id = ${paused ? req.crm!.userId : null}, updated_at = now()
        WHERE id = 1`);
      await writeAudit(tx, {
        orgId: req.crm!.orgId, actor: auditActor(req),
        action: paused ? AUDIT.encryptionRotationPaused : AUDIT.encryptionRotationResumed,
        targetType: 'key_rotation',
        ip: req.ip ?? null, requestId: String(req.id)
      });
    });
    res.status(204).end();
  }
  router.post('/pause', requireRole('admin'), (req, res) => setPaused(req, res, true));
  router.post('/resume', requireRole('admin'), (req, res) => setPaused(req, res, false));

  /** Decrypts a random sample from this org's data and says how many values could not be read. */
  router.post('/verify', requireRole('admin'), async (req: Request, res: Response) => {
    const result = await req.tenant!(async (tx) => {
      const r = await verifySample(tx, kms, 200);
      await writeAudit(tx, {
        orgId: req.crm!.orgId, actor: auditActor(req), action: AUDIT.encryptionVerified,
        targetType: 'key_rotation', after: { ...r },
        ip: req.ip ?? null, requestId: String(req.id)
      });
      return r;
    });
    res.json({ data: result });
  });

  /**
   * Makes a fresh key for the next version and hands it over once. It is never stored here and the
   * current key is never shown: the web only ever sees the new one, which is why the wizard tells the
   * admin to move the existing key into the retired list themselves. Only the fact that a key was made
   * is audited, never the key.
   */
  router.post('/new-key', requireRole('admin'), async (req: Request, res: Response) => {
    const next = kms.keyVersion + 1;
    if (next > 255) {
      res.status(409).json({ type: 'about:blank', title: 'KEY_VERSIONS_EXHAUSTED', status: 409, code: 'KEY_VERSIONS_EXHAUSTED',
        detail: 'Key version 255 is the last one; start a fresh install to go further.', request_id: String(req.id) });
      return;
    }
    await req.tenant!(async (tx) => {
      await writeAudit(tx, {
        orgId: req.crm!.orgId, actor: auditActor(req), action: AUDIT.encryptionKeyGenerated,
        targetType: 'key_rotation', after: { version: next },
        ip: req.ip ?? null, requestId: String(req.id)
      });
    });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ data: { version: next, previousVersion: kms.keyVersion, key: randomBytes(32).toString('hex') } });
  });

  return router;
}
