import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Test runner configuration. Unit tests live beside the code they cover; anything
 * needing a real database or queue lives under tests/ and is run separately.
 */
export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'tests/**/*.test.ts'],
    // Vendored Baileys keeps its own Jest suite; it is not ours to run here.
    exclude: ['**/node_modules/**', 'packages/baileys/**'],
    environment: 'node',

    // Test FILES run one at a time, not in parallel.
    //
    // The integration tests share one database, so concurrent files corrupt each other's
    // fixtures: one truncating `org` while another holds rows referencing it produces foreign
    // key violations, and the API tests — which require exactly one org, because a
    // config-level key cannot say which tenant it means — see orgs another file created and
    // correctly refuse with 409. Every one of those passes alone and fails in suite, which is
    // the most confusing failure mode there is.
    //
    // The honest alternative is a separate database per file. That is worth doing when the
    // suite gets slow enough to care; at this size serial takes about two seconds.
    fileParallelism: false,
    coverage: { provider: 'v8', reporter: ['text', 'html'], include: ['packages/**/src/**'] }
  },
  resolve: {
    alias: {
      '@crm/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
      '@crm/db': fileURLToPath(new URL('./packages/db/src/index.ts', import.meta.url)),
      '@crm/channels': fileURLToPath(new URL('./packages/channels/src/index.ts', import.meta.url)),
      '@crm/channel-fake': fileURLToPath(new URL('./packages/channels/fake/src/index.ts', import.meta.url)),
      '@crm/kms-local': fileURLToPath(new URL('./packages/providers/kms/local/src/index.ts', import.meta.url)),
      '@crm/auth-builtin': fileURLToPath(new URL('./packages/providers/auth/builtin/src/index.ts', import.meta.url)),
      '@crm/llm': fileURLToPath(new URL('./packages/providers/llm/src/index.ts', import.meta.url)),
      '@crm/storage': fileURLToPath(new URL('./packages/providers/storage/src/index.ts', import.meta.url)),
      '@crm/storage-filesystem': fileURLToPath(new URL('./packages/providers/storage/filesystem/src/index.ts', import.meta.url)),
      '@crm/storage-s3': fileURLToPath(new URL('./packages/providers/storage/s3/src/index.ts', import.meta.url)),
      '@crm/channel-baileys': fileURLToPath(new URL('./packages/channels/baileys/src/index.ts', import.meta.url)),
      '@crm/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url))
    }
  }
});
