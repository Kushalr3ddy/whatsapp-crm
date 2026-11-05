# 03 · Competitive analysis

Research date: **September 2026**. Sources listed at the bottom. Pricing and feature claims
move fast — re-verify before quoting any of it externally.

## The landscape

| Product | Shape | Transport | Self-host | Notable |
|---|---|---|---|---|
| **Wati** | SMB shared inbox + broadcast | Official (BSP) | No | Strong support inbox; automation limited to keyword triggers on lower tiers |
| **AiSensy** | India-focused marketing | Official (BSP) | No | Best visual campaign/bot builder in the India segment |
| **Interakt** | India SMB, commerce-leaning | Official (BSP) | No | Auto-replies rather than multi-step branching |
| **Respond.io** | Mid-market omnichannel | Official + others | No | Best-in-class inbox: routing, SLA, collision detection |
| **Periskope** | Multi-number & groups | **Unofficial** | No | The only serious WhatsApp **group** management tool; flat per-seat pricing |
| **TimelinesAI** | Multi-number sync | Unofficial | No | Multi-number, CRM sync |
| **Gallabox / DoubleTick / Zoko / Rasayel** | SMB inbox + commerce | Official | No | Varying commerce depth |
| **Kommo** | Sales CRM with WhatsApp | Official | No | Real pipeline/deal CRM; drip sequences |
| **Twilio / Infobip / Gupshup / 360dialog** | CPaaS / BSP | Official | No | Infrastructure, not a CRM |
| **Chatwoot** | Open-source support inbox | Via integration | **Yes** | Excellent inbox; not WhatsApp-native, no campaign engine |
| **Evolution API** | Open-source WhatsApp REST layer | Unofficial + official | **Yes** | ~9.2k stars; multi-instance; the de-facto OSS transport layer |
| **Chatwoot + Evolution** | The OSS stack people actually assemble | Both | Yes | Two products stitched together; no unified campaign or anti-ban engine |
| **wacrm** | Self-hosted WhatsApp CRM template | **Official only** | **Yes** | MIT, Next.js + Supabase, single-tenant. The closest thing to this project's shape — see below |

### `wacrm` — the nearest neighbour (reviewed 2026-09-22)

