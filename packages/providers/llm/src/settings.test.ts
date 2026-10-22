import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LiveLlm, LlmError, assertSafeBaseUrl, isPrivateAddress, listModels, parseLlmEnv, probeLlm, providerFor, readLlmEnv, writeLlmEnv, PROVIDERS, type LlmDriver, type LlmRequest } from './index.js';

const base = { LLM_DRIVER: 'none', LLM_TIMEOUT_MS: 20000 } as const;
const tmp = (): string => mkdtempSync(join(tmpdir(), 'llm-'));

describe('the env file', () => {
  it('changes only the LLM lines and leaves every other byte alone, including the encryption key', async () => {
    const file = join(tmp(), '.env');
    writeFileSync(file, '# my settings\nENCRYPTION_KEY=abc123\nLLM_MODEL=old\n\nOTHER=1', { mode: 0o640 });   // note: no final newline
    await writeLlmEnv(file, { LLM_DRIVER: 'compatible', LLM_MODEL: 'openai/gpt-oss-20b', LLM_API_KEY: 'sk-secret-1234' });
    const text = readFileSync(file, 'utf8');
    expect(text).toBe('# my settings\nENCRYPTION_KEY=abc123\nLLM_MODEL=openai/gpt-oss-20b\n\nOTHER=1\nLLM_DRIVER=compatible\nLLM_API_KEY=sk-secret-1234\n');
    expect(statSync(file).mode & 0o777).toBe(0o640);                       // permissions kept
    expect(await readLlmEnv(file)).toMatchObject({ LLM_DRIVER: 'compatible', LLM_MODEL: 'openai/gpt-oss-20b' });
  });

  it('makes a dated backup first, keeps only the newest three, and removes a line when its value is undefined', async () => {
    const dir = tmp(); const file = join(dir, '.env');
    writeFileSync(file, 'LLM_API_KEY=k\nKEEP=1\n');
    await writeLlmEnv(file, { LLM_API_KEY: undefined });
    expect(readFileSync(file, 'utf8')).toBe('KEEP=1\n');
    expect(readdirSync(dir).filter((f) => f.startsWith('.env.bak-')).length).toBe(1);
    for (let i = 0; i < 5; i++) { await new Promise((r) => setTimeout(r, 1100)); await writeLlmEnv(file, { LLM_MODEL: `m${String(i)}` }); }
    expect(readdirSync(dir).filter((f) => f.startsWith('.env.bak-')).length).toBe(3);
  }, 20000);

  it('creates a private file when there is none, and refuses a value with a line break or a key it does not own', async () => {
    const file = join(tmp(), 'llm.env');
    await writeLlmEnv(file, { LLM_DRIVER: 'ollama' });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    await expect(writeLlmEnv(file, { LLM_MODEL: 'a\nENCRYPTION_KEY=evil' })).rejects.toThrow(/line break/);
    await expect(writeLlmEnv(file, { ENCRYPTION_KEY: 'x' } as never)).rejects.toThrow(/not a setting/);
  });

  it('reads quoted values and ignores comments and other keys', () => {
    expect(parseLlmEnv('# LLM_MODEL=no\nLLM_MODEL="gemini-x"\nLLM_API_KEY=\nFOO=bar\r\nLLM_DRIVER=gemini\r\n')).toEqual({ LLM_MODEL: 'gemini-x', LLM_DRIVER: 'gemini' });
  });
});

describe('following the file', () => {
  const fake = (name: string): LlmDriver => ({ name, complete: (_r: LlmRequest) => Promise.reject(new LlmError('disabled', 'x')) });
  void fake;

  it('uses the process settings until the file names a driver, then the file, with no restart', async () => {
    const file = join(tmp(), 'llm.env');
    const live = new LiveLlm({ envFile: file, base });
    expect(live.name).toBe('none');
    expect(live.status().source).toBe('environment');

    await writeLlmEnv(file, { LLM_DRIVER: 'openai', LLM_MODEL: 'gpt-x', LLM_API_KEY: 'sk-abcdefgh1234' });
    expect(live.name).toBe('openai-compatible');
    expect(live.status()).toMatchObject({ driver: 'openai', model: 'gpt-x', keyLast4: '1234', source: 'file' });
    expect(JSON.stringify(live.status())).not.toContain('sk-abcdefgh');       // the key is never part of the status

    await writeLlmEnv(file, { LLM_DRIVER: 'none' });
    expect(live.name).toBe('none');
  });

  it('leaves the AI off, instead of crashing, when the file is half set', async () => {
    const file = join(tmp(), 'llm.env');
    const errors: string[] = [];
    const live = new LiveLlm({ envFile: file, base, onError: (m) => errors.push(m) });
    await writeLlmEnv(file, { LLM_DRIVER: 'openai' });                          // no model, no key
    expect(live.name).toBe('none');
    expect(errors[0]).toMatch(/needs LLM_MODEL/);
  });

  it('notices a change made by another process (the file time moves)', async () => {
    const file = join(tmp(), 'llm.env');
    writeFileSync(file, 'LLM_DRIVER=ollama\nLLM_MODEL=a\n');
    const live = new LiveLlm({ envFile: file, base });
    expect(live.status().model).toBe('a');
    writeFileSync(file, 'LLM_DRIVER=ollama\nLLM_MODEL=b\n');
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    expect(live.status().model).toBe('b');
  });
});

