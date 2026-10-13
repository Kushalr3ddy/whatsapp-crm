# 29 · Free hosting plan

How to run this system for **about 10 people and up to 10 WhatsApp numbers** without paying, using
the free offers of cloud providers and free services, alone or combined.

Offers were read from the vendors' own pages on **2026-10-13**. Free tiers change often and without
notice (Oracle halved its free Arm machine in June 2026 without announcing it), so re-check before
you rely on one. Where a claim comes from a blog or forum rather than a vendor page, it says so.

**Constraints that shaped this version (from the owner):** the AWS, Azure and GCP free accounts were
already used in college, so they are probably not available again; a payment card may not work;
Oracle has already been tried and burnt, so it is last; there is **no machine at home**, but a
**homelab cluster is shelved at a cousin's house on a 50 Mbps up/down connection** (section 5A).

---

## 1 · The honest summary

1. **No card-free cloud service can host the gateway.** The gateway is a long-running process that
   holds one WebSocket per WhatsApp number, needs about 1.5 GB at 10 numbers, and must not sleep. The
   free always-on containers that used to cover this have gone, need a card, or put the process to
   sleep (section 4).
2. **The realistic free home for this system is hardware you control**, which in your case is the
   homelab at your cousin's house, with free services around it: Cloudflare Tunnel for HTTPS,
   Tailscale for admin access, free off-site backups, and free telemetry. It also has the best answer
   to the biggest risk, WhatsApp's treatment of datacenter IPs, because a home connection is a
   residential IP.
3. **Combining "free" cloud pieces mostly does not work, for specific technical reasons**
   (section 5): the database features this system leans on (row-level security, `LISTEN/NOTIFY`, a
   privileged role switch) rule out SQLite-style stores such as D1 and document stores such as Convex,
   and the process that matters cannot run on Lambda or Workers.
4. **If a cloud VM is a must**, the order is: a friend's or family member's genuine first-time Azure
   account, then a few dollars a month for a small VPS, then (last) Oracle.

---

## 2 · What the system needs

Measured in [19 · Capacity](19-capacity.md), one number:

| Part | Memory |
|---|---|
| API | ~265 MB |
| Gateway, one number | ~340 MB, then **~45 MB for each extra number** |
| Web (Next.js server, not optional) | ~170 MB |
| Postgres | ~70 MB idle, 200 to 300 MB with real history |

With **10 numbers**: roughly **1.4 to 1.6 GB**. Plan for **2 GB minimum, 4 GB comfortable**. A 512 MB
or 1 GB box fits a pilot of one to three numbers at most.

| Requirement | Why it matters when picking a host |
|---|---|
| **An always-on process** | The gateway holds a WebSocket per number. Sleeping, scale-to-zero and per-request billing all break it. |
| **Postgres with real features** | Row-level security (D-41 drops to a restricted role per statement), `LISTEN/NOTIFY` (wakes the gateway), triggers, a role that can `SET ROLE`, `bytea`, arrays, `jsonb`. |
| **The database next to the gateway** | Since D-41 every gateway statement runs as `BEGIN`, `SET ROLE`, `set_config`, the query, `COMMIT`: five round trips. At a 100 ms round trip to a far database, one send's queries take seconds. Keep them on the same machine or same network. |
| **Stable outbound IP** | WhatsApp ties a linked device to where it connects from. A changing address looks like account sharing. |
| **Node 22 and a native module** | `@node-rs/argon2` has Arm builds, but run the whole test suite once on whatever machine you pick. |

---

## 3 · Where each option stands

### Cloud accounts

| | What is free | Fits? | For you |
|---|---|---|---|
| **Azure** free account | 750 h/month of a burstable VM, including **B2pts v2 (Arm, 2 vCPU, 4 GB)**, 2 × 64 GB disks, ~15 GB outbound, **12 months**, $200 credit for the first 30 days. | Yes, the best of the three | **Probably unavailable**: new customers only, and a card is required. Only if someone who has never held an Azure account opens it in their own name. |
| **AWS** new-account Free plan | Up to **$200 of credits over 6 months**; the account then **closes** unless upgraded. | A 6-month trial, not a plan | Same eligibility and card problem. |
| **GCP** always free | **1 × e2-micro (1 GB)**, 30 GB disk, 1 GB outbound/month, **US regions only**. $300 for 90 days. | **Too small** (1 GB; US-only) | Same. |
| **Oracle** Always Free | See section 7. | In theory | **Last. Likely unavailable.** |

### Services that are genuinely free and need no card (as of the date above)

