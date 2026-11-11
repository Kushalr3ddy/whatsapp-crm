# 49 · Bug list to decide on (2026-11-09)

One list of everything found by the automated failure suites (R-numbers), the live run on real numbers (LF-), the screen check (SC-) and the owner's requirements (U-). Evidence for each is in `tests/regression/REGISTRY.md` (R-) and `docs/47-live-test-log.md` (the rest). Only the bugs under "Fixed" are fixed; everything under "Open" is not. Severity: S1 a person is wrongly messaged, not messaged, or data is lost; S2 a feature misleads or breaks; S3 confusing; S4 polish. "Decision" means the code does what it was built to do and the question is whether that is right.

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

### Two people at once (all fixed: see "Fixed on 2026-11-10")

Checked and fine (guarded by the same file): two requests to start one campaign (FM-5), two STOPs (AC-6.3), one number never sends two messages at once (AC-1.1), thirty replies at once by the owner (all kept), a second agent in an owned chat (409), a chat or person of another organisation (404), wrong types, unknown field names, `__proto__` and `constructor` field names, oversized text, no sign-in, a read-only key and a cookie without the CSRF token.

**Written but not run (2026-11-11):** `tests/integration/orgs-modules.test.ts` and browser scenarios SCR-1 to SCR-9 cover the modules not reached before (export, API keys, key rotation, pictures, imports, segments, custom fields, audit trail, presence). Nothing from them is a bug yet; the first run decides.

### Several organisations and roles (2026-11-10; found by `tests/integration/orgs-*.test.ts` and `shared-template-campaign.test.ts`; repro steps only, not analysed yet)

Each has a test written as `it.fails` that goes green-for-the-right-reason when fixed: change it to `it`.

| Id | Sev | Repro steps |
|---|---|---|
| X-002 | S3 | 1. As an admin, save an AI template. 2. Create a campaign using it (`aiTemplateId`). 3. Delete the template (it moves to Deleted). 4. `POST /campaigns` again with the same `aiTemplateId`: answers 201 (expected 404). Also `GET /ai/templates/<id>` of a deleted template answers 200. Test: `shared-template-campaign.test.ts` "X-002" |
| X-003 | S3 | 1. Two people, one tag. 2. At the same moment: one `DELETE /tags/<id>`, the other `POST /contacts/<contact>/tags` `{ "tagId": "<id>" }`. 3. About one run in several: the second answers 500 (log: `contact_tag_tag_id_tag_id_fk` foreign key violation) instead of 404. Test: "X-003" |
| X-004 | S3 | 1. Two people, same moment, `POST /contacts` with the same new phone (`{ "displayName": "x", "phone": "+9199xxxxxxxx" }`). 2. One answers 201; the other answers 500 (log: `contact_identity_lookup_uidx` unique violation) instead of 409 or the existing contact. One contact is created, never two. Test: "X-004" |
| X-005 | S3 | **Same family as SC-11 (row 8b), still open**: SC-11 saw it while paused (it fixed itself on Resume); L12 saw it again in both organisations at once and here it did NOT fix itself: pause, Resume, then cancel left the rows `queued` for good. Found 2026-11-10 by the live run L12. 1. Campaign of 3 people (explicit contact ids, engagement gate lifted), started. 2. The three messages are sent and delivered on the phones (first at about 3 s, the others 40 to 50 s later). 3. Pause the campaign, resume it, cancel it (a minute or two after the start). 4. `GET /campaigns/<id>/recipients`: all three recipients still say `queued`, with no skip reason. The messages themselves (`GET /conversations/<id>/messages`) say `delivered` and the phones have them. The campaign says `cancelled`. Expected: `sent`. The earlier L8 run (pause after the first send showed as `sent`) ended `sent,sent,skipped`. Exact timing of the pause against the sends was not recorded: reproduce by pausing/cancelling after all three have arrived. Script: wa-testers
un\l12.mjs (L8.5) To check for X-005 (not run yet, no fix): (a) a paused campaign whose rows are stuck `queued`: does a new campaign for the same person on the same number get skipped `in_other_campaign` although the message already went out; (b) does Resume on such a campaign send the message a second time; (c) pin the exact time of the pause against the sends. |
un\l9.mjs |

Decisions for the owner (current behaviour pinned by tests, not bugs yet): any agent can edit, start, pause or cancel any campaign of the organisation; two admins saving the same template at once is last write wins with no warning; `api_key` has no row-level policy (every route filters it by organisation); a campaign created with only another organisation's contact ids is accepted but empty and starts as `running` with nobody in it.

### Fixed on 2026-11-10 (go-live fixes; each has a regression test named by its R-number, see tests/regression/REGISTRY.md)

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

Still open from the live run (Sev 2 and below, not fixed yet): the AI invented a time, mishandled a callback and agreed to reschedule on its own; a landline is accepted on import; the campaign page counts a STOP as "Talking"; the left-over security items; the polish list in docs/51.

### Live run on four phones (2026-11-10; the website driven by Playwright, the API by script; evidence in docs/47)

