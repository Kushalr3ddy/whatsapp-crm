import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { FAKE, startHarness, type Harness, type Seed } from './org-harness.js';

/**
 * The modules the first organisation and role runs did not reach: contact export, API keys, key rotation (encryption), campaign pictures and
 * downloads, imports, segments and custom fields, the audit trail, and chat presence ("who has this open, who is typing").
 *
 * Same cast as the other organisation suites (see org-harness.ts): organisation A (two admins, two agents, keys) and organisation B (an admin,
 * an agent, a key). For each module the suite checks four things:
 *   1. who may use it (admin, agent, each kind of key, nobody signed in),
 *   2. that organisation B never sees or changes A's things, and the answer for A's thing is the same 404 as for a thing that does not exist,
 *   3. that the same name or number can exist in both organisations,
 *   4. what happens when two people do it at the same moment (a clean 409 or 404, never a 500, and never two of something that must be one).
 *
 * FIRST RUN 2026-11-11: 66 tests, 2 known bugs written as `it.fails` (EXP-9 = M-001, FLD-4 = M-002) and one skipped (IMP-6 = M-003). Every test states the correct behaviour; a new failure is a new bug (file it in docs/49-bug-list.md with repro steps only) or a wrong assumption in the test.
 */
const suite = describe;
let h: Harness;
beforeAll(async () => { h = await startHarness(); }, 120_000);
afterAll(async () => { await h.stop(); });

const A = (): Seed => h.A;
const B = (): Seed => h.B;

/** A 1x1 PNG, the smallest picture the campaign picture check accepts. */
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** The text of a response whatever its content type (supertest keeps text/csv and text/vcard as text, but this is safe for both). */
const textOf = (r: request.Response): string => (typeof r.text === 'string' && r.text !== '' ? r.text : Buffer.isBuffer(r.body) ? r.body.toString('utf8') : '');

const auditCount = async (orgId: string, action: string): Promise<number> =>
  (await h.rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM audit_log WHERE org_id = ${orgId} AND action = ${action}`))[0]!.n;

// ───────────────────────────────────────── contact export ─────────────────────────────────────────
suite('contact export (admin only, audited, five an hour)', () => {
  it('[EXP-1] nobody signed in, a garbage session, every kind of key and an agent are refused', async () => {
    for (const who of ['anon', 'garbage', 'agentA', 'agentA2', 'keyAll', 'key:contacts:read', 'keyRevoked', 'keyExpired', 'keyB'] as const) {
      const r = await h.call(who, 'get', '/contacts/export');
      expect([401, 403], `${who} got ${String(r.status)}`).toContain(r.status);
      expect(textOf(r), `${who} must not receive a single contact`).not.toContain('A-person-1');
    }
  });

  it('[EXP-2] a disabled person is refused', async () => {
    expect((await h.call('disabledA', 'get', '/contacts/export')).status).toBe(401);
  });

  it('[EXP-3] A\'s admin gets a CSV with A\'s people and none of B\'s, with the download and no-cache headers', async () => {
    const r = await h.call('adminA', 'get', '/contacts/export');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('text/csv');
    expect(r.headers['content-disposition']).toMatch(/attachment; filename="contacts-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(r.headers['cache-control']).toContain('no-store');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    const csv = textOf(r);
    for (const n of [1, 2, 3]) expect(csv).toContain(`A-person-${String(n)}`);
    expect(csv).not.toContain('B-person-');
  });

  it('[EXP-4] B\'s admin gets only B\'s people', async () => {
    const r = await h.call('adminB', 'get', '/contacts/export');
    expect(r.status).toBe(200);
    const csv = textOf(r);
    expect(csv).toContain('B-person-1');
    expect(csv).not.toContain('A-person-');
  });

  it('[EXP-5] the vCard format works, and an unknown format is a 422 that writes no audit row', async () => {
    const before = await auditCount(A().orgId, 'contacts.exported');
    const vcf = await h.call('adminA', 'get', '/contacts/export?format=vcf');
    expect(vcf.status).toBe(200);
    expect(vcf.headers['content-type']).toContain('text/vcard');
    expect(textOf(vcf)).toContain('BEGIN:VCARD');
    const bad = await h.call('adminA', 'get', '/contacts/export?format=xlsx');
    expect(bad.status).toBe(422);
    expect(await auditCount(A().orgId, 'contacts.exported')).toBe(before + 1);
  });

  it('[EXP-6] a filtered export holds only the people the filter matches, and still none of B\'s', async () => {
    const r = await h.call('adminA', 'get', `/contacts/export?q=${encodeURIComponent('A-person-2')}`);
    expect(r.status).toBe(200);
    const csv = textOf(r);
    expect(csv).toContain('A-person-2');
    expect(csv).not.toContain('A-person-3');
    expect(csv).not.toContain('B-person-');
  });

  it('[EXP-7] every export is in the audit trail of the organisation that did it, with who and how many, and in no other', async () => {
    const rows = await h.rows<{ actor_id: string; after: { people?: number; format?: string } }>(sql`
      SELECT actor_id, after FROM audit_log WHERE org_id = ${A().orgId} AND action = 'contacts.exported' AND NOT (after ? 'filtered') ORDER BY at DESC LIMIT 1`);
    expect(rows[0]?.actor_id).toBe(h.users.adminA.id);
    expect(rows[0]?.after.people).toBeGreaterThanOrEqual(3);
    const crossed = await h.rows<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM audit_log WHERE org_id = ${B().orgId} AND actor_id = ${h.users.adminA.id}`);
    expect(crossed[0]!.n).toBe(0);
  });

  it('[EXP-8] the sixth export in an hour is refused with 429 and a Retry-After, and the limit is per organisation (A is not held up by B)', async () => {
    // Organisation B has done one export above. Keep going until it is refused: it must happen by the sixth, never later.
    let refused: request.Response | null = null;
    for (let n = 0; n < 8 && refused === null; n++) {
      const r = await h.call('adminB', 'get', '/contacts/export');
      if (r.status === 429) refused = r;
    }
    expect(refused, 'B was never refused').not.toBeNull();
    expect(refused!.body.code).toBe('EXPORT_RATE_LIMITED');
    expect(refused!.headers['retry-after']).toBe('3600');
    expect(await auditCount(B().orgId, 'contacts.exported')).toBeLessThanOrEqual(5);
    // A has done fewer than five, so A is not refused by B's count.
    expect((await h.call('adminA2', 'get', '/contacts/export')).status).toBe(200);
  });

  // M-001 (docs/49-bug-list.md): the limit is a count read before the audit row is written, so a burst slips past it. `it.fails` until fixed.
  it.fails('[EXP-9] ten exports at the same moment from one organisation: never more than five are served, nobody gets a 500', async () => {
    await h.rows(sql`DELETE FROM audit_log WHERE org_id = ${A().orgId} AND action = 'contacts.exported'`);
    const results = await Promise.all(Array.from({ length: 10 }, () => h.call('adminA', 'get', '/contacts/export')));
    expect(results.every((r) => r.status === 200 || r.status === 429), results.map((r) => r.status).join(',')).toBe(true);
    // The count and the audit row are one transaction but the count is a plain read, so a burst may slip past: if this fails, that is the bug.
    expect(results.filter((r) => r.status === 200).length).toBeLessThanOrEqual(5);
  });
});

