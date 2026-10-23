# 44 · Findings from preparing the beta production test (2026-10-23)

Written while the stack was brought up on this laptop and on the Linode. "Mikhil's prod" always meant his own laptop; nothing was deployed before today.

## Test results (this laptop, `feat/linode-beta-deploy`, main with #154 #156 #157 #158 merged)
| Check | Result |
|---|---|
| Typecheck | clean |
| Lint | 0 errors, 3 warnings (`jsdoc/no-multi-asterisks`, fixable with `--fix`) |
| Unit + integration (vitest) | 78 files passed, 1 skipped; **923 tests passed, 1 skipped** (216 s) |
| Browser suite (Playwright, dev server, fake gateway, throwaway database) | **48 passed, 2 skipped, 1 failed** (8.3 min). The failure is `R-008` (below) |
| Production-style stack on the laptop (Docker, Caddy HTTPS) | up; HTTPS answered in 0.14 s; app used about 380 MB; API and web ports loopback-only |
| Live Linode | up; trusted certificate; ports 3000, 3001, 5434 closed from outside; wrong password shows its error in about 140 ms |

## Findings
1. **R-008 fails when run against the dev server.** The test is written for a production build ("a same-page redirect from Contacts always shows its result on a production build"). On `next dev` the "You chose No tag" result never showed within 8 s (30 s test timeout). CI runs it on a production build, where it passes. Two readings, both worth knowing: the test is simply not valid on a dev server, or the dev server hits the same stalled same-page redirect that #150 fixed for production, and that is part of what Mikhil feels on `dev:all`. Not investigated further. Action: make the spec skip itself unless `REGRESS=1` (production build), like the speed probe does.
2. **The "Signing in…" stuck button did not reproduce** on a production build, locally through Caddy or on the live Linode: the error appears in 90 to 140 ms and the button resets. After 3 wrong attempts the API locks sign-in for a few minutes (HTTP 429 "Too many failed sign-ins") and that message shows too. The most likely cause on a laptop is dev mode compiling the sign-in action the first time (seconds, during which the button reads "Signing in…"). Not filed as a bug; recheck on Mikhil's laptop with `--fast-web`.
3. **Docker publishes ports around the firewall.** `ufw` does not protect a port Docker publishes, so the API (3000) and web (3001) would have been public over plain HTTP. Fixed: `API_BIND` and `WEB_BIND` in `compose.yaml` (default unchanged), set to `127.0.0.1` on the server; Caddy is the only way in. Verified from outside.
4. **No domain, but a trusted certificate is possible**: `<ip-with-dashes>.sslip.io` points at the IP, so Caddy gets a real Let's Encrypt certificate. Replace with a real domain later by changing `SITE_ADDRESS` and `PUBLIC_URL`.
5. **This laptop has Docker 29 but no `docker compose` plugin**, only the old `docker-compose` 1.29. `infra/scripts/compose.sh` handles both and worked. The server has the v2 plugin.
6. **The generated first-admin password and the encryption keys** live only in the container's `state` volume. They were copied to `/home/kushal/linode-beta-credentials.txt` (mode 600, outside the repo). With no backups, losing the keys or the volume loses all data.
7. **A root password was typed into a chat.** Password login on the server is now off and the password is useless there, but it should be changed in Cloud Manager anyway. The setup key (`claude-setup-linode`) should be removed from both `authorized_keys` files when setup is over.
8. **Linode box:** 4 GB, 2 vCPU, 79 GB. 2 GB swap added as a safety margin for builds. The Docker build took a few minutes; idle the app uses well under 1 GB.
9. **The AI follow-up bug (R-012, #155):** a reasoning model used its whole 400-token budget thinking and returned an empty answer; fixed (3000 tokens) and a warning banner now shows when a model returns nothing. Found on the laptop; not yet seen on the Linode (no number linked).
10. **WhatsApp session desync on the laptop** (`decrypt-failure burst: companion session looks diverged`, 139 failures) after gateway restarts, as in D-82: relink fixes it. The local database was wiped afterwards, so the number must be linked again anyway.
11. **Datacenter-IP risk still untested:** WhatsApp may quietly drop messages from a cloud address. Test with one spare number for a day or two (docs/29 section 8). If it fails, the fallback is proxy support in the gateway plus a paid proxy (not built).
12. **Earlier today, for the record:** the import page had a 40-column cap and a lock on personal columns (now all columns by default, cap 200, #154); "dev mode is slow on first visit" explained the lag on Mikhil's laptop (hint added to `dev:all`, #153); the login lockout was triggered by my own repeated test requests.

## Not done on purpose
Backups, log shipping, alerts, a domain, compiling the API and gateway (no speed gain; they run through `tsx`), proxy support for the gateway. Telemetry stays D-56.
