import { describe, expect, it } from 'vitest';
import { AnthropicLlm, LlmError, NoneLlm, OpenAiCompatibleLlm, createLlm } from './index.js';

/** A fake fetch that records the request and answers with canned JSON. */
function fakeFetch(answer: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(JSON.stringify(answer), { status }));
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const ask = { system: 'You are the shop assistant.', messages: [{ role: 'user' as const, content: 'hi' }] };

describe('NoneLlm', () => {
  it('refuses every call as disabled', async () => {
    await expect(new NoneLlm().complete()).rejects.toMatchObject({ code: 'disabled' });
  });
});

describe('OpenAiCompatibleLlm', () => {
  const base = { baseUrl: 'https://example.test/v1/', apiKey: 'k', model: 'm1', timeoutMs: 1000 };

  it('sends the system text separately from the customer turns, with the key', async () => {
    const f = fakeFetch({ model: 'm1', choices: [{ message: { content: ' hello ' } }], usage: { prompt_tokens: 5, completion_tokens: 2 } });
    const out = await new OpenAiCompatibleLlm({ ...base, fetch: f.impl }).complete(ask);
    expect(out).toMatchObject({ text: 'hello', toolCalls: [], usage: { inputTokens: 5, outputTokens: 2 }, model: 'm1' });
    expect(f.calls[0]?.url).toBe('https://example.test/v1/chat/completions');
    const sent = JSON.parse(f.calls[0]?.init.body as string) as { messages: { role: string; content: string }[] };
    expect(sent.messages).toEqual([{ role: 'system', content: ask.system }, { role: 'user', content: 'hi' }]);
    expect((f.calls[0]?.init.headers as Record<string, string>).authorization).toBe('Bearer k');
  });

  it('sends no auth header when there is no key (a local server)', async () => {
    const f = fakeFetch({ choices: [{ message: { content: 'x' } }] });
    await new OpenAiCompatibleLlm({ ...base, apiKey: '', fetch: f.impl }).complete(ask);
    expect((f.calls[0]?.init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('parses tool calls and their JSON arguments', async () => {
    const f = fakeFetch({ choices: [{ message: { content: null, tool_calls: [{ function: { name: 'send_message', arguments: '{"text":"yo"}' } }] } }] });
    const out = await new OpenAiCompatibleLlm({ ...base, fetch: f.impl }).complete({
      ...ask, tools: [{ name: 'send_message', description: 'd', parameters: { type: 'object' } }]
    });
    expect(out.toolCalls).toEqual([{ name: 'send_message', arguments: { text: 'yo' } }]);
    expect(out.text).toBe('');
  });

  it('rejects tool arguments that are not a JSON object', async () => {
    const f = fakeFetch({ choices: [{ message: { tool_calls: [{ function: { name: 't', arguments: 'nope' } }] } }] });
    await expect(new OpenAiCompatibleLlm({ ...base, fetch: f.impl }).complete(ask)).rejects.toMatchObject({ code: 'bad_response' });
  });

  it('turns a non-2xx into an http error carrying the status', async () => {
    const f = fakeFetch({ error: 'quota' }, 429);
    await expect(new OpenAiCompatibleLlm({ ...base, fetch: f.impl }).complete(ask)).rejects.toMatchObject({ code: 'http', statusCode: 429 });
  });

  it('turns a hung call into a timeout', async () => {
    const hang = ((_u: string, init: RequestInit) => new Promise((_r, rej) => {
      init.signal?.addEventListener('abort', () => { rej(init.signal?.reason); });
    })) as unknown as typeof fetch;
    await expect(new OpenAiCompatibleLlm({ ...base, timeoutMs: 20, fetch: hang }).complete(ask)).rejects.toMatchObject({ code: 'timeout' });
  });

  it('treats an answer with no choices as unusable', async () => {
    const f = fakeFetch({});
    await expect(new OpenAiCompatibleLlm({ ...base, fetch: f.impl }).complete(ask)).rejects.toBeInstanceOf(LlmError);
  });
});

describe('AnthropicLlm', () => {
  it('uses the native format: system on its own, key in x-api-key, text and tool blocks parsed', async () => {
    const f = fakeFetch({
      model: 'c1', content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', name: 'create_campaign', input: { body: 'b' } }],
      usage: { input_tokens: 7, output_tokens: 3 }
    });
    const out = await new AnthropicLlm({ apiKey: 'sk', model: 'c1', timeoutMs: 1000, fetch: f.impl }).complete(ask);
    expect(out).toMatchObject({ text: 'ok', toolCalls: [{ name: 'create_campaign', arguments: { body: 'b' } }], usage: { inputTokens: 7, outputTokens: 3 } });
    expect(f.calls[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    const sent = JSON.parse(f.calls[0]?.init.body as string) as { system: string; max_tokens: number; messages: unknown[] };
    expect(sent).toMatchObject({ system: ask.system, max_tokens: 1024, messages: [{ role: 'user', content: 'hi' }] });
    expect((f.calls[0]?.init.headers as Record<string, string>)['x-api-key']).toBe('sk');
  });
});

describe('createLlm', () => {
  const t = 1000;
  it('builds none by default', () => {
    expect(createLlm({ LLM_DRIVER: 'none', LLM_TIMEOUT_MS: t }).name).toBe('none');
  });
  it('builds the OpenAI-format driver for gemini, openai, ollama and compatible', () => {
    for (const d of ['gemini', 'openai'] as const) {
      expect(createLlm({ LLM_DRIVER: d, LLM_MODEL: 'm', LLM_API_KEY: 'k', LLM_TIMEOUT_MS: t }).name).toBe('openai-compatible');
    }
    expect(createLlm({ LLM_DRIVER: 'ollama', LLM_MODEL: 'm', LLM_TIMEOUT_MS: t }).name).toBe('openai-compatible');
    expect(createLlm({ LLM_DRIVER: 'compatible', LLM_MODEL: 'm', LLM_API_KEY: 'k', LLM_BASE_URL: 'https://x.test/v1', LLM_TIMEOUT_MS: t }).name).toBe('openai-compatible');
  });
  it('builds the native driver for anthropic', () => {
    expect(createLlm({ LLM_DRIVER: 'anthropic', LLM_MODEL: 'm', LLM_API_KEY: 'k', LLM_TIMEOUT_MS: t }).name).toBe('anthropic');
  });
  it('refuses to start without a model, a key (hosted), or a base URL (compatible)', () => {
    expect(() => createLlm({ LLM_DRIVER: 'gemini', LLM_API_KEY: 'k', LLM_TIMEOUT_MS: t })).toThrow(/LLM_MODEL/);
    expect(() => createLlm({ LLM_DRIVER: 'gemini', LLM_MODEL: 'm', LLM_TIMEOUT_MS: t })).toThrow(/LLM_API_KEY/);
    expect(() => createLlm({ LLM_DRIVER: 'compatible', LLM_MODEL: 'm', LLM_API_KEY: 'k', LLM_TIMEOUT_MS: t })).toThrow(/LLM_BASE_URL/);
  });
});