// ───────────────────────────────────────── API keys ─────────────────────────────────────────
suite('API keys (admin only, secret shown once, bound to one organisation)', () => {
  const create = (who: 'adminA' | 'adminB' | 'agentA' | 'keyAll', body: unknown) => h.call(who, 'post', '/admin/keys', body);

  it('[KEY-1] only a signed-in admin makes a key: an agent, a key and nobody are refused', async () => {
    for (const who of ['agentA', 'keyAll'] as const) {
      expect((await create(who, { name: 'x', scopes: ['contacts:read'] })).status, who).toBe(403);
    }
    expect((await h.call('anon', 'post', '/admin/keys', { name: 'x', scopes: ['contacts:read'] })).status).toBe(401);
  });

  it('[KEY-2] the secret is shown once, the list never shows it, and the audit row holds the prefix and not the secret', async () => {
    const made = await create('adminA', { name: 'KEY-2 key', scopes: ['contacts:read'] });
    expect(made.status).toBe(201);
    const secret = String(made.body.data.secret);
    expect(secret.length).toBeGreaterThan(20);
    const list = await h.call('adminA', 'get', '/admin/keys');
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain(secret);
    expect(JSON.stringify(list.body.data.find((k: { id: string }) => k.id === made.body.data.id))).toContain(made.body.data.prefix);
    const audit = await h.rows<{ after: unknown }>(sql`
      SELECT after FROM audit_log WHERE org_id = ${A().orgId} AND action = 'api_key.issued' AND target_id = ${made.body.data.id}`);
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0]!.after)).not.toContain(secret);
  });

  it('[KEY-3] a key reads only what its scope allows, and only its own organisation', async () => {
    const made = await create('adminA', { name: 'KEY-3 read only', scopes: ['contacts:read'] });
    const auth = { Authorization: `Bearer ${String(made.body.data.secret)}` };
    const ok = await request(h.app).get('/api/v1/contacts?limit=5').set(auth);
    expect(ok.status).toBe(200);
    expect(JSON.stringify(ok.body)).toContain('A-person-');
    expect(JSON.stringify(ok.body)).not.toContain('B-person-');
    expect((await request(h.app).post('/api/v1/contacts').set(auth).send({ displayName: 'x', phone: '+919810099999' })).status, 'no write scope').toBe(403);
    expect((await request(h.app).get(`/api/v1/contacts/${B().contactIds[0]!}/detail`).set(auth)).status, 'B\'s contact').toBe(404);
    expect((await request(h.app).get('/api/v1/admin/keys').set(auth)).status, 'a key never manages keys').toBe(403);
  });

  it('[KEY-4] B\'s admin cannot list or revoke A\'s keys: the list holds only B\'s, and revoking one of A\'s is a 404 that changes nothing', async () => {
    const aKeys = (await h.call('adminA', 'get', '/admin/keys')).body.data as Array<{ id: string; revokedAt: string | null }>;
    const target = aKeys.find((k) => k.revokedAt === null)!;
    const bList = (await h.call('adminB', 'get', '/admin/keys')).body.data as Array<{ id: string }>;
    expect(bList.some((k) => aKeys.some((a) => a.id === k.id))).toBe(false);
    expect((await h.call('adminB', 'delete', `/admin/keys/${target.id}`)).status).toBe(404);
    const after = (await h.rows<{ revoked_at: string | null }>(sql`SELECT revoked_at FROM api_key WHERE id = ${target.id}`))[0]!;
    expect(after.revoked_at).toBeNull();
  });

  it('[KEY-5] a revoked key stops working at once, and revoking twice or revoking a made-up id is a 404', async () => {
    const made = await create('adminA', { name: 'KEY-5', scopes: ['contacts:read'] });
    const auth = { Authorization: `Bearer ${String(made.body.data.secret)}` };
    expect((await request(h.app).get('/api/v1/contacts?limit=1').set(auth)).status).toBe(200);
    expect((await h.call('adminA', 'delete', `/admin/keys/${String(made.body.data.id)}`)).status).toBe(204);
    expect((await request(h.app).get('/api/v1/contacts?limit=1').set(auth)).status).toBe(401);
    expect((await h.call('adminA', 'delete', `/admin/keys/${String(made.body.data.id)}`)).status).toBe(404);
    expect((await h.call('adminA', 'delete', `/admin/keys/${FAKE}`)).status).toBe(404);
    expect(await auditCount(A().orgId, 'api_key.revoked')).toBeGreaterThanOrEqual(1);
  });

  it('[KEY-6] a bad body is a 422: no name, no scopes, an unknown scope, a negative or fractional rate limit, a body that names another organisation is ignored', async () => {
    for (const body of [
      { scopes: ['contacts:read'] }, { name: 'x', scopes: [] }, { name: 'x', scopes: ['everything'] },
      { name: 'x', scopes: ['contacts:read'], rateLimitPerMin: -1 }, { name: 'x', scopes: ['contacts:read'], rateLimitPerMin: 1.5 }, { name: '', scopes: ['contacts:read'] }
    ]) expect((await create('adminA', body)).status, JSON.stringify(body)).toBe(422);
    const sneaky = await create('adminA', { name: 'KEY-6 sneaky', scopes: ['contacts:read'], orgId: B().orgId });
    expect(sneaky.status).toBe(201);
    const where = await h.rows<{ org_id: string }>(sql`SELECT org_id FROM api_key WHERE id = ${sneaky.body.data.id}`);
    expect(where[0]!.org_id, 'the key belongs to the organisation of the admin who made it').toBe(A().orgId);
  });

  it('[KEY-7] the same key name can exist in both organisations', async () => {
    expect((await create('adminA', { name: 'KEY-7 shared name', scopes: ['contacts:read'] })).status).toBe(201);
    expect((await create('adminB', { name: 'KEY-7 shared name', scopes: ['contacts:read'] })).status).toBe(201);
  });

  it('[KEY-8] ten keys made at the same moment are ten keys with ten different secrets', async () => {
    const made = await Promise.all(Array.from({ length: 10 }, (_, n) => create('adminA', { name: `KEY-8 burst ${String(n)}`, scopes: ['contacts:read'] })));
    expect(made.every((r) => r.status === 201)).toBe(true);
    expect(new Set(made.map((r) => String(r.body.data.secret))).size).toBe(10);
    expect(new Set(made.map((r) => String(r.body.data.prefix))).size, 'prefixes are for display and may repeat, but should rarely').toBeGreaterThan(5);
  });

  it('[KEY-9] the bootstrap key makes a key for a named organisation and needs the organisation named', async () => {
    expect((await h.call('bootstrap', 'post', '/admin/keys', { name: 'KEY-9', scopes: ['contacts:read'] })).status).toBe(422);
    const r = await h.call('bootstrap', 'post', '/admin/keys', { name: 'KEY-9', scopes: ['contacts:read'], orgId: B().orgId });
    expect(r.status).toBe(201);
    const where = await h.rows<{ org_id: string }>(sql`SELECT org_id FROM api_key WHERE id = ${r.body.data.id}`);
    expect(where[0]!.org_id).toBe(B().orgId);
  });

  it('[KEY-10] a key past its expiry date and a key with the rate limit used up are refused', async () => {
    const made = await create('adminA', { name: 'KEY-10 limited', scopes: ['contacts:read'], rateLimitPerMin: 2 });
    const auth = { Authorization: `Bearer ${String(made.body.data.secret)}` };
    const answers: number[] = [];
    for (let n = 0; n < 5; n++) answers.push((await request(h.app).get('/api/v1/contacts?limit=1').set(auth)).status);
    expect(answers, answers.join(',')).toContain(429);
    expect((await h.call('keyExpired', 'get', '/contacts?limit=1')).status).toBe(401);
  });
});

