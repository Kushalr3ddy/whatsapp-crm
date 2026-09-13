# F5 · Campaigns

**Covers** FR-30…FR-37, FR-45 · **Fixes** M2, M10, M11, M12, M27, M28 · **Tier** V1

## Purpose

Send a template to many people, safely, over hours or days, surviving restarts, without
sending anything twice and without getting the number banned.

The old system did this inline in an HTTP handler (M2), which meant a Cloudflare 524 killed
large runs (M27), a Postgres advisory lock stood in for a queue (M28), and a disconnect lost
the batch with no record of intent.

## User stories

- As a marketer I target a segment, pick a template, schedule it, and see what it will cost
  and how long it will take *before* committing.
- As a marketer I pause a running campaign, and resume it, without duplicate sends.
- As a marketer I see exactly why each recipient was skipped.
- As an operator I am confident a campaign will never exceed a number's safe send rate.

## Design notes

**Recipients are snapshotted at launch** into `campaign_recipient`. A dynamic segment changing
mid-run must not change who is being messaged.

**Every send is an idempotent job** keyed on `(campaign_id, contact_id, template_version)`.
Re-enqueueing is a no-op; a worker restart cannot duplicate.

**Execution is deliberately slow.** The anti-ban limiter paces it. A 10,000-recipient campaign
over 5 warmed numbers takes days, and the dry run says so up front. This is a feature, and the
UI must make it feel like one rather than a bug.

**Pause/resume acts on the queue**, not by mutating rows, so in-flight jobs finish cleanly.

**Skips are reported, never dropped** (FR-45) — every `campaign_recipient` has a `skip_reason`.

## Acceptance criteria

- **AC-1** Dry run returns recipient count, estimated cost (per provider), estimated duration
  given current warmup and caps, and a risk assessment — before any write.
- **AC-2** Launch enqueues 10,000 recipients in under 5 seconds; execution is paced by the engine.
- **AC-3** Killing every worker mid-campaign and restarting produces zero duplicates and zero
  lost recipients.
- **AC-4** Pause stops new sends within one poll interval; resume continues from the exact point.
- **AC-5** Every recipient ends in a terminal state with a reason; none is silently absent.
- **AC-6** Quiet hours and the recipient's timezone are respected; a campaign scheduled into
  quiet hours waits rather than sending.
- **AC-7** A sender crossing risk High auto-pauses the campaign on that sender and alerts.
- **AC-8** An opt-out received mid-campaign removes that contact from all pending sends immediately.
- **AC-9** Cost actuals are reconciled against estimates and visible after completion.

## API surface

```
GET    /api/v1/campaigns
POST   /api/v1/campaigns                  create draft
POST   /api/v1/campaigns/{id}/dry-run     counts, cost, duration, risk
POST   /api/v1/campaigns/{id}/launch
POST   /api/v1/campaigns/{id}/pause
POST   /api/v1/campaigns/{id}/resume
POST   /api/v1/campaigns/{id}/cancel
GET    /api/v1/campaigns/{id}/recipients  ?status=  cursor
GET    /api/v1/campaigns/{id}/metrics
```

## Test cases

| id | Case | Expect |
|---|---|---|
| TC-5.1 | Launch 10k, kill all workers at ~50%, restart | No duplicates, no losses, run completes |
| TC-5.2 | Segment changes mid-run | Recipient set unchanged (snapshot honoured) |
| TC-5.3 | Contact replies STOP mid-campaign | Pending sends to them cancelled immediately |
| TC-5.4 | DNC contact in the segment | Skipped with `skip_reason: dnc`, present in results |
| TC-5.5 | Campaign scheduled into quiet hours | Waits; first send lands after quiet hours end |
| TC-5.6 | Sender hits risk High at ~30% | Campaign auto-pauses on that sender, alert fires |
| TC-5.7 | Pause then resume twice | Each recipient sent exactly once |
| TC-5.8 | Dry run vs actuals | Recipient count exact; cost within 5% |
| TC-5.9 | Two campaigns targeting one contact | Duplicate-campaign guard applies; override is logged |
| TC-5.10 | 10k enqueue timing | Under 5 s (NFR-4) |
