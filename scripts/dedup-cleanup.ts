/**
 * Cleans up what re-importing the same files over and over leaves behind. Run it yourself; the app never does.
 *
 *   npm run dedup:cleanup                       look at every organisation, change nothing, write a report
 *   npm run dedup:cleanup -- --org hiring-studios
 *   npm run dedup:cleanup -- --org hiring-studios --apply     do it (asks you to type "yes" first)
 *   npm run dedup:cleanup -- --org all --apply                every organisation
 *
 * A dry run is the default and always writes `dedup-report-<time>.csv` in the current folder.
 *
 * What it looks for, per organisation:
 *   1. Duplicate tags      the same name once spaces and capitals are ignored. All people move onto the
 *                          oldest tag, campaigns that pointed at a copy are repointed, the copy is deleted.
 *   2. Identical drafts    draft campaigns with the same name, message, audience and number. The newest
 *                          stays; the others are cancelled (never deleted).
 *   3. Repeated uploads    (report only) the same file uploaded more than once. "Upload anyway" already
 *                          marks the older run as replaced, so nothing here needs changing.
 *   4. Possible same person (report only) different contacts whose phone numbers end in the same ten digits.
 *                          Merging people means merging their conversations, so that is left for you to
 *                          decide from the report.
 *
 * Contacts are never duplicated by importing a file twice: the same phone or email always finds the same
 * person. Every change is one transaction per group and one `audit_log` row.
 */
import { writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { sql } from 'drizzle-orm';
import { createDatabase } from '@crm/db';
import { loadConfig } from '@crm/shared';
import { writeAudit, AUDIT, SYSTEM_ACTOR } from '@crm/core';

/** One thing the script found, as a row of the report. */
interface Finding {
  org: string; kind: string; action: string; keep: string; drop: string; detail: string;
}

/** Parses `--key value` and bare `--flag` arguments. */
function flags(argv: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out.set(a.slice(2), 'true');
    else { out.set(a.slice(2), next); i++; }
  }
  return out;
}

/** Prints one line. */
const say = (line = ''): void => { process.stdout.write(`${line}\n`); };
/** Quotes a value for the CSV report. */
const csvCell = (v: string): string => `"${v.replace(/"/g, '""')}"`;
/** A list of rows a raw query returns. */
type Rows<T> = Array<T>;
/** Types the rows a raw query returns. */
const rowsOf = <T>(r: unknown): Rows<T> => r as Rows<T>;

