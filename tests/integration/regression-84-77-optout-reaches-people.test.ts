import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { LlmDriver } from '@crm/llm';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import { addUserToOrg, markOptOut, storeInboundMessage } from '@crm/core';
import { applyInboundEffects } from '../../apps/gateway/src/work.js';
import { kms, makeLane, type Lane } from './antiban-v2-harness.js';

/**
 * #84, #77 (found 2026-11-09 by the live run and the screen check, LF-18 and SC-1). An opt-out was recorded on the contact and nowhere else, so
 * what came after it fell on nothing: a person who opted out and then wrote "I want to talk to a real human" met silence (the AI is blocked for
 * them and nobody was told), and the campaign page went on showing them as "Needs a person" with the AI's old note.
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


const notesOf = async (conversationId: string): Promise<string[]> => ((await lane.db.execute(sql`
  SELECT body FROM internal_note WHERE conversation_id = ${conversationId} ORDER BY created_at`)) as unknown as Array<{ body: string }>).map((r) => r.body);
const recipient = async (campaignId: string, contactId: string) => lane.one<{ status: string | null; summary: string | null }>(sql`
  SELECT ai_status AS status, ai_summary AS summary FROM campaign_recipient WHERE campaign_id = ${campaignId} AND contact_id = ${contactId}`);
/** A person the AI has been talking to in a campaign, with its note for the team. */
async function talkingTo(status: 'talking' | 'needs_person' | 'interested' = 'needs_person') {
  await settings({});
  const c = await lane.contact({ inbound: true });
  const camp = await campaign('your interview');
  await lane.db.execute(sql`
    INSERT INTO campaign_recipient (org_id, campaign_id, contact_id, status, ai_status, ai_summary)
    VALUES (${lane.orgId}, ${camp}, ${c.contactId}, 'sent', ${status}, 'wants to know the venue')`);
  return { c, camp };
}

describe('[R-054] [#84] a person who opted out and writes again is read by a person, not met with silence', () => {
  it('[#84] "I want to talk to a real human" after STOP takes the chat off the AI and leaves one note for the team', async () => {
    const { c } = await talkingTo();
    const botId = await agent();
    await lane.db.execute(sql`INSERT INTO ai_setting (org_id, bot_user_id) VALUES (${lane.orgId}, ${botId}) ON CONFLICT (org_id) DO UPDATE SET bot_user_id = ${botId}`);
    await lane.db.execute(sql`UPDATE conversation SET assignee_user_id = ${botId} WHERE id = ${c.conversationId}`);
    expect((await say(c, 'STOP')).outcome).toBe('opted_out');
    const r = await say(c, 'I want to talk to a real human');
    expect(r.outcome).toBe('review');
    const owner = await lane.one<{ a: string | null }>(sql`SELECT assignee_user_id AS a FROM conversation WHERE id = ${c.conversationId}`);
    expect(owner.a, 'the AI no longer owns the chat').toBeNull();
    const notes = await notesOf(c.conversationId);
    expect(notes.filter((n) => n.startsWith('This person opted out earlier'))).toHaveLength(1);
    expect(notes.join(' ')).toContain('talk to a real human');
    // Still opted out, still no automatic message: a person decides.
    expect((await contactRow(c.contactId)).dnc).toBe(true);
    expect((await outbound(c.conversationId)).filter((m) => !m.override)).toEqual([]);
  });

  it('[#84] five more messages are one note, not five', async () => {
    const { c } = await talkingTo();
    await say(c, 'STOP');
    for (const word of ['hello?', 'anyone there', 'please call me', 'real human please', 'urgent']) await say(c, word);
    expect((await notesOf(c.conversationId)).filter((n) => n.startsWith('This person opted out earlier'))).toHaveLength(1);
  });

  it('[#84] a second STOP, and START, are not "wrote again": no note, and START lifts the opt-out', async () => {
    const { c } = await talkingTo();
    await settings({ restartWords: ['START'] });
    await say(c, 'STOP');
    expect((await say(c, 'stop')).outcome).toBe('none');
    expect(await notesOf(c.conversationId)).toEqual([]);
    expect((await say(c, 'START')).outcome).toBe('restarted');
    expect((await contactRow(c.contactId)).dnc).toBe(false);
  });

  it('[#84] a person who did not opt out is untouched: a plain message leaves no opt-out note', async () => {
    const { c } = await talkingTo('talking');
    expect((await say(c, 'what time?')).outcome).toBe('none');
    expect(await notesOf(c.conversationId)).toEqual([]);
  });
});

describe('[R-054] [#77] the campaign page follows an opt-out', () => {
  it('[#77] someone shown as "Needs a person" or "Talking" or "Interested" becomes "Not interested", with a note that says why', async () => {
    for (const status of ['needs_person', 'talking', 'interested'] as const) {
      const { c, camp } = await talkingTo(status);
      await say(c, 'STOP');
      const r = await recipient(camp, c.contactId);
      expect(r.status, status).toBe('not_interested');
      expect(r.summary).toMatch(/Asked to stop/);
    }
  });

  it('[#77] a recipient the AI never spoke to is left as it was, and so is an agent marking an opt-out by hand', async () => {
    await settings({});
    const quiet = await lane.contact({ inbound: true });
    const camp = await campaign();
    await lane.db.execute(sql`INSERT INTO campaign_recipient (org_id, campaign_id, contact_id, status) VALUES (${lane.orgId}, ${camp}, ${quiet.contactId}, 'sent')`);
    await say(quiet, 'STOP');
    expect((await recipient(camp, quiet.contactId)).status).toBeNull();

    const { c, camp: camp2 } = await talkingTo();
    await markOptOut(lane.db, kms, { orgId: lane.orgId, conversationId: c.conversationId });
    expect((await recipient(camp2, c.contactId)).status).toBe('not_interested');
  });

  it('[#77] START brings them back to "Talking" and removes the stop note', async () => {
    const { c, camp } = await talkingTo();
    await settings({ restartWords: ['START'] });
    await say(c, 'STOP');
    await say(c, 'START');
    const r = await recipient(camp, c.contactId);
    expect(r.status).toBe('talking');
    expect(r.summary).toBeNull();
  });
});
