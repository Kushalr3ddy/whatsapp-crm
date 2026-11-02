import { describe, expect, it } from 'vitest';
import * as core from '@crm/core';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The old anti-ban engine is gone, and stays gone: none of its names may come back into the code. A new anti-ban plugs in
 * through `packages/core/src/antiban.ts`; it does not bring a warm-up ramp, a risk score or an advisory mode with it
 * unannounced. If a name below is wanted again, this test is the place that says so on purpose.
 */
const root = fileURLToPath(new URL('../../', import.meta.url));

/** Where the engine lived. `packages/db/migrations` is history and is not scanned; neither is the vendored Baileys. */
const SCANNED = ['apps', 'packages/core', 'packages/db/src', 'packages/shared', 'packages/channels'];
const SKIPPED_DIRS = new Set(['node_modules', '.next', 'dist', 'coverage', 'test-results']);
const TEXT = /\.(ts|tsx|js|mjs|cjs|json|css|md|sql|html)$/;

/** The engine's own names. `advisory` is matched as a word of ours, not as Postgres' `pg_advisory_xact_lock`. */
const FORBIDDEN = new RegExp([
  'riskScore', 'risk_score', 'RiskBand', 'computeRiskScore', 'checkSendAllowance', 'WARMUP_RAMP', 'dailyCeiling', 'DORMANT_MS',
  'scoreSenderHealth', 'scoreConnectedSenders', 'deliveryDelayMultiplier', 'beginRecovery', 'recoveryState', 'recoveryIncidentFor',
  'sweepRestriction', 'checkRestriction', 'classifyRestriction', 'checkContactGraph', 'EntropyScheduler', 'entropyPlan',
  'readIsDue', 'timezoneForPhone', 'circadianActivity', 'circadianDelayMs', 'circadianTimezone',
  '(?<!pg_)advisory(?!_xact| lock)', 'daily_cap_override', 'dailyCapOverride', 'warmup_started_at', 'warmupStartedAt',
  'quarantined', 'degraded', 'restriction_state', 'restrictionState', 'recovery_until', 'recoveryUntil', 'recovery_incident',
  'basicPolicy', 'makeBasicPolicy', 'BASIC_GAP_MIN_MS', 'BASIC_GAP_MAX_MS', 'BASIC_BATCH',
  'perSenderDailyCap', 'CampaignForecast', 'SEND_RATE_PER_', 'IDENTICAL_BODY', 'identicalBodyCap', 'SEND_CIRCADIAN', 'CONTACT_GRAPH_GATES', 'SEND_BACKGROUND_ENTROPY'
].join('|'));

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIPPED_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (TEXT.test(name)) out.push(path);
  }
}

describe('the old anti-ban engine stays removed', () => {
  it('has no trace of its names in the code', () => {
    const files: string[] = [];
    for (const dir of SCANNED) walk(join(root, dir), files);
    const self = fileURLToPath(import.meta.url);
    expect(files.length).toBeGreaterThan(100);

    const hits: string[] = [];
    for (const file of files) {
      if (file === self) continue;
      readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
        const found = FORBIDDEN.exec(line);
        if (found !== null) hits.push(`${relative(root, file).split(sep).join('/')}:${String(index + 1)} ${found[0]}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it('has none of its modules left', () => {
    for (const gone of ['pacing', 'health', 'recovery', 'restriction', 'contact-graph', 'entropy', 'read-receipts', 'recipient-timezone']) {
      expect(() => statSync(join(root, 'packages/core/src', `${gone}.ts`)), gone).toThrow();
    }
  });
});

describe('AC-9.3 the placeholder policy is deleted', () => {
  it('AC-9.3 basicPolicy and its constants are no longer exported, and the v2 policy is', () => {
    for (const gone of ['basicPolicy', 'makeBasicPolicy', 'BASIC_GAP_MIN_MS', 'BASIC_GAP_MAX_MS', 'BASIC_BATCH', 'typingDelayMs']) {
      expect(core, gone).not.toHaveProperty(gone);
    }
    expect(core.makeAntiBanPolicy).toBeTypeOf('function');
  });
});
