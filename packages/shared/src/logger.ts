import pino from 'pino';
import type { Config } from './config.js';

/**
 * Builds the process logger. JSON lines to stdout, UTC timestamps, no external service
 * required — whatever runs the container already captures stdout (docs/13-deployment.md).
 *
 * UTC is deliberate: the previous system shifted timestamps to IST by adding 5.5 hours
 * and relabelling the `Z` suffix, which silently breaks every log tool that parses them
 * (docs/00-prior-art.md, M25). Localise in the UI, never in the log.
 */
export function createLogger(config: Pick<Config, 'LOG_LEVEL' | 'NODE_ENV'>) {
  return pino({
    level: config.LOG_LEVEL,
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    base: { service: 'whatsapp-crm' },
    // Field ALLOWLIST, not a denylist — a newly added field is redacted by default
    // rather than leaked by default (docs/09-security.md).
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token',
              '*.phone', '*.phone_e164', '*.body_enc', '*.value_enc', '*.apiKey'],
      censor: '[redacted]'
    },
    ...(config.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: false } } }
      : {})
  });
}

/** The logger type, so modules can accept one without importing pino directly. */
export type Logger = ReturnType<typeof createLogger>;
