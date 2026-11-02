import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { LlmDriver, LlmResponse } from '@crm/llm';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { addUserToOrg, markOptOut, storeInboundMessage } from '@crm/core';
import { applyInboundEffects } from '../../apps/gateway/src/work.js';
import { kms, makeLane, type Lane } from './antiban-v2-harness.js';

/**
 * F6 S6: replies, STOP and the closing message. Opt-out intent is read from the contact's message (a STOP word, the org's own words, or
 * the AI classifier); one closing message goes at reply priority; then the contact is on do-not-contact, which the existing gates enforce.
 */
let lane: Lane;
let agentId: string | null = null;
beforeEach(async () => { lane = await makeLane(); agentId = null; });
afterEach(async () => {
  await lane.close();
  if (agentId !== null) await lane.db.execute(sql`DELETE FROM app_user WHERE id = ${agentId}`).catch(() => undefined);
});

/** A signed-in agent of the org: what makes a queued message "typed by a person", the only kind that may answer a do-not-contact contact. */
async function agent(): Promise<string> {
  const made = await addUserToOrg(lane.db, new BuiltinPasswordHasher(), {
    orgId: lane.orgId, email: `agent-${randomUUID()}@antiban-optout.test`, password: 'x', displayName: 'Agent', role: 'agent' });
  agentId = made.userId;
  return made.userId;
}

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

/** The contact writes `body`, the way the gateway stores it and then looks at it. */
async function say(c: { phone: string }, body: string, llm?: LlmDriver) {
  lane.clock.advance(1_000);                         // a later message than anything before it, to the second
  const stored = await storeInboundMessage(lane.db, kms, {
    orgId: lane.orgId, senderIdentityId: lane.senderId, providerMessageId: `wamid.${randomUUID()}`, fromPhoneE164: c.phone,
    fromProviderAddress: `${c.phone.replace(/\D/g, '')}@s.whatsapp.net`, body, contentType: 'text', receivedAt: lane.clock.now()
  });
  return applyInboundEffects(lane.ctx(llm === undefined ? {} : { llm }), {
    senderId: lane.senderId, conversationId: stored.conversationId, messageId: stored.messageId, body, contentType: 'text'
  });
}
const contactRow = (id: string) => lane.one<{ dnc: boolean; reason: string | null; at: string | null }>(sql`
  SELECT do_not_contact AS dnc, dnc_reason AS reason, dnc_at AS at FROM contact WHERE id = ${id}`);
const outbound = async (conversationId: string) => (await lane.db.execute(sql`
  SELECT id, status, sent_by AS "sentBy", dnc_override AS "override", error_code AS code, body_enc AS "bodyEnc" FROM message
  WHERE conversation_id = ${conversationId} AND direction = 'outbound' ORDER BY created_at`)) as unknown as Array<{
    id: string; status: string; sentBy: string; override: boolean; code: string | null; bodyEnc: Uint8Array }>;
const text = (m: { bodyEnc: Uint8Array }): string => new TextDecoder().decode(kms.decrypt(m.bodyEnc));
const settings = (patch: Record<string, unknown>) => {
  const cols = Object.keys(patch);
  return lane.db.execute(sql`
    INSERT INTO antiban_setting (org_id, quiet_hours_enabled, contact_phone, contact_email, default_purpose, closing_message_enabled, stop_words, restart_words)
    VALUES (${lane.orgId}, false, ${(patch.contactPhone as string | undefined) ?? null}, ${(patch.contactEmail as string | undefined) ?? null},
            ${(patch.defaultPurpose as string | undefined) ?? null}, ${(patch.closing as boolean | undefined) ?? true},
            ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify((patch.stopWords as string[] | undefined) ?? [])}::jsonb)),
            ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify((patch.restartWords as string[] | undefined) ?? [])}::jsonb)))
    ON CONFLICT (org_id) DO UPDATE SET contact_phone = EXCLUDED.contact_phone, contact_email = EXCLUDED.contact_email,
      default_purpose = EXCLUDED.default_purpose, closing_message_enabled = EXCLUDED.closing_message_enabled,
      stop_words = EXCLUDED.stop_words, restart_words = EXCLUDED.restart_words`).then(() => cols.length);
};
const campaign = async (purpose: string | null = null): Promise<string> => (await lane.one<{ id: string }>(sql`
  INSERT INTO campaign (org_id, name, status, body, sender_identity_id, started_at, purpose)
  VALUES (${lane.orgId}, 'c', 'running', 'x', ${lane.senderId}, now(), ${purpose}) RETURNING id`)).id;