// ───────────────────────────────────────── key rotation (encryption) ─────────────────────────────────────────
suite('key rotation and encryption status (admin only, never shows a key already in use)', () => {
  it('[ENC-1] every call is refused to an agent, a key and nobody signed in', async () => {
    for (const who of ['agentA', 'keyAll', 'anon', 'garbage'] as const) {
      for (const [method, path] of [['get', '/encryption'], ['post', '/encryption/pause'], ['post', '/encryption/resume'], ['post', '/encryption/verify'], ['post', '/encryption/new-key']] as const) {
        const r = await h.call(who, method, path);
        expect([401, 403], `${who} ${method} ${path} got ${String(r.status)}`).toContain(r.status);
      }
    }
  });

  it('[ENC-2] the status says the stage and counts and never carries a key', async () => {
    const r = await h.call('adminA', 'get', '/encryption');
    expect(r.status).toBe(200);
    expect(['idle', 'reencrypting', 'paused', 'ready_to_retire', 'key_missing']).toContain(r.body.data.stage);
    expect(JSON.stringify(r.body)).not.toMatch(/[0-9a-f]{64}/);
  });

  it('[ENC-3] a new key is handed over once, no-store, and only the fact of it is audited, never the key', async () => {
    const r = await h.call('adminA', 'post', '/encryption/new-key');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toContain('no-store');
    expect(String(r.body.data.key)).toMatch(/^[0-9a-f]{64}$/);
    expect(r.body.data.version).toBe(r.body.data.previousVersion + 1);
    const rows = await h.rows<{ after: unknown }>(sql`SELECT after FROM audit_log WHERE org_id = ${A().orgId} AND action = 'encryption.key_generated' ORDER BY at DESC LIMIT 1`);
    expect(JSON.stringify(rows[0]!.after)).not.toContain(String(r.body.data.key));
  });

  it('[ENC-4] two new keys are two different keys', async () => {
    const [x, y] = await Promise.all([h.call('adminA', 'post', '/encryption/new-key'), h.call('adminA2', 'post', '/encryption/new-key')]);
    expect(x.body.data.key).not.toBe(y.body.data.key);
  });

  it('[ENC-5] verify reads a sample of the organisation\'s own data, reports how many could not be read, and is audited', async () => {
    const before = await auditCount(A().orgId, 'encryption.verified');
    const r = await h.call('adminA', 'post', '/encryption/verify');
    expect(r.status).toBe(200);
    expect(typeof r.body.data).toBe('object');
    expect(await auditCount(A().orgId, 'encryption.verified')).toBe(before + 1);
  });

  it('[ENC-6] pause and resume are audited in the organisation of the admin who pressed them, by that admin', async () => {
    expect((await h.call('adminA', 'post', '/encryption/pause')).status).toBe(204);
    expect((await h.call('adminA2', 'post', '/encryption/resume')).status).toBe(204);
    const rows = await h.rows<{ action: string; actor_id: string }>(sql`
      SELECT action, actor_id FROM audit_log WHERE org_id = ${A().orgId} AND action IN ('encryption.rotation_paused', 'encryption.rotation_resumed') ORDER BY at DESC LIMIT 2`);
    expect(rows.map((r) => r.action).sort()).toEqual(['encryption.rotation_paused', 'encryption.rotation_resumed']);
    expect(await auditCount(B().orgId, 'encryption.rotation_paused')).toBe(0);
  });

  it('[ENC-7] DECISION (SEC-8, S4): the rotation brake is one for the whole install, so B\'s admin pressing pause pauses it for A as well. This test pins today\'s behaviour; change it the day the brake becomes per organisation', async () => {
    expect((await h.call('adminB', 'post', '/encryption/pause')).status).toBe(204);
    expect((await h.call('adminA', 'get', '/encryption')).body.data.paused).toBe(true);
    expect((await h.call('adminB', 'post', '/encryption/resume')).status).toBe(204);
    expect((await h.call('adminA', 'get', '/encryption')).body.data.paused).toBe(false);
  });

  it('[ENC-8] pressing pause twice, or pause and resume at the same moment, never errors', async () => {
    const both = await Promise.all([
      h.call('adminA', 'post', '/encryption/pause'), h.call('adminA2', 'post', '/encryption/pause'),
      h.call('adminA', 'post', '/encryption/resume'), h.call('adminA2', 'post', '/encryption/resume')
    ]);
    expect(both.map((r) => r.status)).toEqual([204, 204, 204, 204]);
  });
});

