import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { LlmDriver, LlmResponse } from '@crm/llm';
import { storeInboundMessage } from '@crm/core';
import { applyInboundEffects } from '../../apps/gateway/src/work.js';
import { kms, makeLane, type Lane } from './antiban-v2-harness.js';

/**
 * R-046 (2026-11-10, area: anti-ban, found by: live run on four phones): the AI classifier read a harmless "flood 10" as an opt-out. The
 * person was put on do-not-contact, sent "We will not message you again", and agents were blocked from answering. The model's word alone
 * no longer silences anyone: a message it reads as negative goes to a colleague with a note, and nothing is flagged or sent. A STOP word
 * (or one of the org's own) still opts out at once, with no model asked.
 */
let lane: Lane;
beforeEach(async () => { lane = await makeLane(); });
afterEach(async () => { await lane.close(); });

const model = (answer: string): LlmDriver & { calls: number } => {
  const d = {
    name: 'fake', calls: 0,
    complete(): Promise<LlmResponse> {
      d.calls += 1;
      return Promise.resolve({ text: answer, toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, model: 'fake' });
    }
  };
  return d;
};
async function say(c: { phone: string }, body: string, llm?: LlmDriver) {
  lane.clock.advance(1_000);
  const stored = await storeInboundMessage(lane.db, kms, {
    orgId: lane.orgId, senderIdentityId: lane.senderId, providerMessageId: `wamid.${randomUUID()}`, fromPhoneE164: c.phone,
    fromProviderAddress: `${c.phone.replace(/\D/g, '')}@s.whatsapp.net`, body, contentType: 'text', receivedAt: lane.clock.now()
  });
  return applyInboundEffects(lane.ctx(llm === undefined ? {} : { llm }), {
    senderId: lane.senderId, conversationId: stored.conversationId, messageId: stored.messageId, body, contentType: 'text'
  });
}
const flagged = async (id: string) => (await lane.one<{ dnc: boolean }>(sql`SELECT do_not_contact AS dnc FROM contact WHERE id = ${id}`)).dnc;
const outboundCount = async (conv: string) => (await lane.one<{ n: number }>(sql`
  SELECT count(*)::int AS n FROM message WHERE conversation_id = ${conv} AND direction = 'outbound'`)).n;
const notes = async (conv: string) => (await lane.db.execute(sql`SELECT body FROM internal_note WHERE conversation_id = ${conv}`)) as unknown as Array<{ body: string }>;

describe('[R-046] the AI classifier', () => {
  it('[R-046] reading a message as negative does not flag the person, does not send a closing message, and leaves a note for the team', async () => {
    const c = await lane.contact({ inbound: 'old' });
    const r = await say(c, 'flood 10', model('NEGATIVE'));
    expect(r.outcome).toBe('review');
    expect(await flagged(c.contactId)).toBe(false);
    expect(await outboundCount(c.conversationId)).toBe(0);
    const written = await notes(c.conversationId);
    expect(written).toHaveLength(1);
    expect(written[0]!.body).toContain('flood 10');
    expect(written[0]!.body).toContain('NOT been marked do-not-contact');
  });

  it('[R-046] a chat the AI owned goes to nobody (so the AI stops answering it) and a chat a person owns stays theirs', async () => {
    const bot = (await lane.one<{ id: string }>(sql`
      INSERT INTO app_user (email, password_hash, display_name, is_bot) VALUES (${`bot-${randomUUID()}@bot.invalid`}, 'x', 'AI assistant', true) RETURNING id`)).id;
    const human = (await lane.one<{ id: string }>(sql`
      INSERT INTO app_user (email, password_hash, display_name) VALUES (${`h-${randomUUID()}@x.test`}, 'x', 'Human') RETURNING id`)).id;
    try {
      await lane.db.execute(sql`INSERT INTO ai_setting (org_id, enabled, bot_user_id) VALUES (${lane.orgId}, true, ${bot})`);
      const a = await lane.contact({ inbound: 'old' });
      await lane.db.execute(sql`UPDATE conversation SET assignee_user_id = ${bot} WHERE id = ${a.conversationId}`);
      await say(a, 'who are you people?', model('NEGATIVE'));
      expect((await lane.one<{ a: string | null }>(sql`SELECT assignee_user_id AS a FROM conversation WHERE id = ${a.conversationId}`)).a).toBeNull();

      const b = await lane.contact({ inbound: 'old' });
      await lane.db.execute(sql`UPDATE conversation SET assignee_user_id = ${human} WHERE id = ${b.conversationId}`);
      await say(b, 'who are you people?', model('NEGATIVE'));
      expect((await lane.one<{ a: string | null }>(sql`SELECT assignee_user_id AS a FROM conversation WHERE id = ${b.conversationId}`)).a).toBe(human);
    } finally {
      await lane.db.execute(sql`DELETE FROM app_user WHERE id IN (${bot}, ${human})`).catch(() => undefined);
    }
  });

  it('[R-046] a STOP word still opts out at once, with a closing message, and the model is not asked', async () => {
    const ai = model('OK');
    const c = await lane.contact({ inbound: 'old' });
    expect((await say(c, 'STOP', ai)).outcome).toBe('opted_out');
    expect(await flagged(c.contactId)).toBe(true);
    expect(ai.calls).toBe(0);
  });

  it('[R-046] a message the model reads as fine, or a model that fails, changes nothing', async () => {
    const a = await lane.contact({ inbound: 'old' });
    expect((await say(a, 'flood 10', model('OK'))).outcome).toBe('none');
    const failing: LlmDriver = { name: 'fake', complete: () => Promise.reject(new Error('down')) };
    const b = await lane.contact({ inbound: 'old' });
    expect((await say(b, 'flood 10', failing)).outcome).toBe('none');
    expect(await flagged(a.contactId)).toBe(false);
    expect(await flagged(b.contactId)).toBe(false);
    expect(await notes(a.conversationId)).toEqual([]);
  });
});
