import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, rm, stat as fsStat, readdir } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import {
  assertValidKey, InvalidKeyError, ObjectNotFoundError,
  type PutOptions, type StorageDriver, type StoredObject
} from '@crm/storage';

/** Where the content type is kept, since a filesystem has nowhere to put it. */
const META_SUFFIX = '.meta';

/**
 * Stores files in a directory. The free, self-hostable default for the `lean` preset.
 *
 * Fine for one machine; the moment there is more than one application process they need shared
 * storage, which is what the MinIO and S3 drivers are for. Nothing above this interface changes
 * when that happens.
 *
 * **Content type lives in a sidecar** (`<key>.meta`). A filesystem has no place to record it
 * and S3 does, so without this `stat()` would answer differently depending on the backend —
 * precisely what the contract suite exists to rule out. Sidecars are hidden from `list()`.
 */
export class FilesystemStorage implements StorageDriver {
  readonly name = 'filesystem';
  readonly #root: string;

  /** Takes the directory everything lives under. Created on first write, not at construction. */
  constructor(root: string) {
    this.#root = resolve(root);
  }

  /**
   * Turns a key into an absolute path, refusing anything that would escape the root.
   *
   * `assertValidKey` already rejects `..` segments, so this is the second of two independent
   * checks. That is deliberate: a path-traversal bug here reads the encryption key out of
   * `.env`, and one validation function away from a `resolve()` is not where a single point of
   * failure belongs.
   */
  #pathFor(key: string): string {
    assertValidKey(key);
    const full = resolve(join(this.#root, key));
    if (full !== this.#root && !full.startsWith(this.#root + sep)) {
      throw new InvalidKeyError(key, 'resolves outside the storage root');
    }
    return full;
  }

  /** Stores bytes and their content type, creating directories as needed. */
  async put(key: string, data: Uint8Array, options: PutOptions): Promise<StoredObject> {
    const path = this.#pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    await writeFile(`${path}${META_SUFFIX}`, JSON.stringify({ contentType: options.contentType }));
    return { key, size: data.byteLength, contentType: options.contentType };
  }

  /** Reads an object whole. */
  async get(key: string): Promise<Uint8Array> {
    const path = this.#pathFor(key);
    try {
      return await readFile(path);
    } catch {
      throw new ObjectNotFoundError(key);
    }
  }

  /**
   * Opens a read stream.
   *
   * Existence is checked first so a missing key fails here, as `ObjectNotFoundError`, rather
   * than as an `error` event on a stream the caller has already begun piping to a response.
   */
  async getStream(key: string): Promise<Readable> {
    const path = this.#pathFor(key);
    try {
      await fsStat(path);
    } catch {
      throw new ObjectNotFoundError(key);
    }
    return createReadStream(path);
  }

  /** Metadata without the bytes. */
  async stat(key: string): Promise<StoredObject | null> {
    const path = this.#pathFor(key);
    try {
      const s = await fsStat(path);
      return { key, size: s.size, contentType: await this.#contentTypeOf(path) };
    } catch {
      return null;
    }
  }

  /** Removes an object and its sidecar. */
  async delete(key: string): Promise<boolean> {
    const path = this.#pathFor(key);
    const existed = (await this.stat(key)) !== null;
    await rm(path, { force: true });
    await rm(`${path}${META_SUFFIX}`, { force: true });
    return existed;
  }

  /** Every object under a prefix, sidecars excluded. */
  async *list(prefix: string): AsyncIterable<StoredObject> {
    // A prefix is not a key — it may be a bare directory like `org/<id>` — so it gets the
    // traversal check without the full key grammar.
    if (prefix.includes('..') || prefix.includes('\0') || prefix.startsWith('/')) {
      throw new InvalidKeyError(prefix, 'unsafe prefix');
    }
    const base = resolve(join(this.#root, prefix));
    if (base !== this.#root && !base.startsWith(this.#root + sep)) {
      throw new InvalidKeyError(prefix, 'resolves outside the storage root');
    }

    yield* this.#walk(base, prefix);
  }

  /** Recurses one directory, yielding objects with keys relative to the root. */
  async *#walk(dir: string, keyPrefix: string): AsyncIterable<StoredObject> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;                       // nothing under this prefix is not an error
    }

    for (const entry of entries) {
      const childKey = keyPrefix === '' ? entry.name : `${keyPrefix}/${entry.name}`;
      if (entry.isDirectory()) {
        yield* this.#walk(join(dir, entry.name), childKey);
        continue;
      }
      if (entry.name.endsWith(META_SUFFIX)) continue;   // sidecars are not objects

      const path = join(dir, entry.name);
      const s = await fsStat(path);
      yield { key: childKey, size: s.size, contentType: await this.#contentTypeOf(path) };
    }
  }

  /** Reads the sidecar, falling back to a type that promises nothing. */
  async #contentTypeOf(path: string): Promise<string> {
    try {
      const raw = await readFile(`${path}${META_SUFFIX}`, 'utf8');
      const parsed = JSON.parse(raw) as { contentType?: string };
      return parsed.contentType ?? 'application/octet-stream';
    } catch {
      // A sidecar written by an older version, or lost. `octet-stream` is the honest answer:
      // it says "bytes" and invites no browser to interpret them.
      return 'application/octet-stream';
    }
  }
}
