import { describe, expect, it } from 'vitest';
import type { LlmDriver, LlmResponse } from '@crm/llm';
import { buildClosingMessage, looksNegative, matchesRestartWord, matchesStopWord } from './optout.js';

const answering = (text: string): LlmDriver & { calls: number } => {
  const d = {
    name: 'fake', calls: 0,
    complete(): Promise<LlmResponse> {
      d.calls += 1;
      return Promise.resolve({ text, toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, model: 'fake' });
    }
  };
  return d;
};
const failing: LlmDriver = { name: 'fake', complete: () => Promise.reject(new Error('model down')) };
const none: LlmDriver & { calls: number } = { name: 'none', calls: 0, complete: () => { none.calls += 1; return Promise.reject(new Error('disabled')); } };

describe('AC-6.1 opt-out intent', () => {
  it('AC-6.1 the built-in STOP words match the whole message, whatever the case, spacing or punctuation', () => {
    for (const word of ['stop', 'STOP', ' Stop. ', 'unsubscribe', 'Unsubscribe!', 'opt out', 'OPT  OUT']) expect(matchesStopWord(word, [])).toBe(true);
  });

  it('AC-6.1 a STOP word inside an ordinary sentence is not an opt-out', () => {
    for (const text of ['where is the bus stop', 'please do not stop now', 'I want to start']) expect(matchesStopWord(text, [])).toBe(false);
  });

  it('AC-6.1 the org\'s own list adds words', () => {
    expect(matchesStopWord('band karo', [])).toBe(false);
    expect(matchesStopWord('Band Karo', ['band karo'])).toBe(true);
  });

  it('AC-6.6 start, and the org\'s own words, are restart words', () => {
    expect(matchesRestartWord('START', [])).toBe(true);
    expect(matchesRestartWord('chalu', [])).toBe(false);
    expect(matchesRestartWord('Chalu', ['chalu'])).toBe(true);
    expect(matchesRestartWord('please start the course', [])).toBe(false);
  });

  it('AC-6.1 the classifier says negative for who-is-this, don\'t-message-me and abuse', async () => {
    expect(await looksNegative(answering('NEGATIVE'), 'who is this? do not message me again')).toBe(true);
    expect(await looksNegative(answering('negative.'), 'you people are scammers')).toBe(true);
  });

  it('AC-6.1 an ordinary message is not negative', async () => {
    expect(await looksNegative(answering('OK'), 'what time is the interview?')).toBe(false);
  });

  it('AC-6.1 with no AI configured, only keywords count: the model is never called', async () => {
    expect(await looksNegative(none, 'leave me alone')).toBe(false);
    expect(none.calls).toBe(0);
    expect(await looksNegative(undefined, 'leave me alone')).toBe(false);
  });

  it('AC-6.1 a model that fails is not an opt-out: nothing is guessed', async () => {
    expect(await looksNegative(failing, 'leave me alone')).toBe(false);
  });
});

describe('AC-6.2 the closing message', () => {
  const full = { purpose: 'you applied for a job with Acme', summary: 'Interview on Monday at 10am. Bring your ID.', phone: '+91 98765 43210', email: 'hr@acme.test' };

  it('AC-6.2 says why they were messaged, a one-line summary, and the org\'s number and email', () => {
    const text = buildClosingMessage(full);
    expect(text).toContain('you applied for a job with Acme');
    expect(text).toContain('Interview on Monday at 10am. Bring your ID.');
    expect(text).toContain('+91 98765 43210');
    expect(text).toContain('hr@acme.test');
    expect(text.split('\n').filter((l) => l.trim() !== '').length).toBeGreaterThan(1);
  });

  it('AC-6.2 is plain text with no link, even when the summary or purpose carried one', () => {
    const text = buildClosingMessage({ ...full, purpose: 'you joined at https://acme.test/join', summary: 'Details at www.acme.test/jobs and http://x.test' });
    expect(text).not.toMatch(/https?:|www\./i);
  });

  it('AC-6.7 a missing contact number leaves that line out; the email stays', () => {
    const text = buildClosingMessage({ ...full, phone: null });
    expect(text).not.toContain('+91');
    expect(text).toContain('hr@acme.test');
    expect(text).not.toContain('null');
  });

  it('AC-6.7 a missing email leaves that line out; the number stays', () => {
    const text = buildClosingMessage({ ...full, email: null });
    expect(text).toContain('+91 98765 43210');
    expect(text).not.toContain('@');
  });

  it('AC-6.7 with neither, no line about reaching the org is written', () => {
    const text = buildClosingMessage({ ...full, phone: null, email: null });
    expect(text).not.toMatch(/call|email|reach|contact us/i);
    expect(text.trim().length).toBeGreaterThan(0);
  });

  it('AC-6.2 with no purpose and no summary, it still says the person will not be messaged again', () => {
    const text = buildClosingMessage({ purpose: null, summary: null, phone: null, email: null });
    expect(text.toLowerCase()).toContain('not message you again');
  });

  it('AC-6.2 the summary is one line, shortened', () => {
    const text = buildClosingMessage({ ...full, summary: 'x'.repeat(500) + '\nsecond line' });
    expect(text).not.toContain('second line');
    expect(text.length).toBeLessThan(600);
  });
});
