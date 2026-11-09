# 14 · Runbooks

One entry per alert. Every alert links here. The rule: **an alert tells you what to do, not
merely that something is wrong.**

Format: Symptom · Impact · Diagnose · Fix · Prevent.

---

## RB-01 · WhatsApp refused or logged out the number

**Impact** The number cannot send. Its running campaigns were paused by the gateway, and nothing resumes them on its own.

**Diagnose** The Numbers page shows the banner and the timeline entry (`forbidden_suspected` for a 403, `hard_ban_suspected` for a
logout nobody asked for, `unlinked_on_phone` when the device was removed under Linked devices; that last one is an unlink, not a ban).
`GET /api/v1/senders/{id}/health-events` returns the same list.

**Fix**
1. Open WhatsApp on the phone that owns the number and look for an "account banned" or "temporarily banned" notice. If there is one, stop: do not relink, and follow the notice to appeal.
2. If there is no notice, someone unlinked the device: link it again once, from the Numbers page, then resume the campaigns.
3. If a 401 logged the number out and it is gone, retire it; do not relink and resume the same behaviour.

**Prevent** Target people who expect the message. A ban is nearly always a targeting problem, not a technical one.

---

## RB-02 · WhatsApp session down > 5 minutes

**Impact** No send or receive on that number. Inbound is queued by WhatsApp, not lost.

**Diagnose** Gateway logs for the disconnect code.

| Code | Meaning | Action |
|---|---|---|
| 401 | Logged out — unlinked on the phone | Re-link required; see RB-01 first |
| 408 | Timeout, or this machine has no internet (Baileys reports `ENOTFOUND` and the like as 408) | Self-heals. With no internet the adapter keeps trying, backing off to once a minute, until the internet is back; those tries never reach WhatsApp, so they do not count toward the 5-try limit |
| 428 | Connection closed | Self-heals via backoff |
| 429 | Rate limited | Back off; check what was sending |
| 440 | Replaced — linked elsewhere | Someone linked the number on another device |
| 515 | Restart required | Normal; the supervisor handles it |

**Fix** Most codes self-heal through backoff — **wait first**. A reconnect storm is worse than
a slow recovery. Closes that come from WhatsApp back off 1, 2, 4, 8, 16 s and stop after 5 tries ("giving up reconnecting"
in the gateway log); after that the gateway's sweep tries a linked number that has been down 10 minutes again, every 10 minutes,
except after 401 (logged out), 403 (refused) and 440 (taken elsewhere). A gateway restart also brings every linked number back
with no QR. If down > 30 min with repeated 515s, restart the gateway. If 401, re-link.

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
from **the gap between sends** (the anti-ban policy spaces them out by a few seconds, so a large campaign drains slowly).

**Fix** If the send queue is deep but jobs are being consumed slowly, that is the engine doing
its job. If workers are dead, restart. If a poison job
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


## RB-13 · The number shows Linked but nothing arrives (decrypt failures)

**Symptom:** the Linked numbers page says *Linked*, the gateway log says `connected`, but no new inbound messages are stored, and a message you
send to a contact stays at *sent* (no delivered or read tick). The gateway log is full of `failed to decrypt message` with
`No matching sessions found for message`, `Key used already or never filled` or `Message counter error`, and `decrypt-failure burst: companion
session looks diverged`; it keeps logging `sent retry receipt`.

**Impact:** customers' messages are lost to the CRM (they stay on the phone). Sending still works for contacts whose session is fine.

**Diagnose:**
1. `grep -c 'failed to decrypt' .dev-logs/gateway.log`, and look at which `remoteJid` fail. Messages with `"fromMe": true` failing are your own phone's
   outgoing messages and are harmless; failures for `fromMe: false` are customers and are not.
2. Last inbound time per chat: `select max(created_at) from message where direction='inbound'`; compare to when you last saw a message arrive.
3. `ps -eo cmd | grep '[g]ateway/src/main'`: more than one gateway on the same number makes this worse.

