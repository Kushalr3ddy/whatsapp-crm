import { LlmError, type LlmDriver, type LlmRequest, type LlmResponse, type LlmToolCall } from './index.js';
import { parseArgs, postJson } from './http.js';

/** What the OpenAI-format driver needs. */
export interface OpenAiCompatibleOptions {
  /** Up to and including the version segment, e.g. `https://api.openai.com/v1`. No trailing slash needed. */
  readonly baseUrl: string;
  /** Empty for a local server that needs none (Ollama). */
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs: number;
  /** Injected so tests never touch the network. */
  readonly fetch?: typeof fetch;
}

/**
 * Any provider that speaks the OpenAI chat-completions format: OpenAI, Gemini (its OpenAI-compatible
 * endpoint), OpenRouter, Groq, Ollama, vLLM. Switching between them is a base URL, a key and a model name.
 */
export class OpenAiCompatibleLlm implements LlmDriver {
  readonly name = 'openai-compatible';

  /** Builds the driver; nothing is sent until `complete` is called. */
  constructor(private readonly o: OpenAiCompatibleOptions) {}

  /** One model turn through `/chat/completions`. Throws `LlmError` on any failure. */
  async complete(req: LlmRequest): Promise<LlmResponse> {
    const body = {
      model: this.o.model,
      messages: [{ role: 'system', content: req.system }, ...req.messages.map((m) => ({ role: m.role, content: m.content }))],
      ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.tools !== undefined && req.tools.length > 0
        ? { tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) }
        : {})
    };
    const json = await postJson(
      `${this.o.baseUrl.replace(/\/+$/, '')}/chat/completions`,
      this.o.apiKey === '' ? {} : { authorization: `Bearer ${this.o.apiKey}` },
      body, this.o.timeoutMs, this.o.fetch ?? fetch
    ) as {
      model?: string;
      choices?: { message?: { content?: string | null; tool_calls?: { function?: { name?: string; arguments?: unknown } }[] } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const message = json.choices?.[0]?.message;
    if (message === undefined) throw new LlmError('bad_response', 'model answer had no choices');
    const toolCalls: LlmToolCall[] = (message.tool_calls ?? []).map((c) => {
      const name = c.function?.name;
      if (name === undefined || name === '') throw new LlmError('bad_response', 'a tool call had no name');
      return { name, arguments: parseArgs(c.function?.arguments, name) };
    });
    return {
      text: (message.content ?? '').trim(),
      toolCalls,
      usage: { inputTokens: json.usage?.prompt_tokens ?? 0, outputTokens: json.usage?.completion_tokens ?? 0 },
      model: json.model ?? this.o.model
    };
  }
}
