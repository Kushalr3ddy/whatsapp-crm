import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * The LIVE suite: a headed (visible) walkthrough of the whole product against a running stack and a
 * REAL linked WhatsApp number. Unlike `playwright.config.ts` this one sends real messages — only to
 * the numbers named in `.env` (`LIVE_SEND_TO`, `LIVE_BROADCAST_TO`), which are the operator's own.
 *
 * It never starts the stack: run `npm run dev:all` (the real gateway, not `GATEWAY_CHANNEL=fake`)
 * first, then `npm run test:live`. `.env` is read here the same way the main config does.
 */
try {
  for (const line of readFileSync(new URL('.env', import.meta.url), 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m !== null && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2];
  }
} catch { /* no .env — fall back to the real environment */ }

export default defineConfig({
  testDir: './tests/live',
  testMatch: '**/*.live.ts',
  // One long, ordered story. Linking a number and real delivery can each take minutes.
  timeout: 20 * 60_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3001',
    // Visible by default — that is the point. LIVE_HEADLESS=1 is for checking the suite itself in CI-ish places.
    headless: process.env.LIVE_HEADLESS === '1',
    // Slow enough to follow with your eyes; override with LIVE_SLOWMO=0 for a quick run.
    launchOptions: { slowMo: Number(process.env.LIVE_SLOWMO ?? 350) },
    viewport: { width: 1360, height: 860 },
    trace: 'retain-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
