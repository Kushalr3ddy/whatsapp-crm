# 29 · Free hosting plan (AWS, GCP, Azure)

A plan for running this system for **about 10 people and up to 10 WhatsApp numbers**, using the
free offers of the big three clouds. Oracle is excluded on purpose.

Facts about the clouds were read from their own pages on **2026-10-13** and free offers change, so
treat the numbers as a snapshot and re-check before signing up. Where a claim comes from a blog or
forum rather than a vendor page, it says so.

---

## 1 · The honest summary

- **Nothing here is free forever except a machine that is too small to run this.** The realistic
  options are **free for 12 months** (Azure) or **free for 6 months** (AWS).
- **Azure is the best fit**: its free account includes a 4 GB Arm virtual machine for 12 months, which
  is the only free offer that comfortably holds the whole system.
- **The biggest risk is not money, it is WhatsApp.** Reports say WhatsApp silently restricts unofficial
  (Baileys) traffic from datacenter IP addresses. This is unproven for our case, so the plan tests it
  with one spare number before anything else, and has a fallback (section 5).
- **Nothing is built to deploy yet.** `infra/docker` and `infra/compose` are empty, and there is no
  production build step. Section 6 is the work that has to happen on our side, about one to two days.

---

## 2 · What the system needs

From the measurements in [19 · Capacity](19-capacity.md), one number:

| Part | Memory |
|---|---|
| API | ~265 MB |
| Gateway, one number | ~340 MB, then **~45 MB for each extra number** |
| Web (Next.js server, not optional) | ~170 MB |
| Postgres | ~70 MB idle, give it 200 to 300 MB with real history |

With **10 numbers** that is roughly **1.4 to 1.6 GB** of working memory. So:

- **Minimum useful: 2 GB.** Tight, needs swap.
- **Comfortable: 4 GB.**
- **A 1 GB machine does not fit**, even with swap, once you pass two or three numbers.

Disk is a non-issue: a message is about 1.6 kB, so a million messages is under 2 GB. Network is small
too (the UI, plus WhatsApp traffic and media).

One more requirement: the gateway holds **long-lived outbound WebSocket connections** to WhatsApp, one
per number. That rules out serverless and scale-to-zero products (Cloud Run, Lambda, Azure Functions,
App Service free tier). It needs an always-on virtual machine.

---

## 3 · The options

| | What is free | For how long | Fits? |
|---|---|---|---|
| **Azure** (free account) | **750 h/month** of a burstable VM: **B2pts v2 (Arm, 2 vCPU, 4 GB)**, or B1s / B2ats v2 (smaller). 2 × 64 GB managed disks. ~15 GB outbound data. $200 credit for the first 30 days. | **12 months** from signup | **Yes, best.** 750 h is one VM running 24/7. |
| **AWS** (new account "Free plan") | Up to **$200 of credits** over 6 months. | **6 months, or until credits run out.** The account then **closes** unless you move to a paid plan. | Works for a trial, **not** a plan. A 2 GB instance is roughly $15/month of credit. |
| **GCP** (always free) | **1 × e2-micro** (1 GB RAM) per month, 30 GB disk, 1 GB outbound/month, only in **us-west1, us-central1, us-east1**. $300 credit for 90 days. | **Forever** (the e2-micro) | **Too small** for the whole system (1 GB, US only). Useful only as a lean leftover. |
| Oracle | (excluded) | | |

Reading the table:

- **Azure, 12 months.** After that you pay (a small bill, look it up in the pricing calculator) or move.
  The free account has a **$0 spending limit** until you upgrade it, so it cannot silently run up a bill.
- **GCP** needs a billing account with a card and has **no hard cap**, only budget alerts.
- **AWS** is the most honest about it: the Free plan closes the account instead of charging you.
- **All three require a card** at signup for identity. See section 7.

### Why not the "two small VMs" idea

Splitting Postgres onto GCP's free e2-micro and the apps onto a second cloud sounds clever but puts
the database across the public internet from the app, and the e2-micro is in the US. It adds latency
and failure modes to save very little. One 4 GB Azure VM is simpler.

---

## 4 · The plan

### Layout on one VM

```
Internet ──443──► Caddy  (TLS certificate, automatic)
                    ├──► web  :3001   (Next.js)
                    └──► api  :3000   (API)
gateway ──outbound WebSockets──► WhatsApp
postgres  (localhost only, never exposed)
```

- Only ports 80 and 443 are open to the internet, plus SSH restricted to your IP.
- The web app forwards the person's session to the API over localhost (`CRM_API_URL=http://localhost:3000`).
- The gateway has no inbound port at all.
- A domain is needed for HTTPS. A free one (DuckDNS, or a Cloudflare-managed domain you own) is fine.

### Phases

**Phase 0, before committing to anything (a weekend)**
1. Create the Azure free account. Create **one** Linux **B2pts v2** VM from the **Free services** page in
   the portal (the portal warns that resources made elsewhere may not default to a free size).
2. Pick a region near the phone: **Central India** if B2pts v2 is offered there, otherwise the nearest
   (Southeast Asia, Japan). The WhatsApp login location should match the phone's.
3. Run the stack by hand, link **one spare number**, send a few messages to your own phones.
4. Soak for **72 hours** watching the silent-restriction tracker
   ([27](27-restriction-tracking.md)) and delivery receipts.