[`github.com/ArnasDon/wacrm`](https://github.com/ArnasDon/wacrm) · [wacrm.tech](https://wacrm.tech)
· MIT · 741 commits · Next.js 16 + server actions + Supabase · single-tenant · self-hosted.

Worth a section of its own because it is the only open-source project aiming at roughly the same
place: a self-hostable WhatsApp CRM rather than an inbox or a transport layer.

**What it has that we do not:** sales pipelines with kanban, a no-code automation builder, an AI
reply assistant with a knowledge base (BYO OpenAI/Anthropic key), analytics, CSV contact import,
outbound webhooks with HMAC-SHA256 signing, internal notes, agent assignment, media in the
composer both directions, an MCP server, and a one-click deploy story. That is most of a product
surface we have not started.

**The decisive difference is the transport, and it is not a gap in their work — it is the rules
of the API they chose.** wacrm is **Meta Cloud API only**. Its broadcasts are Meta-approved
template messages, which means a verified Business account, a BSP, per-template approval, the
24-hour service window and per-message fees. **Cold outreach to people who never messaged first
is not something that stack can do.** That is the exact use case this project's Baileys path
exists to serve, and the exact reason P6 exists to make it survivable.

The inverse also holds and should be said plainly: for opt-in marketing to an existing customer
list, their approach is cheaper to operate, legal, and carries no ban risk. We are not strictly
better; we are aimed somewhere else.

**On the numbers:** 2.4k stars against **6.2k forks**. That inversion is characteristic of a
one-click-deploy template — people fork to deploy, not to contribute — so it should not be read
as 6.2k developers.

**What to take from it:**

1. **Outbound webhooks with HMAC signing.** JobPortal will want events pushed rather than
   polled, and this is the shape to copy (`docs/16-integration-jobportal.md`).
2. **CSV import.** P5 already specs it; their shipping it is evidence of the demand.
3. **An MCP server** is a cheap, differentiating surface once the public API is stable.

**What not to take:** the architecture. Server actions against Supabase is faster to add
features on, and we are deliberately paying for ports, adapters and a separate gateway process
so that a transport can be swapped under a contract suite. That cost only pays back because we
run two transports as peers — which is the one thing they cannot do.

## Table stakes

Present in essentially every competitor. Absence is disqualifying, so these are all V1:

shared team inbox with assignment · contact tags and custom attributes · template management
with Meta approval status · broadcast to a segment · keyword chatbot / auto-reply · canned
replies · click-to-WhatsApp link and QR generator · delivery and read analytics · contact
import · a Zapier-shaped integration story · mobile-responsive inbox.

## Differentiators worth building

Ranked by (gap in the market) × (cheap for us, because of decisions we've already made).

| # | Feature | Who has it | Why it's our opening |
|---|---|---|---|
| 1 | **Cost-aware routing** — "this campaign costs ₹8,600 on Meta, ₹0 on Baileys, here's the risk delta" | **Nobody** | We are the only design running both transports as peers behind one port. Falls straight out of `ChannelProvider.capabilities.costPerMessage`. |
| 2 | **A real ingestion framework** — mapping UI, dry run, scheduled syncs, per-row error ledger | Nobody; everyone has "import CSV" | The old system's single worst pain point (M3–M9). Already a first-class port. |
| 3 | **Self-hostable, single product, no vendor in the path** | Only Chatwoot+Evolution, and that is two products | Our entire premise |
| 4 | **Anti-ban engineering as a product feature** | Unofficial tools mostly hide this | `08-antiban.md` says what is in place and what is pending |
| 5 | **Genuine multi-number management** | Periskope, TimelinesAI | Most tools are one-WABA-shaped; ours is sender-identity-shaped from the schema up |
| 6 | **Collision detection & typing indicators between agents** | Respond.io; rare in the India segment | Cheap once realtime exists |
| 7 | **WhatsApp groups as a first-class object** | Periskope (its moat) | Baileys can do groups; the Meta API cannot. V2. |
| 8 | **Per-row provenance and audit** on everything | Nobody | Falls out of the audit-log requirement |

## Deliberately not building

- **Commerce** — catalogue, cart, payments. Region-locked, and a product in itself.
- **Voice / video.**
- **A visual journey builder** before the primitives under it are solid. AiSensy's is good;
  building ours first would be building the icing.
- **Becoming a BSP.**

## Meta platform features to keep the schema ready for

Not V1, but the schema should not need a migration to accept them — hence `jsonb` on
template metadata:

- **Interactive media carousels** — horizontally scrollable cards, no product catalogue needed.
- **Flows 2.0** — in-chat booking, forms, and payment without leaving the conversation.
- **Catalogue messages** — up to 30 products per message.
- **Click-to-WhatsApp ad attribution** — a distinct event when a user arrives from an ad.
- **AI-initiated conversation category** — a new billing category when an LLM is the originator.
- **Business app + Cloud API on one number simultaneously** (2026) — changes onboarding advice.

## Pricing context (India, 2026)

Meta's own per-message rates, which per-template billing replaced per-conversation billing with:

| Category | Approx. rate |
|---|---|
| Marketing | ~₹0.86 per message (revised up ~10% during 2026) |
| Utility | ~₹0.145 |
| Authentication | ~₹0.145 |
| Service (inside the 24h window) | **Free** |

Utility and authentication have per-market volume tiers that reduce the rate above certain
monthly thresholds; marketing has no volume discount. SaaS competitors add a **12–20% markup**
on top of these, plus a platform subscription. Periskope's flat ~$20/seat with unlimited
messages is the outlier, and is possible precisely because it runs unofficially.

**Our cost story:** the software is free, the infrastructure is a VPS, Baileys traffic costs
nothing, and Meta traffic is billed by Meta at Meta's rate with no markup. The cost report
(FR-66) makes that visible rather than asserted.

## What we learn from each

- **Respond.io** — inbox mechanics: collision detection, transfer, mentions, SLA visibility.
  This is the bar for F3.
- **AiSensy** — campaign builder UX. Visual, forgiving, non-technical.
- **Periskope** — sender-identity-first data model, and groups as real objects.
- **Chatwoot** — what a well-run open-source inbox looks like: install story, theming,
  contribution model.
- **Evolution API** — multi-instance isolation done right, and proof the OSS demand is real.
  Also a warning: it is a transport, and people keep having to bolt a CRM onto it.
- **Wati** — the cost of putting automation behind pricing tiers: it is their most common
  complaint.

## Market research, 2026-10-10 — what the others have that we do not

A second pass over the field, done to find gaps. It extends the landscape above rather than replacing it.
**How much to trust it:** feature lists come from each vendor's own pages; pricing and the "cons" come
from review sites and *competitors'* blog posts, which are not neutral. Treat the pricing as an order of
magnitude and re-check before quoting. The WhatsApp-first tools keep their live product behind a
login, so no account was opened. Their screens come from the vendors' own public help-centre articles
(Wati, Interakt, AiSensy) and product pages (Zoho Recruit), which show real UI but at low resolution, and
AiSensy's is a schematic. Zoko, Gallabox, ChatDaddy, Trengo, HubSpot, Bullhorn and Naukri RMS have no
screenshot here and are described from text only.

### Who was looked at

| Group | Products | What they are |
|---|---|---|
| WhatsApp-first (official API, SaaS) | **Wati**, **Interakt**, **AiSensy**, Zoko, Gallabox, ChatDaddy | Shared inbox + broadcast + no-code bot, sold per seat plus a 12–25% markup on Meta's per-message rate |
| Omnichannel inbox | **Respond.io**, Trengo, **Chatwoot** (open source) | One inbox across WhatsApp, Instagram, Messenger, email, live chat; routing, SLA, reports |
| General CRM | **HubSpot**, **Pipedrive**, **Twenty** (open source) | Contacts, deals pipeline, tasks, email, reports; WhatsApp is an add-on |
| Recruitment | **Zoho Recruit**, **Bullhorn**, **Naukri RMS**, Manatal | ATS + CRM: resume parsing, job boards, candidate pipelines, interview scheduling |

### Features they have and we do not (yet)

Ordered by how often it appeared and how much it matters to the people this product is for.

| Gap | Who has it | Where it stands here |
|---|---|---|
| **Message templates** with Meta approval status, in a library | Wati, Interakt, AiSensy, Respond.io | Pinned D-19 |
| **No-code chatbot / flow builder**, keyword auto-replies | Wati, Interakt, AiSensy, Respond.io, Chatwoot | Out of scope until the primitives are solid (see above); keyword auto-reply is the cheap first step |
| **AI agent** answering and handing off to a human | Wati (Astra), Respond.io, Interakt, Chatwoot (Captain), HubSpot | Deferred (F12); human takeover pinned D-42 |
| **Scheduled broadcasts** (up to 2 months ahead) | Wati, AiSensy | Not built; campaigns start now or never |
| **Ready-made behavioural segments** (highly engaged, win-back, at risk) | Wati | We have saved audiences and filters, but no engagement-based presets |
| **Delivery / read / click / reply analytics** per campaign and per agent, plus CSAT | Wati, AiSensy, Respond.io, Chatwoot | Per-recipient results exist; no agent/team reports, no read/click rates |
| **Pipeline / lifecycle stages** (New lead → Hot → Customer) with a kanban | Wati, Respond.io (Lifecycle), Pipedrive, HubSpot, Twenty | Not built; deliberately no domain objects, so it would be a user-defined stage field |
| **Snooze**, **@mentions**, collisions, "collaborations" inbox | Respond.io, Chatwoot | Thread lock only; D-17 / D-18 |
| **Saved custom inboxes** (e.g. "Morning shift", "VIP customers") | Respond.io | Only mine / unassigned / all × open / closed |
| **SLA, business hours, auto-assignment, agent capacity** | Chatwoot, Respond.io | Not built |
| **Account limit and quality shown beside campaign results** (daily messaging limit, quality rating) | Wati | Meta tier tracking is pinned D-37; our number health panel is the nearest thing |
| **Opt-in status on the contact** ("WhatsApp opted: yes") | Interakt | Do-not-contact exists; an explicit opted-in flag does not (D-27 is opt-out only) |
| **Bot-to-human handoff queue** (Active / Requesting / Intervened) | AiSensy | Waits on a bot (D-42) |
| **Slash snippets with variables** (`/` snippet, `$` variable, `:` emoji) and a command bar | Respond.io, Chatwoot | We have a saved-reply picker; no inline `/` |
| **Contact merge suggestions** | Respond.io | We merge LID duplicates automatically; no manual suggestion UI |
| **Click-to-WhatsApp ads**, attribution, **WhatsApp Flows / forms**, catalogue, in-chat payments | Wati, Interakt, AiSensy | Commerce is out of scope; CTWA attribution and Flows are listed as schema-ready |
| **Integrations**: Zapier, Shopify, HubSpot / Salesforce / Zoho sync, outbound webhooks | All of them (Wati 100+) | P9 (webhooks, OpenAPI); nothing yet |
| **Other channels**: Instagram, Messenger, SMS, email, live chat, voice calls | Respond.io, Wati, Interakt, Chatwoot | Out of scope; `ChannelProvider` port keeps it possible |
| **Resume parsing, job-board posting, candidate scorecards, interview scheduling** | Zoho Recruit, Bullhorn, Naukri RMS, Manatal | Out of scope (we are not an ATS); this is the host app's job via the API |
| **Self-service signup, billing, SSO / 2FA**, mobile app, knowledge base | Most | Signup/billing pinned D-47 (built once, reverted for now); SSO and mobile not planned |

### What we have that most of them do not

- **Self-hostable and API-first**, with no per-message markup on the unofficial path.
- **An anti-ban policy** (the first engine was removed on 2026-10-30; the new one is pending).** The WhatsApp-first SaaS tools sit on the official API and do not need one; the
  unofficial tools rarely show theirs.
- **Do-not-contact enforced on every send path with an audited admin override**, and an append-only
  audit log written in the same transaction as the change.
- **Row-level security on every tenant table**, proved by tests that query with no filter.
- **A real ingestion path** (CSV / Excel, dry run, per-row ledger, content-hash dedup) where most tools
  stop at "upload CSV".

### Interface patterns worth copying

Screenshots are in [`assets/competitors/`](assets/README.md); these are the patterns, with what each
one costs.

| Pattern | Seen in | Why it works | Cost / caution |
|---|---|---|---|
| **Narrow icon rail → section list → conversation list → thread → slim right rail** | Respond.io | Four columns that each do one job; the left list doubles as a saved-view switcher with live counts | Dense on small screens; needs a mobile collapse |
| **Tabs with counts** (Mine 11 · Unassigned 5 · All 18) and a source label on every conversation | Chatwoot, Respond.io | Tells an agent what needs them without opening anything | Counts must update live or they erode trust |
| **Activity events inline in the thread** ("assigned to…", "set priority to high", "closed by contact merge") | Chatwoot, Respond.io | The thread becomes the audit trail an agent actually reads | Needs an event stream per conversation |
| **Internal comments in a different colour**, composer with Reply / Private note tabs | Chatwoot, Respond.io | Makes it hard to send a note to a customer by mistake | We already separate notes by construction; the colour cue is cheap |
| **Right panel as collapsible sections** (actions, participants, macros, attributes, previous conversations) | Chatwoot | Progressive disclosure; the panel never overwhelms | Needs a sensible default open section |
| **Status chips on list cards** (Closed, Snoozed) and the assignee avatar | Respond.io | Scannable | Snooze must exist to show it |
| **Kanban with stage totals and a "schedule activity" popover** | Pipedrive | The pipeline *is* the home screen | Only worth it if we add stages |
| **Table + kanban views over user-defined objects, Notion-like** | Twenty | One model, many views; fast | A big build; our "no domain objects" principle points the same way |
| **Merge-suggestion banner in the contact panel** | Respond.io | Duplicate people are surfaced where the agent is looking | Needs a duplicate-detection rule |
| **Filter sidebar inside the inbox**: channels, then All / Active / Assigned to me / Unassigned / Favourite / Solved / tags, any filter pinnable, two groups combinable | Wati | Saved views without leaving the inbox; "Assigned to me" and "Open" can be combined | Counts were replaced by markers in Wati's own redesign, which suggests live counts are costly |
| **Campaign overview with the account's health on top**: daily Meta messaging limit, consecutive days messaging, messaging quality, then Sent / Delivered / Read / Replied / Failed tiles | Wati | The number's limits sit next to the results, which is where a sender looks | We already compute the health of a number; it lives on a different page |
| **Reply and Notes tabs, "Choose template" when the 24-hour window is closed**, and a contact panel with opt-in status, tags and notes | Interakt | The window state is stated in the composer; opt-in is visible per contact | Needs the Meta window (D-18) and an opt-in field (D-27) |
| **Bot lanes: Active, Requesting, Intervened**, with an Intervene button and Resolve | AiSensy | Makes a bot-to-human handoff a visible queue | Only meaningful once a bot exists (D-42) |
| **Pipeline matrix**: one row per job, one column per stage (Assessment, Screening, Submissions, Interview, Hired), a count in each cell | Zoho Recruit | A manager sees every opening's funnel on one screen | Needs stages and a notion of "job", which is the host app's data |

![respond.io inbox](assets/competitors/respondio-inbox.jpg)
![Chatwoot conversations](assets/competitors/chatwoot-inbox.jpg)
![Pipedrive pipeline](assets/competitors/pipedrive-pipeline.jpg)
![Twenty CRM](assets/competitors/twenty-crm.jpg)
![Wati campaigns overview](assets/competitors/wati-campaigns-overview.jpg)
![Wati team inbox filter sidebar](assets/competitors/wati-team-inbox-filters.jpg)
![Interakt shared inbox](assets/competitors/interakt-shared-inbox.jpg)
![AiSensy live chat lanes (schematic)](assets/competitors/aisensy-live-chat-lanes.jpg)
![Zoho Recruit pipeline view](assets/competitors/zohorecruit-pipeline-view.jpg)

Our UI after #7 already has the three-panel inbox, day separators, a contact side panel and a risk
meter on numbers, so the gap is in *behaviour* (saved inboxes, inline events, snooze, counts), not in
layout.

### Pros and cons, as reviewers describe them

| Product | Pros | Cons |
|---|---|---|
| **Wati** | Easy no-code workflows; strong CRM integrations (Zoho, HubSpot, Salesforce); polished inbox; 4.6/5 on Capterra (203 reviews) | Hard 3-user cap on the entry plan; ~20% markup on Meta rates; reviewers report true cost well above list price; automation and reporting customisation limited |
| **Interakt** | Native Shopify triggers (cart abandonment, order updates); cheap entry; 14-day trial | Thin automation; contact limits on lower tiers; 12–25% markup; India-centric support |
| **AiSensy** | Cheapest of the group; quick broadcasts; schedule 2 months ahead; IST support | Marketing-first; thinner inbox and CRM; Meta rates passed through |
| **Respond.io** | Best inbox mechanics (routing, lifecycle, workflows); many channels; good support | Expensive for growing teams; billed by monthly active contacts; reviewers miss pipeline depth; some sync and edit lag |
| **Chatwoot** | Open source and self-hostable; SOC 2; very complete support-inbox feature set | Not WhatsApp-native; campaigns are basic; no anti-ban engine |
| **Twenty** | Open source, modern, fast, custom objects, workflows free | Not a messaging tool; WhatsApp would be an integration |
| **HubSpot** | Generous free CRM; 2,000+ integrations; reporting | Useful features (duplicate management, scoring, custom objects) gated to paid tiers; WhatsApp is shallow |
| **Pipedrive** | Best-in-class visual pipeline; activity-based selling; 500+ integrations | Sales-only; WhatsApp via add-on |
| **Zoho Recruit** | Free tier; resume parsing, job boards, blueprint process enforcement; low price | Blueprint and AI matching only on the top plan; WhatsApp is chat-based, not a campaign engine |
| **Bullhorn** | Whole-agency system for large staffing firms; 300+ marketplace partners | Heavy and expensive; built for enterprise staffing, not a small team |
| **Naukri RMS** | The Indian resume database sits next to the workflow | Little public detail on messaging; tied to Naukri's ecosystem |

### What this suggests, in order

None of this is scheduled; it is for Kushal to rank.

1. **Templates (D-19) and scheduled broadcasts** — the two table-stakes items we still lack.
2. **Inbox behaviour**: tab counts, inline activity events, snooze, saved inboxes. Cheap, and where
   Respond.io and Chatwoot are clearly ahead.
3. **Campaign analytics and agent reports** — the first thing a manager asks for.
4. **Engagement-based segment presets** (highly engaged, win-back, at risk) — we hold the data already.
5. **Webhooks + OpenAPI (P9)** — every competitor leads with integrations.
6. **A lifecycle stage field and kanban**, only if users ask for a pipeline; it must stay a
   user-defined field, not a domain object.

Everything else on the gap table is either out of scope by principle (commerce, voice, ATS features) or
waiting on a decision (AI agent, other channels).

## Sources

- Respond.io — [Best WhatsApp CRM 2026](https://respond.io/blog/best-whatsapp-crm), [Best WhatsApp API Providers](https://respond.io/blog/best-whatsapp-api-providers)
- Periskope — [Best WhatsApp group management tools](https://periskope.app/blog/best-whatsapp-group-management-tools-for-businesses-features-pricing-use-cases), [DPDP compliance guide](https://periskope.app/blog/dpdp-compliance-for-whatsapp-based-business-operations-a-guide)
- [Evolution API](https://github.com/evolution-foundation/evolution-api) · [self-hosted MVP stack example](https://github.com/anirudhatalmale6-alt/whatsapp-crm-selfhosted-mvp)
- Meta — [Messaging limits](https://developers.facebook.com/docs/whatsapp/messaging-limits/)
- Pricing — [MyOperator India 2026](https://myoperator.com/blog/whatsapp-business-api-pricing-india-2026), [Blueticks 2026 categories](https://blueticks.co/blog/whatsapp-business-api-pricing-2026), [AiSensy pricing](https://aisensy.com/pricing)
- Platform updates — [Infobip WhatsApp news](https://www.infobip.com/blog/whatsapp-news-and-updates), [Omnichat 2026 features](https://blog.omnichat.ai/whatsapp-features/)
- Comparisons — [Ominiflow: Wati vs Interakt vs AiSensy](https://ominiflow.com/wati-vs-interakt-vs-aisensy), [ChatMaxima 2026 roundup](https://chatmaxima.com/blog/10-best-whatsapp-crm-systems-2026/)
- Open source — [wacrm: best open-source WhatsApp CRMs 2026](https://wacrm.tech/blog/best-open-source-whatsapp-crm)
