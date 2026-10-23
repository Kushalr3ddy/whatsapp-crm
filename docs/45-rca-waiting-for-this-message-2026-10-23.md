# 45 · RCA: "Waiting for this message" after the AI replied (2026-10-23)

**Reported by:** the other dev (Mikhil), on his phone, after the AI's reply to his message. **Sender:** Kushal's laptop (`dev:all`), number `919035524447`. **Recipient:** Mikhil, `919964122631`.
Times below are UTC (IST is +5:30). Evidence is the gateway logs `.dev-logs/gateway.log` and `/tmp/.../gateway-r012.log`, and the local database.

## Verdict
Mikhil's phone could not decrypt the AI's message. The message was sent fine and the AI worked. The sending number's WhatsApp encryption state was already broken, and the broken part has a **confirmed** cause in the code we run: **Baileys 6.7.24 keeps one encryption session per `user.device` with no link between a person's phone-number address and their LID address**, and WhatsApp now talks to the same person by both. Restarts and the AI were not the start of it.

## Impact
- The AI's reply (sent 08:37:56) showed "Waiting for this message" on Mikhil's phone, so the contact saw nothing readable.
- 139 decrypt failures logged in the first gateway run (08:14 to 08:26) and 389 in the next; the gateway asked WhatsApp to resend ~131 times, then kept asking after every restart.
- The number looked "Linked" the whole time.

## Timeline
| Time (UTC) | Event |
|---|---|
| 08:09:12 | The number is linked fresh (database had been wiped; no earlier sessions). History sync is off by config. |
| 08:11:31 | Campaign's first message to Mikhil: encrypted for 5 devices under his **phone-number** address (`919964122631`, `:84`, `:88`) and ours. Sessions are created under those addresses. |
| 08:14:32 | **Mikhil replies.** WhatsApp delivers it from his **LID** address `110762928373833@lid` (with `senderPn` 919964122631). Our store has no session for `110762928373833`: **`SessionError: No session record`**. First failure of the day, **before any restart**. |
| 08:14:37 on | Retry receipt sent for his reply, then a storm: 133 failures `No matching sessions found for message` from **our own account's LID** (`78847127097458`, i.e. the owner's phone and its devices), a burst about every 15 s; 131 retry receipts; "placeholder resend" requests to the owner's phone ("PDO message without response after 15 seconds. Phone possibly offline"). The app logs `decrypt-failure burst: companion session looks diverged` 45 times. Two `MessageCounterError: Key used already or never filled` show the session ratchet had also drifted. |
| 08:14:38 | The reply is stored and handed to the AI (R-011 works). The AI run is `skipped / empty_answer` (R-012: 400-token budget used up by a reasoning model). Separate bug, fixed in #156. |
| 08:18:24, 08:19:00 | The gateway restarts twice (`tsx watch`, from my edits). Each restart re-requests everything undecryptable; failures continue at the same rate. |
| 08:26:34 / 08:27:12 | The first gateway stops; I start another with the R-012 fix. 389 more failures in it. |
| 08:37:44 | Mikhil's next message is answered: **the AI reply now works** (R-012 fix). Row `sent_by=agent`. |
| 08:37:56.98 | The AI message is sent to the same 5 devices, again under the phone-number address. |
| **08:37:57.51** | **0.5 s later Mikhil's device (`110762928373833@lid`) sends a retry request: it could not decrypt it.** We resend (`resending a message the recipient could not decrypt`), this time fetching sessions for the LID address, and again 1 s later. The phone shows "Waiting for this message" meanwhile. |

