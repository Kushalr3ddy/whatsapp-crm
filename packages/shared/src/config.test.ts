import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

/** The smallest environment the schema accepts; each test layers one setting on top. */
const base = {
  DATABASE_URL: 'postgresql://dev:dev@localhost:5434/x',
  APP_SECRET: 'a'.repeat(32),
  PUBLIC_URL: 'http://localhost:3000',
  ENCRYPTION_KEY: '0'.repeat(64),
  ENCRYPTION_INDEX_KEY: '1'.repeat(64),
  API_KEY: 'k'.repeat(32)
};

describe('GATEWAY_CHANNEL', () => {
  it('defaults to the real transport', () => {
    expect(loadConfig(base).GATEWAY_CHANNEL).toBe('baileys');
  });

  it('allows the fake channel outside production', () => {
    expect(loadConfig({ ...base, GATEWAY_CHANNEL: 'fake', NODE_ENV: 'development' }).GATEWAY_CHANNEL)
      .toBe('fake');
  });

  it('refuses the fake channel in production', () => {
    // A production gateway that silently sent nothing would look healthy while dropping every message.
    expect(() => loadConfig({ ...base, GATEWAY_CHANNEL: 'fake', NODE_ENV: 'production' }))
      .toThrow(/fake channel/);
  });
});