describe('AC-6.1 opt-out intent', () => {
  it('AC-6.1 STOP puts the contact on do-not-contact', async () => {
    const c = await lane.contact({ inbound: 'old' });
    const r = await say(c, 'STOP');
    expect(r.outcome).toBe('opted_out');
    expect(await contactRow(c.contactId)).toMatchObject({ dnc: true, reason: 'opt_out' });
  });

  it('AC-6.1 unsubscribe and opt out do the same, and so do the org\'s own words', async () => {
    await settings({ stopWords: ['band karo'] });
    for (const word of ['Unsubscribe', 'opt out', 'band karo']) {
      const c = await lane.contact({ inbound: 'old' });
      expect((await say(c, word)).outcome).toBe('opted_out');
    }
  });

  it('AC-6.1 an ordinary message is left alone', async () => {
    const c = await lane.contact({ inbound: 'old' });
    expect((await say(c, 'what time is the interview?')).outcome).toBe('none');
    expect((await contactRow(c.contactId)).dnc).toBe(false);
    expect(await outbound(c.conversationId)).toEqual([]);
  });

  it('AC-6.1 the AI classifier can say negative (who is this, don\'t message me, abuse)', async () => {
    const ai = model('NEGATIVE');
    const c = await lane.contact({ inbound: 'old' });
    const r = await say(c, 'who is this? stop texting me you scammers', ai);
    expect(r.outcome).toBe('opted_out');
    expect(ai.calls).toBe(1);
  });

  it('AC-6.1 the classifier saying fine leaves the contact alone', async () => {
    const c = await lane.contact({ inbound: 'old' });
    expect((await say(c, 'thanks, got it', model('OK'))).outcome).toBe('none');
  });

  it('AC-6.1 with no AI configured, keywords only: a rude message is not an opt-out', async () => {
    const c = await lane.contact({ inbound: 'old' });
    expect((await say(c, 'leave me alone')).outcome).toBe('none');
    expect((await contactRow(c.contactId)).dnc).toBe(false);
  });

  it('AC-6.1 a STOP word needs no model: the classifier is not asked when a keyword already decided', async () => {
    const ai = model('OK');
    const c = await lane.contact({ inbound: 'old' });
    expect((await say(c, 'stop', ai)).outcome).toBe('opted_out');
    expect(ai.calls).toBe(0);
  });
});

describe('AC-6.2 the closing message', () => {
  it('AC-6.2 is queued at reply priority and goes before campaign messages queued earlier', async () => {
    await settings({ contactPhone: '+91 98765 43210', contactEmail: 'hr@acme.test', defaultPurpose: 'you asked us about jobs' });
    const other = await lane.contact({ inbound: 'old' });
    const camp = await campaign();
    for (let i = 0; i < 3; i++) await lane.queue(other.conversationId, `campaign ${i}`, { campaignId: camp });
    const c = await lane.contact({ inbound: 'old' });
    await say(c, 'stop');

    // The opt-out runs the lane itself, so the closing message has gone by now, ahead of the three campaign messages queued before it.
    await lane.drain();
    const sent = lane.sentBodies();
    expect(sent[0]).toMatch(/not message you again/i);
    expect(sent.slice(1)).toEqual(['campaign 0', 'campaign 1', 'campaign 2']);
  });

  it('AC-6.2 says why (the campaign purpose), a one-line summary of what was sent, and the org\'s number and email, as plain text', async () => {
    await settings({ contactPhone: '+91 98765 43210', contactEmail: 'hr@acme.test', defaultPurpose: 'default purpose' });
    const camp = await campaign('you applied for the Pune driver job');
    const c = await lane.contact({ inbound: 'old' });
    await lane.sent(c.conversationId, { agoMs: 3_600_000, campaignId: camp, body: 'Your interview is on Monday at 10am.\nSee https://acme.test/details' });
    await say(c, 'stop');
    await lane.drain();

    const [closing] = await outbound(c.conversationId).then((all) => all.filter((m) => m.sentBy === 'system'));
    const body = text(closing!);
    expect(body).toContain('you applied for the Pune driver job');
    expect(body).not.toContain('default purpose');
    expect(body).toContain('Your interview is on Monday at 10am.');
    expect(body).toContain('+91 98765 43210');
    expect(body).toContain('hr@acme.test');
    expect(body).not.toMatch(/https?:|www\./i);
    expect(closing!.status).toBe('sent');
  });

  it('AC-6.2 with no campaign purpose, the org default is used', async () => {
    await settings({ defaultPurpose: 'you asked us about jobs' });
    const c = await lane.contact({ inbound: 'old' });
    await say(c, 'stop');
    const [closing] = await outbound(c.conversationId);
    expect(text(closing!)).toContain('you asked us about jobs');
  });

  it('AC-6.7 without a contact number or email set, that line is left out', async () => {
    await settings({ defaultPurpose: 'you asked us about jobs' });
    const c = await lane.contact({ inbound: 'old' });
    await say(c, 'stop');
    const [closing] = await outbound(c.conversationId);
    expect(text(closing!)).not.toMatch(/call|email|@|\+91/i);
  });
});