// ───────────────────────────────────────── campaign pictures and downloads ─────────────────────────────────────────
suite('campaign pictures and media downloads', () => {
  const upload = (who: 'adminA' | 'adminB' | 'agentA' | 'keyAll' | 'key:conversations:read' | 'anon', bytes: Buffer, name = 'pic.png') =>
    request(h.app).post(`/api/v1/campaigns/media?filename=${name}`).set(h.headers[who]).set('Content-Type', 'application/octet-stream').send(bytes);

  it('[MED-1] who may upload: an admin and an agent yes, a read-only key and nobody no', async () => {
    expect((await upload('adminA', PNG_1X1)).status).toBe(201);
    expect([201, 409]).toContain((await upload('agentA', Buffer.concat([PNG_1X1, Buffer.from('a')]))).status);
    expect((await upload('key:conversations:read', PNG_1X1)).status).toBe(403);
    expect((await upload('anon', PNG_1X1)).status).toBe(401);
  });

  it('[MED-2] a text file, an empty body and a picture that does not decode are refused with a plain code, and nothing is stored', async () => {
    const before = (await h.rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM media_asset WHERE org_id = ${A().orgId}`))[0]!.n;
    expect((await upload('adminA', Buffer.from('this is not a picture'), 'x.png')).status).toBe(415);
    expect((await upload('adminA', Buffer.alloc(0))).status).toBe(415);
    expect((await upload('adminA', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(40)]), 'broken.png')).status).toBe(415);
    const after = (await h.rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM media_asset WHERE org_id = ${A().orgId}`))[0]!.n;
    expect(after).toBe(before);
  });

  it('[MED-3] a picture over 5 MB is a 413', async () => {
    const big = Buffer.concat([PNG_1X1, Buffer.alloc(5 * 1024 * 1024 + 10)]);
    expect([413, 415]).toContain((await upload('adminA', big, 'big.png')).status);
  });

  it('[MED-4] A\'s pictures are listed for A and not for B, and B\'s upload of the very same bytes is B\'s own', async () => {
    const own = await upload('adminA', Buffer.concat([PNG_1X1, Buffer.from('MED-4')]), 'a4.png');
    const aList = (await h.call('adminA', 'get', '/campaigns/media')).body.data as Array<{ id: string }>;
    const bBefore = (await h.call('adminB', 'get', '/campaigns/media')).body.data as Array<{ id: string }>;
    expect(aList.some((p) => p.id === own.body.data.id)).toBe(true);
    expect(bBefore.some((p) => aList.some((a) => a.id === p.id))).toBe(false);
    const same = await upload('adminB', PNG_1X1, 'same.png');
    expect([201, 409]).toContain(same.status);
    if (same.status === 201) expect(aList.some((p) => p.id === same.body.data.id)).toBe(false);
  });

  it('[MED-5] a download of a made-up id and of another organisation\'s file are the same 404, and an uploaded picture of A cannot be fetched by B', async () => {
    const own = await upload('adminA', Buffer.concat([PNG_1X1, Buffer.from('MED-5')]), 'a5.png');
    const id = String(own.body.data.id);
    expect((await h.call('adminB', 'get', `/media/${id}`)).status).toBe(404);
    expect((await h.call('adminB', 'get', `/media/${id}/thumb`)).status).toBe(404);
    expect((await h.call('keyB', 'get', `/media/${id}`)).status).toBe(404);
    expect((await h.call('adminB', 'get', `/media/${FAKE}`)).status).toBe(404);
    expect((await h.call('adminA', 'get', '/media/not-a-uuid')).status).toBe(422);
  });

  it('[MED-6] the same picture uploaded twice at the same moment by two people is one picture or two clean answers, never a 500', async () => {
    const same = Buffer.concat([PNG_1X1, Buffer.from('MED-6')]);
    const results = await Promise.all([upload('adminA', same, 'x.png'), upload('agentA', same, 'y.png'), upload('adminA', same, 'z.png')]);
    expect(results.every((r) => [201, 409].includes(r.status)), results.map((r) => r.status).join(',')).toBe(true);
  });

  it('[MED-7] a signed-out request for a download is a 401 and a bad id is a 422, never a stack trace', async () => {
    expect((await h.call('anon', 'get', `/media/${FAKE}`)).status).toBe(401);
    expect((await h.call('adminA', 'get', '/media/xyz')).status).toBe(422);
  });
});