## Causal chain (five whys)
1. **Why "Waiting for this message"?** The recipient's device could not decrypt our message and asked for a resend (retry request at 08:37:57.51, logged).
2. **Why could it not decrypt?** Our side and his side disagree about the encryption session for him: we encrypted under the session we made for his phone-number address; his device replies and expects things under his LID address. Our first failure, "No session record" for `110762928373833`, is the same mismatch seen from the other direction.
3. **Why do we disagree?** In `node_modules/baileys` 6.7.24 `lib/Signal/libsignal.js`, a session is stored under `new ProtocolAddress(user, device)` with the domain thrown away, and there is **no LID-to-phone mapping or session migration anywhere in that version** (searched: no `lid-mapping`, no `migrateSession`). The number `110762928373833` (LID) and `919964122631` (phone) are therefore two unrelated people to our code. WhatsApp delivers the same person under both.
4. **Why did it keep getting worse (the 133-failure storm from our own LID)?** Same cause on our own account: messages from the owner's phone arrive under its LID address and our companion has no matching session. Every failure triggers a retry receipt and a placeholder-resend request to the phone, which re-encrypts and churns sessions further, and the loop restarts after each gateway restart.
5. **Why did nobody notice before the other dev did?** The app detects it (`decrypt-failure burst` is logged and recorded as a health signal) but does nothing visible: the number still shows "Linked", the AI and campaigns keep sending, and there is no warning on the Linked numbers page. That part is on our to-do list as D-82 and is not built.

