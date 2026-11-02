# Regression registry

Every bug that has reached a person gets a row here and a test that fails if it comes back. `npm run regress:check` (part of CI) fails when a row marked **guarded** has no matching test, when a test claims an R-number that is not in this table, or when a row has been **fixed** for no test at all.

**Status:** `open` (reported, test is a `fixme` stub or red) · `fixed` (code fixed, test still to write: not allowed to stay here) · `guarded` (fixed and a passing test names it).
**Test tag:** put `[R-012]` in the title of the test (`test('[R-012] ...')`, `it('[R-012] ...')`). Add `@smoke` as well for the few that must run on a production build in CI.

| ID | Date | What broke (in plain words) | Found by | Layer | Status | Fix | Issue |
|---|---|---|---|---|---|---|---|
| R-001 | 2026-10-22 | Forms that redirect after saving hung forever on "Creating…" / "Counting…" in a production build (Next's own gzip never finished the response) | session audit on a production build | e2e @smoke | guarded | #108 | #120 |
| R-002 | 2026-10-22 | A campaign or message to the sending number itself: the phone shows "Waiting for this message" and keeps asking for a resend | session audit, gateway log | integration | guarded | #110 | #128 |
| R-003 | 2026-10-22 | An import with a different name for someone already in the book kept the old name and said nothing | Mikhil (prod feedback issue 2) | integration | guarded | #107 | #117 |
| R-004 | 2026-10-22 | Clicking Create draft several times made several identical drafts (no feedback after the click) | Mikhil (issue 5) | e2e @smoke | guarded | #106 | #120 |
| R-005 | 2026-10-22 | Deleting a tag with an API key was refused (403) after the delete was limited to admin sessions | CI | integration | guarded | #105 | |
| R-006 | 2026-10-22 | "Tag many at once" Preview with no tag chosen gave no answer | Mikhil (issue 4) | e2e @smoke | guarded | #104, #108 | #119 |
| R-007 | 2026-10-22 | A contact row opened before the page finished starting up did not show its panel | CI | e2e @smoke | guarded | #111 | |
| R-008 | 2026-10-22 | A server action that redirects to the same page could leave the page blank on a production build: the root loading.tsx (a Suspense boundary) plus a slow, heavy target page stalled Next's client router. Fix: no root loading.tsx (the top progress bar covers navigation) | flaky CI, repro loop, minimal repro | e2e | guarded |  | #135 |
| R-009 | 2026-10-22 | Browser tests that import people used phone numbers that land on the seeded demo people (0120-0139) and, since newest-name-wins, renamed them: the seeded-pages tests (Farhan Ali, Asha Rao) then failed at random in CI | CI, trace of a failed run | e2e | guarded | #138 |  |
| R-010 | 2026-10-22 | Messages the owner sent from their own phone never appeared in the inbox (the gateway dropped every fromMe message) | Kushal, 2026-10-22 | integration | guarded | #144 | #143 |
| R-011 | 2026-10-22 | After a campaign's first message the AI did not take over the replies (nothing assigned the chat to the assistant, and the campaign's template was never used) | Kushal, 2026-10-22 | integration | guarded | #146 | #145 |
| R-012 | 2026-10-23 | The AI sent nothing after the contact's first reply: a reasoning model used its whole 400-token budget thinking and returned an empty answer (empty_answer) | Kushal, 2026-10-23 | integration | guarded | this PR | #155 |
| R-013 | 2026-10-23 | "Waiting for this message" on the other phone and own-phone messages missing from the inbox: Baileys 6.7.24 kept no link between a person's phone-number address and their LID address, so a reply under the LID found "No session record" and what we sent next could not be read | Kushal and the other dev, 2026-10-22 and 2026-10-23 | integration | guarded | this PR | #160 |
| R-014 | 2026-10-25 | A campaign message stayed queued ("sender not connected"): pressing Link again while the first, unscanned QR socket was alive left two sockets logged in as the same device, replacing each other forever (an old socket's late close dropped the new one, and the connection event re-sent the link request) | Mikhil, 2026-10-25 | integration | guarded | this PR | |
| R-015 | 2026-10-26 | Linking a number made a contact named after the account's own LID (<lid>@lid) with empty outgoing messages: the phone's sync messages to its own chat were stored as messages the owner sent, and they counted as undelivered sends | Mikhil, 2026-10-26, local sanity test | integration | guarded | #4 | #3 |
| R-016 | 2026-10-26 | An 18 KB .xlsx crashed the API: the import parser read every column out to the sheet's widest (16,384) for every row, with no column, row or unpacked-size limit, in the API process | Mikhil and Claude, 2026-10-26, import security review | integration | guarded | #7 | #6 |
| R-017 | 2026-10-30 | Numbers page kept saying Linked after WhatsApp removed the device | Mikhil, live test 2026-10-30 | e2e | guarded | |  |
