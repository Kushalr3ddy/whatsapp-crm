/**
 * Tries the language models through the same driver the app uses, and says which ones work, how fast, and whether they
 * can call a tool (which the AI assistant's campaign and messaging features depend on).
 *
 *   npm run llm:check                      the model in .env (LLM_*), plus Groq if GROQ_API_KEY is set
 *   npm run llm:check -- --runs 3          repeat each check to see how steady the speed is
 *   npm run llm:check -- --only groq       just one of them
 *   npm run llm:check -- --groq-model openai/gpt-oss-120b
 *   npm run llm:check -- --driver compatible --base-url https://api.example.com/v1 --model some-model --key-env SOME_KEY
 *
 * Each model gets two checks, repeated `--runs` times (default 2):
 *   hello  a one-line answer, to time it
 *   tool   an instruction that must come back as a `create_campaign` call carrying the right tag id (the shape the
 *          assistant relies on)
 * Nothing is saved or sent anywhere except to the provider you are testing, and no key is ever printed.
 */
import { createLlm, type LlmConfig, type LlmDriver } from '@crm/llm';

/** One thing to test: a name for the report, and how to reach it. */
interface Target { readonly label: string; readonly config: LlmConfig }

/** How a single check went. */
interface Outcome { readonly ok: boolean; readonly ms: number; readonly note: string }

/** Prints a line. This is a CLI: stdout is the interface. */
function say(line = ''): void {
  process.stdout.write(`${line}\n`);
}

/** Reads `--name value` from the command line. */
function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Decides what to test from .env and the command line. */
function targets(): Target[] {
  const timeout = Number(flag('timeout') ?? process.env.LLM_TIMEOUT_MS ?? 60000);
  const out: Target[] = [];

  const driver = flag('driver');
  if (driver !== undefined) {
    const keyEnv = flag('key-env');
    const key = keyEnv === undefined ? undefined : process.env[keyEnv];
    out.push({
      label: flag('label') ?? `${driver}:${flag('model') ?? '?'}`,
      config: {
        LLM_DRIVER: driver as LlmConfig['LLM_DRIVER'], LLM_MODEL: flag('model'), LLM_API_KEY: key,
        LLM_BASE_URL: flag('base-url'), LLM_TIMEOUT_MS: timeout
      }
    });
    return out;
  }

  if (process.env.LLM_DRIVER !== undefined && process.env.LLM_DRIVER !== 'none') {
    out.push({
      label: `configured (${process.env.LLM_DRIVER}: ${process.env.LLM_MODEL ?? '?'})`,
      config: {
        LLM_DRIVER: process.env.LLM_DRIVER as LlmConfig['LLM_DRIVER'], LLM_MODEL: process.env.LLM_MODEL,
        LLM_API_KEY: process.env.LLM_API_KEY, LLM_BASE_URL: process.env.LLM_BASE_URL || undefined, LLM_TIMEOUT_MS: timeout
      }
    });
  }
  if (process.env.GROQ_API_KEY !== undefined && process.env.GROQ_API_KEY !== '') {
    const model = flag('groq-model') ?? process.env.GROQ_MODEL ?? 'openai/gpt-oss-20b';
    out.push({
      label: `groq (${model})`,
      config: {
        LLM_DRIVER: 'compatible', LLM_MODEL: model, LLM_API_KEY: process.env.GROQ_API_KEY,
        LLM_BASE_URL: 'https://api.groq.com/openai/v1', LLM_TIMEOUT_MS: timeout
      }
    });
  }
  const only = flag('only');
  return only === undefined ? out : out.filter((t) => t.label.toLowerCase().includes(only.toLowerCase()));
}

/** Runs one check and turns any failure into words, never a crash. */
async function attempt(work: () => Promise<string>): Promise<Outcome> {
  const start = Date.now();
  try {
    const note = await work();
    return { ok: true, ms: Date.now() - start, note };
  } catch (error) {
    const e = error as { code?: string; statusCode?: number; message?: string };
    const why = e.statusCode !== undefined ? `HTTP ${String(e.statusCode)}` : e.code ?? 'error';
    return { ok: false, ms: Date.now() - start, note: `${why}: ${(e.message ?? '').slice(0, 90)}` };
  }
}

