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
export function createLogger(config: Pick<Config, 'LOG_LEVEL' | 'NODE_ENV'>, destination?: { write(line: string): void }) {
  const options = {
    level: config.LOG_LEVEL,
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    base: { service: 'whatsapp-crm' },
    // A DENYLIST: a header or field is written unless it is named here, so every header that carries a credential must be named, on the
    // request and on the response. The response is the one that was missed: the request logger writes `res.headers`, and the sign-in
    // answer's `set-cookie` holds the raw session token and the CSRF token (R-033).
    redact: {
      paths: [
        'req.headers.authorization', 'req.headers.cookie', 'req.headers["x-csrf-token"]', 'req.headers["x-api-key"]', 'req.headers["proxy-authorization"]',
        'res.headers["set-cookie"]', 'res.headers["x-csrf-token"]', 'res.headers.authorization',
        '*.password', '*.token', '*.phone', '*.phone_e164', '*.body_enc', '*.value_enc', '*.apiKey'
      ],
      censor: '[redacted]'
    },
    ...(config.NODE_ENV === 'development' && destination === undefined
      ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: false } } }
      : {})
  };
  return destination === undefined ? pino(options) : pino(options, destination);
}

/** The logger type, so modules can accept one without importing pino directly. */
export type Logger = ReturnType<typeof createLogger>;
