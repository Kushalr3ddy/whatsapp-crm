import { FilesystemStorage } from '@crm/storage-filesystem';
import type { StorageDriver } from './index.js';

/** Only what choosing a storage backend needs, so this does not depend on the whole config. */
export interface StorageConfig {
  readonly STORAGE_DRIVER: 'filesystem' | 'minio' | 's3';
  readonly STORAGE_PATH: string;
}

/**
 * Builds the configured storage backend.
 *
 * **This is the only place that knows which driver is in use.** Everything above it takes a
 * `StorageDriver` and cannot tell the difference — which is what P1's exit criterion means by
 * "flipping `STORAGE_DRIVER` changes no application code", and what the contract suite proves
 * is safe to do.
 *
 * `minio` and `s3` throw rather than silently falling back. A deployment that asked for S3 and
 * quietly got a local directory would look fine until the second application process started
 * and could not see the first one's files.
 */
export function createStorage(config: StorageConfig): StorageDriver {
  switch (config.STORAGE_DRIVER) {
    case 'filesystem':
      return new FilesystemStorage(config.STORAGE_PATH);
    case 'minio':
    case 's3':
      throw new Error(
        `STORAGE_DRIVER="${config.STORAGE_DRIVER}" is not implemented yet. ` +
        'Only "filesystem" exists; the S3-compatible driver is still to be written. ' +
        'See docs/18-providers.md.'
      );
  }
}
