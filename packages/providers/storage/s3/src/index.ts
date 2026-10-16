import type { Readable } from 'node:stream';
import {
  S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand,
  ListObjectsV2Command, type S3ClientConfig
} from '@aws-sdk/client-s3';
import {
  assertValidKey, InvalidKeyError, ObjectNotFoundError,
  type PutOptions, type StorageDriver, type StoredObject
} from '@crm/storage';

/** What the S3 driver needs. Works with AWS S3, Cloudflare R2, Backblaze B2 and MinIO. */
export interface S3StorageOptions {
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Set for everything that is not AWS itself (R2, B2, MinIO). Leave unset for AWS S3. */
  readonly endpoint?: string;
  /** `auto` suits R2; AWS and B2 want a real region. */
  readonly region?: string;
  /** MinIO and most self-hosted servers need `true`; AWS and R2 work with `false`. */
  readonly forcePathStyle?: boolean;
  /** Reported as `name`, so a stored object can record whether it is `s3` or `minio`. */
  readonly name?: string;
}

/** True when an AWS SDK error means "no such object" (404 on a HEAD carries no body or name). */
function isNotFound(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === 'NoSuchKey' || e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404;
}

/**
 * Stores files in an S3-compatible bucket: one shared place that the API, the gateway and any
 * future second host can all reach, and that survives the machine being replaced.
 *
 * Everything above this class sees only `StorageDriver`, so switching `STORAGE_DRIVER` from
 * `filesystem` to `s3` changes no application code; the shared contract suite is what proves that.
 *
 * Differences from the filesystem driver, all invisible to callers:
 * - The content type is stored as native object metadata, so there is no sidecar.
 * - `list()` reports `application/octet-stream` for every object, because a bucket listing does
 *   not return content types and asking for each one would cost a request per object. `stat()`
 *   gives the true type.
 * - There are no signed URLs, on purpose: every download is resolved through the database and
 *   streamed by the API, because row-level security does not reach the bucket (D-11).
 */
export class S3Storage implements StorageDriver {
  readonly name: string;
  readonly #bucket: string;
  readonly #client: S3Client;

  /** Builds the client; no network call is made until the first operation. */
  constructor(options: S3StorageOptions) {
    this.name = options.name ?? 's3';
    this.#bucket = options.bucket;
    const config: S3ClientConfig = {
      region: options.region ?? 'auto',
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
      ...(options.endpoint !== undefined ? { endpoint: options.endpoint } : {}),
      ...(options.forcePathStyle !== undefined ? { forcePathStyle: options.forcePathStyle } : {})
    };
    this.#client = new S3Client(config);
  }

  /** Stores bytes and their content type, replacing anything already at the key. */
  async put(key: string, data: Uint8Array, options: PutOptions): Promise<StoredObject> {
    assertValidKey(key);
    await this.#client.send(new PutObjectCommand({
      Bucket: this.#bucket, Key: key, Body: data, ContentType: options.contentType
    }));
    return { key, size: data.byteLength, contentType: options.contentType };
  }

  /** Reads an object whole. */
  async get(key: string): Promise<Uint8Array> {
    assertValidKey(key);
    try {
      const out = await this.#client.send(new GetObjectCommand({ Bucket: this.#bucket, Key: key }));
      return await out.Body!.transformToByteArray();
    } catch (error) {
      if (isNotFound(error)) throw new ObjectNotFoundError(key);
      throw error;
    }
  }

  /** Reads an object as a stream. A missing key fails here, before anything is piped. */
  async getStream(key: string): Promise<Readable> {
    assertValidKey(key);
    try {
      const out = await this.#client.send(new GetObjectCommand({ Bucket: this.#bucket, Key: key }));
      return out.Body as Readable;
    } catch (error) {
      if (isNotFound(error)) throw new ObjectNotFoundError(key);
      throw error;
    }
  }

  /** Metadata without the bytes, or null when the key names nothing. */
  async stat(key: string): Promise<StoredObject | null> {
    assertValidKey(key);
    try {
      const out = await this.#client.send(new HeadObjectCommand({ Bucket: this.#bucket, Key: key }));
      return {
        key, size: out.ContentLength ?? 0, contentType: out.ContentType ?? 'application/octet-stream'
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  /** Removes an object. S3 deletes silently, so existence is checked first to answer truthfully. */
  async delete(key: string): Promise<boolean> {
    assertValidKey(key);
    const existed = (await this.stat(key)) !== null;
    await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: key }));
    return existed;
  }

  /**
   * Every object under a prefix, following continuation tokens until the bucket stops returning
   * them. A prefix is treated as a directory (`org/a` does not match `org/ab/...`), the same as
   * the filesystem driver, because tenant erasure depends on never reaching another org's files.
   */
  async *list(prefix: string): AsyncIterable<StoredObject> {
    if (prefix.includes('..') || prefix.includes('\0') || prefix.startsWith('/') || prefix.includes('\\')) {
      throw new InvalidKeyError(prefix, 'unsafe prefix');
    }
    const directory = prefix === '' || prefix.endsWith('/') ? prefix : `${prefix}/`;
    let token: string | undefined;
    do {
      const page = await this.#client.send(new ListObjectsV2Command({
        Bucket: this.#bucket, Prefix: directory, ...(token !== undefined ? { ContinuationToken: token } : {})
      }));
      for (const object of page.Contents ?? []) {
        if (object.Key === undefined) continue;
        yield { key: object.Key, size: object.Size ?? 0, contentType: 'application/octet-stream' };
      }
      token = page.IsTruncated === true ? page.NextContinuationToken : undefined;
    } while (token !== undefined);
  }
}
