# 38 · Session audit on a production build (2026-10-22)

The same timed, recorded walk as [`37-session-audit-findings.md`](37-session-audit-findings.md), repeated on a **production build** (`next build` + `next start`) with Chrome closed, and extended with the screens added today (PRs #104 to #107). Real messages to the operator's own test numbers. Raw output: `test-results/session-real-20261022-170710/` (`report.md`, `compare-with-dev-run.md`, `session.webm`, `resources.csv`); the earlier dev-server run is `session-real-20261022-124106`. Re-run with `npm run test:session:real`; compare two runs with `node tests/live/session-compare.mjs <older> <newer> out.md`.

## Baseline before the run
Chrome closed, dev web server stopped: 5.7 GB of 15.7 GB used, 8 GB free, CPU 73% idle, load 1.4, swap 2.1 GB. Production web server after start: about 210 MB (the dev server had grown to 2.7 to 3.2 GB during the first run).

## Result: click to response
| | dev server (first run) | production build (this run) |
|---|---:|---:|
| steps / failed | 114 / 0 | 132 / 5 (all explained below) |
| median step | 1.12 s | **0.55 s** |
| 90th percentile | 3.35 s | **1.28 s** |
| slowest ordinary step | 12.79 s | **3.40 s** (the AI writing instructions: a real model call) |
| total on the 112 steps both runs have | 292 s | **173 s** |
| open Contacts | 5.97 s | **1.93 s** |
| open Inbox | 0.69 s | 0.24 s |
| Create draft | 1.26 s | 0.48 s |
| sign out | 2 to 10 s | **0.62 s** |
| message leaves the gateway after the inbox reply | 21 s | 16.6 s |
| campaign: all three recipients settle | 93 s | 85.6 s |
| web server memory | 2.7 to 3.2 GB | **0.2 to 0.3 GB** |
| machine CPU average / load average | 68% / 6.8 | 43% / 3.6 |

So a large part of "the interface is laggy" is **dev mode** (compiling every page on first visit, growing memory). Contacts is still the slowest real page (about 1 MB of HTML, D-46/D-89).

## Bugs and discrepancies found
1. **Forms that redirect hung forever in a production build (the big one; PR #108).** Create draft, "Tag many at once" Preview, New tag and every other server action ending in `redirect()` left the button on "Creating…" / "Counting…" and never moved on. The server answered in about 10 ms with the right `x-action-redirect` header; Next's own gzip response never finished, so the browser never followed it. With `compress: false` the same click takes 0.3 s. It cannot be seen in `next dev`. Very likely the cause of Mikhil's "create draft does nothing, I clicked 10 times", "tag add doesn't redirect" and "All loading for 2 minutes".
2. **`next build` fails if `.env` sets `NODE_ENV=development`** (`<Html> should not be imported outside of pages/_document`). Build with `NODE_ENV=production`.
3. **The API process had run for 6+ hours on old code** (`tsx watch` did not restart it after branch changes), so a new feature looked broken until the API was restarted. Restart the API after switching branches.
4. **`kushal_test` shows "Cooling off after a suspected soft ban: sending paused about 24h"**, delivery 61%, "Sent past a hold 25 time(s)" (advisory mode on). Advisory mode lets sends go out; WhatsApp may still be limiting the number. Worth watching before using it for real volume.
5. **No `<main>` landmark on the signed-in pages** (accessibility; test selectors cannot rely on it). Minor.
6. **Remove this number is hidden while a number is linked** and the page says "press Unlink first": correct, but easy to miss; the new audit step checks the note instead of the button.
7. The "newest name wins" Preview (PR #107) shows `Was "Test Phone One" → "Renamed Check …"` as designed once the API runs the merged code.

## The five failed steps in this run (all test problems, now fixed in the test)
Four were the rename-import steps re-uploading identical bytes (refused as "already uploaded", as designed: the file is now unique per run); one looked for a Remove button that is correctly hidden for a linked number. The rename Preview was checked on its own afterwards (`scripts/check-rename-preview.mjs`).

## Test changes (tests/live/session-audit.live.ts)
Brings the window to the front before every step and retries once when something covers the page or an element moves (a stray mouse or click); records script errors, console errors and failed or HTTP 4xx/5xx requests per step, in the step's note; new steps for the template picker, double-clicked Create draft (only one draft may appear), the Draft-created banner, the 14-day warning, the overrides popup, the custom-fields panel, Manage tags (Cancel only), Tag many at once, the rename-by-import Preview, and the Linked-numbers remove control. The real-mode campaign now starts through the overrides popup in the UI. Cancel-only: nothing destructive is confirmed.