| Service | Free allowance | Useful for this system? |
|---|---|---|
| **Cloudflare Tunnel** | Free HTTPS exposure of a machine at home, no open ports | **Yes.** The way to publish a home-hosted UI. |
| **Tailscale** (personal) | Free private network between your own machines (verify the current device cap) | **Yes.** Admin access, or a home gateway to a cloud database. |
| **Supabase** Free | **500 MB** Postgres, 5 GB egress, 2 projects, paused after **1 week of inactivity** (ours is never idle) | **As an off-site backup target, yes. As the live database, no** (latency, see section 2). |
| **Neon** Free | 1 GB/project, **100 CU-hours/month**, **autosuspend after 5 min that cannot be turned off** | **No.** An always-running gateway keeps it awake all month and burns the hours early. |
| **Grafana Cloud** Free | 10k metric series, **50 GB logs**, 50 GB traces, 14-day retention, 3 users, no card | **Yes**, for telemetry. |
| **PostHog** Free | 1M events, 5k replays, **100k error-tracking exceptions**, logs, 1-year retention | Partly (errors yes; session replay **no**, see section 6). |
| **Cloudflare Workers** Free | 100k requests/day, **10 ms CPU per request**, 128 MB, 50 subrequests | The web UI, with caveats (section 5). Not the gateway. |
| **Vercel** Hobby | Free hosting of a Next.js app; terms limit it to **non-commercial** use | The web UI only. |

---

## 4 · Free always-on hosting for the gateway: what is left

| Platform | Reality in 2026 | Verdict |
|---|---|---|
| **Hugging Face Spaces** | The free CPU hardware is 16 GB, but **Docker Spaces now require a paid plan**; free ones also sleep when unused. | Out. |
| **Render** free web service | 512 MB, **sleeps after 15 minutes idle**, card required (per a comparison article). | Out: sleeping drops every WhatsApp socket. |
| **Railway** | $5 trial credit for 30 days, then $1/month. Its fair-use terms (per a forum thread) **disallow WhatsApp bots**. | Out. |
| **Koyeb** | Older guides list a free always-on 512 MB service; its current pricing page shows pay-per-use and a free Postgres of 5 hours a month, **no longer a clearly stated free web service**. | Unverified. At 512 MB it would only hold one to three numbers anyway. |
| **Back4app Containers** | 256 MB, sleeps when idle (per a comparison article). | Out: too small. |
| **Fly.io** | No free allowance for new accounts that I could confirm, and it asks for a card. | Out. |
| **Cloud Run, Lambda, Azure Functions, App Service free** | Scale to zero or per-request. | Out: cannot hold the sockets. |

Conclusion: with no working card, **there is no free managed place to run the gateway**.

---

## 5 · Mix-and-match: what was asked about, and why it does or does not work

| Idea | Verdict | Why |
|---|---|---|
| **Frontend on Cloudflare (Pages or Workers)** | Possible, not worthwhile | The web app is a server-rendered Next.js app that forwards the session to the API (server actions), so a static export is no longer possible. The OpenNext adapter supports server actions, but the **free plan's 10 ms CPU limit** is tight for rendering server components, and the UI would call the API across the public internet instead of localhost. Saves ~170 MB of memory at the cost of a second deployment. |
| **Frontend on Vercel Hobby** | Works technically | Free, but its terms restrict Hobby to non-commercial use. |
| **Cloudflare D1 for the database** | **No** | D1 is SQLite. The system relies on row-level security, `LISTEN/NOTIFY`, plpgsql triggers, `bytea` and Postgres arrays. SQLite support is a separate, unbuilt item (D-20). |
| **Convex** | **No** | A document database with its own function runtime. Using it means rewriting the data layer, the gateway's command channel, and every query. |
| **RDS (or Aurora)** | Not available to you | Only free through an AWS free plan, which needs an account you probably cannot open. Also far from the gateway (section 2). |
| **Lambda / Workers / Functions for the API** | Not worthwhile | The API is Express with `pino-http`, a native password-hashing module and a transaction-per-request pattern. Porting it saves nothing: the gateway still needs a real process. |
| **Lambda for the gateway** | **No** | Sockets that stay open for weeks. |
| **Supabase as the live database** | Works on paper, wrong place | Needs a direct, non-pooled connection for `LISTEN`, and the latency (section 2) makes it slow with the gateway elsewhere. Good as a backup target. |
| **Neon as the live database** | **No** | Autosuspend cannot be disabled, and the free hours run out in under three weeks of always-on use. |
| **"A tiny VM for the backend"** | The right instinct | It is the gateway and API on a machine you control. See combination A. |

### Combinations that hold together

**A · Everything on the homelab at your cousin's house** (recommended; $0, no card)

```
phone/browser ──HTTPS──► Cloudflare Tunnel ──► one node of the homelab
                                                ├─ Caddy (optional) → web :3001 / api :3000
                                                ├─ gateway ──► WhatsApp  (residential IP)
                                                └─ Postgres (local disk)
node ──nightly encrypted dump──► free off-site storage (Supabase / Backblaze / Drive)
admin: Tailscale SSH
```