Nothing here is fixed. Found by importing an Excel on the website and through the API, running AI campaigns to four real phones, and having the phones answer.

| # | Id | Sev | What |
|---|---|---|---|
| v3 | LV-3 | S2 | After a person's "yes" in Hindi the AI asked them to confirm "tomorrow 11 am". Their interview is 15 Nov at 4:00 PM and the chat holds only their own messages: a made-up time |
| v4 | LV-4 | S3 | Import accepts a landline (`080 2345 6789`) as a phone and tags it with everyone, but sending to it is refused (NOT_REACHABLE). "Message them now" on the import result includes it. The sender checks WhatsApp registration, but a landline can be on WhatsApp |
| v5 | LV-5 | S3 | Campaign page "What people said": a person who sent STOP is counted under "Talking" |
| v6 | LV-6 | S3 | "maybe later, please call me next week" was filed as not interested. The chat was handed to a person (correct) but the reply to the customer did not mention a callback |
| v7 | LV-7 | S3 | Import: a later duplicate row's shorter name replaces the fuller one (Anita Rao became Anita R; the screen warns). The button says "Import 13 people" for 10 created (it counts rows). The dry run reports 0 warnings and the real run warns 3 |
| v8 | LV-8 | S4 | Import messages: a picture gives only "The request could not be completed."; an empty CSV says "Choose a file first."; a semicolon-separated CSV is read as one column |
| v9 | LV-9 | S4 | Reading a chat through the API (`GET /conversations/:id/messages`) clears its unread count, so an integration can silently clear the flag for the team |
| v10 | LV-10 | S4 | A flood of 20 messages sent 250 ms apart is shown in arrival order (1, 4, 3, 2, 6, 5…), not sent order |
| v11 | LV-11 | S4 | Closing message: it reads badly when the organisation's purpose is not a clause ("because your interview with us"), and it quotes the opening cut mid-word ("on 12 N…") |
| v12 | LV-12 | S4 | AI: a thumbs-up alone was answered by asking the question again; a PDF with only a file name was answered "Thanks for your response"; a request to move to 4 pm was agreed without a person |
| v13 | LV-13 | S4 | Messages to one phone stay at one tick ("sent") while the phone received them: that phone's receipts do not come back (the phone, not the CRM) |

Related, already open as R-043: two clicks on Send in the same instant (0 ms) send two messages from the Inbox. With 30, 80 or 150 ms between them the screen sends one.

### Security (review of 2026-11-09; evidence in docs/47)

