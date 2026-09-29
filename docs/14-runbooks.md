# 14 · Runbooks

One entry per alert. Every alert links here. The rule: **an alert tells you what to do, not
merely that something is wrong.**

Format: Symptom · Impact · Diagnose · Fix · Prevent.

---

## RB-01 · Sender risk Critical / number quarantined

**Impact** All outbound on that number is stopped. Campaigns using it are paused.

**Diagnose**
```
GET /api/v1/senders/{id}/health      # risk score + contributing events
```
Look at `send_risk_event` for the last 24 h. The score is a sum of typed events — identify
which dominate: repeated 403s, a delivery collapse, or accumulated disconnects.

**Fix**
1. **Do not** clear the quarantine and resume. That is how a soft ban becomes a hard one.
2. Follow the recovery schedule in [`08-antiban.md`](08-antiban.md) for the incident class —
   463 timelock: 24 h pause then 10%; rate overlimit: 4 h then 25%; suspected soft ban:
   48 h then 5%.
3. Check whether a campaign targeted cold contacts, or whether the reply ratio collapsed.
4. If a 401 logged-out: the number is gone. Retire the sender; do not re-link and resume the
   same behaviour.

**Prevent** Lower the daily cap; increase the stranger multiplier; audit the segment that
preceded it. A number reaching Critical is nearly always a targeting problem, not a technical one.

---

## RB-02 · WhatsApp session down > 5 minutes

**Impact** No send or receive on that number. Inbound is queued by WhatsApp, not lost.

**Diagnose** Gateway logs for the disconnect code.

| Code | Meaning | Action |
|---|---|---|
| 401 | Logged out — unlinked on the phone | Re-link required; see RB-01 first |
| 408 | Timeout | Should self-heal; check network/DNS |
| 428 | Connection closed | Self-heals via backoff |
| 429 | Rate limited | Back off; check what was sending |
| 440 | Replaced — linked elsewhere | Someone linked the number on another device |
| 515 | Restart required | Normal; the supervisor handles it |

**Fix** Most codes self-heal through backoff — **wait first**. A reconnect storm is worse than
a slow recovery. If down > 30 min with repeated 515s, restart the gateway. If 401, re-link.

**Prevent** Do not link the same number in another tool. Keep the gateway's Postgres reachable —
auth state lives there.

---

## RB-03 · Meta quality rating dropped to Medium / Low

**Impact** Medium: no tier upgrade. **Low: marketing sends hard-stop automatically.**

**Diagnose** Check block and report rates, and which template correlates with the drop.

**Fix**
1. **Stop marketing sends** on that number — the system does this at Low, but do it at Medium
   too, manually.
2. Review the last 48 h of templates for anything misleading or off-category.
3. Prioritise service-window replies to rebuild engagement.
4. Recovery takes **7+ days of good behaviour**. There is no fast path.

**Prevent** Honest template categories, real opt-in, tight segments. The feedback loop
described in [`08-antiban.md`](08-antiban.md) is very hard to reverse once started.

---

## RB-04 · Queue depth > 10,000 / jobs ageing

**Diagnose** `GET /api/v1/admin/queues`. Distinguish **backlog** (workers too slow or stopped)
from **deliberate pacing** (the anti-ban limiter holding sends back — which is correct and
expected during a large campaign).

**Fix** If the send queue is deep but jobs are being consumed slowly, that is the engine doing
its job — **do not "fix" it by raising limits**. If workers are dead, restart. If a poison job
is cycling, check the DLQ (RB-05).

**Prevent** Alert on job *age* rather than depth alone; depth is expected to be large during
campaigns.

---

## RB-05 · Dead-letter queue growing

**Diagnose** `GET /api/v1/admin/dlq`. Group by `error_code`.

**Fix** A systematic error (bad template, expired credential) — fix the cause and replay the
batch. Genuinely poison jobs (unresolvable recipient, M26) — discard and record; they must
never be auto-replayed into the socket.

**Prevent** Poison jobs quarantine after N attempts by design. A growing DLQ usually means a
new provider error code that needs classifying.

---

## RB-06 · Database down / connection pool exhausted

**Impact** Total outage. The app fails `/ready` and stops accepting traffic rather than
serving errors.

**Diagnose** Postgres reachable? Pool metrics. Long-running queries:
```sql
SELECT pid, now()-query_start AS dur, state, query FROM pg_stat_activity
WHERE state <> 'idle' ORDER BY dur DESC LIMIT 20;
```

**Fix** Kill long-running queries; restart the app to reset the pool; if Postgres is down,
recover it before anything else — the queue is in Postgres in `lean`, so nothing proceeds.

**Prevent** Statement timeouts, pool sizing per role, slow-query alerting.

---

## RB-07 · Import run failing or stuck

**Diagnose** `GET /api/v1/imports/{id}` for counts and status; `import_row` for per-row errors
grouped by reason.

**Fix** Runs **always complete** by design — a stuck run means a worker died. It resumes from
the last committed batch on restart. For widespread row errors, the mapping is usually wrong:
download the failed rows, correct the mapping, re-import only those.

**Prevent** The dry run exists precisely to catch this. A run committed without one is an
operator-process failure.

---

## RB-08 · Webhook deliveries failing

**Diagnose** `GET /api/v1/webhooks/{id}/deliveries`. Distinguish endpoint down (5xx/timeout)
from rejection (4xx — usually a signature mismatch after a secret rotation).

**Fix** Endpoint down: backoff handles it; confirm the consumer. Signature mismatch: confirm
the consumer verifies over **raw bytes**, not a re-serialised body — the most common integration
error. Replay from the delivery log once fixed.

**Prevent** Publish a verification example in [`15-api.md`](15-api.md).

---

## RB-09 · Disk > 90%

**Diagnose** Usual culprits in order: media assets, `inbound_event_raw`, `audit_log`,
Postgres WAL, container logs.

**Fix** Run the retention job; check WAL archiving is actually shipping (a stalled archive
fills the disk fast); rotate container logs.

**Prevent** Retention windows tuned per org; disk alert at 75%, not 90%.

---

## RB-10 · Provider driver unhealthy (`/admin/providers`)

**Impact** Varies by port. A broken email driver means password resets silently fail — which is
exactly why this dashboard exists.

**Diagnose** `GET /api/v1/admin/providers` shows the active driver, health and last error per port.

**Fix** Almost always credentials or network. Re-run the driver's `test()`. For storage, confirm
bucket permissions; for email, confirm SMTP auth and that the port is not blocked.

**Prevent** Drivers are health-checked at boot and periodically; a failing optional driver
degrades its feature rather than the app.

---

## RB-11 · Suspected data breach

1. **Preserve evidence** — do not restart or clear logs.
2. Revoke all API keys; force re-authentication.
3. Rotate the KEK and re-wrap DEKs; rotate provider credentials.
4. Determine scope from `audit_log` and export logs.
5. Notify per **your jurisdiction's** breach obligations (DPDP, GDPR, etc.) — timelines are legal,
   not technical, and are the operator's responsibility.
6. Post-mortem, published internally.

---

## RB-12 · Restore from backup

**Drill this quarterly. An untested backup is not a backup** (M21b).

```
1. Provision a clean Postgres
2. Restore the base dump, then replay WAL to the target time
3. Verify row counts against the pre-incident snapshot
4. Point a staging app at it; confirm /ready
5. Confirm WhatsApp sessions restore from channel_auth_state — this is the real test
6. Only then switch production
```

RPO ≤ 24 h, RTO ≤ 1 h. If step 5 fails, the KEK is wrong or missing — the database alone is
not sufficient to recover.
