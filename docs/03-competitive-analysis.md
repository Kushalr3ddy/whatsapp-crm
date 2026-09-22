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
| 4 | **Anti-ban engineering as a product feature**, with a visible sender-health dashboard | Unofficial tools mostly hide this | `08-antiban.md` is the deepest part of the design |
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

## Sources

- Respond.io — [Best WhatsApp CRM 2026](https://respond.io/blog/best-whatsapp-crm), [Best WhatsApp API Providers](https://respond.io/blog/best-whatsapp-api-providers)
- Periskope — [Best WhatsApp group management tools](https://periskope.app/blog/best-whatsapp-group-management-tools-for-businesses-features-pricing-use-cases), [DPDP compliance guide](https://periskope.app/blog/dpdp-compliance-for-whatsapp-based-business-operations-a-guide)
- [Evolution API](https://github.com/evolution-foundation/evolution-api) · [self-hosted MVP stack example](https://github.com/anirudhatalmale6-alt/whatsapp-crm-selfhosted-mvp)
- Meta — [Messaging limits](https://developers.facebook.com/docs/whatsapp/messaging-limits/)
- Pricing — [MyOperator India 2026](https://myoperator.com/blog/whatsapp-business-api-pricing-india-2026), [Blueticks 2026 categories](https://blueticks.co/blog/whatsapp-business-api-pricing-2026), [AiSensy pricing](https://aisensy.com/pricing)
- Platform updates — [Infobip WhatsApp news](https://www.infobip.com/blog/whatsapp-news-and-updates), [Omnichat 2026 features](https://blog.omnichat.ai/whatsapp-features/)
- Comparisons — [Ominiflow: Wati vs Interakt vs AiSensy](https://ominiflow.com/wati-vs-interakt-vs-aisensy), [ChatMaxima 2026 roundup](https://chatmaxima.com/blog/10-best-whatsapp-crm-systems-2026/)
- Open source — [wacrm: best open-source WhatsApp CRMs 2026](https://wacrm.tech/blog/best-open-source-whatsapp-crm)
