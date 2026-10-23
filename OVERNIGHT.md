# What happened overnight (2026-10-22 to 2026-10-23)

You went to sleep with me in bypass mode and a checkpoint (tag `checkpoint-2026-10-22-night`, `main` 0ab3b9d). The full rules and log are in [docs/41-overnight-automation-run-2026-10-22.md](docs/41-overnight-automation-run-2026-10-22.md). In plain words:

## What I did
1. **Google Doc to markdown, no Google login (#149).** A small tool that runs in your own signed-in browser, reads the testers' doc, and saves a markdown file. `npm run feedback:latest` imports it. Tried on the real doc: 4 problems, 5 screenshots found.
2. **Hunted the "button does nothing" bug (R-008).** On a production build, a button that sends you back to the same page (like Contacts, Preview with "No tag") sometimes left the page empty. It never showed in CI because CI tests the dev server. I built a tiny test page until it broke the same way and found the cause: the app-wide loading placeholder file `loading.tsx`.
3. **Fixed it (#150).** Removed that file. On a production build the browser suite went from 9 failures to 1 (the one left is local test data, not the app). Added a real test so it cannot come back, and fixed the speed probe, which had been passing only because of the placeholder.
4. **Wrote it down (#151, #152).** The overnight log, this file, and the handoff.

Earlier the same evening: the AI now takes over a campaign's replies (#146, not live until the gateway restarts), the CI install flake fix (#148).

## What I did not do
- Did not restart the gateway (needs your yes).
- Did not send any WhatsApp messages or type in WhatsApp Web.
- Did not touch anything that was already working.

## For you to decide
- **No more grey placeholder blocks** while a page loads (the thin top progress bar still shows). If you want them back, revert #150: `git revert -m 1 000d54b` on a branch. A better option may be a placeholder only inside the slow pages.
- Say yes to a **gateway restart** so the AI campaign takeover goes live.
- Close issue #135 (fixed by #150).

## How to undo anything
`git revert -m 1 <merge commit>` on a branch for one change. To see the start of the night: `git checkout -b back-to-checkpoint checkpoint-2026-10-22-night`.
