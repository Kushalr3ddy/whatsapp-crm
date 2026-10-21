import { LlmError, type LlmDriver, type LlmResponse } from './index.js';

/** The default: no model. Every call says so, and the caller treats that as "AI is off". */
export class NoneLlm implements LlmDriver {
  readonly name = 'none';

  /** Always refuses: there is no model. */
  complete(): Promise<LlmResponse> {
    return Promise.reject(new LlmError('disabled', 'LLM_DRIVER is "none": no language model is configured.'));
  }
}