| # | Id | Sev | What |
|---|---|---|---|
| s4 | SEC-4 | S3 | The AI model is still one per install (now only the oldest org's admin may change it); redirects from the model address are followed |
| s5 | DEP-1 | S2 | drizzle-orm 0.36.4 and zod 3.25.76 have high advisories; reach not checked; fixes are major upgrades |
| s6 | SEC-7 | S3 | The web app sends no security headers and no CSP (the API now does) |
| s7 | SEC-9 | S3 | No rate limit on AI answer-now / commands / jobs |
| s8 | SEC-5 | S4 | Audit IP can be set by the caller |
| s9 | SEC-6 | S4 | A database error may log query parameters (not reproduced) |
| s10 | SEC-8 | S4 | Any org's admin can pause install-wide key rotation |
| s12 | ISO-1 | S4 | Another org's conversation messages answer 200 with an empty list instead of 404 (no data shown) |

### Screens at phone and desktop width (2026-11-09; evidence in docs/47)

| # | Id | Sev | What |
|---|---|---|---|
| p1 | PERF-1 | S2 | Importing 2 to 12 people took more than 10 s ("Importing 2 people… 0:10") once the scratch org had about 2 100 contacts, on a loaded machine; earlier, with about 100 contacts, the check step was slow under load only. Not measured on a quiet machine; cause not looked at |
| u1 | UI-1 | S3 | React #418 (server and browser text differ) on /team and /ai/settings |
| u2 | UI-2 | S3 | /signup throws "An unexpected response was received from the server" on load |
| u3 | UI-5 | S3 | Contacts table runs off the right edge at 375 |
| u4 | UI-7 | S3 | Numbers page badge and logged-out notice run off the right edge at 375 |
| u5 | UI-3 | S3 | Home "Manage" link cut at 375 |
| u6 | UI-4, UI-6 | S4 | Inbox search placeholder and classic contacts tag row cut at 375 |

### Campaigns

| # | Id | Sev | What | Where |
|---|---|---|---|---|
| 3 | LF-1 | S2 | Review says "Nobody is left out", then Start skips the person as `engaged` (an agent owns the chat) and the campaign reads completed | New campaign review vs `policy-gates.ts` |
| 4 | SC-1 | S2 | After an opt-out the campaign still shows the person as "Needs a person" with an old note; the opt-out appears nowhere on the page | Campaign page, What people said |
| 5 | SC-2 | S3 | "AI is answering replies" while a person owns the chat and the contact opted out | Campaign page banner |
| 6 | SC-4 | S3 | The Message box shows the typed body with `{{…}}`, not what the AI actually sent | Campaign page |
| 7 | SC-3 | unconfirmed | No "Stop the AI" on a completed AI campaign (not checked on a running one) | Campaign page |
| 8b | SC-11 | S3 | A paused campaign keeps showing a message as "queued, 0 sent" after it was sent and delivered, until Resume | Campaign page; `dispatchCampaigns` reconciles running campaigns only (likely) |
| 8 | LF-10 | unconfirmed | Picking a tag in "Who gets it" did not select (maybe the browser automation) | New campaign |

### Opt-out and do-not-contact

| # | Id | Sev | What | Where |
|---|---|---|---|---|
| 10 | U-1 | requirement | On STOP the chat should end with the hand-over person's name and number and two lines on the campaign's goal | `buildClosingMessage`, `opt-out.ts` |
| 12 | LF-12 | decision | A confused "who is this" is read as an opt-out and the person is told "We will not message you again" | AI classifier, test AC-6.1 |
| 13 | LF-17 | decision | A rude message is read as an opt-out | same |
| 14 | LF-18 | S2 | "I want to talk to a real human", right after an opt-out, gets silence and no hand-over | opt-out + AI gate |
| 15 | SC-6 | S2 | Neither the thread nor the Details panel shows that the person opted out or restarted | Inbox |
| 16 | SC-5 | S3 | Closing messages are labelled "Campaign" in the thread | Inbox |

### Inbox

| # | Id | Sev | What | Where |
|---|---|---|---|---|
| 18 | SC-7 | S3 | Details lists every campaign as "Replied", including one cancelled before it was sent | Inbox Details |
| 19 | SC-8 | S3 | The AI's status and summary for the person are not shown in the inbox | Inbox Details |
| 20 | LF-13 | S3 | When a person owns the chat, replies to an AI campaign are not answered by the AI and nothing says so | AI claim rule |
| 21 | SC-10 | unconfirmed | One AI reply stayed "Sent, no delivery for 32 min" while the messages around it were delivered | Thread 17:26 |

### AI replies (live, Gemini flash-lite)

AI-INT-1 (S2): a clear "yes I will be there" was filed as "talking", not "interested", although the AI's own note says "confirmed his attendance". A polite no was filed correctly as not interested, and not as an opt-out. One sample; cause likely the model, not the code (docs/47).

| # | Id | Sev | What |
|---|---|---|---|
| 22 | LF-14 | S2 | Made up "bring a copy of your resume and a valid ID" (not in its knowledge; it is told never to guess) |
| 23 | LF-4 | S3 | Gives customers the staff **login email** and the sending number as the person who will confirm |
| 24 | LF-16 | S3 | Called itself "an automated helper" (the rule is to speak as the team, never as an assistant or bot), and answered in Hindi to an English question |
| 25 | LF-15 | S3 | "kal" (tomorrow) for a 14 Nov interview: did not point out the date differs |

### AI template editor

| # | Id | Sev | What |
|---|---|---|---|
| 26 | LF-3 | S2 | The owner's "never share the salary / internal notes" rules and the answer to the AI's own question were dropped by the rewrite |
| 27 | LF-6 | S3 | "Rewrite with my choices" silently removes a section the owner typed |
| 28 | LF-5 | S3 | "Who it is for" said "Nothing found. Import a file first" though a tag existed (made after the page opened) |
| 29 | LF-7 | S4 | Typing into the name box adds to the AI's suggested name |

### Linking and connection (real adapter, from the replay suite)

| # | Id | Sev | What |
|---|---|---|---|
| 35 | R-025 | S3 | A 440 leaves no health event; the Numbers page only says "not connected" |
| 36 | R-031 | S3 | The adapter reports a logged-out number as "closed" |

### Not app bugs (environment, noted)

The worktree's `node_modules` pointed at a deleted worktree; the main checkout runs an old commit (`4fda7ef`); CodeGraph answered from another checkout; two `llm/settings` tests fail on Windows only; `antiban-v2-lane` AC-1.1 timed out once. See `docs/47-live-test-log.md`.

## AI template changes to consider (the owner's call; nothing changed)

From the live conversation. These are wording changes to "What the AI knows" or to the always-on rules, not code fixes.

1. Put back the owner's rules the rewrite dropped: "Never say the salary figure. Never mention internal notes or past applications." (LF-3)
2. Name the hand-over person by name, not email: give the team member a display name, or add a "name to give customers" to the template. (LF-4)
3. Say what to do with things it does not know, by example: "If asked what to bring, the dress code, parking or anything not written here, say <name> will confirm." (LF-14)
4. Language: "Reply in the language of the person's latest message." (LF-16)
5. Dates: "If they ask for a day other than their interview date, repeat the date we have and ask whether they want to move it." (LF-15)
6. Identity: decide what it says to "are you a bot?" and write it in (today it said "automated helper" and handed over). (LF-16)
