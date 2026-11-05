# F10 · Analytics

**Covers** FR-65, FR-66 · **Tier** V1 core reports

## Purpose

Answer four questions: is messaging working, are the agents keeping up, are the numbers
healthy, and what is this costing.

## Reports

### Messaging funnel
Sent → delivered → read → replied, sliceable by campaign, template, sender, channel and date.
Reply rate is the headline, because it is also the strongest ban-risk signal
(`../08-antiban.md`).

### Campaign performance
Per campaign: recipients, delivery rate, read rate, reply rate, opt-out rate, skip breakdown
by reason, cost, duration actual vs estimated.

**Opt-out rate and skip reasons are first-class**, not buried — they are how an operator
notices a badly targeted campaign before WhatsApp does.

### Agent productivity
Conversations handled, first-response time, resolution time, messages sent, currently open.
Presented as workload, not as a leaderboard.

### Sender health
The dashboard an operator keeps open: per number — state, delivery ratio, reply ratio, recent
events, Meta quality rating and tier headroom.

### Cost report — the differentiator
Meta spend by template category against free Baileys volume, with a **"what this would have
cost entirely on Meta"** comparison and a per-campaign cost breakdown. No competitor exposes
this, because no competitor runs both transports as peers (`../03-competitive-analysis.md`).

## Design notes

Incremental rollups into `campaign_metric` and daily aggregate tables, refreshed by a worker.
Dashboards read rollups, never scan `message`. Raw queries stay available for export.

Numbers must reconcile: any dashboard figure must be reproducible from raw `message` rows, and
a test asserts it. A reporting layer that quietly disagrees with reality is worse than none.

## Acceptance criteria

- **AC-1** Every dashboard figure reconciles exactly with a raw query over `message`.
- **AC-2** Dashboards load in under 1 s at the Small-team tier by reading rollups.
- **AC-3** Cost is tracked per message in micros with a currency, and campaign actuals
  reconcile with estimates.
- **AC-4** Sender health shows the contributing risk events, not just a score.
- **AC-5** All reports are exportable as CSV, rate-limited and audited (they are a bulk-export
  surface — see `../09-security.md`).
- **AC-6** Date ranges respect the org timezone.

## Test cases

| id | Case | Expect |
|---|---|---|
| TC-10.1 | Rollup vs raw aggregate | Identical |
| TC-10.2 | Message fails after being counted as sent | Rollup corrects on the next refresh |
| TC-10.3 | Campaign spanning a DST boundary | Daily buckets correct in the org timezone |
| TC-10.4 | Cost estimate vs actual on a mixed-provider campaign | Within 5% |
| TC-10.5 | Export 100k rows | Streams, rate-limited, audited, does not exhaust memory |
