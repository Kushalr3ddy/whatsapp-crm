import { describe, expect, it } from 'vitest';
import { assertValidKey, mediaKey, createStorage, InvalidKeyError } from './index.js';

describe('storage keys', () => {
  it('builds an org-prefixed media key', () => {
    const key = mediaKey('11111111-1111-4111-8111-111111111111', 'abc123', 'pdf');
    // Org-prefixed so a tenant's files list and erase as a unit, and a stray listing cannot
    // span tenants.
    expect(key).toBe('org/11111111-1111-4111-8111-111111111111/media/abc123.pdf');
  });

  it('builds a key without an extension when there is none', () => {
    expect(mediaKey('org-1', 'abc')).toBe('org/org-1/media/abc');
  });

  it('refuses to build a key from a value that would escape the store', () => {
    // A filename arriving from WhatsApp is attacker-controlled. If it ever reached a key
    // unchecked, `../../` in it would read outside the store.
    expect(() => mediaKey('a', '../../etc/passwd')).toThrow(InvalidKeyError);
  });

  it('rejects every shape that could escape a storage root', () => {
    for (const bad of ['../x', 'a/../../b', '/abs', 'trail/', 'a//b', 'a/./b', 'a\\b', '']) {
      expect(() => { assertValidKey(bad); }, bad).toThrow(InvalidKeyError);
    }
  });

  it('accepts ordinary keys', () => {
    for (const good of ['a', 'org/a/media/x.pdf', 'a_b-c.v2/d']) {
      expect(() => { assertValidKey(good); }, good).not.toThrow();
    }
  });
});

describe('choosing a driver', () => {
  it('builds the filesystem driver by name', () => {
    expect(createStorage({ STORAGE_DRIVER: 'filesystem', STORAGE_PATH: './x' }).name)
      .toBe('filesystem');
  });

  it('refuses s3 without its settings rather than falling back silently', () => {
    // A deployment that asked for S3 and quietly got a local directory would look fine until
    // a second process started and could not see the first one's files.
    expect(() => createStorage({ STORAGE_DRIVER: 's3', STORAGE_PATH: './x' }))
      .toThrow(/needs S3_BUCKET/);
  });
});

describe('createStorage', () => {
  const s3 = { S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' };

  it('builds the filesystem driver by default', () => {
    expect(createStorage({ STORAGE_DRIVER: 'filesystem', STORAGE_PATH: './storage' }).name).toBe('filesystem');
  });

  it('builds the S3-compatible driver for s3 and for minio, each under its own name', () => {
    expect(createStorage({ STORAGE_DRIVER: 's3', STORAGE_PATH: '', ...s3 }).name).toBe('s3');
    expect(createStorage({
      STORAGE_DRIVER: 'minio', STORAGE_PATH: '', S3_ENDPOINT: 'http://localhost:9000', ...s3
    }).name).toBe('minio');
  });
});
