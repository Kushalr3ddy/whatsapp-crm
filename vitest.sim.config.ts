import { defineConfig } from 'vitest/config';
import base from './vitest.config.js';

/**
 * The anti-ban simulation (docs/12-testing.md). Separate from `npm test` because a scenario runs
 * days of simulated traffic through the real engine and takes tens of seconds each; run it with
 * `npm run test:sim`. Files are `*.sim.ts` so the ordinary runner never picks them up.
 */
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    // Replaced, not merged: merging would append to the base list and run the whole suite too.
    include: ['tests/simulation/**/*.sim.ts'],
    testTimeout: 900_000, hookTimeout: 120_000
  }
});