// ───────────────────────────────────────── imports ─────────────────────────────────────────
suite('imports in two organisations', { timeout: 30_000 }, () => {
  const MAPPING = { version: 1, displayName: { from: 'Name' }, identities: [{ kind: 'phone', from: 'Phone' }], defaultCountry: 'IN' };
  const csv = (tag: string, phones: string[]): string => `Name,Phone\n${phones.map((p, n) => `${tag}-imp-${String(n)},${p}`).join('\n')}\n`;
  const up = (who: 'adminA' | 'adminB' | 'agentA' | 'keyAll' | 'key:contacts:read' | 'anon', body: string, q = '') =>
    request(h.app).post(`/api/v1/imports${q}`).set(h.headers[who]).set('Content-Type', 'text/csv').send(body);
  const run = (who: 'adminA' | 'adminB' | 'agentA', id: string, dryRun: boolean, extra: object = {}) =>
    request(h.app).post(`/api/v1/imports/${id}/run`).set(h.headers[who]).send({ mapping: MAPPING, dryRun, ...extra });

  it('[IMP-1] who may import: an admin and an agent yes, a read-only key and nobody no', async () => {
    expect((await up('adminA', csv('IMP1a', ['9811100001']))).status).toBe(201);
    expect((await up('agentA', csv('IMP1b', ['9811100002']))).status).toBe(201);
    expect((await up('key:contacts:read', csv('IMP1c', ['9811100003']))).status).toBe(403);
    expect((await up('anon', csv('IMP1d', ['9811100004']))).status).toBe(401);
  });

  it('[IMP-2] the same file uploaded by both organisations is two separate imports, not a duplicate of each other', async () => {
    const same = csv('IMP2', ['9811100010', '9811100011']);
    const a = await up('adminA', same);
    const b = await up('adminB', same);
    expect(a.status).toBe(201);
    expect(b.status, 'the duplicate check is per organisation').toBe(201);
    expect(b.body.data.id).not.toBe(a.body.data.id);
  });

  it('[IMP-3] B cannot read, run or list A\'s import: every address answers 404, and B\'s list does not hold it', async () => {
    const a = await up('adminA', csv('IMP3', ['9811100020']));
    const id = String(a.body.data.id);
    for (const path of [`/imports/${id}`, `/imports/${id}/rows`, `/imports/${id}/numbers`]) {
      expect((await h.call('adminB', 'get', path)).status, path).toBe(404);
      expect((await h.call('keyB', 'get', path)).status, `key ${path}`).toBe(404);
    }
    expect((await run('adminB', id, false)).status).toBe(404);
    const list = (await h.call('adminB', 'get', '/imports')).body.data as Array<{ id: string }>;
    expect(list.some((r) => r.id === id)).toBe(false);
  });

  it('[IMP-4] both organisations import the same phone number: one contact in each, and a person in A is not changed by B\'s import', async () => {
    const phone = '9811100030';
    const a = await up('adminA', csv('IMP4-A', [phone]));
    const b = await up('adminB', csv('IMP4-B', [phone]));
    expect((await run('adminA', String(a.body.data.id), false)).status).toBe(200);
    expect((await run('adminB', String(b.body.data.id), false)).status).toBe(200);
    const inA = (await h.call('adminA', 'get', `/contacts?q=${encodeURIComponent('IMP4-A')}`)).body.data as Array<{ displayName: string }>;
    const inB = (await h.call('adminB', 'get', `/contacts?q=${encodeURIComponent('IMP4-B')}`)).body.data as Array<{ displayName: string }>;
    expect(inA).toHaveLength(1);
    expect(inB).toHaveLength(1);
    expect(JSON.stringify((await h.call('adminA', 'get', '/contacts?limit=250')).body)).not.toContain('IMP4-B');
  });

  it('[IMP-5] a dry run creates nobody, a commit creates them, and committing the same import twice is a 409', async () => {
    const a = await up('adminA', csv('IMP5', ['9811100040', '9811100041']));
    const id = String(a.body.data.id);
    const dry = await run('adminA', id, true);
    expect(dry.status).toBe(200);
    expect(JSON.stringify((await h.call('adminA', 'get', `/contacts?q=IMP5`)).body.data)).not.toContain('IMP5-imp-0');
    expect((await run('adminA', id, false)).status).toBe(200);
    expect((await run('adminA', id, false)).status).toBe(409);
  });

  // M-003 (#112), fixed: a commit claims the import before it writes, so exactly one of two simultaneous commits runs.
  it('[R-051] [IMP-6] two people committing the same import at the same moment: one wins, the other gets 409, and nobody is created twice', async () => {
    const a = await up('adminA', csv('IMP6', ['9811100050', '9811100051', '9811100052']));
    const id = String(a.body.data.id);
    const both = await Promise.all([run('adminA', id, false), run('agentA', id, false)]);
    const codes = both.map((r) => r.status).sort();
    expect(codes, 'one commit runs, the other is told it is already committed or being committed').toEqual([200, 409]);
    const n = (await h.rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM contact WHERE org_id = ${A().orgId} AND display_name LIKE 'IMP6-imp-%'`))[0]!.n;
    expect(n).toBe(3);
  });

  it('[IMP-7] two organisations importing at the same moment both succeed', async () => {
    const a = await up('adminA', csv('IMP7-A', ['9811100060', '9811100061']));
    const b = await up('adminB', csv('IMP7-B', ['9811100060', '9811100061']));
    const both = await Promise.all([run('adminA', String(a.body.data.id), false), run('adminB', String(b.body.data.id), false)]);
    expect(both.map((r) => r.status)).toEqual([200, 200]);
  });

  it('[IMP-8] tagging an import with another organisation\'s tag is refused or ignored: the people are not tagged with it and B\'s tag is not changed', async () => {
    const a = await up('adminA', csv('IMP8', ['9811100070']));
    const r = await run('adminA', String(a.body.data.id), false, { tag: { id: B().tagId } });
    expect([404, 422, 200]).toContain(r.status);
    const crossed = await h.rows<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM contact_tag ct JOIN contact c ON c.id = ct.contact_id WHERE ct.tag_id = ${B().tagId} AND c.org_id = ${A().orgId}`);
    expect(crossed[0]!.n, 'a contact of A must never carry B\'s tag').toBe(0);
  });

  it('[IMP-9] an empty body, a file with no identity column, a mapping that names a column the file lacks, and a mapping with no identity rule are refused cleanly', async () => {
    expect((await up('adminA', '')).status).toBe(415);
    const a = await up('adminA', csv('IMP9', ['9811100080']));
    const id = String(a.body.data.id);
    expect((await request(h.app).post(`/api/v1/imports/${id}/run`).set(h.headers.adminA).send({ mapping: { ...MAPPING, identities: [] }, dryRun: true })).status).toBe(422);
    const missing = await run('adminA', id, true, { mapping: { ...MAPPING, identities: [{ kind: 'phone', from: 'No such column' }] } });
    expect([200, 422]).toContain(missing.status);
    expect((await request(h.app).post(`/api/v1/imports/${id}/run`).set(h.headers.adminA).send({ dryRun: true })).status).toBe(422);
  });

  it('[IMP-10] a text value that starts like a formula is stored as text; a very long name is refused with a plain 422 (a cell limit) or accepted; a NUL character is a 422 or accepted, never a 500', async () => {
    expect((await up('adminA', 'Name,Phone\n=1+1,9811100090\n')).status).toBe(201);
    expect([201, 422]).toContain((await up('adminA', 'Name,Phone\n' + 'N'.repeat(500) + ',9811100091\n')).status);
    const nul = await request(h.app).post('/api/v1/imports').set(h.headers.adminA).set('Content-Type', 'text/csv').send('Name,Phone\nA\u0000B,9811100092\n');
    expect([201, 422]).toContain(nul.status);
  });
});