describe('AC-6.3 exactly one closing message per opt-out', () => {
  it('AC-6.3 a second STOP sends nothing', async () => {
    const c = await lane.contact({ inbound: 'old' });
    await say(c, 'stop');
    await lane.drain();
    expect(await outbound(c.conversationId)).toHaveLength(1);

    const again = await say(c, 'STOP');
    expect(again.outcome).toBe('none');
    await lane.drain();
    expect(await outbound(c.conversationId)).toHaveLength(1);
    expect(lane.provider.sent).toHaveLength(1);
  });

  it('AC-6.3 two STOPs arriving together still produce one closing message', async () => {
    const c = await lane.contact({ inbound: 'old' });
    await Promise.all([say(c, 'stop'), say(c, 'stop')]);
    expect(await outbound(c.conversationId)).toHaveLength(1);
  });
});

describe('AC-6.4 and AC-6.5 do-not-contact after the closing message', () => {
  it('AC-6.4 campaigns and the AI are blocked; the closing message itself still goes', async () => {
    const c = await lane.contact({ inbound: 'old' });
    await say(c, 'stop');
    const viaCampaign = await lane.queue(c.conversationId, 'campaign', { campaignId: await campaign() });
    const viaAi = await lane.queue(c.conversationId, 'ai', { sentBy: 'agent' });
    await lane.drain();

    expect(lane.sentBodies()).toHaveLength(1);
    expect(lane.sentBodies()[0]).toMatch(/not message you again/i);
    expect(await lane.row(viaCampaign)).toMatchObject({ status: 'failed', code: 'do_not_contact' });
    expect(await lane.row(viaAi)).toMatchObject({ status: 'failed', code: 'do_not_contact' });
  });

  it('AC-6.5 a do-not-contact contact who writes again can be answered by hand; campaigns and AI stay blocked', async () => {
    const c = await lane.contact({ inbound: 'old' });
    await say(c, 'stop');
    await lane.drain();

    await say(c, 'sorry, who is this?');
    const byHand = await lane.queue(c.conversationId, 'This is Acme HR.', { userId: await agent() });
    const viaCampaign = await lane.queue(c.conversationId, 'campaign', { campaignId: await campaign() });
    const viaAi = await lane.queue(c.conversationId, 'ai', { sentBy: 'agent' });
    await lane.drain();

    expect(lane.sentBodies().slice(1)).toEqual(['This is Acme HR.']);
    expect((await lane.row(byHand)).status).toBe('sent');
    expect(await lane.row(viaCampaign)).toMatchObject({ status: 'failed', code: 'do_not_contact' });
    expect(await lane.row(viaAi)).toMatchObject({ status: 'failed', code: 'do_not_contact' });
    expect((await contactRow(c.contactId)).dnc).toBe(true);
  });

  it('AC-6.5 a contact flagged by hand who has never written since is still refused, as before', async () => {
    const c = await lane.contact({ inbound: 'old' });
    await lane.db.execute(sql`UPDATE contact SET do_not_contact = true, dnc_reason = 'asked on the phone', dnc_at = now() WHERE id = ${c.contactId}`);
    const byHand = await lane.queue(c.conversationId, 'hello', { userId: await agent() });
    expect(await lane.drain()).toEqual([]);
    expect(await lane.row(byHand)).toMatchObject({ status: 'failed', code: 'do_not_contact' });
  });
});

