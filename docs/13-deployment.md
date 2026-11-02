# 13 · Deployment & operations

Target: **a stranger self-hosts a working instance in under 10 minutes from the README alone.**

## Presets

One `PRESET` variable (or `config/preset.yml`) expands to a full driver set, so a self-hoster
makes one decision rather than thirty. Individual variables override anything.

| | `lean` (default) | `standard` | `scale` |
|---|---|---|---|
| Processes | 1 (`PROCESS_ROLE=all`) + gateway | api + worker + gateway | replicas per role |
| Queue | pg-boss (Postgres) | BullMQ + Redis | BullMQ + Redis |
| Storage | filesystem | MinIO | S3 / R2 |
| Web | static export via Caddy | Next.js server | Next.js + CDN |
| Telemetry | off — stdout logs, `/metrics`, cron alerts | full stack | full + remote write |
| LLM · SMS · AV | off | off unless configured | as configured |
| **Baseline RAM** | **~0.7–1 GB** | ~2.5–3.5 GB | 8 GB+ |

`lean` runs **every v1 feature**. It simply does not run the tools for *observing* the system,
which can be added the day they are needed. Details in [`19-capacity.md`](19-capacity.md).

## Compose profiles

Start only what you are not already paying for. This generalises the pattern the previous
system reached for Postgres alone (`--profile local-db`) to every resource.

| Profile | Starts | Skip when |
|---|---|---|
| `core` | caddy, app, postgres | never |
| `split` | separate api / worker / gateway | staying single-instance |
| `local-cache` | redis | `QUEUE_DRIVER=pgboss` |
| `local-storage` | minio | filesystem, or S3/R2/B2 |
| `local-auth` | keycloak | built-in auth or a hosted IdP |
| `observability` | prometheus, grafana, loki, tempo, alertmanager | **off by default** (~1–2 GB) |
| `local-llm` | ollama | **off by default** (5–7 GB) |
| `local-av` | clamav | **off by default** (~1.2 GB) |
| `dev` | mailhog, adminer | not developing |
| `external-db` | nothing — points `DATABASE_URL` elsewhere | using bundled Postgres |

```bash
docker compose --profile core up -d                       # lean: the whole product
docker compose --profile observability up -d              # add monitoring later, no restart
```

## Setup

`make setup` checks Docker, generates secrets, runs migrations, creates the first admin
interactively, and prints the URL. Also shipped: one-click templates for Coolify and Dokploy.

The image stays **12-factor, stateless and health-endpointed**, so a Helm chart is an additive
contribution later rather than a redesign.

## Configuration

One `.env.example` documents **every** variable — typed, marked required/optional, and grouped
by driver. It is validated by the same Zod schema the app uses, so `docker compose config`
catching a mistake and the app crashing at boot are the same check (M17).

Required in every deploy: `DATABASE_URL`, `APP_SECRET`, `ENCRYPTION_KEY`, `PUBLIC_URL`.
Everything else has a documented default. **A missing required secret is a hard crash with a
readable message, never a silent random fallback.**

> **`SEND_TIMEZONE`** is the install's local day, set explicitly, not inferred from the host or cloud region. The home
> page greeting (good morning / afternoon / evening) is worked out in it.

### Key `org_setting` defaults

| Setting | Default | Editable |
|---|---|---|
| `cooldown_days` | 14 | yes |
| `quiet_hours` | 21:00–09:00 local | yes |
| `retention_raw_events_days` | 30 | yes |
| `optout_keywords` | locale packs | yes |

What decides how fast a number sends is the anti-ban policy — see [`08-antiban.md`](08-antiban.md).

## Upgrades — zero downtime (M21a)

The prior system deployed by `git pull && docker compose down && docker compose up -d --build`
over SSH **with a password in CI secrets** — full downtime, no migration step, no health gate,
no rollback.

```
1. CI builds and scans the image, pinned by digest
2. Migrate — forward-only, backwards-compatible (expand → migrate → contract)
3. Start the new version alongside the old
4. Health-gate on /ready
5. Shift traffic; drain queues on SIGTERM
6. Stop the old version
   └─ any failed health check auto-rolls back
```

Authentication to the host is by **SSH key or OIDC, never a password**. Migrations never drop a
column in the same release that stops writing it — that is the contract step, a release later.

## Backups (M21b)