**Fix (cheapest first):**
1. Wait a minute or two and ask the contact to send a **new** message; a fresh message sometimes rebuilds the session.
2. Delete only that contact's saved sessions, back them up first, restart the gateway once: `delete from channel_auth_state where key like
   'session-<number>.%' or key like 'session-<lid>.%'` for that sender. This repaired **sending** to the contact but not receiving (2026-10-21).
3. **Unlink and relink** (Linked numbers → *Unlink / reset this number* → *Scan a QR* on the phone: WhatsApp → Settings → Linked Devices → Link a
   device). This always works: after it, zero decrypt failures and messages arrived at once. Conversations and contacts stay; messages that arrived
   while it was broken are not recovered into the CRM.

**"Waiting for this message" on the other phone:** the recipient could not decrypt something we sent and asks for it again. The gateway answers that for text (`resending a message the recipient could not decrypt`). Before the resend hook the log
said `recv retry request, but message not available` and the placeholder never cleared.

**Prevent:** `dev-up.sh` no longer runs the gateway under `tsx watch` (since 2026-10-23; `--watch-gateway` brings the old behaviour back for a laptop with no real number linked). Do not restart the gateway while testing real numbers; after changing gateway or `packages/core` code, stop and start the script. (Before that, under `tsx watch` every saved edit to a file it imports restarted it.) Restart only the API
and web with `bash infra/scripts/dev-up.sh --no-gateway`. Never run two gateways on one number. Tracked as D-82 (flush auth state on shutdown; detect the burst and say so on the page).

---

## RB-14 · Messages are held ("waiting: …")

**Impact** Queued messages are not leaving a number, or not leaving to one contact. Nothing is dropped; a hold keeps the message in its place in the lane.

**Diagnose** `message.hold_reason` and `hold_until` on a waiting message (also the "waiting: …" line in the thread); the gateway log line `anti-ban decision` has the reason and its inputs. `channel_session` (`timelock_*`, `capping_*`) and `whatsapp_notice` show what WhatsApp last said about the number.

| Reason | What it means | How it ends |
|---|---|---|
| `timelock`, `new_chat_cap` | WhatsApp is not letting the number start new chats. Known contacts still get messages. | By itself at `hold_until` (WhatsApp's time). Nothing to do. |
| `quiet_hours` | Campaign and AI first messages wait out the org's quiet hours (default 22:00 to 08:00, Asia/Kolkata). | At `hold_until`. Change the hours with `PUT /antiban/settings` (admin). |
| `refused_463` | WhatsApp refused a message to this contact (463). New sends to them are held. The cause of 463 is not known. | **Nothing clears it yet** (the Retry action is S10). Do not clear it in bulk: `UPDATE conversation SET refused_463_at = NULL WHERE id = '…'` for one chat, after looking at why. |
| `decrypt_retry` | The contact's phone asked for our last message again. New sends to them wait. | A delivered or read receipt after the retry, or a message from them. There is no timeout. |
| `decrypt_wave` | Phones of 3 or more contacts asked for retries within 10 minutes. The whole number is held and a critical health event is recorded: suspect the session store, not the contacts. | **Only relinking the number** (a reconnect does not). Check `docs/45` and RB-13 first. |
| `many_undelivered` | 8 or more of the last 20 sends to fast-delivering contacts are still at one tick after 30 minutes. The number's campaigns are held (replies and manual sends still go). | When the count falls below 4, or `POST /senders/:id/resume` (needs `senders:write`; audited). Look at the Numbers page timeline first: WhatsApp may be limiting the number. |
| `likely_blocked` | The contact's photo and about were visible and are gone: they probably blocked the number. Campaigns and the AI stop; an agent can still send by hand. | When the contact writes to us. |
| `sender_not_connected` | The number is down, or it dropped during the send (the message stays queued). | When it reconnects (RB-02). |

A message that failed rather than waited: `send_unconfirmed` (it was handed to WhatsApp but the send was never recorded, because the gateway stopped or the database went in between; it may have arrived, so check the chat on the phone before sending it again), `campaign_cancelled` (the campaign was cancelled while it was queued), `do_not_contact` (the contact is on the list; an `opt_out` flag lifts with `PUT /contacts/:id/do-not-contact` or the contact sending `start`), `not_on_whatsapp`, `whatsapp_refused_463`, `send_error` (`message.error_detail` has the provider's words). Failed messages are never retried automatically.

**Prevent** Target people who expect the message; the engine reacts to WhatsApp's warnings, it cannot make a number safe.
