/** One provider the settings page offers. The driver and base address are what `createLlm` needs; the rest is for the person choosing. */
export interface ProviderPreset {
  readonly id: 'groq' | 'gemini' | 'openai' | 'anthropic' | 'openrouter' | 'ollama' | 'custom';
  readonly label: string;
  readonly driver: 'compatible' | 'gemini' | 'openai' | 'anthropic' | 'ollama';
  /** Fixed for hosted providers; the person types it for `custom`; a local address for Ollama. */
  readonly baseUrl: string | null;
  readonly needsKey: boolean;
  /** Where a key is made, shown as a hint. */
  readonly keyHelp: string;
  /** A model already measured to work with this app (`npm run llm:check`), or null when none has been measured. */
  readonly recommended: string | null;
}

/** The providers, in the order the page lists them. Models are never hard-coded here: the page fetches the provider's own list. */
export const PROVIDERS: readonly ProviderPreset[] = [
  { id: 'groq', label: 'Groq', driver: 'compatible', baseUrl: 'https://api.groq.com/openai/v1', needsKey: true, keyHelp: 'console.groq.com, API Keys', recommended: 'openai/gpt-oss-20b' },
  { id: 'gemini', label: 'Google Gemini', driver: 'gemini', baseUrl: null, needsKey: true, keyHelp: 'aistudio.google.com, Get API key', recommended: 'gemini-3.1-flash-lite' },
  { id: 'openai', label: 'OpenAI', driver: 'openai', baseUrl: null, needsKey: true, keyHelp: 'platform.openai.com, API keys', recommended: null },
  { id: 'anthropic', label: 'Anthropic (Claude)', driver: 'anthropic', baseUrl: null, needsKey: true, keyHelp: 'console.anthropic.com, API keys', recommended: null },
  { id: 'openrouter', label: 'OpenRouter', driver: 'compatible', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true, keyHelp: 'openrouter.ai, Keys', recommended: null },
  { id: 'ollama', label: 'Ollama (on this machine)', driver: 'ollama', baseUrl: 'http://localhost:11434/v1', needsKey: false, keyHelp: 'no key; Ollama must be running on the same machine', recommended: null },
  { id: 'custom', label: 'Other (OpenAI-compatible address)', driver: 'compatible', baseUrl: null, needsKey: true, keyHelp: 'any service that speaks the OpenAI chat format', recommended: null }
];

/** Looks a provider up by id. */
export function providerById(id: string): ProviderPreset | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** Works out which provider a saved configuration is, so the page can show it selected. */
export function providerFor(driver: string, baseUrl: string | undefined): ProviderPreset | undefined {
  if (driver === 'none') return undefined;
  if (driver === 'compatible') {
    const host = baseUrl === undefined ? '' : (() => { try { return new URL(baseUrl).hostname; } catch { return ''; } })();
    return PROVIDERS.find((p) => p.driver === 'compatible' && p.baseUrl !== null && new URL(p.baseUrl).hostname === host) ?? providerById('custom');
  }
  return PROVIDERS.find((p) => p.driver === driver);
}