The prior system's `daily_backups.yml` had no schedule despite its name, dumped Postgres to
SQLite on the ephemeral CI runner, and then `echo "s3 not yet setup, so skipping"`. **There
were no backups.**

- Nightly `pg_dump` **plus WAL archiving** to object storage, with a retention policy.
- Encrypted at rest; the KEK backed up separately — a database backup without the key is
  useless, and both in one place is a single point of compromise.
- **A restore drill runs in CI** against a scratch database and asserts row counts and a
  successful application boot. *An untested backup is not a backup, and a backup discarded
  with the runner is not even that.*
- **RPO ≤ 24 h, RTO ≤ 1 h** (NFR-11).
- `channel_auth_state` living in Postgres means a restore brings the **WhatsApp numbers** back
  with it — the single strongest argument against file-based session state (M30).

## Scaling

In order, as load grows:

1. Move Postgres off the box (managed or its own host).
2. `--profile split` — separate api / worker / gateway.
3. Add workers. They are stateless; the queue distributes.
4. Shard the gateway by sender identity — each number pinned to one gateway instance, since
   sockets are stateful and a number must hold exactly one connection.
5. Read replicas for analytics.

The gateway is the component that does **not** scale horizontally for a single number. Shard
by number, never load-balance one.

## Logging

Pino → JSON → stdout → whatever collects it. **UTC RFC3339** (M25 — the prior system shifted
timestamps to IST by adding 5.5 hours and relabelling the `Z`, which breaks every log tool).

Every line carries `request_id`, `org_id`, `actor_id`, `module`. PII redacted by field
**allowlist**, so a new field is redacted by default. In `lean`, `docker logs` and `journald`
with logrotate are the intended answer — `grep` works, and it costs nothing.

## Metrics

Exposed at `/metrics` whether or not Prometheus is running, so `lean` users can scrape on demand.

- **Business** — messages sent/delivered/read/failed by provider and template; campaign
  progress; reply rate; inbox response time; import rows/sec; Meta spend.
- **Safety** — per-sender delivery ratio, quality rating, tier headroom.
- **Technical** — HTTP p50/p95/p99 by route, queue depth and job age, worker saturation, DB
  pool usage, slow queries, error rate.

Shipped Grafana dashboards (importable JSON, no Grafana required to keep them): RED per
service, USE per resource, and **Sender Health** — the one an operator keeps open.

## Alerting

| Severity | Examples | Response |
|---|---|---|
| **Critical** | Sender risk Critical or 401 logged out · session down > 5 min · DB down · queue depth > 10k · error rate > 5% · disk > 90% · webhook DLQ growing | Page |
| **Warning** | Risk High · delivery ratio < 85% · Meta quality dropped to Medium · tier headroom < 20% · p95 > 2 s · import failure rate > 10% · cert expiry < 14 d | Same day |
| **Info** | Campaign completed · sync done · new sender linked | Digest |

Every alert links to an entry in [`14-runbooks.md`](14-runbooks.md) — **the alert says what to
do, not merely that something is wrong**. `make test-alerts` fires each one so the routing is
verified before it matters.

In `lean`, the `alerts=cron` driver runs the same rules as a scheduled query posting to a
webhook, email or Telegram — no Alertmanager required.

## The application's database role

**Connect the application as a non-superuser.** Postgres superusers bypass row-level
security entirely — `FORCE ROW LEVEL SECURITY` constrains a table's *owner*, but not a
superuser, so an app connected as one has every tenant policy silently disabled while the
policies still look enabled in `pg_tables`.

Migration `0001` creates a `crm_app` role for this. Verified behaviour once connected as it:

| Context | Result |
|---|---|
| No `app.org_id` set | **0 rows** — a forgotten org filter fails closed |
| `app.org_id` = org A | Only org A's rows |
| `app.org_id` = org B | Only org B's rows |
| Org A inserting a row owned by org B | `ERROR: new row violates row-level security policy` |

Grant `crm_app` a password and point `DATABASE_URL` at it in any deployment where the
migrating role and the application role can be separated. Migrations still run as the owner.

## Health

`/health` liveness · `/ready` dependencies checked · `/metrics`.

**Startup is a gated sequence** (M6): migrations verified, dependencies reachable, *then*
listen. The prior system's bootstrap was fire-and-forget — it listened and served traffic even
when table creation had failed.
