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

  // ---- runtime ---------------------------------------------------------------------
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  /** Which roles this process runs. `all` is the lean single-process default. */
  PROCESS_ROLE: z.enum(['all', 'api', 'worker', 'gateway']).default('all'),

  // ---- drivers (docs/18-providers.md) ----------------------------------------------
  // Each defaults to the free, self-hostable option, so an empty .env still boots.
  PRESET: z.enum(['lean', 'standard', 'scale']).default('lean'),
  STORAGE_DRIVER: z.enum(['filesystem', 'minio', 's3']).default('filesystem'),
  QUEUE_DRIVER: z.enum(['pgboss', 'bullmq']).default('pgboss'),
  TELEMETRY_DRIVER: z.enum(['none', 'prometheus', 'otlp']).default('none'),
  LLM_DRIVER: z.enum(['none', 'ollama', 'openai', 'anthropic', 'gemini']).default('none'),
  SMS_DRIVER: z.enum(['none', 'twilio', 'msg91']).default('none'),

  // ---- messaging safety (docs/08-antiban.md) ---------------------------------------
  // Defaults, not ceilings. The hard limits the engine enforces are not configurable to
  // an unsafe value by anyone, including an admin.
  DEFAULT_COUNTRY: z.string().length(2).default('IN'),
  SEND_RATE_PER_MINUTE: z.coerce.number().int().positive().max(20).default(8),
  SEND_RATE_PER_DAY: z.coerce.number().int().positive().max(2000).default(1500)
});

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
