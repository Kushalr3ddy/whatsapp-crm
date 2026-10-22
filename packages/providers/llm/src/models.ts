import { LlmError } from './index.js';
import type { ProviderPreset } from './presets.js';

/** One model a provider offers, as the picker shows it. */
export interface ModelInfo {
  readonly id: string;
  readonly name?: string;
  /** Context size in tokens, when the provider says. */
  readonly contextLength?: number;
}

/** What it takes to list models. `fetch` is injectable so tests need no network. */
export interface ListModelsInput {
  readonly preset: ProviderPreset;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
}

/** The most models the picker is given; some providers list hundreds. */
const MAX_MODELS = 600;

/**
 * Asks the provider for the models this key may use. OpenAI-format providers (OpenAI, Groq, OpenRouter, Gemini's compatible address,
 * Ollama) answer `GET {base}/models`; Anthropic has its own. Throws `LlmError` with the status when the provider refuses, so the
 * page can say "the key was refused". Never returns the key.
 */
export async function listModels(input: ListModelsInput): Promise<ModelInfo[]> {
  const fetchImpl = input.fetch ?? fetch;
  const anthropic = input.preset.driver === 'anthropic';
  const url = anthropic ? `${input.baseUrl.replace(/\/+$/, '')}/v1/models?limit=100` : `${input.baseUrl.replace(/\/+$/, '')}/models`;
  const headers: Record<string, string> = anthropic
    ? { 'x-api-key': input.apiKey, 'anthropic-version': '2023-06-01' }
    : input.apiKey === '' ? {} : { authorization: `Bearer ${input.apiKey}` };
  let res: Response;
  try {
    res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(input.timeoutMs ?? 15000) });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new LlmError(timedOut ? 'timeout' : 'http', timedOut ? 'The provider took too long to list its models.' : 'The provider could not be reached.');
  }
  if (!res.ok) throw new LlmError('http', `The provider answered ${String(res.status)} when listing models.`, res.status);
  const json = (await res.json().catch(() => null)) as { data?: Array<{ id?: unknown; name?: unknown; context_length?: unknown }> } | null;
  const rows = Array.isArray(json?.data) ? json.data : [];
  const out: ModelInfo[] = [];
  for (const r of rows) {
    if (typeof r.id !== 'string' || r.id === '') continue;
    const id = r.id.replace(/^models\//, '');
    out.push({
      id,
      ...(typeof r.name === 'string' && r.name !== id ? { name: r.name } : {}),
      ...(typeof r.context_length === 'number' ? { contextLength: r.context_length } : {})
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id)).slice(0, MAX_MODELS);
}
