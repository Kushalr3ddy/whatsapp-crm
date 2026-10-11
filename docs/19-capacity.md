# 19 · Capacity & resource planning

> **All figures below are estimates** derived from typical footprints for these components,
> not yet measured for this system. **P11 replaces every number here with a real measurement**
> and updates the calculator's coefficients. Treat them as planning guidance, not guarantees.

Interactive version: **[`capacity-calculator.html`](capacity-calculator.html)** — open it in a
browser, no server needed. Its `ASSUMPTIONS` object holds every coefficient used below.

## Measured on 2026-10-11 (replaces three estimates)

One org, about 90 messages and 80 contacts, one real linked number, measured with `ps` on the dev machine.
The API and gateway ran under the `tsx` loader, which adds some overhead; a compiled build should be a
little lower, so treat these as an upper bound for a small install.

| Part | Estimated before | Measured | Calculator now |
|---|---|---|---|
| API process | 150 MB | **264 MB** | `apiBase` 230 |
| Gateway (one linked number) | 110 MB + 45 per number | **338 MB** | `gatewayBase` 290, 45 per number |
| Web (`next start`) | 170 MB, optional | **170 MB**, **not optional** | always on |
| Postgres (idle, small DB) | 256 MB | 71 MB | unchanged (it grows with the data) |
| Disk per message | 1.5 kB | **1.6 kB** | unchanged |
| Disk per contact (with identities and tags) | 0.6 kB | **5.5 kB** | `kbPerContact` 5.5 |

What changed in the picture: the web UI is a server-rendered Next.js app (server actions, session
forwarding), so the "static export served by Caddy" lean option no longer exists and the lean preset gains
~170 MB. The smallest install is three processes (API, gateway, web) plus Postgres, about 1.1 GB before
headroom: still inside 2 GB, but with much less slack than the original 0.6 GB plan. Per-number RAM is
still an estimate; it needs a second and third linked number to measure.

## What actually drives load

In order:

1. **Connected WhatsApp numbers** — the clearest RAM driver (~30–60 MB each).
2. **Messages per day** — CPU, queue depth, disk growth.
3. **Stored message history** — disk.
4. **Concurrent agents** — API and realtime connections.

**Contacts barely matter.** A million contact rows is a few hundred MB and Postgres does not
care. People size for contacts and then get surprised by numbers and history.

## Why everything optional is off by default

| Optional component | RAM | Disk | Lean substitute |
|---|---|---|---|
| Prometheus | 300 MB – 1 GB | 1–2 GB / 15 d | `/metrics` stays exposed; scrape from elsewhere, or not at all |
| Grafana | 150–250 MB | small | Dashboards ship as JSON; run Grafana locally against a dump |
| Loki | 200–500 MB | 1–5 GB / mo | JSON logs to stdout → `docker logs` / journald + logrotate. `grep` works. |
| Tempo | 200–400 MB | 1–3 GB | Trace ids are still in the logs |
| Alertmanager | 30–50 MB | — | `alerts=cron`: a scheduled query posting to a webhook |
| **Telemetry total** | **~0.9–2.2 GB** | **3–10 GB** | **≈ 0 MB** |
| MinIO | 200–400 MB | your media | `STORAGE_DRIVER=filesystem` |
| Next.js SSR server | 100–200 MB | — | Static export served by Caddy — a logged-in app needs no SSR |
| Redis | 50–150 MB | — | `QUEUE_DRIVER=pgboss` (single-instance only) |
| ClamAV | 1–1.2 GB | 300 MB | Off; magic-byte and size validation still apply |
| **Ollama (8B Q4)** | **5–7 GB** | 5 GB | Off, or a hosted API |
| Split processes | ~300 MB overhead | — | `PROCESS_ROLE=all` |

**The telemetry stack costs more RAM than the application it watches.** That is why it is
opt-in — not because monitoring is unimportant, but because defaulting it on makes the smallest
supported deployment impossible.

## The LLM question

`LLM_DRIVER=none` is the default and F12 disappears from the UI, exactly like SMS.