**Phase 1, if Phase 0 is healthy**
5. Package it properly (section 6) so a restart or reboot brings everything back.
6. Add numbers one at a time. The warm-up ramp already limits how fast each one can send.
7. Backups, uptime check, budget alert (section 7).

**Phase 2, month 10 or 11**
8. Decide: pay the small Azure bill, or move to a cheap VPS of 4 GB. Moving is a database dump plus
   `.env`, which is why backups and the key backup matter from day one.

---

## 5 · The datacenter-IP risk and what to do about it

Several write-ups (blogs and forum posts, not WhatsApp itself) describe the same symptom: a Baileys
companion running from a cloud or VPS IP connects fine and "sends" successfully, but messages quietly
do not arrive. The number is not banned; the unofficial device's traffic is dropped. The reports
suggest **residential IP addresses do not have this problem**.

That is the exact failure the silent-restriction tracker was built to notice from delivery evidence
(`restriction_state`, "no delivery for 3h", the number's health timeline). So Phase 0 is the test.

If Phase 0 shows it, in order of effort:

| Fallback | How | Cost |
|---|---|---|
| **Split: gateway at home, rest in the cloud** | Run only the gateway on your own always-on machine (residential IP), joined to the cloud VM by **Tailscale** (free personal plan). It reaches Postgres over the private network. | Free. Your machine must be on. |
| **Everything at home** | Run the whole stack on your own machine; expose it with a **Cloudflare Tunnel** (free) for the web UI. | Free. Power and internet at home. |
| **Route the socket through a residential exit** | Egress the WhatsApp connection through a home Tailscale exit node (SOCKS proxy). | Needs a code change: the Baileys adapter has **no proxy support today**. |

Whichever you use, keep **one stable IP** per number. Changing it often looks like account sharing.

---

## 6 · What has to be built on our side

None of this exists yet (the two deployment folders are empty). Rough list:

| Item | Notes |
|---|---|
| Production build for the API and gateway | `npm start` points at `apps/api/dist/server.js` but there is no build script that makes it. Either compile with `tsc` or run with `tsx` in production. |
| `next build` and `next start` for the web app | Already works; needs wiring and an environment file. |
| A **Dockerfile** and a **compose file**, or **systemd units** | Compose is simpler to rebuild; systemd is lighter on a 4 GB machine. Pick one. |
| **Caddyfile** | TLS plus two reverse proxies. |
| Migrations at start | Run `db:migrate` before the API and gateway start. |
| **Arm check** | The B2pts v2 is Arm. Node, Postgres and Next run fine on Arm; the one native module is `@node-rs/argon2`, which ships Arm builds, but the full test suite must be run once on the real VM. |
| Log rotation | Docker's `max-size` and `max-file`, or logrotate. See [28 · Logging and telemetry](28-logging-and-telemetry.md). |
| A **backup job** | Nightly `pg_dump`, copied off the machine, encrypted. |
| An **update procedure** | `git pull`, install, build, migrate, restart. Written down, then rehearsed. |

---

## 7 · Operations and guard rails

**Secrets.** `ENCRYPTION_KEY`, `ENCRYPTION_INDEX_KEY` and `ENCRYPTION_KEYS_PREVIOUS` live only in the
VM's environment file (permissions `600`) **and in a backup somewhere else**. Losing them loses every
linked number's session and every message. Back up the database and the keys to **different places**.

**Backups.** Nightly dump, kept for 14 days, copied to free object storage (Azure Blob 5 GB for 12
months, or your own machine). Do one **restore drill** before relying on it.

**Cost guard rails.**
- A budget alert at a very small amount, on day one.
- Create resources from the **Free services** page, not by hand, so the free size is the default.
- Keep exactly one VM running; a second one uses up the 750 hours and bills the rest.
- Do not add a paid managed database or a second public IP "to try".

**Security.** SSH keys only, no password login; firewall as above; automatic security updates; Postgres
bound to localhost; the API's bootstrap `API_KEY` is only for provisioning.

**Monitoring.** `GET /health` and `GET /ready` plus a free uptime monitor (UptimeRobot's free plan, or
a scheduled curl). Logs via the runtime. A real metrics endpoint is pinned as D-56.

**The card.** All three clouds need a payment card to verify identity, and each lets only a first-time
customer have the free account. If a card is refused, or you have had an account with that provider
before, the plan changes. That is a question only you can answer (section 8).

---

## 8 · Decisions needed from you

1. **Have you had an Azure, AWS or GCP account before?** Azure's 12 months is for new customers only.
2. **Will a card work?** Azure and Google generally need a debit or credit card that allows online
   recurring charges. If yours was refused elsewhere, try a different one first.
3. **Is "free for 12 months, then a small bill or a cheap 4 GB VPS" acceptable?** Or must it be free
   forever (in which case the honest answer is your own machine plus a Cloudflare Tunnel)?
4. **Is a machine at home available 24/7** as the fallback gateway host?

---

## 9 · Sources

- Google Cloud free tier: <https://docs.cloud.google.com/free/docs/free-cloud-features>
- AWS free tier: <https://aws.amazon.com/free/>
- Azure free account: <https://learn.microsoft.com/en-us/azure/cost-management-billing/manage/create-free-services>
- Azure free services list: <https://azure.microsoft.com/en-us/pricing/free-services>
- Datacenter-IP reports for Baileys (anecdotal): <https://www.valebyte.com/en/blog/whatsapp-bot-on-vps-via-baileys-free-instead-of-whatsapp-business-api/>
