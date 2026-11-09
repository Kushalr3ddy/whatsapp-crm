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

## Open

### Security (review of 2026-11-09; evidence in docs/47)

| # | Id | Sev | What |
|---|---|---|---|
| s1 | SEC-1 | S2 | Raw session cookie and CSRF token written to the API log on every login |
| s2 | SEC-3 | S2 | An agent can clear do-not-contact and then message the person; agents can also add, link and unlink numbers |
| s3 | SEC-2 | S2 | Login limited per email only: anyone can lock the admin out for 15 min; no per-IP limit |
| s4 | SEC-4 | S2 | Install-wide AI settings editable by any org's admin; the saved key can go to a host the admin picks |
| s5 | DEP-1 | S2 | drizzle-orm 0.36.4 and zod 3.25.76 have high advisories; reach not checked; fixes are major upgrades |
| s6 | SEC-7 | S3 | No security headers on the API, no CSP on the web app |
| s7 | SEC-9 | S3 | No rate limit on AI answer-now / commands / jobs |
| s8 | SEC-5 | S4 | Audit IP can be set by the caller |
| s9 | SEC-6 | S4 | A database error may log query parameters (not reproduced) |
| s10 | SEC-8 | S4 | Any org's admin can pause install-wide key rotation |
| s12 | ISO-1 | S4 | Another org's conversation messages answer 200 with an empty list instead of 404 (no data shown) |
| s11 | VAL-1 | S3 | A NUL character in a tag name gives a 500 (Postgres refuses it); other text fields probably the same, not checked |

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
| 2 | R-024 | S3 | A campaign can be started on a removed number | API start |
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
| 9 | LF-11, LF-17 | S2 | The closing message never names the campaign: it quotes whatever was last typed in the chat (an old agent reply, or the AI's own last line, cut off), because campaign messages are skipped as `sent_by = 'system'` | `antiban/opt-out.ts:159` |
| 10 | U-1 | requirement | On STOP the chat should end with the hand-over person's name and number and two lines on the campaign's goal | `buildClosingMessage`, `opt-out.ts` |
| 11 | LF-19 | S2 | Someone who says STOP twice can be messaged by an agent again: the second STOP counts as "they wrote again" | `apps/gateway/src/lane.ts:84`, `:466` |
| 12 | LF-12 | decision | A confused "who is this" is read as an opt-out and the person is told "We will not message you again" | AI classifier, test AC-6.1 |
| 13 | LF-17 | decision | A rude message is read as an opt-out | same |
| 14 | LF-18 | S2 | "I want to talk to a real human", right after an opt-out, gets silence and no hand-over | opt-out + AI gate |
| 15 | SC-6 | S2 | Neither the thread nor the Details panel shows that the person opted out or restarted | Inbox |
| 16 | SC-5 | S3 | Closing messages are labelled "Campaign" in the thread | Inbox |

### Inbox

| # | Id | Sev | What | Where |
|---|---|---|---|---|
| 17 | R-023 / SC-9 | S3 | A reply of only spaces is accepted and arrives as an empty bubble; the chat list preview reads "Message" | `routes/messages.ts` `sendMessage` schema |
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
| 31 | R-030 | S2 | After 440 (session taken elsewhere) the adapter dials again by itself: two clients take the device from each other (the R-014 loop) |
| 32 | R-027 | S2 | Two link requests at the same moment open two sockets |
| 33 | R-028 | S2 | Repeated 515 restarts reconnect instantly with no limit |
| 34 | R-029 | S2 | After a 403 (ban) the adapter dials the number again up to five times |
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
