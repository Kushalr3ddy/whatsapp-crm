import type { LlmDriver } from './index.js';
import { NoneLlm } from './none.js';
import { OpenAiCompatibleLlm } from './openai-compatible.js';
import { AnthropicLlm } from './anthropic.js';

/** Only what choosing a model needs, so this does not depend on the whole config. */
export interface LlmConfig {
  readonly LLM_DRIVER: 'none' | 'ollama' | 'openai' | 'anthropic' | 'gemini' | 'compatible';
  readonly LLM_MODEL?: string | undefined;
  readonly LLM_API_KEY?: string | undefined;
  readonly LLM_BASE_URL?: string | undefined;
  readonly LLM_TIMEOUT_MS: number;
}

/** Where each OpenAI-format provider lives when LLM_BASE_URL is not set. */
const DEFAULT_BASE_URL = {
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  ollama: 'http://localhost:11434/v1'
} as const;

/**
 * Builds the configured language model.
 *
 * **This is the only place that knows which provider is in use.** `ollama`, `openai`, `gemini` and `compatible`
 * all build the same OpenAI-format driver (differing only in default address); `compatible` is for anything
 * else that speaks that format (OpenRouter, Groq, vLLM...) and needs LLM_BASE_URL. A model with no name, or a
 * hosted provider with no key, refuses to start rather than failing on the first customer message.
 */
export function createLlm(config: LlmConfig): LlmDriver {
  const driver = config.LLM_DRIVER;
  if (driver === 'none') return new NoneLlm();

  const model = config.LLM_MODEL ?? '';
  if (model === '') throw new Error(`LLM_DRIVER="${driver}" needs LLM_MODEL.`);
  const apiKey = config.LLM_API_KEY ?? '';
  if (driver !== 'ollama' && apiKey === '') throw new Error(`LLM_DRIVER="${driver}" needs LLM_API_KEY.`);

  if (driver === 'anthropic') {
    return new AnthropicLlm({ apiKey, model, timeoutMs: config.LLM_TIMEOUT_MS, ...(config.LLM_BASE_URL !== undefined ? { baseUrl: config.LLM_BASE_URL } : {}) });
  }
  const baseUrl = config.LLM_BASE_URL ?? (driver === 'compatible' ? undefined : DEFAULT_BASE_URL[driver]);
  if (baseUrl === undefined) throw new Error('LLM_DRIVER="compatible" needs LLM_BASE_URL.');
  return new OpenAiCompatibleLlm({ baseUrl, apiKey, model, timeoutMs: config.LLM_TIMEOUT_MS });
}
