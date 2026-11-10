import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { addUserToOrg, storeInboundMessage } from '@crm/core';
import { applyInboundEffects } from '../../apps/gateway/src/work.js';
import { kms, makeLane, type Lane } from './antiban-v2-harness.js';

/**
 * [R-037] After an opt-out, an agent may answer by hand once the person writes again. A second STOP counted as "writing again", so a
 * person who said STOP twice could be messaged by an agent.
 * [R-038] The closing message quoted whatever an agent or the AI typed last in the chat, never the campaign message, because campaign
 * messages are stored as sent by `system` and the lookup skipped every `system` message (the fixtures in the older tests stored them
 * as `api`, so the real shape was never exercised).
 */
let lane: Lane;
let agentId: string | null = null;
beforeEach(async () => { lane = await makeLane(); agentId = null; });
afterEach(async () => {
  await lane.close();
  if (agentId !== null) await lane.db.execute(sql`DELETE FROM app_user WHERE id = ${agentId}`).catch(() => undefined);
});

async function agent(): Promise<string> {
  if (agentId !== null) return agentId;
  const made = await addUserToOrg(lane.db, new BuiltinPasswordHasher(), {
    orgId: lane.orgId, email: `agent-${randomUUID()}@r037.test`, password: 'x', displayName: 'Agent', role: 'agent' });
  agentId = made.userId;
  return agentId;
}

async function say(c: { phone: string }, body: string) {
  lane.clock.advance(1_000);
  const stored = await storeInboundMessage(lane.db, kms, {
    orgId: lane.orgId, senderIdentityId: lane.senderId, providerMessageId: `wamid.${randomUUID()}`, fromPhoneE164: c.phone,
    fromProviderAddress: `${c.phone.replace(/\D/g, '')}@s.whatsapp.net`, body, contentType: 'text', receivedAt: lane.clock.now()
  });
  return applyInboundEffects(lane.ctx(), {
    senderId: lane.senderId, conversationId: stored.conversationId, messageId: stored.messageId, body, contentType: 'text'
  });
}
const campaign = async (purpose: string | null): Promise<string> => (await lane.one<{ id: string }>(sql`
  INSERT INTO campaign (org_id, name, status, body, sender_identity_id, started_at, purpose)
  VALUES (${lane.orgId}, 'c', 'running', 'x', ${lane.senderId}, now(), ${purpose}) RETURNING id`)).id;
const outbound = async (conversationId: string) => (await lane.db.execute(sql`
  SELECT status, sent_by AS "sentBy", body_enc AS "bodyEnc" FROM message
  WHERE conversation_id = ${conversationId} AND direction = 'outbound' ORDER BY created_at`)) as unknown as Array<{ status: string; sentBy: string; bodyEnc: Uint8Array }>;
const text = (m: { bodyEnc: Uint8Array }): string => new TextDecoder().decode(kms.decrypt(m.bodyEnc));

describe('[R-037] a second STOP is not the person writing to us', () => {
  it('[R-037] an agent cannot message someone who said STOP twice', async () => {
    const c = await lane.contact({ inbound: 'old' });
    await say(c, 'stop');
    await lane.drain();
    await say(c, 'STOP');                                      // asks again
    const byHand = await lane.queue(c.conversationId, 'Are you sure?', { userId: await agent() });
    await lane.drain();
    expect(await lane.row(byHand)).toMatchObject({ status: 'failed', code: 'do_not_contact' });
    expect(lane.sentBodies()).toHaveLength(1);                 // only the closing message ever went
  });

  it('[R-037] a real reply still lets an agent answer, and a STOP after that closes it again', async () => {
    const c = await lane.contact({ inbound: 'old' });
    await say(c, 'stop');
    await lane.drain();
    await say(c, 'sorry, who is this?');
    const first = await lane.queue(c.conversationId, 'This is Acme HR.', { userId: await agent() });
    await lane.drain();
    expect((await lane.row(first)).status).toBe('sent');

    await say(c, 'Stop');
    const second = await lane.queue(c.conversationId, 'One more thing', { userId: await agent() });
    await lane.drain();
    expect(await lane.row(second)).toMatchObject({ status: 'failed', code: 'do_not_contact' });
  });

  it('[R-037] the org\'s own stop words count the same as STOP', async () => {
    await lane.db.execute(sql`UPDATE antiban_setting SET stop_words = ARRAY['band karo'] WHERE org_id = ${lane.orgId}`);
    const c = await lane.contact({ inbound: 'old' });
    await say(c, 'band karo');
    await lane.drain();
    await say(c, 'band karo');
    const byHand = await lane.queue(c.conversationId, 'hello', { userId: await agent() });
    await lane.drain();
    expect(await lane.row(byHand)).toMatchObject({ status: 'failed', code: 'do_not_contact' });
  });
});

describe('[R-038] the closing message names the campaign', () => {
  it('[R-038] quotes the campaign message and its purpose, not an agent\'s or the AI\'s last line', async () => {
    await lane.db.execute(sql`UPDATE antiban_setting SET default_purpose = 'default purpose' WHERE org_id = ${lane.orgId}`);
    const camp = await campaign('you applied for the Pune driver job');
    const c = await lane.contact({ inbound: 'old' });
    // The shapes the live install really stores: the campaign message is sent by `system`, then people and the AI chat in the same thread.
    await lane.sent(c.conversationId, { agoMs: 3_600_000, sentBy: 'system', campaignId: camp, body: 'Your interview is on Monday at 10am.' });
    await lane.sent(c.conversationId, { agoMs: 1_800_000, sentBy: 'api', body: 'F7 reply while the gateway is down' });
    await lane.sent(c.conversationId, { agoMs: 600_000, sentBy: 'agent', body: 'Main Live Test ka ek automated helper hoon and I' });
    await say(c, 'stop');
    await lane.drain();

    const closing = (await outbound(c.conversationId)).filter((m) => m.sentBy === 'system' && text(m).includes('not message you again'));
    expect(closing).toHaveLength(1);
    const body = text(closing[0]!);
    expect(body).toContain('you applied for the Pune driver job');
    expect(body).toContain('Your interview is on Monday at 10am.');
    expect(body).not.toContain('F7 reply');
    expect(body).not.toContain('automated helper');
    expect(body).not.toContain('default purpose');
  });

  it('[R-038] a chat with no campaign still quotes the last message a person or the AI sent, and an earlier closing message is never quoted', async () => {
    const c = await lane.contact({ inbound: 'old' });
    await lane.sent(c.conversationId, { agoMs: 3_600_000, sentBy: 'system', body: 'Earlier closing: We will not message you again.' });
    await lane.sent(c.conversationId, { agoMs: 600_000, sentBy: 'agent', body: 'Your documents are ready.' });
    await say(c, 'stop');
    await lane.drain();
    const body = text((await outbound(c.conversationId)).at(-1)!);
    expect(body).toContain('Your documents are ready.');
    expect(body).not.toContain('Earlier closing');
  });
});
