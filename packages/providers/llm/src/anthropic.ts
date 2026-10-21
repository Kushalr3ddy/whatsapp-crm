import { LlmError, type LlmDriver, type LlmRequest, type LlmResponse, type LlmToolCall } from './index.js';
import { parseArgs, postJson } from './http.js';

/** What the Anthropic driver needs. */
export interface AnthropicOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs: number;
  /** Defaults to Anthropic's own API. */
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
}

/** Anthropic's native Messages API. */
export class AnthropicLlm implements LlmDriver {
  readonly name = 'anthropic';

  /** Builds the driver; nothing is sent until `complete` is called. */
  constructor(private readonly o: AnthropicOptions) {}

  /** One model turn through the Messages API. Throws `LlmError` on any failure. */
  async complete(req: LlmRequest): Promise<LlmResponse> {
    const body = {
      model: this.o.model,
      system: req.system,
      // The API requires a ceiling; 1024 is plenty for a chat reply and callers can raise it.
      max_tokens: req.maxTokens ?? 1024,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.tools !== undefined && req.tools.length > 0
        ? { tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) }
        : {})
    };
    const json = await postJson(
      `${(this.o.baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '')}/v1/messages`,
      { 'x-api-key': this.o.apiKey, 'anthropic-version': '2023-06-01' },
      body, this.o.timeoutMs, this.o.fetch ?? fetch
    ) as {
      model?: string;
      content?: { type?: string; text?: string; name?: string; input?: unknown }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    if (!Array.isArray(json.content)) throw new LlmError('bad_response', 'model answer had no content');
    const toolCalls: LlmToolCall[] = json.content
      .filter((b) => b.type === 'tool_use')
      .map((b) => {
        const name = b.name ?? '';
        if (name === '') throw new LlmError('bad_response', 'a tool call had no name');
        return { name, arguments: parseArgs(b.input, name) };
      });
    return {
      text: json.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim(),
      toolCalls,
      usage: { inputTokens: json.usage?.input_tokens ?? 0, outputTokens: json.usage?.output_tokens ?? 0 },
      model: json.model ?? this.o.model
    };
  }
}
