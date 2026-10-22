# 41 · Overnight automation run (2026-10-22 night)

Kushal went to sleep with the session in **bypass mode** and gave it a mandate: *test and fix everything, assume decisions from earlier ones, merge automatically because it can be reverted.* This page says what was allowed, what was done, how to undo any of it, and what to check in the morning. It is written for him and for the next session.

## The mandate (his words, shortened)
- "Make a checkpoint commit before starting and keep testing and fixing everything."
- "Assume (it) if required, based on previous decisions."
- "Merge them automatically, since the PR can be reverted: that's why I asked for the checkpoint."
- "Create a manually triggerable Google Doc to markdown pipeline using my browser UI itself, no Google credentials."
- "To monitor the WhatsApp messages you can open web.whatsapp.com (the chat *mikhil-1* is test phone number 2)."

## Where to go back to (the checkpoint)
Branch `checkpoint/2026-10-22-night`, tag **`checkpoint-2026-10-22-night`** at `main` **0ab3b9d** (CI green; PRs #102 to #148 merged). To see it: `git checkout checkpoint-2026-10-22-night`. To undo **one** change, revert its merge commit on a branch (`git revert -m 1 <merge sha>`) and open a PR; to undo **everything** from the night, revert the merges after `0ab3b9d`, newest first. Every PR the run merged is listed below with its merge commit.

## The rules the run followed
- Small **independent** PRs from `main` (never stacked, so a revert is clean). Merge only when **every required check is green** (`check`, `e2e`, `secrets-scan`, `regress-smoke`, `bug-gate`), one PR at a time, then watch `main`'s CI; if it goes red, revert at once.
- *If it works, do not touch it*: only fix what is broken or was asked for.
- WhatsApp Web is for **reading** only: nothing was typed or sent from it. No real messages beyond what he already approved for his own test numbers. The gateway was **not** restarted again.
- Only Kushal's own browser ("Browser 2", the Linux laptop) was used; the other connected browser was left alone.
- Nothing from the testers (screenshots, names, numbers) is committed: the repository is public.

## Log
*(filled in as the night goes; see the "Outcome" section at the end for the summary)*

| time (IST) | what | PR / commit | result |
|---|---|---|---|
| 22:05 | Checkpoint made | branch + tag above | `main` 0ab3b9d green |
| 22:30 | Google Doc → markdown tool that runs in his signed-in browser (no credentials) | #149 (merge 1b2aada) | tried on the real doc: 4 problems, 5 screenshots; main green |
| night | Hunted R-008 (buttons that redirect to the same page sometimes did nothing on a production build). Built a tiny test page until it broke the same way | scratch only, not committed | cause: the root `loading.tsx` |
| night | Removed the root `loading.tsx`; made R-008 a real test (5 same-page redirects in a row); the speed probe now waits for the page's own heading | #150 (merge 000d54b) | all 5 required checks green; main green after merge |

## Outcome
**What was found.** On a production build, a button that redirects to the same page (Contacts: Preview with "No tag", tag many, confirm) could leave the content area empty with the address already changed. It showed on 9 browser tests run against a local production build, and probably is what testers meant by "the button does nothing". CI never saw it because CI's browser tests run against the dev server.

**Cause.** The app-wide `apps/web/app/loading.tsx` (the grey placeholder blocks) makes every page sit inside a waiting area. When a page was heavy and slow to draw, Next's client router never swapped the new page in after a redirect. A tiny test page reproduced it (heavy page + 0.6 s delay: 17-19 of 20 clicks stuck; the same page without the root `loading.tsx`: 0 of 60).

**What was merged.**
- #149: the Google Doc → markdown tool (done earlier in the night).
- #150: removed the root `loading.tsx`. On a local production build the browser suite went from 9 failures to 1 (that one is local test data: a phone number shared by two specs; CI has a fresh database). R-008 is now guarded by a real test, and the speed probe no longer passes on the placeholder's `<main>`.

**Trade-off for you to decide.** Navigation no longer shows grey placeholder blocks; the thin top progress bar still shows. If you want the blocks back, revert #150 (command below) and we look for another way. Because D-46 (laggy feel) is top priority, a better skeleton that does not wrap whole pages is worth a look (e.g. a loading file only inside the slow routes, tested with the R-008 test).

**How to undo.** `git revert -m 1 000d54b` (the merge of #150). To return everything to the start of the night: `git checkout -b back-to-checkpoint checkpoint-2026-10-22-night` (a new branch).

**Not done / needs you.** The gateway was not restarted overnight, so R-011 (the AI taking over campaign replies) is not live until you say yes to a restart. `feedback-ingest` still needs the Google service account secret if you want it automatic (the browser tool works without it). #139-#142 wait for Mikhil's answers. The nightly regression workflow has never run: trigger it once by hand.