**Why it fits.**
- **50 Mbps up and down is far more than needed.** The UI is a few kilobytes per click; WhatsApp
  traffic for ten numbers is a trickle; media is occasional. Bandwidth is not the constraint.
- **A tunnel needs no router access.** Cloudflare Tunnel makes an outbound connection, so nothing
  has to be forwarded on your cousin's router, and an ISP that shares addresses (CGNAT) does not matter.
- **It is a residential IP**, which is the best answer to the datacenter-IP risk (section 8).
- **A cluster is more than needed.** Run everything on **one** node with Docker Compose. Do not run
  k3s or Kubernetes for 10 users: it costs memory and operating effort for nothing here. Keep a second
  node as a cold spare, or later as a Postgres replica.

**What the node needs.** 4 GB of RAM (2 GB is the floor at 10 numbers), 20 GB of disk, Linux, and an
SSD or USB-SSD for Postgres: an SD card will wear out under a database. Arm is fine (Raspberry Pi 4
or 5, or similar); the suite must be run once on it.

**What you now depend on, because it is someone else's house.**

| Risk | What to do |
|---|---|
| Power cuts, or the node being unplugged | Boot on power-return in BIOS or firmware; a small UPS if you can; a smart plug so someone can power-cycle it remotely. |
| The router or Wi-Fi being restarted or changed | Wired Ethernet to the router; the tunnel reconnects by itself; a watchdog or systemd restart on the services. |
| Your cousin moves, changes ISP or turns it off | Agree it explicitly, and keep nightly backups so a move is a restore, not a loss. |
| The house's IP location | Keep the phones' country and city plausible for that address, and **do not move the node between houses** once numbers are linked. |
| Their electricity bill | A mini PC or Pi is a few watts to a few tens of watts; offer to cover it. |
| Reaching it when something breaks | Tailscale SSH and the tunnel for the UI. A smart plug as the last resort. |
| Privacy | The machine holds customer chats and WhatsApp sessions in another person's house. Full-disk encryption helps; `ENCRYPTION_KEY` stays in an environment file and in your backup, not on a USB stick left in the house. |

**B · Home gateway, cloud for the rest** (only if a cloud VM becomes available)

The gateway (needs the residential IP) stays at home. API, web and Postgres run on the cloud VM; the
gateway reaches the database over **Tailscale**. This is the same plan as the earlier Azure version,
with the one risky component moved. The five-round-trip cost in section 2 applies here, so the
database should live **with the gateway at home**, and only the web and API sit in the cloud.

**C · Cloud-only, minimal** (needs an eligible account or a few dollars)

