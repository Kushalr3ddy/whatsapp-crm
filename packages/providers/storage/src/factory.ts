import { FilesystemStorage } from '@crm/storage-filesystem';
import { S3Storage } from '@crm/storage-s3';
import type { StorageDriver } from './index.js';

/** Only what choosing a storage backend needs, so this does not depend on the whole config. */
export interface StorageConfig {
  readonly STORAGE_DRIVER: 'filesystem' | 'minio' | 's3';
  readonly STORAGE_PATH: string;
  /** Read only for `s3` and `minio`; the config schema guarantees the required ones are present. */
  readonly S3_BUCKET?: string | undefined;
  readonly S3_ENDPOINT?: string | undefined;
  readonly S3_REGION?: string | undefined;
  readonly S3_ACCESS_KEY_ID?: string | undefined;
  readonly S3_SECRET_ACCESS_KEY?: string | undefined;
  readonly S3_FORCE_PATH_STYLE?: boolean | undefined;
}

/**
 * Builds the configured storage backend.
 *
 * **This is the only place that knows which driver is in use.** Everything above it takes a
 * `StorageDriver` and cannot tell the difference — which is what P1's exit criterion means by
 * "flipping `STORAGE_DRIVER` changes no application code", and what the contract suite proves
 * is safe to do.
 *
 * **`filesystem` is the default and the alpha's choice.** `s3` and `minio` build the same S3-compatible
 * driver (path-style addressing defaults to on for `minio`, off for `s3`), and refuse to start without
 * their bucket and credentials rather than falling back to a local directory: a deployment that asked for
 * shared storage and quietly got a local one would look fine until a second process could not see the
 * first one's files.
 */
export function createStorage(config: StorageConfig): StorageDriver {
  switch (config.STORAGE_DRIVER) {
    case 'filesystem':
      return new FilesystemStorage(config.STORAGE_PATH);
    case 'minio':
    case 's3': {
      if (!config.S3_BUCKET || !config.S3_ACCESS_KEY_ID || !config.S3_SECRET_ACCESS_KEY) {
        throw new Error(
          `STORAGE_DRIVER="${config.STORAGE_DRIVER}" needs S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.`
        );
      }
      return new S3Storage({
        name: config.STORAGE_DRIVER,
        bucket: config.S3_BUCKET,
        accessKeyId: config.S3_ACCESS_KEY_ID,
        secretAccessKey: config.S3_SECRET_ACCESS_KEY,
        ...(config.S3_ENDPOINT !== undefined ? { endpoint: config.S3_ENDPOINT } : {}),
        ...(config.S3_REGION !== undefined ? { region: config.S3_REGION } : {}),
        forcePathStyle: config.S3_FORCE_PATH_STYLE ?? config.STORAGE_DRIVER === 'minio'
      });
    }
  }
}
