import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Test runner configuration. Unit tests live beside the code they cover; anything
 * needing a real database or queue lives under tests/ and is run separately.
 */
export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    environment: 'node',
    coverage: { provider: 'v8', reporter: ['text', 'html'], include: ['packages/**/src/**'] }
  },
  resolve: {
    alias: {
      '@crm/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
      '@crm/db': fileURLToPath(new URL('./packages/db/src/index.ts', import.meta.url))
    }
  }
});