describe('AC-6.6 lifting do-not-contact', () => {
  it('AC-6.6 a restart word from the contact lifts it', async () => {
    const c = await lane.contact({ inbound: 'old' });
    await say(c, 'stop');
    await lane.drain();
    const r = await say(c, 'START');
    expect(r.outcome).toBe('restarted');
    expect(await contactRow(c.contactId)).toMatchObject({ dnc: false, reason: null });
    const camp = await lane.queue(c.conversationId, 'campaign', { campaignId: await campaign() });
    await lane.drain();
    expect((await lane.row(camp)).status).toBe('sent');
  });

  it('AC-6.6 the org\'s own restart word works; other messages do not lift it', async () => {
    await settings({ restartWords: ['chalu'] });
    const c = await lane.contact({ inbound: 'old' });
    await say(c, 'stop');
    await say(c, 'ok thanks');
    expect((await contactRow(c.contactId)).dnc).toBe(true);
    expect((await say(c, 'Chalu')).outcome).toBe('restarted');
    expect((await contactRow(c.contactId)).dnc).toBe(false);
  });

  it('AC-6.6 a restart word does not lift a flag someone set for another reason', async () => {
    const c = await lane.contact({ inbound: 'old' });
    await lane.db.execute(sql`UPDATE contact SET do_not_contact = true, dnc_reason = 'legal hold', dnc_at = now() WHERE id = ${c.contactId}`);
    expect((await say(c, 'start')).outcome).toBe('none');
    expect((await contactRow(c.contactId)).dnc).toBe(true);
  });

  it('AC-6.3 after the contact restarts and stops again, that is a new opt-out with its own closing message', async () => {
    const c = await lane.contact({ inbound: 'old' });
    await say(c, 'stop');
    await lane.drain();
    await say(c, 'start');
    await say(c, 'stop');
    await lane.drain();
    expect((await outbound(c.conversationId)).filter((m) => m.sentBy === 'system')).toHaveLength(2);
  });
});

describe('AC-6.7 switching the closing message off', () => {
  it('AC-6.7 is on unless the org switches it off', async () => {
    const c = await lane.contact({ inbound: 'old' });
    await say(c, 'stop');
    expect(await outbound(c.conversationId)).toHaveLength(1);
  });

  it('AC-6.7 off: no closing message, but the contact is still on do-not-contact', async () => {
    await settings({ closing: false });
    const c = await lane.contact({ inbound: 'old' });
    const r = await say(c, 'stop');
    expect(r.outcome).toBe('opted_out');
    expect(r.closingMessageId).toBeNull();
    expect(await outbound(c.conversationId)).toEqual([]);
    expect((await contactRow(c.contactId)).dnc).toBe(true);
  });
});

describe('AC-6.8 an agent marks a reply as opt-out by hand', () => {
  it('AC-6.8 has the same effect: closing message, then do-not-contact', async () => {
    await settings({ contactEmail: 'hr@acme.test', defaultPurpose: 'you asked us about jobs' });
    const c = await lane.contact({ inbound: 'old' });
    const r = await markOptOut(lane.db, kms, { orgId: lane.orgId, conversationId: c.conversationId });
    expect(r.alreadyOptedOut).toBe(false);
    expect(r.closingMessageId).not.toBeNull();
    expect(await contactRow(c.contactId)).toMatchObject({ dnc: true, reason: 'opt_out' });

    const order = await lane.drain();
    expect(order).toHaveLength(1);
    expect(order[0]).toContain('hr@acme.test');
  });

  it('AC-6.8 marking someone already opted out sends nothing more', async () => {
    const c = await lane.contact({ inbound: 'old' });
    await markOptOut(lane.db, kms, { orgId: lane.orgId, conversationId: c.conversationId });
    const again = await markOptOut(lane.db, kms, { orgId: lane.orgId, conversationId: c.conversationId });
    expect(again).toMatchObject({ alreadyOptedOut: true, closingMessageId: null });
    expect(await outbound(c.conversationId)).toHaveLength(1);
  });
});
