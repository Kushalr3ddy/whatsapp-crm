import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * End-to-end (browser) tests, kept apart from the vitest suites: vitest owns `*.test.ts`, Playwright
 * owns `*.spec.ts` under `tests/e2e/`, so neither runner grabs the other's files.
 *
 * The specs sign in as the dev test admin, so they need `TEST_EMAIL` / `TEST_PASSWORD`. The app
 * loads `.env` via `--env-file`, but the Playwright runner does not, so read those two here without
 * pulling in a dotenv dependency. A spec skips itself when they are absent (e.g. a fresh clone).
 */
try {
  for (const line of readFileSync(new URL('.env', import.meta.url), 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m !== null && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2];
  }
} catch { /* no .env — fall back to the real environment */ }

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3001';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL, trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Reuse the stack if it is already up (the usual local case: `npm run dev:all`), otherwise start
  // it. Kept generous because a cold start migrates the database and boots three processes.
  webServer: {
    command: 'npm run dev:all',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 180_000
  }
});