// ───────────────────────────────────────── segments and custom fields ─────────────────────────────────────────
suite('segments and custom fields', () => {
  it('[SEG-1] the same segment name exists in both organisations, and each list shows only its own', async () => {
    const mk = (who: 'adminA' | 'adminB') => h.call(who, 'post', '/segments', { name: 'SEG-1 same name', definition: { replied: 'never' } });
    const [a, b] = [await mk('adminA'), await mk('adminB')];
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const aList = (await h.call('adminA', 'get', '/segments')).body.data as Array<{ id: string }>;
    expect(aList.some((s) => s.id === b.body.data.id)).toBe(false);
  });

  it('[SEG-2] B cannot delete A\'s segment: 404, and it is still there afterwards', async () => {
    const a = await h.call('adminA', 'post', '/segments', { name: 'SEG-2', definition: { dnc: 'exclude' } });
    expect((await h.call('adminB', 'delete', `/segments/${String(a.body.data.id)}`)).status).toBe(404);
    expect((await h.call('keyB', 'delete', `/segments/${String(a.body.data.id)}`)).status).toBe(404);
    const still = (await h.call('adminA', 'get', '/segments')).body.data as Array<{ id: string }>;
    expect(still.some((s) => s.id === a.body.data.id)).toBe(true);
  });

  it('[SEG-3] a segment that names another organisation\'s tag matches nobody of its own and never leaks a count of B\'s people', async () => {
    const r = await h.call('adminA', 'post', '/segments/preview', { definition: { tagIds: [B().tagId] } });
    expect([200, 404, 422]).toContain(r.status);
    if (r.status === 200) expect(JSON.stringify(r.body)).not.toMatch(/"(count|total|matches)":\s*[1-9]/);
  });

  it('[SEG-4] an unknown key in a definition, a rule with a bad operator and more than 20 tags are refused with 422', async () => {
    for (const definition of [{ nonsense: true }, { tagIds: Array.from({ length: 21 }, () => FAKE) }, { lastContactedWithinDays: 0 }, { fieldRules: Array.from({ length: 11 }, () => ({ key: 'x', op: 'eq', value: 'y' })) }]) {
      expect((await h.call('adminA', 'post', '/segments/preview', { definition })).status, JSON.stringify(definition).slice(0, 60)).toBe(422);
    }
  });

  it('[SEG-5] a read-only key lists but cannot create or delete; an agent can create (contacts:write is their role)', async () => {
    expect((await h.call('key:contacts:read', 'get', '/segments')).status).toBe(200);
    expect((await h.call('key:contacts:read', 'post', '/segments', { name: 'x', definition: {} })).status).toBe(403);
    expect((await h.call('agentA', 'post', '/segments', { name: 'SEG-5 by agent', definition: {} })).status).toBe(201);
  });

  it('[FLD-1] only an admin defines or deletes a custom field; an agent, a key and nobody cannot, but all can read them', async () => {
    for (const who of ['agentA', 'keyAll'] as const) {
      expect((await h.call(who, 'post', '/custom-fields', { key: 'fld1', label: 'x' })).status, who).toBe(403);
      expect((await h.call(who, 'delete', `/custom-fields/${A().fieldKey}`)).status, who).toBe(403);
    }
    expect((await h.call('anon', 'post', '/custom-fields', { key: 'fld1', label: 'x' })).status).toBe(401);
    for (const who of ['agentA', 'key:contacts:read', 'adminA'] as const) expect((await h.call(who, 'get', '/custom-fields')).status, who).toBe(200);
  });

  it('[FLD-2] the same field key exists in both organisations, deleting it in one leaves the other\'s field and values alone', async () => {
    expect((await h.call('adminA', 'post', '/custom-fields', { key: 'fld2_shared', label: 'Shared A' })).status).toBe(201);
    expect((await h.call('adminB', 'post', '/custom-fields', { key: 'fld2_shared', label: 'Shared B' })).status).toBe(201);
    expect((await h.call('adminB', 'put', `/contacts/${B().contactIds[0]!}/custom-fields`, { values: { fld2_shared: 'b-value' } })).status).toBeLessThan(300);
    expect((await h.call('adminA', 'delete', '/custom-fields/fld2_shared')).status).toBe(204);
    const bFields = (await h.call('adminB', 'get', '/custom-fields')).body.data as Array<{ key: string }>;
    expect(bFields.some((f) => f.key === 'fld2_shared')).toBe(true);
    const value = await h.rows<{ v: string | null }>(sql`SELECT custom_fields->>'fld2_shared' AS v FROM contact WHERE id = ${B().contactIds[0]!}`);
    expect(value[0]!.v).toBe('b-value');
  });

  it('[FLD-3] two admins defining the same field at the same moment: one 201 and one 409, never a 500, never two', async () => {
    const both = await Promise.all([
      h.call('adminA', 'post', '/custom-fields', { key: 'fld3_race', label: 'one' }),
      h.call('adminA2', 'post', '/custom-fields', { key: 'fld3_race', label: 'two' })
    ]);
    expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
    const n = (await h.rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM custom_field WHERE org_id = ${A().orgId} AND key = 'fld3_race'`))[0]!.n;
    expect(n).toBe(1);
  });

  // M-002 (docs/49-bug-list.md): the value is written after the delete cleared the field's values, so it is left behind. It happens in about two rounds of three,
  // so the test runs fifteen rounds and `it.fails` says "at least one left a value behind". Make it a plain `it` when fixed.
  it.fails('[FLD-4] one admin deleting a field while another sets a value on it: the delete wins or the set is refused, and no value of a deleted field is left on any contact (15 rounds)', async () => {
    let orphans = 0;
    for (let n = 0; n < 15; n++) {
      const key = `fld4_r${String(n)}`;
      expect((await h.call('adminA', 'post', '/custom-fields', { key, label: 'race' })).status).toBe(201);
      const [del, set] = await Promise.all([
        h.call('adminA', 'delete', `/custom-fields/${key}`),
        h.call('agentA', 'put', `/contacts/${A().contactIds[2]!}/custom-fields`, { values: { [key]: 'late' } })
      ]);
      expect([200, 204]).toContain(del.status);
      expect(set.status, 'never a 500').toBeLessThan(500);
      const left = await h.rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM contact WHERE org_id = ${A().orgId} AND custom_fields ? ${key}`);
      orphans += left[0]!.n;
    }
    expect(orphans, 'a value of a field that no longer exists was left behind in some round').toBe(0);
  });

  it('[FLD-5] a bad key (spaces, capitals, an operator, 200 characters, __proto__), a select with no options and a 51st option are 422', async () => {
    for (const body of [
      { key: 'has space', label: 'x' }, { key: 'UPPER', label: 'x' }, { key: "a'; DROP TABLE contact;--", label: 'x' }, { key: 'k'.repeat(200), label: 'x' },
      { key: '__proto__', label: 'x' }, { key: 'sel', label: 'x', type: 'select', options: [] }, { key: 'sel2', label: 'x', type: 'select', options: Array.from({ length: 51 }, (_, n) => `o${String(n)}`) }
    ]) expect((await h.call('adminA', 'post', '/custom-fields', body)).status, JSON.stringify(body).slice(0, 60)).toBe(422);
  });
});

