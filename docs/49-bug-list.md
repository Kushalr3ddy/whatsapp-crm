# 49 · Bug list to decide on (2026-11-09)

The history of what was found and fixed. **Open bugs are GitHub issues** (https://github.com/Mikhil31/whatsapp-crm-anti-ban/issues, labels `bug` and `sev1` to `sev4`); this file no longer lists them. Evidence for each is in `tests/regression/REGISTRY.md` (R-) and `docs/47-live-test-log.md` (the rest). Severity: S1 a person is wrongly messaged, not messaged, or data is lost; S2 a feature misleads or breaks; S3 confusing; S4 polish. "Decision" means the code does what it was built to do and the question is whether that is right.

## Fixed

| Id | What | Guard | Where |
|---|---|---|---|
| R-018 | A connection drop mid-campaign failed the rest of the run for good | FM-2 | merged (#22) |
| R-019 | A database blip or a killed gateway after WhatsApp accepted a message sent it again | FM-3, FM-4 | merged (#22) |
| R-020 | Cancel let already-queued messages (up to 20) go out | UM-2; live F5 | merged (#22) |
| R-021 | A campaign message of only spaces was accepted | UM-5 | merged (#22) |
| R-022 / LF-2 | Pause on a draft, then Resume: the campaign "completed" having messaged nobody. Pause and Cancel shared one rule that let Pause act on a draft, and Start froze the audience only when the status was `draft`. Now Pause only stops a started campaign (a draft gets 409 "has not started"), and Start freezes the audience whenever the campaign has never started. The AI assistant's pause tool gets the same answer. | UM-13, UM-23, UM-24; live C-3 | `claude/whatsapp-crm-live-testing-ae21f6` (not committed) |
| R-032 / UI-8 | Contacts side panel: a person from a Naukri file (long question headers) showed every value one letter per line. The label column was as wide as the longest label and the value could shrink to one character. Now the value keeps at least 45% of the width and long labels wrap. | regression-r-032 spec (failed at 210 px tall before, passes after) | same branch (not committed) |
| R-026 | After about 30 s without internet the number stayed offline until a restart. Baileys reports a local network error (ENOTFOUND…) as 408, the same as a WhatsApp timeout, so 5 offline tries used the 5-try budget. Now those tries do not count and repeat about once a minute until the internet is back; the gateway also tries a linked number that has been down 10 minutes again, every 10 minutes (a safety net, not the cause). Never for logged out, 403 or 440. | WA-C9, FM-16 | same branch (not committed) |
| R-033 / SEC-1 | The raw session cookie and CSRF token were written to the API log on every sign-in: the request logger records response headers and the redaction list named only request headers. Now `set-cookie`, the CSRF and API-key headers are redacted. Old logs still hold sessions: revoke them on deploy | regression-r-033 | branch `claude/whatsapp-crm-live-testing-a10837` (not committed) |
| R-034 / SEC-3 | An agent could clear do-not-contact (then message the person) and add, link and unlink numbers and read the QR: every signed-in person passed a scope check. Now clearing and managing numbers are admin only; flagging stays open; keys keep their scopes. `resume` on a number is unchanged (agents may still use it) | regression-r-034 | same branch |
| R-035 / SEC-2 | Login limited per email only. Now per address and email, plus 30 failures per address per 15 min. Not fixed: a caller that reaches the API directly can set its own `X-Forwarded-For`; add the limit at the proxy; many addresses against one email each get 5 tries | regression-r-035 | same branch |
| R-036 / SEC-4 | Any org's admin could change the install-wide AI model and see the end of its key. Now only the admin of the oldest org. Not fixed: redirects from a model address are still followed (key is not sent across origins by fetch); real per-org model settings are a larger change | regression-r-035 | same branch |
| R-037 / LF-19 | A second STOP counted as the person writing again, so an agent could message them. Now a repeat STOP stamps the opt-out again | regression-r-037 | same branch |
| R-038 / LF-11, LF-17 | The closing message quoted an old agent or AI line, never the campaign, because campaign messages are `sent_by = system` and the lookup skipped `system`. Now it uses the latest campaign message and its purpose | regression-r-037 | same branch |
| R-039 / VAL-1 | A NUL character in text gave a 500. Now 422 for any JSON body or query | regression-r-034 | same branch |
| R-040 / SEC-7 (API) | The API sent no security headers. Now nosniff, DENY framing, no-referrer, no-store and a locked CSP. The web app sends nosniff, no framing and a referrer policy but no full CSP | regression-r-034 | same branch |
| R-023 / SC-9 | A reply of only spaces was accepted from the inbox and arrived as an empty bubble. Now 422 | failure-modes UM-15 | same branch |
| R-024 | A campaign could be started on a removed number. Now 409 `NUMBER_REMOVED` | failure-modes UM-21 | same branch |

## Open

Tracked as GitHub issues since 2026-11-11. The old ids still appear in the docs and the tests, so this is the map from id to issue number. Filter with `is:open label:bug`, and by `sev2`, `sev3`, `sev4`.

| Old id | Issue | Old id | Issue | Old id | Issue |
|---|---|---|---|---|---|
| LV-3 | #47 | LV-4 | #48 | LV-5 | #49 |
| LV-6 | #50 | LV-7 | #51 | LV-8 | #52 |
| LV-9 | #53 | LV-10 | #54 | LV-11 | #55 |
| LV-12 | #56 | LV-13 | #57 | held-picture wording | #58 |
| DEP-1 | #59 | login limit at the proxy (SEC-2) | #60 | SEC-4 | #61 |
| SEC-7 | #62 | SEC-9 | #63 | SEC-5 | #64 |
| SEC-6 | #65 | SEC-8 | #66 | ISO-1 | #67 |
| agent re-flag overwrites reason | #68 | PERF-1 | #69 | UI-1 | #70 |
| UI-2 | #71 | UI-5 | #72 | UI-7 | #73 |
| UI-3 | #74 | UI-4, UI-6 | #75 | LF-1 | #76 |
| SC-1 | #77 | SC-2 | #78 | SC-4 | #79 |
| SC-11 (and X-005) | #80 | SC-3 | #81 | LF-10 | #82 |
| U-1 | #83 | LF-18 | #84 | SC-6 | #85 |
| SC-5 | #86 | SC-7 | #87 | SC-8 | #88 |
| LF-13 | #89 | SC-10 | #90 | AI-INT-1 | #91 |
| LF-14 | #92 | LF-16 | #93 | LF-15 | #94 |
| LF-3 | #95 | LF-6 | #96 | LF-5 | #97 |
| LF-7 | #98 | R-025 | #103 | R-031 | #104 |
| X-002 | #107 | X-003 | #108 | X-004 | #109 |
| M-001 | #110 | M-002 | #111 | M-003 | #112 |

Fixed but their issues are still open on GitHub (to be closed): R-030 #99, R-027 #100, R-028 #101, R-029 #102.

**Decisions for the owner** (current behaviour pinned by tests, not bugs): any agent can edit, start, pause or cancel any campaign of the organisation; two admins saving the same template at once is last write wins with no warning; `api_key` has no row-level policy (every route filters it by organisation); a campaign created with only another organisation's contact ids is accepted but empty and starts as `running` with nobody in it; a confused "who is this" or a rude message is read as an opt-out only if a STOP word is used (LF-12, LF-17, changed by R-046); the rotation brake is one for the whole install (SEC-8, ENC-7 pins it).

**Not app bugs (environment):** two `llm/settings` tests fail on Windows only (file modes); `antiban-v2-lane` AC-1.1 timed out once.

## Fixed on 2026-11-10 and 2026-11-11 (go-live fixes; each has a regression test named by its R-number, see tests/regression/REGISTRY.md)

| Fixed | R | Issue | What changed |
|---|---|---|---|
| Pause did not stop messages already queued | R-045 | #36 | The sender never sends a message of a paused campaign; it shows "the campaign is paused" and goes on Resume |
| The AI classifier opted a person out on its own word | R-046 | #37 | Only a STOP word (or the org's own) opts out. A message the AI reads as negative leaves a note, takes the chat off the AI and flags nobody |
| Two admins demoting or disabling each other left no admin | R-041 | #38 | One lock per organisation around every change of role or status |
| The AI told a customer the team member's login email | R-047 | #39 | An email is never used as the hand-over person's name: "a colleague" instead |
| The AI never answered a new person's first reply when a picture was held back | R-048 | #40 | The campaign's own held picture no longer counts as "someone already answered" |
| Two agents sending the first message in an unowned chat both went through | R-042 | #41 | The claim is the rule: the loser gets 409 THREAD_ASSIGNED |
| A repeated send created two messages | R-043 | #42 | `Idempotency-Key` header (migration 0050); the Inbox sends one key per Send |
| Quiet hours did not hold a campaign message to someone who wrote in the last 24 hours | R-049 | #43 | A campaign's own message is a campaign message for quiet hours whatever the chat history; the held picture sent after a reply still goes |
| The Contacts form overwrote a colleague's newer value | R-044 | #44 | The form sends only the fields that changed |
| A corrupt picture was accepted as a campaign picture | R-050 | #45 | A still picture must decode whole, or it is refused |
| An admin could add another organisation's person by email, reset their password or disable them | X-001 | this PR | An email that belongs to a person of another organisation is refused (409 `EMAIL_UNAVAILABLE`); the password and status of a person who is in two organisations cannot be changed by either organisation's admin. Only the operator CLI attaches an existing account |
| The same phone linked twice in one organisation was accepted | X-006 | this PR | The second entry is unlinked again with the reason `number_already_linked`; it is never made active |
| Two link requests opened two sockets | R-027 | this PR | One link attempt and one socket open per number at a time |
| Repeated 515 restarts reconnected at once without limit | R-028 | this PR | Three in a row are the handshake; after that they back off and spend the retry budget |
| After 403 (ban) or 440 (taken over) the adapter dialled again by itself | R-029, R-030 | this PR | Neither reconnects by itself; a person relinks or resumes from the Numbers page |


## AI template changes to consider (the owner's call; nothing changed)

From the live conversation. These are wording changes to "What the AI knows" or to the always-on rules, not code fixes.

1. Put back the owner's rules the rewrite dropped: "Never say the salary figure. Never mention internal notes or past applications." (LF-3)
2. Name the hand-over person by name, not email: give the team member a display name, or add a "name to give customers" to the template. (LF-4)
3. Say what to do with things it does not know, by example: "If asked what to bring, the dress code, parking or anything not written here, say <name> will confirm." (LF-14)
4. Language: "Reply in the language of the person's latest message." (LF-16)
5. Dates: "If they ask for a day other than their interview date, repeat the date we have and ask whether they want to move it." (LF-15)
6. Identity: decide what it says to "are you a bot?" and write it in (today it said "automated helper" and handed over). (LF-16)
