import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { BuiltinPasswordHasher } from '@crm/auth-builtin';
import type { LlmDriver, LlmRequest, LlmResponse } from '@crm/llm';
import { createOrgWithAdmin, rewriteKnowledge, saveAiSettings } from '@crm/core';
import { droppedLines } from '../../packages/core/src/ai-example.js';

/**
 * [#95] (2026-11-09, found by: live run, LF-3). "Rewrite with my choices" tidied the owner's text and the model silently dropped lines the owner
 * had written as rules ("Never share the salary", "Never mention internal notes") and the answer to a question the AI itself asks. The rewrite
 * was only checked for values it must hide, never for what it must keep. Now the lines that are rules or answers are checked against the result;
 * the model is asked once more with the missing lines named, and anything still missing is put back as the owner wrote it.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5434/whatsapp_crm_test';
const hasher = new BuiltinPasswordHasher();

class ScriptedLlm implements LlmDriver {
  readonly name = 'fake';
  calls: LlmRequest[] = [];
  constructor(private readonly answers: string[]) {}
  complete(req: LlmRequest): Promise<LlmResponse> {
    this.calls.push(req);
    return Promise.resolve({ text: this.answers[Math.min(this.calls.length - 1, this.answers.length - 1)]!, toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, model: 'fake' });
  }
}

const KNOWLEDGE = [
  'Role: welding helper in Pune.',
  'Never share the salary figure with anyone before the interview.',
  'Never mention internal notes or past applications.',
  'Q: What documents should they bring?',
  'A: Only the original certificate and a passport photo.',
  'Shift: 9 to 6, Monday to Saturday.'
].join('\n');

describe('[R-058] [#95] which owner lines went missing', () => {
  it('[#95] a rewrite that kept the rules and the answer drops nothing', () => {
    const rewritten = '- Role: welding helper in Pune\n- Never share the salary figure before the interview\n- Never mention internal notes or past applications\n- Bring the original certificate and a passport photo\n- Shift 9 to 6, Monday to Saturday';
    expect(droppedLines(KNOWLEDGE, rewritten)).toEqual([]);
  });
  it('[#95] a rewrite that lost both rules and the answer names exactly those lines', () => {
    const rewritten = '- Role: welding helper in Pune\n- Shift 9 to 6, Monday to Saturday';
    expect(droppedLines(KNOWLEDGE, rewritten)).toEqual([
      'Never share the salary figure with anyone before the interview.',
      'Never mention internal notes or past applications.',
      'Only the original certificate and a passport photo.'
    ]);
  });
  it('[#95] ordinary facts that are not rules or answers are not required to stay word for word', () => {
    expect(droppedLines('Shift: 9 to 6, Monday to Saturday.\nRole: welding helper in Pune.', '- Welding helper')).toEqual([]);
  });
});

describe('[R-058] [#95] rewriteKnowledge', () => {
  let db: Database;
  let orgId: string;
  beforeAll(() => { db = createDatabase(url, { max: 4 }); });
  afterAll(async () => { await db.$client.end(); });
  beforeEach(async () => {
    await db.execute(sql`DELETE FROM org`);
    await db.execute(sql`DELETE FROM app_user`);
    const org = await createOrgWithAdmin(db, hasher, { orgName: 'Acme', slug: 'acme-95', email: 'a@acme95.test', password: 'x', displayName: 'Admin' });
    orgId = org.orgId;
    await saveAiSettings(db, orgId, { enabled: true, acceptConsent: true, instructions: 'x' }, { type: 'user', id: org.userId });
  });

  it('[#95] a clean rewrite is returned as it is, in one model call', async () => {
    const good = '- Welding helper in Pune\n- Never share the salary figure before the interview\n- Never mention internal notes or past applications\n- Bring the original certificate and a passport photo\n- Shift 9 to 6';
    const llm = new ScriptedLlm([good]);
    expect(await rewriteKnowledge({ db, llm }, orgId, { knowledge: KNOWLEDGE, sensitive: [] })).toBe(good);
    expect(llm.calls).toHaveLength(1);
  });

  it('[#95] a rewrite that drops the rules is sent back once with those lines named, and the corrected one is used', async () => {
    const bad = '- Welding helper in Pune\n- Shift 9 to 6';
    const good = '- Welding helper in Pune\n- Never share the salary figure before the interview\n- Never mention internal notes or past applications\n- Bring the original certificate and a passport photo\n- Shift 9 to 6';
    const llm = new ScriptedLlm([bad, good]);
    expect(await rewriteKnowledge({ db, llm }, orgId, { knowledge: KNOWLEDGE, sensitive: [] })).toBe(good);
    expect(llm.calls).toHaveLength(2);
    expect(JSON.stringify(llm.calls[1]!.messages)).toContain('Never share the salary figure');
  });

  it('[#95] a model that keeps dropping them does not get to: the lines are put back as the owner wrote them', async () => {
    const llm = new ScriptedLlm(['- Welding helper in Pune\n- Shift 9 to 6']);
    const out = await rewriteKnowledge({ db, llm }, orgId, { knowledge: KNOWLEDGE, sensitive: [] });
    expect(llm.calls).toHaveLength(2);
    expect(out).toContain('Kept as the owner wrote them');
    expect(out).toContain('- Never share the salary figure with anyone before the interview.');
    expect(out).toContain('- Never mention internal notes or past applications.');
    expect(out).toContain('- Only the original certificate and a passport photo.');
  });

  it('[#95] hiding a value still wins: an exact "keep general" value left in the text is still refused', async () => {
    const llm = new ScriptedLlm(['- Never share the salary figure before the interview\n- Never mention internal notes or past applications\n- Bring the original certificate and a passport photo\n- Pay is 25000']);
    await expect(rewriteKnowledge({ db, llm }, orgId, {
      knowledge: `${KNOWLEDGE}\nPay is 25000.`, sensitive: [{ detail: 'Pay: 25000', mode: 'general' }]
    })).rejects.toThrow(/25000/);
  });
});
