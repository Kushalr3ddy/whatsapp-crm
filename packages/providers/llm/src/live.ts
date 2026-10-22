import { readFileSync, statSync } from 'node:fs';
import { createLlm, type LlmConfig } from './factory.js';
import { parseLlmEnv, type LlmEnvValues } from './env-file.js';
import { NoneLlm } from './none.js';
import type { LlmDriver, LlmRequest, LlmResponse } from './index.js';

/** Where the model settings came from right now. */
export interface LiveLlmStatus {
  readonly driver: LlmConfig['LLM_DRIVER'];
  readonly model: string | null;
  readonly baseUrl: string | null;
  /** Only the last four characters; the key itself is never returned. */
  readonly keyLast4: string | null;
  readonly timeoutMs: number;
  /** `file` when the settings come from the env file (set in the app), `environment` when from the process's own environment. */
  readonly source: 'file' | 'environment';
}

/**
 * A model that follows the env file. The settings page writes the `LLM_*` lines to a file; every process that talks to a model (the API
 * and the gateway, which writes the assistant's replies) holds one of these instead of a fixed model, so a change applies on the next call
 * with no restart. The file is looked at (its size and modified time) before each call, and re-read only when they changed.
 *
 * If the file has a `LLM_DRIVER` line, **the file's five settings are used as a set**; otherwise the process's own environment from boot is
 * used. A file that does not describe a usable model leaves the AI off (`none`) instead of crashing the process.
 */
export class LiveLlm implements LlmDriver {
  private cached: { stamp: string; driver: LlmDriver; status: LiveLlmStatus } | null = null;

  /** `envFile` is the file the settings page writes; `base` is the configuration the process started with. */
  constructor(private readonly o: { envFile: string; base: LlmConfig; onError?: (message: string) => void }) {}

  /** The name of the model driver currently in use (`none` when the AI is not set up). */
  get name(): string { return this.current().driver.name; }

  /** One model turn through whatever the settings are now. */
  complete(request: LlmRequest): Promise<LlmResponse> { return this.current().driver.complete(request); }

  /** What the settings are now, for the settings page. */
  status(): LiveLlmStatus { return this.current().status; }

  /** Re-reads the file if it changed and returns the model built from it. Synchronous on purpose: the file is tiny, and callers ask `name` before they call. */
  private current(): { driver: LlmDriver; status: LiveLlmStatus } {
    let stamp = 'absent';
    try { const s = statSync(this.o.envFile); stamp = `${String(s.mtimeMs)}:${String(s.size)}`; } catch { /* no file: the boot environment applies */ }
    if (this.cached !== null && this.cached.stamp === stamp) return this.cached;

    let fromFile: LlmEnvValues = {};
    if (stamp !== 'absent') { try { fromFile = parseLlmEnv(readFileSync(this.o.envFile, 'utf8')); } catch { fromFile = {}; } }
    const useFile = fromFile.LLM_DRIVER !== undefined;
    const config = useFile ? configFrom(fromFile, this.o.base.LLM_TIMEOUT_MS) : this.o.base;
    let driver: LlmDriver;
    try { driver = createLlm(config); }
    catch (error) {
      this.o.onError?.(`AI settings are not usable: ${error instanceof Error ? error.message : String(error)}`);
      driver = new NoneLlm();
    }
    const key = config.LLM_API_KEY ?? '';
    this.cached = {
      stamp, driver,
      status: {
        driver: driver.name === 'none' ? 'none' : config.LLM_DRIVER,
        model: driver.name === 'none' ? null : config.LLM_MODEL ?? null,
        baseUrl: config.LLM_BASE_URL ?? null,
        keyLast4: key.length >= 8 ? key.slice(-4) : null,
        timeoutMs: config.LLM_TIMEOUT_MS,
        source: useFile ? 'file' : 'environment'
      }
    };
    return this.cached;
  }
}

/** Builds a model configuration from the file's lines; an unknown driver word becomes `none`. */
function configFrom(values: LlmEnvValues, defaultTimeoutMs: number): LlmConfig {
  const drivers = ['none', 'ollama', 'openai', 'anthropic', 'gemini', 'compatible'] as const;
  const driver = drivers.find((d) => d === values.LLM_DRIVER) ?? 'none';
  const timeout = Number(values.LLM_TIMEOUT_MS);
  return {
    LLM_DRIVER: driver, LLM_MODEL: values.LLM_MODEL, LLM_API_KEY: values.LLM_API_KEY, LLM_BASE_URL: values.LLM_BASE_URL,
    LLM_TIMEOUT_MS: Number.isFinite(timeout) && timeout >= 1000 && timeout <= 120000 ? timeout : defaultTimeoutMs
  };
}