## Contributing causes (made it worse, did not start it)
- **Gateway restarts.** Three process starts in 18 minutes (two from `tsx watch` after my file edits). Restarts did not start today's failure (it began 4 minutes before the first one) but each one re-requested every undecryptable message.
- **Auth-state persistence** (`packages/channels/baileys/src/auth-adapter.ts`): the key store has no in-memory cache and `set` writes all keys with `Promise.all`, unordered, with no flush on shutdown (D-82's "probable cause"). This can lose the newest session state when the process is killed. **Not proven by this log**; it is a second, independent way to the same symptom.
- **Fresh link with no history sync**, so the companion starts with no sessions at all for anyone.

## Ruled out
- **Sending to the sending number itself (#110):** the recipient is `919964122631`, the sender `919035524447`.
- **Gateway crash (#103):** no crash; the process ran continuously and answered resend requests.
- **The AI / empty answer (R-012):** the 08:14 reply was skipped for that reason, a different bug; the 08:37 reply was written correctly and sent.
- **A second gateway on the same number:** none ran concurrently (the first stopped at 08:26:34, the next started 08:27:12). No "conflict" or "replaced" event in either log.
- **Campaign pacing / anti-ban hold:** the message left immediately (`hold_reason` empty).

## Confidence
- Proximate cause (recipient could not decrypt): **confirmed** (retry request in the log).
- Phone-number vs LID session mismatch as the origin: **high**, supported by the first error ("No session record" for the LID address), the 6.7.24 source (no mapping), and the sends going to phone-number addresses. **Not yet reproduced in isolation.**
- Auth-store write race: **possible, not shown.**

## What to do
1. **Now (recovery):** Unlink and relink the number (`docs/14-runbooks.md` RB-13). Do not restart the gateway while a real number is linked; test real numbers on the Linode, where the gateway is not under `tsx watch`.
2. **Next, small (D-82, make it visible):** when a decrypt-failure burst is recorded, show it on the Linked numbers page and the thread, hold the AI and campaign sends for that number, and offer a Reset (relink) button. It stops the AI from sending into a broken session and tells the user why.
3. **Next, the real fix:** evaluate Baileys 7 (the line with LID mapping and session migration) or a mapping shim, test it on a spare number on the Linode for a day or two (docs/29 section 8), and add an integration test for "a reply that arrives under a LID address finds the session made under the phone-number address". This is a library upgrade, so it needs its own plan and a test number.
4. **Also:** flush the auth state on SIGTERM and order the key writes (D-82), and have the health scorer ignore our own-account decrypt failures so a burst does not quarantine the number for 48 hours.
5. **Verification:** after relinking, send an AI reply to a spare number and confirm no `retry request` follows within 5 s and no `No session record` appears for the recipient's LID.

## Filing
GitHub issue and registry entry (R-013) not created yet; per `docs/39` the next step is the issue plus a failing test. Open question for Kushal: which of steps 2 and 3 first.


---

## The fix, built the same night (branch `fix/not-quitting-till-waiting-for-this-message-is-fixed`, issue #160, R-013)

### What changed
1. **Baileys 6.7.24 to 7.0.0-rc14** (`package.json`). npm's `latest` tag is the 7.x line; 6.7.24 is tagged `legacy`. The 7.x library keeps the phone-number to LID pair in the credential store (`lid-mapping` keys), looks it up when a message arrives under a LID, and **moves the existing session across** (`migrateSession`) so the reply finds the session we made under the phone number. It also sends under the LID once it is known, so both sides use one session. Our adapter needed three small changes and no more: it reads the new `remoteJidAlt` / `participantAlt` fields for the contact's other address, it listens to `lid-mapping.update` and stores each pair as one of the contact's identities, and the login settings are unchanged. Typecheck, lint and all tests pass with it.
2. **The credential store writes each key in order and flushes before the process exits** (`packages/channels/baileys/src/auth-adapter.ts`, D-82). Two overlapping writes to one session key could land out of order and leave our copy behind what WhatsApp had been told. Each key now has its own queue, and `disconnect`/`shutdown` wait (up to 10 s) for the queues to drain.
3. **The thread says when the other phone could not read a message** (D-101). The gateway notices WhatsApp's retry request ("recv retry request") through its logger, records it on the message (`message.retry_requests`, `last_retry_at`, migration 0038), and the thread shows "delivered, but the other phone could not read it yet (it asked for it again N times)" until the message is read. "Delivered" alone no longer hides it.
4. **A broken encryption session is said plainly** (D-82, D-102). A burst of undecryptable messages from contacts, or from the owner's own phone or WhatsApp Web, is recorded separately (`channel_session.decrypt_burst_at` and the new `own_decrypt_burst_at`); the composer shows "The encryption session of <number> looks broken ... Unlink the number and link it again". The amber "WhatsApp may be limiting" banner adds "this may be a result of the encryption problem above, not a judgement by WhatsApp" when both are true.
5. **The ban score no longer counts the owner's own devices.** Failures from the account's own addresses are not evidence that WhatsApp is penalising the number (D-82 had recorded a false 48-hour quarantine from exactly this).

### What was verified, and how
- **R-013, `tests/integration/regression-r-013-a-reply-under-a-lid-address-finds-the-session.test.ts`**: the real library and the real Postgres credential store, two parties. (a) Control: without the mapping, a reply under the LID address fails with `No session record`: the production failure, reproduced. (b) With the pair stored and the session moved, the reply is read and our next message, sent under the LID address, is read by the contact: no retry, no "Waiting". (c) After a simulated restart the pair and the moved session come back from the encrypted store and keep working.
- Unit and integration tests for the new log taps, the ordered writer, the retry-request recording, the thread notice and the scoring rule.
- **Smoke test against the real WhatsApp servers** (no phone needed): the 7.0.0-rc14 socket through our adapter connects and is issued a QR in about one second.

### Honest findings and what is NOT yet proven
- **The one number linked under 6.7.24 was logged out (401) the first time it connected under 7.0.0-rc14** (2026-10-23 11:50 UTC, this laptop, the `kushal_test` sender). Our code treats 401 as terminal and, as designed, removed the stored credentials, so that number must be linked again with a QR. **The cause is not known**: WhatsApp may already have unlinked that companion after hours of decrypt failures, or 7.x may not accept sessions created by 6.x. A fresh link under 7.x is the only way to tell. **Plan: every number linked before this change is relinked once** (they all needed it anyway, RB-13).
- **Real-phone verification is still to do** and needs a person with a phone: link one spare number on the Linode (the first link under 7.x), message a second phone of Kushal's own, and check: no `recv retry request` within 5 s of a send, no `No session record` for the contact's LID, a reply arrives and is answered by the AI, and a message typed on the phone and on WhatsApp Web both reach the inbox (D-102). The acceptance list is in D-101.
- 7.0.0-rc14 is a release candidate. It is what npm calls `latest`, but it should be watched during the day-or-two spare-number test.
- Not done: holding AI and campaign sends while the session is broken (D-82's last item); a one-click relink button.