One 4 GB VM (a friend's genuine Azure free account, or a small paid VPS): everything on one box with
Caddy. Test the datacenter-IP risk first (section 8).

**D · Pilot-sized, fully cloud, no card**

Not currently possible: nothing in section 4 holds even one number reliably.

---

## 6 · Telemetry on a free budget

Pairs with any combination. Telemetry is not built yet beyond logs (D-56); see
[28 · Logging and telemetry](28-logging-and-telemetry.md).

| Need | Free option | How it fits |
|---|---|---|
| **Logs**, searchable and kept 14 days | **Grafana Cloud (Loki)**, 50 GB/month | The app already writes JSON lines. A `pino-loki` transport ships them from inside the process, **no extra process and almost no memory**. Alternatives: Axiom, Better Stack. |
| **Metrics** (queue depth, sends and holds, number health) | **Grafana Cloud (Prometheus)**, 10k series | Needs the `/metrics` endpoint from D-56 first, plus a small agent (Grafana Alloy, about 100 to 150 MB) to push it. |
| **Errors** | **PostHog** error tracking (100k/month) or **Sentry** free | One small SDK in the API and gateway. |
| **Uptime** | UptimeRobot free, or a scheduled `curl` | Hits `GET /health`. |
| **Product usage** | PostHog events | Optional. |

Two cautions:

- **Never turn on session replay** for this app. It would record customer chats on screen and send
  them to a third party. Events and error tracking only.
- **Logs would leave your machine.** Message bodies are never logged and sensitive fields are
  redacted by allowlist, but phone numbers in ids and error text could still appear. Review a day of
  real log output before pointing it at a third party.

---

## 7 · Oracle (last, and probably not for you)

Listed because it was asked for, at the end because it is the least likely to work:

- **Always Free Ampere A1 is now 2 OCPUs and 12 GB** (it was 4 and 24 until **15 June 2026**), plus up
  to two 1 GB AMD micro VMs and 200 GB of disk. Existing instances over the new limit were shut down;
  a terminated one may not be re-creatable at the old size. Source: Oracle's own docs and InfoQ.
- **Idle reclamation:** an instance is reclaimed if, over 7 days, **CPU (p95) is under 20%, network is
  under 20%, and memory is under 20%** (memory for A1 shapes). This workload is the typical idle one:
  about 1.5 GB of 12 GB is roughly 12% memory. Expect it to be flagged.
- **Signup needs a working card and passes an anti-abuse check.** With several accounts already used,
  a new one is unlikely to clear it, and opening more accounts to get around that would break their terms.

Verdict: do not plan on it.

---

## 8 · The datacenter-IP risk and how to test it

Several write-ups (blogs and forums, not WhatsApp) describe the same symptom: a Baileys companion
running from a cloud IP connects and "sends" successfully but messages quietly do not arrive. The
number is not banned. A residential IP is reported not to have the problem. Unproven for us.

That is the failure the silent-restriction tracker detects from delivery evidence ([27](27-restriction-tracking.md)).
So before moving anything to a cloud VM: link **one spare number**, send a few messages to your own
phones, and watch it for **72 hours**. If anything looks restricted, use combination A or B.

There is no proxy support in the Baileys adapter today, so "route the socket through a home exit node"
needs a code change if you ever want it.

---

## 9 · What has to be built on our side (any combination)

| Item | Notes |
|---|---|
| Production build for the API and gateway | `npm start` points at `apps/api/dist/server.js`, but no script builds it. Compile with `tsc`, or run with `tsx`. |
| `next build` and `next start` | Works; needs wiring. |
| A Dockerfile and compose file, or systemd units | Compose is easier to rebuild; systemd uses less memory. |
| Caddy, or a Cloudflare Tunnel config | TLS plus the two proxies. |
| Migrations at start | `db:migrate` before the API and gateway. |
| Restart on boot, and after a power cut | Needed for a home machine. |
| A backup job | Nightly `pg_dump`, encrypted, copied off the machine. |
| Update procedure | `git pull`, install, build, migrate, restart. |
| Log shipping, if wanted | `pino-loki`, once you decide. |

Both deployment folders (`infra/docker`, `infra/compose`) are empty today. Roughly one to two days.

---

## 10 · Operations and guard rails

- **Keys.** `ENCRYPTION_KEY`, `ENCRYPTION_INDEX_KEY` and `ENCRYPTION_KEYS_PREVIOUS` live in the
  machine's environment file (mode `600`) **and in a backup somewhere else**. Losing them loses every
  session and message. Back up the database and the keys to **different** places.
- **Backups.** Nightly, kept 14 days, one restore drill before relying on it.
- **Security.** SSH keys only; no inbound ports at home when using a tunnel; Postgres on localhost;
  automatic security updates.
- **Watching it.** `GET /health` and `GET /ready`, a free uptime check, and logs.
- **Cost surprises.** There are none if no paid account is attached: a service that wants a card to
  start is a service to skip.

---

## 11 · Decisions needed

1. **What is the hardware?** Number of nodes, CPU model and architecture (x86 or Arm), RAM per node,
   storage type (SSD, HDD or SD), and whether any node has 4 GB or more.
2. **Is it powered and online now, and can it be reached remotely?** Or does someone have to switch it
   on and plug it in? Is it a wired connection?
3. **Is your cousin happy with it running 24/7**, and could they power-cycle it if asked?
4. **How often does power go out there?** That decides whether a UPS is worth buying.
5. **Is a few dollars a month acceptable as the fallback** if the house does not work out?
6. **Which telemetry**: logs only to Grafana Cloud, plus error tracking, or neither for now?

---

## 12 · Sources

- Google Cloud free tier: <https://docs.cloud.google.com/free/docs/free-cloud-features>
- AWS free tier: <https://aws.amazon.com/free/>
- Azure free account: <https://learn.microsoft.com/en-us/azure/cost-management-billing/manage/create-free-services>
- Oracle Always Free resources: <https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm>
- Oracle free-tier cut (InfoQ): <https://infoq.com/news/2026/07/oracle-cloud-free-tier-limits/>
- Neon pricing: <https://neon.com/pricing>
- Supabase pricing: <https://supabase.com/pricing>
- Grafana Cloud pricing: <https://grafana.com/pricing/>
- Cloudflare Workers limits: <https://developers.cloudflare.com/workers/platform/limits/>
- Hugging Face Spaces overview: <https://huggingface.co/docs/hub/spaces-overview>
- Koyeb pricing: <https://www.koyeb.com/pricing>
- Free Docker hosting comparison (article, secondary): <https://flywp.com/blog/9769/best-free-docker-hosting-platforms/>
- PostHog free plan (secondary): <https://usercall.co/post/posthog-pricing>
- Datacenter-IP reports for Baileys (anecdotal): <https://www.valebyte.com/en/blog/whatsapp-bot-on-vps-via-baileys-free-instead-of-whatsapp-business-api/>