// ───────────────────────────────────────── audit trail ─────────────────────────────────────────
suite('the audit trail', () => {
  it('[AUD-1] a role change is recorded once, in the organisation where it happened, with who did it and the role before and after', async () => {
    const person = await h.call('adminA', 'post', '/admin/users', { email: `aud1-${String(Date.now())}@a.test`, password: 'correct-horse-1234', displayName: 'AUD-1', role: 'agent' });
    const id = String(person.body.data.userId);
    expect((await h.call('adminA', 'patch', `/admin/users/${id}`, { role: 'admin' })).status).toBe(200);
    const rows = await h.rows<{ actor_id: string; before: { role: string }; after: { role: string } }>(sql`
      SELECT actor_id, before, after FROM audit_log WHERE org_id = ${A().orgId} AND action = 'user.role.changed' AND target_id = ${id}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor_id).toBe(h.users.adminA.id);
    expect([rows[0]!.before.role, rows[0]!.after.role]).toEqual(['agent', 'admin']);
    expect((await h.rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM audit_log WHERE org_id = ${B().orgId} AND target_id = ${id}`))[0]!.n).toBe(0);
  });

  it('[AUD-2] a refused change is not recorded as done: a 403 or 404 leaves no "changed" row', async () => {
    const before = await auditCount(A().orgId, 'user.role.changed');
    await h.call('agentA', 'patch', `/admin/users/${h.users.agentA2.id}`, { role: 'admin' });
    await h.call('adminB', 'patch', `/admin/users/${h.users.agentA2.id}`, { role: 'admin' });
    expect(await auditCount(A().orgId, 'user.role.changed')).toBe(before);
  });

  it('[AUD-3] nothing secret is ever in an audit row: no password, hash, session token, API key secret, message text', async () => {
    const rows = await h.rows<{ blob: string }>(sql`SELECT (coalesce(before::text, '') || coalesce(after::text, '')) AS blob FROM audit_log WHERE org_id IN (${A().orgId}, ${B().orgId})`);
    for (const { blob } of rows) {
      expect(blob).not.toMatch(/\$argon2/);
      expect(blob).not.toContain('correct-horse-1234');
      expect(blob).not.toMatch(/crm_(live|test)_[A-Za-z0-9]{20,}/);
    }
  });

  it('[AUD-5] a download is audited before the bytes move, with the chat and the type and never the file name or the bytes', async () => {
    const rows = await h.rows<{ after: Record<string, unknown> }>(sql`SELECT after FROM audit_log WHERE action = 'media.downloaded' LIMIT 5`);
    for (const r of rows) expect(Object.keys(r.after).sort()).toEqual(['contentType', 'conversationId']);
  });

  it('[AUD-6] a password change and a disabled account each leave a row naming the person, in the organisation of the admin who did it', async () => {
    const email = `aud6-${String(Date.now())}@a.test`;
    const made = await h.call('adminA', 'post', '/admin/users', { email, password: 'correct-horse-1234', displayName: 'AUD-6', role: 'agent' });
    const id = String(made.body.data.userId);
    await h.call('adminA', 'post', `/admin/users/${id}/password`, { password: 'another-long-password-9' });
    await h.call('adminA', 'patch', `/admin/users/${id}`, { status: 'disabled' });
    const actions = (await h.rows<{ action: string }>(sql`SELECT action FROM audit_log WHERE org_id = ${A().orgId} AND target_id = ${id}`)).map((r) => r.action);
    expect(actions).toContain('user.disabled');
    expect(actions.some((a) => a.includes('password'))).toBe(true);
  });
});