describe('the address guard', () => {
  it('knows private addresses', () => {
    for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) expect(isPrivateAddress(a), a).toBe(true);
    for (const a of ['8.8.8.8', '172.32.0.1', '1.1.1.1', '2606:4700:4700::1111']) expect(isPrivateAddress(a), a).toBe(false);
  });

  it('refuses http, credentials in the address, and private networks, but lets Ollama use localhost', async () => {
    await expect(assertSafeBaseUrl('http://api.example.com/v1', { ollama: false, allowPrivate: false })).rejects.toThrow(/https/);
    await expect(assertSafeBaseUrl('https://user:pw@api.example.com/v1', { ollama: false, allowPrivate: false })).rejects.toThrow(/user name/);
    await expect(assertSafeBaseUrl('https://127.0.0.1/v1', { ollama: false, allowPrivate: false })).rejects.toThrow(/private network/);
    await expect(assertSafeBaseUrl('https://169.254.169.254/latest', { ollama: false, allowPrivate: false })).rejects.toThrow(/private network/);
    await expect(assertSafeBaseUrl('not a url', { ollama: false, allowPrivate: false })).rejects.toThrow(/web address/);
    await expect(assertSafeBaseUrl('http://localhost:11434/v1', { ollama: true, allowPrivate: false })).resolves.toBeUndefined();
    await expect(assertSafeBaseUrl('http://localhost:11434/v1', { ollama: false, allowPrivate: false })).rejects.toThrow(/https/);
    await expect(assertSafeBaseUrl('http://10.0.0.5/v1', { ollama: false, allowPrivate: true })).resolves.toBeUndefined();
  });
});

describe('providers, model lists and the test', () => {
  const groq = PROVIDERS.find((p) => p.id === 'groq')!;
  const answer = (body: unknown, status = 200): typeof fetch => (() => Promise.resolve(new Response(JSON.stringify(body), { status }))) as typeof fetch;

  it('recognises a saved configuration as its provider', () => {
    expect(providerFor('compatible', 'https://api.groq.com/openai/v1')?.id).toBe('groq');
    expect(providerFor('compatible', 'https://openrouter.ai/api/v1')?.id).toBe('openrouter');
    expect(providerFor('compatible', 'https://example.org/v1')?.id).toBe('custom');
    expect(providerFor('gemini', undefined)?.id).toBe('gemini');
    expect(providerFor('none', undefined)).toBeUndefined();
  });

  it('lists models, sorted, with the provider\'s extra detail, and reads a refusal as a refusal', async () => {
    const models = await listModels({ preset: groq, baseUrl: groq.baseUrl!, apiKey: 'k', fetch: answer({ data: [{ id: 'models/zeta' }, { id: 'alpha', name: 'Alpha', context_length: 128000 }, { nope: 1 }] }) });
    expect(models).toEqual([{ id: 'alpha', name: 'Alpha', contextLength: 128000 }, { id: 'zeta' }]);
    await expect(listModels({ preset: groq, baseUrl: groq.baseUrl!, apiKey: 'bad', fetch: answer({}, 401) })).rejects.toMatchObject({ statusCode: 401 });
  });

  const driver = (calls: { text: string; tool?: boolean }[]): LlmDriver => {
    let i = 0;
    return { name: 'fake', complete: () => { const c = calls[i++]!; return Promise.resolve({ text: c.text, toolCalls: c.tool ? [{ name: 'ping', arguments: { note: 'ok' } }] : [], usage: { inputTokens: 1, outputTokens: 1 }, model: 'm' }); } };
  };
  const cfg = { LLM_DRIVER: 'openai', LLM_MODEL: 'm', LLM_API_KEY: 'k', LLM_TIMEOUT_MS: 20000 } as const;

  it('reports a model that answers and calls a function as fully usable', async () => {
    const r = await probeLlm(cfg, { driver: driver([{ text: 'OK' }, { text: '', tool: true }]) });
    expect(r).toMatchObject({ usable: true, toolCalling: true, problem: null });
  });

  it('says plainly when a model answers but cannot call a function', async () => {
    const r = await probeLlm(cfg, { driver: driver([{ text: 'OK' }, { text: 'sure' }]) });
    expect(r.usable).toBe(true); expect(r.toolCalling).toBe(false);
    expect(r.notes[0]).toMatch(/did not call a function/);
  });

  it('explains a refused key, a missing model, and a rate limit in words, never with the key', async () => {
    for (const [status, words] of [[401, /refused the key/], [404, /does not know that model/], [429, /rate limiting/]] as const) {
      const failing: LlmDriver = { name: 'fake', complete: () => Promise.reject(new LlmError('http', 'model call returned', status)) };
      const r = await probeLlm({ ...cfg, LLM_API_KEY: 'sk-super-secret' }, { driver: failing });
      expect(r.usable).toBe(false);
      expect(r.problem).toMatch(words);
      expect(JSON.stringify(r)).not.toContain('sk-super-secret');
    }
  });

  it('reports incomplete settings instead of throwing', async () => {
    const r = await probeLlm({ LLM_DRIVER: 'openai', LLM_TIMEOUT_MS: 20000 });
    expect(r.usable).toBe(false);
    expect(r.problem).toMatch(/needs LLM_MODEL/);
  });
});
