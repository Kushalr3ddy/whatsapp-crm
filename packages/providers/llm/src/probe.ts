import { createLlm, type LlmConfig } from './factory.js';
import { LlmError, type LlmDriver } from './index.js';

/** The kinds of failure the settings page gives a checklist for. */
export type ProblemKind = 'key' | 'model' | 'rate_limit' | 'timeout' | 'unreachable' | 'response' | 'settings';

/** What a test of a model found. `usable` means it answered; `toolCalling` says whether it can also call functions (the campaign commands and hand-over need that). */
export interface ProbeResult {
  readonly usable: boolean;
  readonly toolCalling: boolean;
  readonly model: string;
  readonly milliseconds: number;
  /** What is wrong, in words to show as they are; null when `usable`. */
  readonly problem: string | null;
  /** What kind of problem, so the page can say what to check: the key, the model name, the address, a limit, a timeout, an unusable answer, or incomplete settings. */
  readonly problemKind: ProblemKind | null;
  /** Things worth knowing even when it works (for example, no tool calling). */
  readonly notes: readonly string[];
}

/** Which kind of failure this is. */
export function problemKindOf(error: unknown): ProblemKind {
  if (error instanceof LlmError) {
    if (error.code === 'timeout') return 'timeout';
    if (error.code === 'bad_response') return 'response';
    if (error.code === 'disabled') return 'settings';
    const status = error.statusCode;
    if (status === 401 || status === 403) return 'key';
    if (status === 404) return 'model';
    if (status === 429) return 'rate_limit';
    if (status === 400) return 'model';
  }
  return 'unreachable';
}

/** Turns a model failure into words that say what to do. Shared by the test and by callers that surface a failure. */
export function explainLlmError(error: unknown): string {
  if (error instanceof LlmError) {
    if (error.code === 'disabled') return 'No AI model is configured.';
    if (error.code === 'timeout') return 'The provider took too long to answer. Try again, or pick a faster model.';
    if (error.code === 'bad_response') return 'The model answered in a form this app cannot use. Try a different model.';
    const status = error.statusCode;
    if (status === 401 || status === 403) return `The provider refused the key (${String(status)}). Check that it is correct and has access to this model.`;
    if (status === 404) return 'The provider does not know that model, or the address is wrong (404).';
    if (status === 429) return 'The provider is rate limiting this key (429). Wait a minute and try again.';
    if (status === 400) return `The provider rejected the request (400): ${error.message.replace(/^model call returned 400: /, '').slice(0, 200)}`;
    if (status !== undefined && status >= 500) return `The provider had a problem (${String(status)}). Try again in a moment.`;
    return 'The provider could not be reached. Check the address and your connection.';
  }
  return 'The model could not be used.';
}

/**
 * Tests a model with two tiny real calls (this costs a fraction of a cent; the token limit is generous because "reasoning" models spend
 * part of it thinking before they answer, and a small limit made a working model look broken): one plain question, then one that offers a function and asks
 * for it to be called. Nothing is changed or saved. The key is never part of the result.
 */
export async function probeLlm(config: LlmConfig, dependencies: { driver?: LlmDriver } = {}): Promise<ProbeResult> {
  const started = Date.now();
  let driver: LlmDriver;
  try { driver = dependencies.driver ?? createLlm({ ...config, LLM_TIMEOUT_MS: Math.min(config.LLM_TIMEOUT_MS, 30000) }); }
  catch (error) { return { usable: false, toolCalling: false, model: config.LLM_MODEL ?? '', milliseconds: 0, problem: error instanceof Error ? error.message : 'The settings are incomplete.', problemKind: 'settings', notes: [] }; }

  let model = config.LLM_MODEL ?? '';
  try {
    const plain = await driver.complete({ system: 'You are a test. Answer in one short word.', messages: [{ role: 'user', content: 'Say OK.' }], maxTokens: 400 });
    model = plain.model || model;
    if (plain.text.trim() === '' && plain.toolCalls.length === 0) {
      return { usable: false, toolCalling: false, model, milliseconds: Date.now() - started, problem: 'The model answered with nothing. Try a different model.', problemKind: 'response', notes: [] };
    }
  } catch (error) {
    return { usable: false, toolCalling: false, model, milliseconds: Date.now() - started, problem: explainLlmError(error), problemKind: problemKindOf(error), notes: [] };
  }

  const notes: string[] = [];
  let toolCalling = false;
  try {
    const tool = await driver.complete({
      system: 'You are a test. When asked, call the function.',
      messages: [{ role: 'user', content: 'Call the function ping with note set to "ok".' }],
      tools: [{ name: 'ping', description: 'A test function.', parameters: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] } }],
      maxTokens: 400
    });
    toolCalling = tool.toolCalls.some((c) => c.name === 'ping');
  } catch { toolCalling = false; }
  if (!toolCalling) {
    notes.push('This model answered, but it did not call a function. Replies will work; the assistant\'s campaign commands and automatic hand-over need a model that can call functions.');
  }
  return { usable: true, toolCalling, model, milliseconds: Date.now() - started, problem: null, problemKind: null, notes };
}