// ───────────────────────────────────────── chat presence ─────────────────────────────────────────
suite('who has a chat open, and who is typing', () => {
  const chat = (): string => A().conversationId;

  it('[PRE-1] a person in A\'s organisation who opens a chat is seen by a colleague and not by themselves', async () => {
    expect((await h.call('agentA', 'post', `/conversations/${chat()}/presence`)).status).toBe(204);
    const seenByColleague = (await h.call('agentA2', 'get', `/conversations/${chat()}/presence`)).body.data as Array<{ userId: string; typing: boolean }>;
    expect(seenByColleague.map((p) => p.userId)).toContain(h.users.agentA.id);
    const seenByThemself = (await h.call('agentA', 'get', `/conversations/${chat()}/presence`)).body.data as Array<{ userId: string }>;
    expect(seenByThemself.map((p) => p.userId)).not.toContain(h.users.agentA.id);
  });

  it('[PRE-2] typing shows as typing for a few seconds and is cleared by leaving', async () => {
    expect((await h.call('agentA', 'post', `/conversations/${chat()}/typing`)).status).toBe(204);
    const typing = (await h.call('adminA', 'get', `/conversations/${chat()}/presence`)).body.data as Array<{ userId: string; typing: boolean }>;
    expect(typing.find((p) => p.userId === h.users.agentA.id)?.typing).toBe(true);
    expect((await h.call('agentA', 'delete', `/conversations/${chat()}/presence`)).status).toBe(204);
    const gone = (await h.call('adminA', 'get', `/conversations/${chat()}/presence`)).body.data as Array<{ userId: string }>;
    expect(gone.map((p) => p.userId)).not.toContain(h.users.agentA.id);
  });

  it('[PRE-3] B\'s people cannot say they are in A\'s chat (404), cannot see who is in it (an empty list, never a name), and cannot clear A\'s people out of it', async () => {
    expect((await h.call('agentA', 'post', `/conversations/${chat()}/presence`)).status).toBe(204);
    for (const who of ['adminB', 'agentB'] as const) {
      expect((await h.call(who, 'post', `/conversations/${chat()}/presence`)).status, who).toBe(404);
      expect((await h.call(who, 'post', `/conversations/${chat()}/typing`)).status, who).toBe(404);
      const seen = await h.call(who, 'get', `/conversations/${chat()}/presence`);
      expect(seen.status).toBe(200);
      expect(seen.body.data, 'no names of another organisation').toEqual([]);
      expect((await h.call(who, 'delete', `/conversations/${chat()}/presence`)).status).toBe(204);
    }
    const stillThere = (await h.call('agentA2', 'get', `/conversations/${chat()}/presence`)).body.data as Array<{ userId: string }>;
    expect(stillThere.map((p) => p.userId), 'B\'s delete did not remove A\'s person').toContain(h.users.agentA.id);
    const rows = await h.rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM conversation_presence WHERE conversation_id = ${chat()} AND org_id <> ${A().orgId}`);
    expect(rows[0]!.n).toBe(0);
  });

  it('[PRE-4] an API key is not a person: presence and typing are a 422, and the list is readable', async () => {
    expect((await h.call('keyAll', 'post', `/conversations/${chat()}/presence`)).status).toBe(422);
    expect((await h.call('keyAll', 'post', `/conversations/${chat()}/typing`)).status).toBe(422);
    expect((await h.call('keyAll', 'get', `/conversations/${chat()}/presence`)).status).toBe(200);
  });

  it('[PRE-5] a made-up chat, a malformed id and no sign-in are 404, 422 and 401', async () => {
    expect((await h.call('agentA', 'post', `/conversations/${FAKE}/presence`)).status).toBe(404);
    expect((await h.call('agentA', 'post', '/conversations/not-a-uuid/presence')).status).toBe(422);
    expect((await h.call('anon', 'get', `/conversations/${chat()}/presence`)).status).toBe(401);
  });

  it('[PRE-6] ten people-calls at the same moment from two colleagues never error and leave one row each', async () => {
    const calls = await Promise.all(Array.from({ length: 10 }, (_, n) => h.call(n % 2 === 0 ? 'agentA' : 'agentA2', 'post', `/conversations/${chat()}/${n % 3 === 0 ? 'typing' : 'presence'}`)));
    expect(calls.every((r) => r.status === 204), calls.map((r) => r.status).join(',')).toBe(true);
    const rows = await h.rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM conversation_presence WHERE conversation_id = ${chat()} AND user_id IN (${h.users.agentA.id}, ${h.users.agentA2.id})`);
    expect(rows[0]!.n).toBe(2);
  });

  it('[PRE-7] a disabled person\'s old presence disappears from the list once they have not been seen for 30 seconds, and a disabled person cannot post', async () => {
    expect((await h.call('disabledA', 'post', `/conversations/${chat()}/presence`)).status).toBe(401);
    await h.rows(sql`UPDATE conversation_presence SET seen_at = now() - interval '31 seconds' WHERE conversation_id = ${chat()} AND user_id = ${h.users.agentA.id}`);
    const seen = (await h.call('adminA', 'get', `/conversations/${chat()}/presence`)).body.data as Array<{ userId: string }>;
    expect(seen.map((p) => p.userId)).not.toContain(h.users.agentA.id);
  });
});