/** Finds the duplicates, writes the report, and (with --apply, after a yes) cleans them up. */
async function main(): Promise<void> {
  const f = flags(process.argv.slice(2));
  const apply = f.has('apply');
  const config = loadConfig();
  const db = createDatabase(config.DATABASE_URL, { max: 2 });

  try {
    const orgs = rowsOf<{ id: string; slug: string }>(await db.execute(sql`
      SELECT id, slug FROM org ${f.get('org') === undefined || f.get('org') === 'all' ? sql`` : sql`WHERE slug = ${f.get('org')!}`}
      ORDER BY slug`));
    if (orgs.length === 0) { say('  no such organisation'); process.exit(1); }
    if (orgs.length > 1 && f.get('org') !== 'all' && apply) {
      say('  --apply with several organisations needs --org <slug> or --org all'); process.exit(1);
    }

    const findings: Finding[] = [];
    const applyPlans: Array<() => Promise<void>> = [];

    for (const org of orgs) {
      // 1 · duplicate tags
      const tagGroups = rowsOf<{ norm: string; ids: string[]; names: string[]; made: string[] }>(await db.execute(sql`
        SELECT lower(btrim(name)) AS norm, array_agg(id ORDER BY created_at, id) AS ids,
               array_agg(name ORDER BY created_at, id) AS names, array_agg(created_at::text ORDER BY created_at, id) AS made
        FROM tag WHERE org_id = ${org.id} GROUP BY 1 HAVING count(*) > 1`));
      for (const g of tagGroups) {
        const keep = g.ids[0]!;
        for (const dropId of g.ids.slice(1)) {
          findings.push({
            org: org.slug, kind: 'duplicate tag', action: 'merge into the oldest tag and delete this one',
            keep, drop: dropId, detail: `"${g.names[0]!}" (kept) and "${g.names[g.ids.indexOf(dropId)]!}"`
          });
          applyPlans.push(async () => {
            await db.transaction(async (tx) => {
              await tx.execute(sql`SELECT set_config('app.org_id', ${org.id}, true)`);
              const moved = rowsOf<unknown>(await tx.execute(sql`
                INSERT INTO contact_tag (org_id, contact_id, tag_id)
                SELECT org_id, contact_id, ${keep} FROM contact_tag WHERE org_id = ${org.id} AND tag_id = ${dropId}
                ON CONFLICT DO NOTHING RETURNING contact_id`));
              await tx.execute(sql`UPDATE campaign SET from_tag_id = ${keep} WHERE org_id = ${org.id} AND from_tag_id = ${dropId}`);
              await tx.execute(sql`DELETE FROM tag WHERE id = ${dropId} AND org_id = ${org.id}`);
              await writeAudit(tx, {
                orgId: org.id, actor: SYSTEM_ACTOR, action: AUDIT.tagMergedByCleanup, targetType: 'tag', targetId: keep,
                before: { mergedTagId: dropId, name: g.names[g.ids.indexOf(dropId)] }, after: { keptTagId: keep, peopleAdded: moved.length }
              });
            });
          });
        }
      }

      // 2 · identical draft campaigns
      const draftGroups = rowsOf<{ ids: string[]; name: string }>(await db.execute(sql`
        SELECT array_agg(id ORDER BY created_at DESC, id) AS ids, min(name) AS name
        FROM campaign WHERE org_id = ${org.id} AND status = 'draft'
        GROUP BY name, body, sender_identity_id, from_tag_id, from_import_run_id, from_segment_id, ai_template_id, media_asset_id,
                 explicit_contact_ids::text
        HAVING count(*) > 1`));
      for (const g of draftGroups) {
        const keep = g.ids[0]!;
        for (const dropId of g.ids.slice(1)) {
          findings.push({
            org: org.slug, kind: 'identical draft campaign', action: 'cancel this draft (the newest is kept)',
            keep, drop: dropId, detail: `"${g.name}"`
          });
          applyPlans.push(async () => {
            await db.transaction(async (tx) => {
              await tx.execute(sql`SELECT set_config('app.org_id', ${org.id}, true)`);
              await tx.execute(sql`UPDATE campaign SET status = 'cancelled', updated_at = now() WHERE id = ${dropId} AND org_id = ${org.id} AND status = 'draft'`);
              await writeAudit(tx, {
                orgId: org.id, actor: SYSTEM_ACTOR, action: AUDIT.campaignCancelledByCleanup, targetType: 'campaign', targetId: dropId,
                before: { status: 'draft' }, after: { status: 'cancelled', keptCampaignId: keep }
              });
            });
          });
        }
      }

      // 3 · repeated uploads (report only)
      const uploads = rowsOf<{ filename: string; n: number; live: number }>(await db.execute(sql`
        SELECT min(filename) AS filename, count(*)::int AS n, count(*) FILTER (WHERE superseded_at IS NULL)::int AS live
        FROM import_run WHERE org_id = ${org.id} GROUP BY sha256 HAVING count(*) > 1`));
      for (const u of uploads) {
        findings.push({
          org: org.slug, kind: 'repeated upload', action: u.live > 1 ? 'REVIEW: more than one live run' : 'none: older runs are already marked replaced',
          keep: '', drop: '', detail: `"${u.filename}" uploaded ${String(u.n)} times, ${String(u.live)} live`
        });
      }

      // 4 · possible same person (report only)
      const people = rowsOf<{ tail: string; ids: string[]; names: string[] }>(await db.execute(sql`
        SELECT right(regexp_replace(i.value_normalized, '\D', '', 'g'), 10) AS tail,
               array_agg(DISTINCT c.id) AS ids, array_agg(DISTINCT c.display_name) AS names
        FROM contact_identity i JOIN contact c ON c.id = i.contact_id
        WHERE i.org_id = ${org.id} AND i.kind = 'phone' AND c.deleted_at IS NULL
        GROUP BY 1 HAVING count(DISTINCT c.id) > 1`));
      for (const p of people) {
        findings.push({
          org: org.slug, kind: 'possible same person', action: 'REVIEW by hand (conversations would have to be merged)',
          keep: '', drop: p.ids.join(' '), detail: `phone ends ${p.tail}: ${p.names.join(' / ')}`
        });
      }
    }

    // report
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = `dedup-report-${stamp}.csv`;
    const header = 'organisation,kind,action,keep,drop,detail';
    writeFileSync(file, [header, ...findings.map((x) => [x.org, x.kind, x.action, x.keep, x.drop, x.detail].map(csvCell).join(','))].join('\n') + '\n');

    const by = new Map<string, number>();
    for (const x of findings) by.set(`${x.org} · ${x.kind}`, (by.get(`${x.org} · ${x.kind}`) ?? 0) + 1);
    say();
    say(findings.length === 0 ? '  Nothing to clean up.' : '  What was found:');
    for (const [k, n] of [...by].sort()) say(`    ${String(n).padStart(5)}  ${k}`);
    say(`\n  Report: ${file}`);

    const changes = applyPlans.length;
    if (!apply) { say(changes > 0 ? `\n  Dry run: nothing was changed. ${String(changes)} change(s) would be made with --apply.` : ''); return; }
    if (changes === 0) { say('\n  Nothing to change.'); return; }

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`\n  Make ${String(changes)} change(s) now? Type yes to continue: `);
    rl.close();
    if (answer.trim() !== 'yes') { say('  Cancelled, nothing was changed.'); return; }

    let done = 0;
    for (const plan of applyPlans) { await plan(); done++; }
    say(`  Done: ${String(done)} change(s). Run it again to confirm nothing is left.`);
  } finally {
    await db.$client.end();
  }
}

main().catch((err: unknown) => { process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`); process.exit(1); });
