import { describe, expect, it } from 'vitest';
import { InvalidKeyError, ObjectNotFoundError, type StorageDriver } from '@crm/storage';

/** How a suite run gets a clean store, and disposes of it afterwards. */
export interface StorageHarness {
  /** A fresh, empty driver per test. */
  create(): Promise<{ storage: StorageDriver; dispose: () => Promise<void> }>;
}

/** Collects an async iterable, because every assertion here wants the whole list. */
async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of source) out.push(item);
  return out;
}

/** Reads a stream to the end. */
async function drain(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

/**
 * The conformance suite EVERY StorageDriver must pass — filesystem, MinIO, S3, and anything
 * added later.
 *
 * This is what makes "swap the storage backend" a claim rather than a hope. Each driver gets
 * the same tests run against it, so a new one is correct by construction instead of
 * hand-verified, and a migration is a config change whose safety was tested in advance
 * (docs/12-testing.md, docs/18-providers.md).
 *
 * The tests never know which implementation they are driving. That is the whole point: anything
 * they can observe is part of the contract, and anything they cannot is a backend's own
 * business.
 *
 * Call it from a .test.ts file with a harness for the implementation under test.
 */
export function runStorageDriverContract(name: string, harness: StorageHarness): void {
  describe(`StorageDriver contract: ${name}`, () => {

    describe('round trip', () => {
      it('returns exactly the bytes that were stored', async () => {
        const { storage, dispose } = await harness.create();
        // Binary, not text: a driver that treats content as UTF-8 corrupts every PDF and
        // every image, and a text-only test would never notice.
        const data = new Uint8Array([0, 1, 2, 255, 254, 0, 128]);

        await storage.put('org/a/media/x.bin', data, { contentType: 'application/octet-stream' });

        expect(Buffer.from(await storage.get('org/a/media/x.bin'))).toEqual(Buffer.from(data));
        await dispose();
      });

      it('reports the size and content type it was given', async () => {
        const { storage, dispose } = await harness.create();
        const data = new Uint8Array(1234);

        const stored = await storage.put('org/a/media/y.pdf', data, { contentType: 'application/pdf' });

        expect(stored.size).toBe(1234);
        expect(stored.contentType).toBe('application/pdf');
        // And it survives — otherwise every backend would answer stat() differently.
        expect(await storage.stat('org/a/media/y.pdf')).toEqual(stored);
        await dispose();
      });

      it('streams the same bytes it returns whole', async () => {
        const { storage, dispose } = await harness.create();
        const data = Buffer.from('a'.repeat(100_000));
        await storage.put('org/a/media/big.txt', data, { contentType: 'text/plain' });

        // Serving a 100 MB document must not mean buffering it, so both paths must agree.
        expect(await drain(await storage.getStream('org/a/media/big.txt'))).toEqual(data);
        await dispose();
      });

      it('replaces an object when the same key is written twice', async () => {
        const { storage, dispose } = await harness.create();
        await storage.put('org/a/media/z', Buffer.from('first'), { contentType: 'text/plain' });
        await storage.put('org/a/media/z', Buffer.from('second'), { contentType: 'text/html' });

        expect(Buffer.from(await storage.get('org/a/media/z')).toString()).toBe('second');
        expect((await storage.stat('org/a/media/z'))?.contentType).toBe('text/html');
        await dispose();
      });

      it('stores an empty object without treating it as absent', async () => {
        const { storage, dispose } = await harness.create();
        await storage.put('org/a/media/empty', new Uint8Array(0), { contentType: 'text/plain' });

        // Zero bytes is a legitimate file. Conflating it with "missing" would make a
        // truncated upload silently disappear instead of being visible and wrong.
        expect((await storage.stat('org/a/media/empty'))?.size).toBe(0);
        await dispose();
      });
    });

    describe('absence', () => {
      it('throws ObjectNotFoundError rather than returning empty bytes', async () => {
        const { storage, dispose } = await harness.create();
        await expect(storage.get('org/a/media/nothing')).rejects.toBeInstanceOf(ObjectNotFoundError);
        await dispose();
      });

      it('fails to open a stream for a missing key, before any piping begins', async () => {
        const { storage, dispose } = await harness.create();
        // Otherwise the failure arrives as an error event on a stream already being piped to
        // an HTTP response whose headers have gone out.
        await expect(storage.getStream('org/a/media/nothing')).rejects.toBeInstanceOf(ObjectNotFoundError);
        await dispose();
      });

      it('returns null from stat rather than throwing', async () => {
        const { storage, dispose } = await harness.create();
        expect(await storage.stat('org/a/media/nothing')).toBeNull();
        await dispose();
      });

      it('treats deleting something absent as unremarkable', async () => {
        const { storage, dispose } = await harness.create();
        // Retention and erasure both re-run; a second delete must not be an error.
        expect(await storage.delete('org/a/media/nothing')).toBe(false);
        await dispose();
      });

      it('reports true when it actually deleted something, and the object is gone', async () => {
        const { storage, dispose } = await harness.create();
        await storage.put('org/a/media/gone', Buffer.from('x'), { contentType: 'text/plain' });

        expect(await storage.delete('org/a/media/gone')).toBe(true);
        expect(await storage.stat('org/a/media/gone')).toBeNull();
        await dispose();
      });
    });

    describe('keys', () => {
      // The security boundary. A filesystem driver turns a key into a path, so a traversal
      // bug reads the encryption key out of .env — every driver must refuse identically.
      const illegal = [
        ['../escape', 'parent segment'],
        ['org/../../escape', 'parent segment mid-key'],
        ['/absolute', 'leading slash'],
        ['trailing/', 'trailing slash'],
        ['org//empty', 'empty segment'],
        ['org/a/./here', 'current-directory segment'],
        ['back\\slash', 'backslash'],
        ['', 'empty key']
      ] as const;

      for (const [key, why] of illegal) {
        it(`refuses ${why}`, async () => {
          const { storage, dispose } = await harness.create();
          await expect(storage.put(key, Buffer.from('x'), { contentType: 'text/plain' }))
            .rejects.toBeInstanceOf(InvalidKeyError);
          // Refused on read too: a driver that only validates on write is one bug away from
          // serving whatever a crafted key points at.
          await expect(storage.get(key)).rejects.toBeInstanceOf(InvalidKeyError);
          await dispose();
        });
      }

      it('accepts dots, dashes and underscores inside a segment', async () => {
        const { storage, dispose } = await harness.create();
        const key = 'org/a/media/a_file-name.v2.pdf';
        await storage.put(key, Buffer.from('x'), { contentType: 'application/pdf' });
        expect(await storage.stat(key)).not.toBeNull();
        await dispose();
      });
    });

    describe('listing', () => {
      it('returns everything under a prefix, and nothing outside it', async () => {
        const { storage, dispose } = await harness.create();
        await storage.put('org/a/media/one', Buffer.from('1'), { contentType: 'text/plain' });
        await storage.put('org/a/media/two', Buffer.from('2'), { contentType: 'text/plain' });
        await storage.put('org/b/media/three', Buffer.from('3'), { contentType: 'text/plain' });

        const keys = (await collect(storage.list('org/a'))).map((o) => o.key).sort();

        // Tenant erasure depends on this: listing one org must never reach another's files.
        expect(keys).toEqual(['org/a/media/one', 'org/a/media/two']);
        await dispose();
      });

      it('recurses into nested prefixes', async () => {
        const { storage, dispose } = await harness.create();
        await storage.put('org/a/media/deep/nested/file', Buffer.from('x'), { contentType: 'text/plain' });

        expect((await collect(storage.list('org'))).map((o) => o.key))
          .toContain('org/a/media/deep/nested/file');
        await dispose();
      });

      it('yields nothing for a prefix with no objects, rather than failing', async () => {
        const { storage, dispose } = await harness.create();
        expect(await collect(storage.list('org/nobody'))).toEqual([]);
        await dispose();
      });

      it('stops listing an object once it is deleted', async () => {
        const { storage, dispose } = await harness.create();
        await storage.put('org/a/media/tmp', Buffer.from('x'), { contentType: 'text/plain' });
        await storage.delete('org/a/media/tmp');

        // A backend keeping sidecar metadata must remove that too, or a deleted file lingers
        // in every listing as a ghost.
        expect(await collect(storage.list('org/a'))).toEqual([]);
        await dispose();
      });

      it('refuses a prefix that would escape the store', async () => {
        const { storage, dispose } = await harness.create();
        await expect(collect(storage.list('../..'))).rejects.toBeInstanceOf(InvalidKeyError);
        await dispose();
      });
    });

    describe('identity', () => {
      it('names itself, so a stored object can record where it came from', async () => {
        const { storage, dispose } = await harness.create();
        expect(typeof storage.name).toBe('string');
        expect(storage.name.length).toBeGreaterThan(0);
        await dispose();
      });
    });
  });
}
