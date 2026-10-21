import { z } from 'zod';

/**
 * The full environment contract. Every variable the system reads is declared here once,
 * and this same schema generates .env.example and validates at boot — so "documented"
 * and "validated" cannot drift apart (docs/00-prior-art.md, M22).
 */
const configSchema = z.object({
  // ---- required in every deployment ------------------------------------------------
  // A missing value here is a hard crash, never a silent fallback. The previous system
  // generated a random SESSION_SECRET per boot when it was absent, so a production deploy
  // that forgot it "worked" while logging everyone out on every restart (M17).
  DATABASE_URL: z.string().url({ message: 'must be a postgres:// or postgresql:// URL' }),
  APP_SECRET: z.string().min(32, 'must be at least 32 characters — generate with `openssl rand -hex 32`'),
  PUBLIC_URL: z.string().url(),

  // Encryption at rest. Two separate keys, both 32 bytes of hex. Validated here so a
  // deployment with a malformed key fails at boot rather than at the first message.
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be 32 bytes of hex (64 chars) — generate with `openssl rand -hex 32`'),
  ENCRYPTION_INDEX_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be 32 bytes of hex (64 chars) — generate with `openssl rand -hex 32`'),
  // Key rotation (D-31). The version is stamped into every encrypted value; a rotation raises it by
  // one and moves the old key to the previous list until everything has been re-encrypted.
  ENCRYPTION_KEY_VERSION: z.coerce.number().int().min(1).max(255).default(1),
  ENCRYPTION_KEYS_PREVIOUS: z.string().regex(
    /^\s*\d{1,3}\s*:\s*[0-9a-fA-F]{64}\s*(,\s*\d{1,3}\s*:\s*[0-9a-fA-F]{64}\s*)*$/,
    'must be comma-separated <version>:<64 hex chars> pairs, e.g. 1:ab12…'
  ).optional().or(z.literal('').transform(() => undefined)),

  // Required, not optional. Scoped keys in a database table are P2; until then this single
  // key guards the whole API. Making it optional with a warning is how software reaches
  // production with no authentication at all (docs/00-prior-art.md, M16).
  API_KEY: z.string().min(32, 'must be at least 32 characters — generate with `openssl rand -hex 32`'),

  // ---- runtime ---------------------------------------------------------------------
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  // Browser origins allowed to call the API from another host or port, comma-separated, each exactly
  // `scheme://host[:port]` (e.g. `http://192.168.1.20:4000`). Empty = none. Server-to-server callers
  // (a backend, curl) need no entry — CORS only constrains browsers (apps/api/src/cors.ts).
  CORS_ALLOWED_ORIGINS: z.string().default('').transform((v) =>
    v.split(',').map((o) => o.trim().replace(/\/$/, '')).filter((o) => o !== '')
  ).refine((list) => list.every((o) => /^https?:\/\/[^/\s]+$/.test(o)), {
    message: 'each origin must look like http://host:port (no path, no wildcard)'
  }),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  /** Which roles this process runs. `all` is the lean single-process default. */
  PROCESS_ROLE: z.enum(['all', 'api', 'worker', 'gateway']).default('all'),

  // Which transport the gateway drives. `fake` is an in-memory channel for CI and local UI tests —
  // it sends nothing real, so a broadcast can be verified end to end. Refused in production (below).
  GATEWAY_CHANNEL: z.enum(['baileys', 'fake']).default('baileys'),
  // How often the gateway's safety-net sweep runs (dispatching campaigns, reconciling results).
  // 60 s is right for a real number; tests set it low so a broadcast finishes in seconds.
  GATEWAY_SWEEP_SECONDS: z.coerce.number().int().min(1).max(600).default(60),

  // ---- drivers (docs/18-providers.md) ----------------------------------------------
  // Each defaults to the free, self-hostable option, so an empty .env still boots.
  PRESET: z.enum(['lean', 'standard', 'scale']).default('lean'),
  STORAGE_DRIVER: z.enum(['filesystem', 'minio', 's3']).default('filesystem'),
  /** Where the filesystem driver keeps objects. Ignored by every other storage driver. */
  STORAGE_PATH: z.string().default('./storage'),
  // S3-compatible storage (STORAGE_DRIVER=s3 or minio): AWS S3, Cloudflare R2, Backblaze B2 or MinIO.
  // Only read when one of those drivers is chosen; choosing one without a bucket and credentials is a
  // boot-time error (below), never a silent fall back to local disk.
  // An empty value counts as unset (a compose file passes blanks through), hence the preprocess.
  S3_BUCKET: z.preprocess((v) => v === '' ? undefined : v, z.string().optional()),
  S3_ENDPOINT: z.preprocess((v) => v === '' ? undefined : v, z.string().url().optional()),
  S3_REGION: z.preprocess((v) => v === '' ? undefined : v, z.string().default('auto')),
  S3_ACCESS_KEY_ID: z.preprocess((v) => v === '' ? undefined : v, z.string().optional()),
  S3_SECRET_ACCESS_KEY: z.preprocess((v) => v === '' ? undefined : v, z.string().optional()),
  /** Unset = the driver's default (true for minio, false for s3). MinIO and most self-hosted servers need true. */
  S3_FORCE_PATH_STYLE: z.preprocess((v) => v === '' ? undefined : v, z.enum(['true', 'false']).optional())
    .transform((v) => v === undefined ? undefined : v === 'true'),
  QUEUE_DRIVER: z.enum(['pgboss', 'bullmq']).default('pgboss'),
  TELEMETRY_DRIVER: z.enum(['none', 'prometheus', 'otlp']).default('none'),
  LLM_DRIVER: z.enum(['none', 'ollama', 'openai', 'anthropic', 'gemini', 'compatible']).default('none'),
  // The language model (docs/06-features/F12-ai-agent.md). Only read when LLM_DRIVER is not `none`; the model
  // name, and for hosted providers the key, are checked at boot (below). An empty value counts as unset.
  LLM_MODEL: z.preprocess((v) => v === '' ? undefined : v, z.string().optional()),
  LLM_API_KEY: z.preprocess((v) => v === '' ? undefined : v, z.string().optional()),
  /** Unset = the provider's own address. Required for `compatible` (OpenRouter, Groq, vLLM...). */
  LLM_BASE_URL: z.preprocess((v) => v === '' ? undefined : v, z.string().url().optional()),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(20000),
  SMS_DRIVER: z.enum(['none', 'twilio', 'msg91']).default('none'),

  // ---- messaging safety (docs/08-antiban.md) ---------------------------------------
  // Defaults, not ceilings. The hard limits the engine enforces are not configurable to
  // an unsafe value by anyone, including an admin.
  DEFAULT_COUNTRY: z.string().length(2).default('IN'),
  SEND_RATE_PER_MINUTE: z.coerce.number().int().positive().max(20).default(8),
  SEND_RATE_PER_DAY: z.coerce.number().int().positive().max(2000).default(1500),
  // Circadian pacing (docs/08-antiban.md): shape *when* a number sends across the day, not only
  // how much. `SEND_TIMEZONE` is the number's local day — single-tenant India defaults to IST;
  // `SEND_CIRCADIAN=false` turns the day/night curve off and leaves layers 1–2 unchanged.
  SEND_TIMEZONE: z.string().default('Asia/Kolkata').refine(isValidTimezone, {
    message: 'must be a valid IANA timezone, e.g. Asia/Kolkata'
  }),
  SEND_CIRCADIAN: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  // Contact-graph gates (docs/08-antiban.md): how many brand-new strangers one number may START
  // messaging per hour / day. Cold-blasting a fresh list is a top ban signal; these cap it.
  NEW_CONTACTS_PER_HOUR: z.coerce.number().int().positive().max(100).default(5),
  NEW_CONTACTS_PER_DAY: z.coerce.number().int().positive().max(500).default(20),
  // Reply-ratio floor: the daily new-contact cap above is only earned once ~30% of recent new
  // contacts have replied; until then a lower starting allowance applies. `false` = flat cap.
  NEW_CONTACT_REPLY_FLOOR: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  CONTACT_GRAPH_GATES: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  // Typing simulation (docs/08-antiban.md, D-24): emit a "typing…" presence and pause a beat
  // proportional to the message length before each send, so a send looks human rather than
  // instant. Cosmetic anti-ban; `SEND_TYPING_SIMULATION=false` turns it off (e.g. to send faster).
  SEND_TYPING_SIMULATION: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  // Number fallback (D-60): before the first send to a contact that has more than one phone number,
  // ask WhatsApp whether the primary one has an account, and message the next one that does. One lookup
  // per number, cached, only when a fallback exists. `false` always messages the primary number.
  SEND_VERIFY_FALLBACK_NUMBERS: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  // Recipient timezone (docs/08-antiban.md, Layer 3): also respect the recipient's day, inferred from
  // their phone number's country, on top of SEND_TIMEZONE (the sender's). Only adds caution.
  SEND_RECIPIENT_TIMEZONE: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  // Read behaviour (docs/08-antiban.md, Layer 3): mark inbound messages read after a per-message
  // 10–60 minute delay, only in active hours. `false` = never send read receipts from the gateway.
  SEND_READ_RECEIPTS: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  // Background entropy (docs/08-antiban.md, Layer 3): every 2–6 h per connected number, in active
  // hours, an abandoned "typing…" and a brief online blip. `false` = no idle-time presence at all.
  SEND_BACKGROUND_ENTROPY: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  // Body-variation backstop (docs/08-antiban.md, Layer 3 / D-26): the most identical message bodies
  // one number may queue within a rolling 24h. Beyond it, further identical-body recipients are left
  // pending until the window frees up or the operator adds spintax. Only bites a no-variation blast —
  // spintax/`{{name}}` make bodies differ, so it never fires on a varied campaign.
  IDENTICAL_BODY_DAILY_CAP: z.coerce.number().int().positive().max(100000).default(50)
}).refine((c) => !(c.GATEWAY_CHANNEL === 'fake' && c.NODE_ENV === 'production'), {
  path: ['GATEWAY_CHANNEL'],
  message: 'the fake channel sends nothing real and must never run with NODE_ENV=production'
}).superRefine((c, ctx) => {
  // A chosen model with no name or key would only fail on the first customer message, so say so at boot.
  if (c.LLM_DRIVER !== 'none') {
    if (c.LLM_MODEL === undefined) ctx.addIssue({ code: 'custom', path: ['LLM_MODEL'], message: `required when LLM_DRIVER=${c.LLM_DRIVER}` });
    if (c.LLM_DRIVER !== 'ollama' && c.LLM_API_KEY === undefined) ctx.addIssue({ code: 'custom', path: ['LLM_API_KEY'], message: `required when LLM_DRIVER=${c.LLM_DRIVER}` });
    if (c.LLM_DRIVER === 'compatible' && c.LLM_BASE_URL === undefined) ctx.addIssue({ code: 'custom', path: ['LLM_BASE_URL'], message: 'required when LLM_DRIVER=compatible' });
  }
}).superRefine((c, ctx) => {
  // A deployment that asked for S3 storage and quietly got a local directory would look fine until a
  // second process could not see the first one's files, so the missing pieces are named at boot.
  if (c.STORAGE_DRIVER === 'filesystem') return;
  for (const name of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
    if (c[name] === undefined || c[name] === '') {
      ctx.addIssue({
        code: 'custom', path: [name],
        message: `required when STORAGE_DRIVER=${c.STORAGE_DRIVER} (S3-compatible storage)`
      });
    }
  }
  if (c.STORAGE_DRIVER === 'minio' && c.S3_ENDPOINT === undefined) {
    ctx.addIssue({ code: 'custom', path: ['S3_ENDPOINT'], message: 'required when STORAGE_DRIVER=minio' });
  }
});

/** True when the string names a timezone this runtime's Intl database recognises. */
function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The validated, fully-typed configuration for this process. */
export type Config = z.infer<typeof configSchema>;

/**
 * Parses and validates the environment, or exits. Called once at startup, before the
 * server listens — see docs/04-architecture.md on gated startup (M6): the previous
 * system's bootstrap was fire-and-forget and served traffic even when it had failed.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new ConfigError(`Invalid configuration:\n${problems}\n\nSee .env.example.`);
  }
  return result.data;
}

/** Thrown when the environment is incomplete or malformed. Always fatal. */
export class ConfigError extends Error {
  /** Names the error so a crash log says what kind of failure this was. */
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}
