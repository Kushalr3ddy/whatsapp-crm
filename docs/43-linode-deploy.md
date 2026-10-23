# 43 · Beta production test on a Linode

One server, one compose stack: the app (API + gateway + web in one container), Postgres, and Caddy in front for HTTPS.
For observation and human testing. **No domain, no backups** (decided 2026-10-23); logs are what matter.

## What is where
| Part | Detail |
|---|---|
| Server | Linode Shared 4 GB, Mumbai, Ubuntu 24.04. Users: `deploy` (sudo, in the `docker` group). SSH by key only; root password login is off. |
| Firewall | `ufw`: 22, 80, 443 only. The API (3000) and web (3001) ports are bound to `127.0.0.1` inside Docker (`API_BIND`, `WEB_BIND`), because Docker-published ports go around `ufw`. |
| HTTPS | Caddy (`infra/compose/Caddyfile`) proxies only the web UI. The address is the server's IP with dashes plus `.sslip.io`, e.g. `<ip-with-dashes>.sslip.io`: a public service that points that name at the IP, so Caddy gets a real certificate with no domain. |
| Code | `/home/deploy/whatsapp-crm` (a git clone). Settings in `infra/compose/.env` (created on the server, git-ignored). |
| Secrets | Generated on first start into the `state` volume (`/app/state/secrets.env`). Copy that file off the server once; without it the database cannot be read. |

## Start, stop, update
```bash
cd ~/whatsapp-crm
bash infra/scripts/compose.sh -f infra/compose/compose.prod.yaml up -d --build     # start (same as: npm run prod:up, which needs Node)
bash infra/scripts/compose.sh -f infra/compose/compose.prod.yaml down              # stop; volumes (data) are kept
git pull && bash infra/scripts/compose.sh -f infra/compose/compose.prod.yaml up -d --build   # update (migrations run on start)
```

## Logs
Every process writes one JSON line per event (docs/28). Docker keeps 50 MB x 10 files per service and rotates them.
```bash
docker compose -p whatsapp-crm -f infra/compose/compose.yaml -f infra/compose/compose.prod.yaml logs --since 24h app > app-24h.log
C="bash infra/scripts/compose.sh -f infra/compose/compose.prod.yaml"; $C logs -f app          # live
C="bash infra/scripts/compose.sh -f infra/compose/compose.prod.yaml"; $C logs app | grep -E "decrypt-failure burst|unhandled error|sender not connected"
```
Signals worth grepping: `decrypt-failure burst: companion session looks diverged` (relink the number), `sender not connected` (the number is closed), `unhandled error`, and `ai_run` rows with `empty_answer` (the model returned nothing).

## First start
1. `C="bash infra/scripts/compose.sh -f infra/compose/compose.prod.yaml"; $C logs app | grep -A3 "organisation created"` shows the first admin email and a generated password (printed once; also in the `state` volume's `first-admin.txt`).
2. Open `https://<ip-dashed>.sslip.io/login`, sign in, change nothing else yet.
3. Copy `/app/state/secrets.env` and the admin password to a safe place off the server.
4. Link **one spare number** (Linked numbers page) and watch delivery for a day or two before real numbers: WhatsApp may quietly drop messages from a datacenter address (docs/29 section 8). If it does, the fallback is proxy support in the gateway plus a paid proxy (not built).

## Relinking a number
Linked numbers → Unlink → link again from the phone (WhatsApp → Settings → Linked devices). Needed after the `decrypt-failure burst` warning.

## Not done on purpose
Backups, log shipping, alerts, a domain (swap `SITE_ADDRESS` and `PUBLIC_URL` in `.env`, then `prod:up`; Caddy re-issues the certificate). Telemetry is D-56.
