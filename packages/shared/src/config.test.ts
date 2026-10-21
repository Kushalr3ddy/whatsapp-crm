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

describe('STORAGE_DRIVER and the S3 settings', () => {
  it('defaults to the local filesystem and needs no S3 settings', () => {
    expect(loadConfig(base).STORAGE_DRIVER).toBe('filesystem');
  });

  it('treats blank S3 values (as a compose file passes them) as unset', () => {
    const c = loadConfig({
      ...base, S3_BUCKET: '', S3_ENDPOINT: '', S3_REGION: '', S3_ACCESS_KEY_ID: '',
      S3_SECRET_ACCESS_KEY: '', S3_FORCE_PATH_STYLE: ''
    });
    expect(c.STORAGE_DRIVER).toBe('filesystem');
    expect(c.S3_REGION).toBe('auto');
    expect(c.S3_FORCE_PATH_STYLE).toBeUndefined();
  });

  it('refuses s3 without a bucket and credentials, naming what is missing', () => {
    expect(() => loadConfig({ ...base, STORAGE_DRIVER: 's3' })).toThrow(/S3_BUCKET/);
    expect(() => loadConfig({ ...base, STORAGE_DRIVER: 's3', S3_BUCKET: 'b' }))
      .toThrow(/S3_ACCESS_KEY_ID/);
  });

  it('accepts s3 with a full set of settings', () => {
    const c = loadConfig({
      ...base, STORAGE_DRIVER: 's3', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's'
    });
    expect(c.STORAGE_DRIVER).toBe('s3');
    expect(c.S3_BUCKET).toBe('b');
  });

  it('requires an endpoint for minio, since there is no default host', () => {
    const minio = { ...base, STORAGE_DRIVER: 'minio', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' };
    expect(() => loadConfig(minio)).toThrow(/S3_ENDPOINT/);
    expect(loadConfig({ ...minio, S3_ENDPOINT: 'http://localhost:9000' }).STORAGE_DRIVER).toBe('minio');
  });
});

describe('LLM_DRIVER and the model settings', () => {
  it('defaults to none and needs nothing else', () => {
    expect(loadConfig(base).LLM_DRIVER).toBe('none');
  });

  it('names the missing model and key at boot', () => {
    expect(() => loadConfig({ ...base, LLM_DRIVER: 'gemini' })).toThrow(/LLM_MODEL/);
    expect(() => loadConfig({ ...base, LLM_DRIVER: 'gemini', LLM_MODEL: 'm' })).toThrow(/LLM_API_KEY/);
    expect(loadConfig({ ...base, LLM_DRIVER: 'ollama', LLM_MODEL: 'm' }).LLM_DRIVER).toBe('ollama');
  });

  it('needs a base URL for compatible', () => {
    expect(() => loadConfig({ ...base, LLM_DRIVER: 'compatible', LLM_MODEL: 'm', LLM_API_KEY: 'k' })).toThrow(/LLM_BASE_URL/);
  });
});
