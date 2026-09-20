import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilesystemStorage } from '@crm/storage-filesystem';
import type { StorageDriver } from '@crm/storage';

/** A storage driver backed by a throwaway directory, and the way to remove it again. */
export interface TempStorage {
  readonly storage: StorageDriver;
  readonly root: string;
  /** Deletes the directory and everything in it. Call from `afterAll`. */
  cleanup(): void;
}

/**
 * A real storage driver in a temporary directory.
 *
 * A real one rather than a stub, because the tests that matter here are about bytes arriving
 * intact and headers describing them correctly — a stub would agree with whatever the code
 * did. Every suite that builds the app needs one, since the app takes a `StorageDriver`
 * whether or not that suite touches an attachment.
 */
export function tempStorage(label = 'crm-media'): TempStorage {
  const root = mkdtempSync(join(tmpdir(), `${label}-`));
  return {
    storage: new FilesystemStorage(root),
    root,
    cleanup: () => { rmSync(root, { recursive: true, force: true }); }
  };
}