/** The answer must be short text. */
async function hello(llm: LlmDriver): Promise<string> {
  const r = await llm.complete({
    system: 'Answer in one short sentence.', messages: [{ role: 'user', content: 'Say hello and name the company you are replying for: Acme Hiring.' }], maxTokens: 200
  });
  if (r.text.trim() === '') throw new Error('empty answer');
  return r.text.trim().replace(/\s+/g, ' ').slice(0, 60);
}

/** The model must call create_campaign with the tag id from the context, not invent one. */
async function tool(llm: LlmDriver): Promise<string> {
  const tagId = '3f1c6d2e-7a4b-4c1d-9e55-0a1b2c3d4e5f';
  const r = await llm.complete({
    system: `You prepare WhatsApp campaigns with the tools. Use only ids from the context. Context (JSON): ${JSON.stringify({ tags: [{ id: tagId, name: 'pune' }, { id: 'aaaa', name: 'delhi' }], numbers: [{ id: 'n1', label: 'Main' }] })}`,
    messages: [{ role: 'user', content: 'Send a reminder about Friday\'s 10am walk-in interview to everyone tagged pune.' }],
    tools: [{
      name: 'create_campaign', description: 'Prepare a new campaign for a tag.',
      parameters: { type: 'object', properties: { name: { type: 'string' }, body: { type: 'string' }, tagId: { type: 'string' }, senderId: { type: 'string' } }, required: ['name', 'body'] }
    }],
    maxTokens: 800
  });
  const call = r.toolCalls.find((c) => c.name === 'create_campaign');
  if (call === undefined) throw new Error('no create_campaign call');
  if (call.arguments.tagId !== tagId) throw new Error(`wrong tag id: ${String(call.arguments.tagId)}`);
  return 'called create_campaign with the right tag';
}

/** The middle value, or 0 when there is none. */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[Math.floor(s.length / 2)]!;
}

/** Pads a cell for the report table. */
const cell = (v: string, n: number): string => v.length >= n ? `${v.slice(0, n - 1)}…` : v.padEnd(n);

const list = targets();
if (list.length === 0) {
  say('Nothing to test. Set LLM_DRIVER/LLM_MODEL/LLM_API_KEY (and/or GROQ_API_KEY) in .env, or pass --driver/--model/--key-env.');
  process.exit(1);
}
const runs = Math.max(1, Number(flag('runs') ?? 2));
say(`Testing ${String(list.length)} model${list.length === 1 ? '' : 's'}, ${String(runs)} run${runs === 1 ? '' : 's'} each. Slow providers can take a minute per call.\n`);

const rows: string[] = [];
for (const t of list) {
  let llm: LlmDriver;
  try { llm = createLlm(t.config); } catch (error) {
    rows.push(`${cell(t.label, 44)} ${cell('not set up', 11)} ${(error as Error).message}`);
    continue;
  }
  const helloRuns: Outcome[] = [];
  const toolRuns: Outcome[] = [];
  say(`▶ ${t.label}`);
  for (let i = 0; i < runs; i++) {
    const h = await attempt(() => hello(llm));
    const c = await attempt(() => tool(llm));
    helloRuns.push(h); toolRuns.push(c);
    say(`   run ${String(i + 1)}: hello ${h.ok ? '✓' : '✗'} ${(h.ms / 1000).toFixed(1)}s   tool ${c.ok ? '✓' : '✗'} ${(c.ms / 1000).toFixed(1)}s${h.ok ? '' : `   [hello: ${h.note}]`}${c.ok ? '' : `   [tool: ${c.note}]`}`);
    if (i === 0 && h.ok) say(`          says: "${h.note}"`);
  }
  const hOk = helloRuns.filter((r) => r.ok).length;
  const cOk = toolRuns.filter((r) => r.ok).length;
  const verdict = hOk === runs && cOk === runs ? 'GOOD' : hOk === 0 ? 'FAILS' : cOk === 0 ? 'NO TOOLS' : 'FLAKY';
  rows.push(`${cell(t.label, 44)} ${cell(verdict, 11)} hello ${String(hOk)}/${String(runs)} (median ${(median(helloRuns.map((r) => r.ms)) / 1000).toFixed(1)}s) · tool ${String(cOk)}/${String(runs)} (median ${(median(toolRuns.map((r) => r.ms)) / 1000).toFixed(1)}s)`);
}

say('\n── result ──');
for (const r of rows) say(r);
say('\nGOOD = both checks passed every run. NO TOOLS = answers text but cannot call tools, so the AI’s campaign and messaging features will not work with it.');
