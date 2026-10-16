import { randomUUID } from 'node:crypto';
import { describe, it } from 'vitest';
import {
  S3Client, CreateBucketCommand, DeleteBucketCommand, ListObjectsV2Command, DeleteObjectCommand
} from '@aws-sdk/client-s3';
import { S3Storage } from '@crm/storage-s3';
import { runStorageDriverContract } from './storage-driver.js';

/**
 * Runs the shared StorageDriver contract against an S3-compatible server.
 *
 * It only runs when `S3_TEST_ENDPOINT` is set, so `npm test` stays green on a machine with no S3 server. CI
 * starts moto, an S3 emulator, as a service container (MinIO's own images are no longer pulled from Docker
 * Hub or Quay, and a real bucket would need an account). Locally:
 * `docker run -d --name crm-s3-test -p 19000:5000 motoserver/moto:latest`, then
 * `S3_TEST_ENDPOINT=http://localhost:19000 S3_TEST_ACCESS_KEY_ID=test S3_TEST_SECRET_ACCESS_KEY=test
 * npx vitest run tests/contract/s3-storage.test.ts`, then `docker rm -f crm-s3-test`.
 *
 * An emulator proves the driver speaks the S3 protocol correctly; it does not prove behaviour against R2,
 * B2 or AWS themselves (see docs/21-deferred.md, D-63).
 */
const endpoint = process.env.S3_TEST_ENDPOINT;
const accessKeyId = process.env.S3_TEST_ACCESS_KEY_ID ?? 'test';
const secretAccessKey = process.env.S3_TEST_SECRET_ACCESS_KEY ?? 'test';

if (endpoint === undefined || endpoint === '') {
  describe.skip('StorageDriver contract: s3 (set S3_TEST_ENDPOINT to run)', () => {
    it('is skipped without an S3 endpoint', () => undefined);
  });
} else {
  const admin = new S3Client({
    region: 'us-east-1', endpoint, forcePathStyle: true, credentials: { accessKeyId, secretAccessKey }
  });

  runStorageDriverContract('s3 (emulator)', {
    async create() {
      // A fresh bucket per test, emptied and removed afterwards, so nothing leaks between tests.
      const bucket = `crm-test-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
      await admin.send(new CreateBucketCommand({ Bucket: bucket }));
      return {
        storage: new S3Storage({
          name: 's3', bucket, endpoint, region: 'us-east-1', forcePathStyle: true, accessKeyId, secretAccessKey
        }),
        dispose: async () => {
          let token: string | undefined;
          do {
            const page = await admin.send(new ListObjectsV2Command({
              Bucket: bucket, ...(token !== undefined ? { ContinuationToken: token } : {})
            }));
            for (const o of page.Contents ?? []) {
              await admin.send(new DeleteObjectCommand({ Bucket: bucket, Key: o.Key! }));
            }
            token = page.IsTruncated === true ? page.NextContinuationToken : undefined;
          } while (token !== undefined);
          await admin.send(new DeleteBucketCommand({ Bucket: bucket }));
        }
      };
    }
  });
}
