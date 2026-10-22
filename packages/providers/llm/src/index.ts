/**
 * A language model, behind one port. Which provider answers is configuration, never code: Gemini,
 * OpenAI, OpenRouter, Ollama and anything else that speaks the OpenAI chat format share one driver, and
 * Anthropic has its own. Nothing outside packages/providers/llm may import a model SDK or call a model
 * endpoint directly (docs/06-features/F12-ai-agent.md).
 *
 * Text a customer wrote must only ever travel as a `user` message, never inside `system` (F12 AC-2): the
 * caller builds `system` from the organisation's own instructions and passes the conversation as messages.
 */
export interface LlmDriver {
  /** Which driver this is: `openai-compatible`, `anthropic`, or `none`. */
  readonly name: string;

  /** One model turn. Throws `LlmError` on a refusal, a timeout or an unusable answer; never returns a half answer. */
  complete(request: LlmRequest): Promise<LlmResponse>;
}

/** A turn in the conversation handed to the model. */
export interface LlmMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

/** A function the model may ask the caller to run. `parameters` is a JSON Schema object. */
export interface LlmTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

/** One request to the model. */
export interface LlmRequest {
  /** The organisation's own instructions. Never customer text. */
  readonly system: string;
  readonly messages: readonly LlmMessage[];
  /** When given, the model may answer with `toolCalls` instead of (or as well as) text. */
  readonly tools?: readonly LlmTool[];
  readonly maxTokens?: number;
  /** 0 = steady, higher = more varied. Left to the provider's default when unset. */
  readonly temperature?: number;
}

/** One function the model asked the caller to run. */
export interface LlmToolCall {
  readonly name: string;
  /** Already parsed; a call whose arguments were not valid JSON is an `LlmError`. */
  readonly arguments: Record<string, unknown>;
}

/** What came back from one model turn. */
export interface LlmResponse {
  /** The model's reply text; empty when it only asked for tools. */
  readonly text: string;
  readonly toolCalls: readonly LlmToolCall[];
  /** Recorded in the audit row so cost is visible per organisation (F12 AC-5, AC-7). */
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
  /** The model that actually answered, as the provider reports it. */
  readonly model: string;
}

/** Why a call failed, so the caller can decide: nothing is ever sent to a customer on any of these. */
export class LlmError extends Error {
  /** `code` says which kind of failure; `statusCode` is the provider's HTTP status when there was one. */
  constructor(
    readonly code: 'disabled' | 'timeout' | 'http' | 'bad_response',
    message: string,
    readonly statusCode?: number
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export { createLlm, defaultBaseUrl, type LlmConfig } from './factory.js';
export { NoneLlm } from './none.js';
export { OpenAiCompatibleLlm, type OpenAiCompatibleOptions } from './openai-compatible.js';
export { AnthropicLlm, type AnthropicOptions } from './anthropic.js';
export { LiveLlm, type LiveLlmStatus } from './live.js';
export { readLlmEnv, writeLlmEnv, parseLlmEnv, LLM_ENV_KEYS, type LlmEnvValues, type LlmEnvKey } from './env-file.js';
export { PROVIDERS, providerById, providerFor, type ProviderPreset } from './presets.js';
export { listModels, type ModelInfo, type ListModelsInput } from './models.js';
export { probeLlm, explainLlmError, problemKindOf, type ProbeResult, type ProblemKind } from './probe.js';
export { assertSafeBaseUrl, isPrivateAddress, UnsafeUrlError } from './url-guard.js';