| Option | Local cost | Per-message cost | When |
|---|---|---|---|
| **`none`** (default) | 0 | 0 | Always, to start. Rules (F9) cover most of it, more predictably. |
| **Hosted API** | ~0 RAM | fractions of a paisa at this volume | The pragmatic middle. No infrastructure; swap providers by env var. The trade is privacy — use a paid tier with no-training terms, in-region. |
| **Self-hosted** | 5–7 GB RAM for 8B Q4, or ~6 GB VRAM | 0 | **Only on a separate box with a GPU.** On a shared CPU VPS an 8B model runs at single-digit tokens/sec — too slow for a live reply, and it will starve Postgres. |

Smaller models (Gemma 2 2B ≈ 1.7 GB, Phi-3.5-mini ≈ 2.5 GB) fit an 8 GB box and are adequate
for classification and tagging, but not for holding a conversation.

## Per-component footprint

| Component | Idle | Loaded | Scales with |
|---|---|---|---|
| api | 120 MB | 250–400 MB | concurrent agents, API QPS |
| worker | 100 MB | 200–350 MB each | queue throughput |
| **gateway** | 80–150 MB | **+30–60 MB per connected number** | **number count** |
| web (SSR) | 100 MB | 150–250 MB | — (0 if static) |
| postgres | 256 MB | 1–2 GB | working set, connections |
| redis | 50 MB | +queue depth (100k jobs ≈ 200–400 MB) | backlog |
| caddy | 20 MB | 40 MB | — |

**Disk.** ~1.5 KB per encrypted message plus index overhead → 10k msgs/day ≈ 5.5 MB/day ≈
**2 GB/year**. Postgres itself ~200 MB; 1 M contacts ≈ 400–800 MB with indexes. **Media
dominates if retained** — set a retention policy.

**CPU** is rarely the constraint: the anti-ban engine spends most of its time deliberately
sleeping. One vCPU handles ~8 msg/min/number comfortably. Encryption and spreadsheet parsing
are the spiky parts.

## Sizing tiers

| Tier | Agents | Contacts | Msgs/day | Numbers | vCPU | RAM | Disk | Shape | ≈ €/mo |
|---|---|---|---|---|---|---|---|---|---|
| **Solo** | 1–3 | ≤5 k | ≤1 k | 1–2 | 1–2 | **2 GB** | 25 GB | `lean`, one box | 4–8 |
| **Small team** | 5–10 | ≤50 k | ≤10 k | 3–5 | 2 | **4 GB** | 80 GB | `lean` + observability, or `standard` | 8–20 |
| **Growing** | 10–25 | ≤250 k | ≤50 k | 6–12 | 4 | **8 GB** | 160 GB | `standard`, Postgres may move off-box | 25–50 |
| **Scale** | 25–100 | 1 M+ | 200 k+ | 25+ | 8+ | **16–32 GB** | 500 GB+ | `scale`, managed Postgres, worker fleet, sharded gateways | 100–300 |

## The two numbers that matter more than the table

**1. The anti-ban engine caps Baileys at ~1,500 messages/day/number by design.**
So "50k messages/day" is not a hardware question — it needs roughly **34 warmed numbers**.
Throughput here is bought with numbers and patience, not with RAM.

**2. Meta's messaging tier caps you long before your server does** — 250/day unverified, then
1k, 10k, 100k. A bigger box does not move that.

Both are enforced in software, and both appear as inline warnings in the calculator, because
this is the single most common sizing mistake.

## Growth planning

Disk is the only resource that grows without action:

```
annual disk ≈ (msgs/day × 1.5 KB × 365)        message bodies + indexes
            + (media/day × avg size × 365)     usually the larger term
            + (contacts × 0.6 KB)
            + WAL and backup overhead (~30%)
```

10k msgs/day with modest media ≈ **5–8 GB/year**. Set retention before it matters, not after.

## Scaling order

1. Move Postgres off the box.
2. `--profile split`.
3. Add workers (stateless; the queue distributes).
4. Shard the gateway **by sender identity** — sockets are stateful; a number must hold exactly
   one connection. This is the one component that cannot be load-balanced.
5. Read replicas for analytics.
