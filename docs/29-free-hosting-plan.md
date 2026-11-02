# 29 · Free hosting plan

How to run this system for **about 10 people and up to 10 WhatsApp numbers** without paying, using
the free offers of cloud providers and free services, alone or combined.

Offers were read from the vendors' own pages on **2026-10-13**. Free tiers change often and without
notice (Oracle halved its free Arm machine in June 2026 without announcing it), so re-check before
you rely on one. Where a claim comes from a blog or forum rather than a vendor page, it says so.

**Constraints that shaped this version (from the owner):** the AWS, Azure and GCP free accounts were
already used in college, so they are probably not available again; a payment card may not work; and
Oracle has already been tried and burnt, so it is last.

---

## 1 · The honest summary

1. **No card-free cloud service can host the gateway.** The gateway is a long-running process that
   holds one WebSocket per WhatsApp number, needs about 1.5 GB at 10 numbers, and must not sleep. The
   free always-on containers that used to cover this have gone, need a card, or put the process to
   sleep (section 4).
2. **Cloud only, with your constraints, means paying a little** (section 1a): about ₹600 to ₹1,000 a
   month for a 4 GB VPS you can pay for with UPI. The free routes (an existing GCP account's
   e2-micro, startup credits, someone else's first-time Azure account) each depend on an account or a
   card you may not have.
3. **Combining "free" cloud pieces mostly does not work, for specific technical reasons**
   (section 5): the database features this system leans on (row-level security, `LISTEN/NOTIFY`, a
   privileged role switch) rule out SQLite-style stores such as D1 and document stores such as Convex,
   and the process that matters cannot run on Lambda or Workers.
4. **Home hosting** (your own machine, or the shelved homelab) would be the best free answer and the
   best answer to the datacenter-IP risk, but it is out of reach for now. It stays in the document as a
   reference.

---

## 1a · Decision: cloud only (2026-10-13)

Home hosting is out: there is no machine at home, and the homelab at a cousin's house is out of
reach. (The 50 Mbps line was never the problem; this system needs well under 1 Mbps.)

What is left has to run in the cloud. The constraints: the AWS, Azure and GCP free accounts were used
in college, a payment card may not work, and Oracle is burnt.

**The finding.** After checking the vendors' pages, there is **no free, always-on cloud host with 2 GB
or more that needs neither a card nor a first-time account** (section 4). So "cloud only" means one
of these, best first:

| Tier | What | Cost | Needs | Fits 10 numbers? |
|---|---|---|---|---|
| **B** | **A small paid VPS you can pay for with UPI**, 4 GB | About ₹600 for the first term, about ₹1,000 a month on renewal (Hostinger, per a secondary source; MilesWeb quotes a smaller plan near ₹430) | UPI | **Yes, comfortably. Recommended.** |
| **A** | **GCP Always Free e2-micro**, with Supabase Free as the database | ₹0 | An **existing GCP billing account in good standing with a valid payment method** | **Pilot only** (1 GB, US regions only) |
| **C** | **Startup credits** through Hiring Studios (AWS Activate $1,000, up to about 2 years; Google Start up to $2,000; Microsoft Founders Hub $1,000) | ₹0 for a long time | A real company with its own domain and website, and a cloud account that may need a card | Yes |
| **D** | Someone else's genuine first-time **Azure** free account (4 GB Arm VM, 12 months) | ₹0 for 12 months | That person's identity and card, in their name | Yes |
| **E** | Oracle | | Not available to you | Last |

**Why B is the recommendation.** It is the only option that is certain to work with what you have
(UPI is accepted by Indian VPS providers; the big clouds need a card). It is also the only one whose
size is right for 10 numbers, with the least engineering, in a region (India) near the phones. About
₹600 to ₹1,000 a month is the cost of not depending on a free tier that can change tomorrow.

**What A really is, so nobody is surprised.** The Always Free tier has no end date and is open to
existing customers, not only new ones (the $300 trial is the first-time part). But it needs a Cloud
Billing account that is active and in good standing **with a valid payment method**, which is the part
that may not hold for you. It is also 1 GB of RAM and only in Oregon, Iowa or South Carolina.

### Tier B in practice

```
browser ──HTTPS──► Caddy (automatic TLS)
                     ├─► web  :3001
                     └─► api  :3000
gateway ──outbound WebSockets──► WhatsApp
postgres (localhost only)
nightly encrypted dump ──► free off-site storage
```

- **4 GB RAM, 2 vCPU, 40 GB or more of disk**; an **India data centre** if offered (same country as
  the phones).
- One box, one compose file, as in section 9. Postgres on the same machine, never exposed.
- **First 72 hours is a test, not a launch:** link one spare number and watch for the silent
  restriction (section 8). If it shows, the choice is a different provider's IP range or a different
  region, not a code change.
- Pay a month or a quarter at a time at first, not a year.

### Tier A in practice (only if the GCP account is alive)

| Part | Where | Notes |
|---|---|---|
| Gateway and API, one process (`PROCESS_ROLE=all`) | GCP e2-micro, **us-east1** | Add 2 GB of swap. Holds a few numbers, not ten. |
| Postgres | **Supabase Free**, nearest US region | 500 MB. Use the **session pooler** (port 5432, IPv4): it supports `LISTEN/NOTIFY`. The direct connection is IPv6 only on the free plan, and the transaction pooler (6543) has no `LISTEN`. |
| Web UI | A second free host (Cloudflare Workers or Vercel Hobby), or the same VM if memory allows | Vercel Hobby is non-commercial. Cloudflare's free CPU limit is tight (section 5). |

Costs of this layout, in plain terms: the WhatsApp login comes from a **US** address while the phone is
in India; the database is a network hop away (five round trips per statement, section 2) so keep both
in the same US region; and the free allowances (1 GB outbound a month, 500 MB of database) are small.
Treat it as an experiment, not the plan.

---

## 1b · Cheapest paid option on each provider (added 2026-10-15)

Asked for after the free options ran out: what a 4 GB box (the size section 2 says is comfortable for 10
numbers) costs on each cloud and on the obvious budget hosts. **How far to trust this:** prices come from
comparison sites and calculators dated 2026, not from each vendor's own page; they exclude tax, move often
(Hetzner raised prices on 1 April 2026), and a region changes them. Re-check at checkout.

| Provider | Smallest box that fits 4 GB | Roughly per month | Notes |
|---|---|---|---|
| **Hetzner Cloud** | CX23: 2 vCPU, 4 GB, 40 GB, 20 TB traffic (Arm CAX11 is €4.49) | **about €4** (€3.99; €4.49 with an IPv4 address) | The cheapest real 4 GB option here by a wide margin. Germany and Finland (and a few non-EU sites at higher prices, not checked). Far from Indian phones, and a datacenter IP: run the section 8 test first. Payment and sign-up checks not verified |
| **India-based VPS** (MilesWeb, Inservers and similar) | 4 GB plans | **about ₹430 to ₹880** | The same tier B as section 1a: UPI, rupees, Mumbai region, GST invoice. Plan sizes at the low end were not confirmed, so check that "₹430" really is 4 GB |
| **OVH** | VPS-2: 4 vCPU, 8 GB | about $10 | More machine than needed; secondary source |
| **Contabo** | Cloud VPS 2: 6 vCPU, 16 GB | about $11 | Cheap per GB, but shared and oversubscribed hosts are the usual complaint; secondary source |
| **AWS** | EC2 t4g.small (2 vCPU, **2 GB**) at about $12/month on demand; Lightsail 2 GB at $12 | **$12 for 2 GB** | 2 GB is the floor for a few numbers, not ten. t4g.small has a free trial of 750 h/month **until 31 December 2026** (secondary source), which needs an AWS account that is eligible and a working card. Lightsail's first 3 months are free on its $5, $7 and $12 plans |
| **Azure** | B2pls_v2 (2 vCPU Arm, 4 GB) | **about $16** in the cheapest regions; B2als_v2 (x86) about $18 in Central India | Dearest 4 GB of the big three after GCP; the 12-month free account in section 3 is the only way it is cheap |
| **GCP** | e2-medium (2 vCPU, 4 GB) | **about $40** in us-central1 | Dear for always-on use. The Always Free e2-micro (section 1a, tier A) is the only cheap route |

**Reading it.** Per month for a 4 GB box: Hetzner at about €4, an Indian VPS at about ₹430 to ₹880, Azure
about $16, AWS about $24 for the same 4 GB (extrapolated, not confirmed), GCP about $40. For the alpha the
real choice is between **an Indian VPS you can pay with UPI** (right region, rupees) and **Hetzner** (cheapest,
needs a card or PayPal and sits far from the phones). The big three are for credits, not for price.

**Anywhere else works the same way.** Any machine with 4 GB, Docker and outbound internet runs the alpha
container unchanged (`npm run alpha:up`), and `npm run alpha:tunnel` publishes it through a Cloudflare Tunnel
with no open inbound ports ([30 · Cloudflare Tunnel](30-cloudflare-tunnel.md)). That also means a spare
laptop or a mini PC at someone's home is a valid host if the section 8 test says datacenter IPs are trouble.

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

**A · Everything at home** (recommended; $0, no card)

```
phone/browser ──HTTPS──► Cloudflare Tunnel ──► home machine
                                                ├─ Caddy (optional) → web :3001 / api :3000
                                                ├─ gateway ──► WhatsApp  (residential IP)
                                                └─ Postgres (localhost)
home machine ──nightly encrypted dump──► free off-site storage (Supabase / Backblaze / Drive)
admin: Tailscale SSH
```

- Hardware: your current machine, a spare laptop, or a mini PC or Arm single-board computer with 4 GB.
  A mini PC left on 24/7 draws about as much as a light bulb.
- It answers the datacenter-IP risk by design.
- Risks you own: power cuts, router resets, your ISP changing your IP (consider a UPS and
  auto-restart on boot), and the machine being a single point of failure. Backups matter more here.
- Needs a domain for a friendly address (a free subdomain works), because Cloudflare Tunnel publishes
  names, not bare IPs.

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

That failure is not detected by the system.
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

1. **Does UPI work for you** on a VPS provider (it should; check it at checkout before relying on it)?
2. **Is about ₹600 to ₹1,000 a month acceptable** for tier B, or must it be ₹0?
3. **Is the old GCP account still active** with a valid payment method? That decides whether tier A is
   even possible.
4. **Is Hiring Studios a real company** with its own domain and website? That unlocks tier C.
5. **Telemetry:** logs only to Grafana Cloud, plus PostHog or Sentry for errors, or neither for now?

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
- AWS Activate: <https://aws.amazon.com/activate/credits>
- Google for Startups Cloud Program (secondary summary): <https://hub.causo.ai/startup-cloud-credits-compared-2026>
- Microsoft for Startups Founders Hub (Microsoft Q&A on eligibility): <https://learn.microsoft.com/en-in/answers/questions/5912941/eligibility-for-microsoft-for-startups-founders-hu>
- Hetzner Cloud prices after the April 2026 change (secondary): <https://findstack.com/resources/hetzner-price-increase-2026> and <https://agentdeals.dev/hetzner-pricing-2026>
- AWS Lightsail pricing (secondary): <https://kuberns.com/blogs/aws-lightsail-pricing-your-comprehensive-guide/>
- EC2 t4g.small price and free trial to end of 2026 (secondary): <https://calculator.holori.com/aws/ec2/t4g.small> and <https://dev.classmethod.jp/en/articles/ec2-t4g-small-free-tier-2026/>
- Azure B-series VM prices (secondary): <https://www.azurespeed.com/AzureVmPricing/Series/Bpsv2> and <https://calculator.holori.com/azure/vm/standard-b2als-v2>
- GCP e2-medium price (secondary): <https://calculator.holori.com/gcp/vm/e2-medium>
- Indian VPS price comparison (secondary): <https://www.techplained.com/cheapest-vps-india> and <https://gbnodes.host/blogs/cheap-vps-india-2026/>
