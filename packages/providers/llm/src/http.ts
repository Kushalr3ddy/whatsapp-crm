import { LlmError } from './index.js';

/** POSTs JSON and returns the parsed answer, turning a timeout, a non-2xx or non-JSON reply into an `LlmError`. */
export async function postJson(
  url: string, headers: Record<string, string>, body: unknown, timeoutMs: number, fetchImpl: typeof fetch
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new LlmError(timedOut ? 'timeout' : 'http', timedOut ? `model call timed out after ${String(timeoutMs)} ms` : `model call failed: ${String(err)}`);
  }
  if (!res.ok) {
    // The provider's reason helps; the key is never in the response, and the body is cut short.
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new LlmError('http', `model call returned ${String(res.status)}: ${detail}`, res.status);
  }
  try {
    return await res.json();
  } catch {
    throw new LlmError('bad_response', 'model call returned something that is not JSON');
  }
}

/** Parses a tool call's JSON arguments; an unusable string is an `LlmError`, not a guess. */
export function parseArgs(raw: unknown, tool: string): Record<string, unknown> {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const v: unknown = raw.trim() === '' ? {} : JSON.parse(raw);
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch { /* falls through */ }
  }
  throw new LlmError('bad_response', `tool call "${tool}" had arguments that are not a JSON object`);
}
