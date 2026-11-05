# 32 · Setup, signup, teams and billing

**Status: a plan. Nothing here is built, and nothing will be built until the alpha test is complete (Kushal, 2026-10-20).**
It answers: how setup should work, whether it chains to signup, what a new organisation goes through (details, keys, billing,
payment checks, adding teammates), what other products do, what comparable tools charge, and what to build in what order.
The payment-provider comparison is its own document: [`33 · Payment providers`](33-payment-providers.md).

Decisions already made (Kushal, 2026-10-20): **invite-only beta first**; teammates are **added by an org admin** (who can reset a
password and revoke access, but **never delete** an account, because audit logs, assignments and chats must stay); payments are decided
after reading doc 33; **no implementation before the alpha test ends**.

Prices and fees quoted from other products come from third-party comparison pages found by web search (2026), not from the vendors'
own pages. Treat them as direction, and check the vendor's page before relying on a number.

---

## 1 · Setup and signup are two doors into the same room

There is one function that creates an organisation and its first admin: `createOrgWithAdmin()` in
`packages/core/src/provisioning.ts`. It runs in one transaction, inserts the `org`, the `app_user` (argon2id password), an
`org_membership` with role `admin`, and the audit rows. Everything below calls it.

| Door | Who uses it | When | What it asks |
|---|---|---|---|
| **Setup** (first-run wizard, D-8) | The person running the deployment | Once, when the database has **no organisation** | Organisation name, admin email, password (generated, shown once) |
| **Signup** (D-47) | A customer's first admin | Any time after that | Name, organisation, work email, password, **and an invite code** during the beta |

So the answer to "is setup chained to signup?" is yes: **the wizard is signup for organisation number one**, and the signup page is
the same form behind an invite code for number two onwards. Today the first organisation is made by `npm run admin -- org` (or by the
alpha container's `entrypoint.sh`, which also generates the secrets and writes the first password to `first-admin.txt`), and the signup
page at `/signup` only checks its fields in the browser and says nothing was created.

**Keys.** An org admin does not type or hold encryption keys. `ENCRYPTION_KEY`, `ENCRYPTION_INDEX_KEY`, `APP_SECRET` and the bootstrap
`API_KEY` belong to the deployment: generated once, backed up by the operator, rotated from the Security page. What an org admin owns is
their **API keys** (issued in the app, scoped, revocable), their **linked numbers**, and their **team**. One key per organisation
(so destroying a customer's key erases their data) is D-31, and is needed before untrusted organisations share a database.

---

## 2 · What a new organisation goes through

1. **Get an invite code** from the operator (sent by whatever channel you already use).
2. **Sign up** with the code: name, organisation, work email, password (12 characters or more, with the strength meter that exists).
   No email verification in the beta: there is no email service yet, and the invite code is the gate.
3. **Land on Overview** with the checklist: link a number (scan the QR), import contacts, tag them, message them. The "what next" buttons
   after linking and after an import already exist.
4. **Add the team** (Team tab, admins only). The admin enters name, email and role. The CRM generates a password and shows it **once**;
   the admin passes it on. The person should be forced to change it at first sign-in (to build).
5. **Run the beta** for free, with fair-use limits.
6. **Later, billing:** a Billing page with plan, seats and numbers used, invoices, and change or cancel. See section 5.

### Teammates: admin-created accounts (chosen)
| Action | Who | Effect |
|---|---|---|
| Add a person | Admin | Account and membership created, password shown once |
| Reset password | Admin | New password shown once; **all that person's sessions end** |
| Change role (admin / agent) | Admin | Takes effect at once; the last admin cannot be demoted or disabled |
| **Revoke access** (disable) | Admin | Sessions end at once; the person stays in audit logs, assignments and chat history |
| Re-enable | Admin | Same account, same history |
| Delete | **Nobody, for now** | Deliberately absent: it would orphan audit rows and conversation history |

All of this exists today (`apps/api/src/routes/admin.ts`, `packages/core/src/team.ts`, `apps/web/app/team/*`) except the forced password
change at first sign-in. Email invitations and self-service password reset are **not** built and need an email service
(`packages/providers/email` is empty). Passing a password through chat is the known weak point of this choice; it is acceptable for a
small invite-only beta and is the first thing to replace once email exists (single-use invite links, which also cover password reset).

---

## 3 · What other products do

- **Signup.** Slack, Figma and Notion ask for very little (email and password, or Google), verify the email (Slack sends a six-digit code),
  then create the workspace and prompt "invite your team". Guides recommend three to seven steps and collecting role and company size later.
- **Inviting people.** Four common paths: a single-use **email invite** (most control), a shared **invite link** (loosest; regenerating it
  voids the old one), **domain auto-join** (needs a verified domain), and an **approval queue** where a request waits for an admin. Products
  also let owners decide who may invite. Our beta uses a fifth, simpler path: the admin creates the account.
- **Billing.** A subscription priced per seat (and sometimes per usage), a free trial with or without a card, a self-serve portal for card,
  invoices and cancel, automatic retries for failed payments, and a grace period before access is limited. In Stripe, changing seats during a
  trial ends the trial and invoices at once.

Sources: [Slack onboarding teardown](https://userpilot.com/blog/slack-onboarding/), [SaaS onboarding best practices](https://designrevision.com/blog/saas-onboarding-best-practices.md),
[Slite invitations](https://slite.com/help/FRqYfR2lGTNnPh/Invitations), [Cursor auto-join](https://forum.cursor.com/t/understanding-cursor-enterprise-autojoin/155691),
[Atlassian site access](https://confluence.atlassian.com/display/Cloud/Specify+how+users+get+site+access), [Stripe customer management](https://stripe.com/en-hu/docs/customer-management).

---

## 4 · What comparable tools charge

| Product | Entry price | Notes |
|---|---|---|
| Freshsales | about $9 per user per month (annual); free for up to 3 users | Pro about $39 |
| Twenty (open source CRM) | about $9 per user; about $19 with single sign-on | Self-hosting is free |
| Pipedrive | about $14 per user (annual) | Mid tier about $49, top about $99 |
| Zoho CRM | about $14 per user; first 3 users free per one source | About $35 and $60 above |
| HubSpot Sales Hub | $15 to $20 Starter; about $90 Professional | Sources disagree on the Starter price |
| Chatwoot (support inbox) | Free for 2 agents; $19, $39 and $99 per agent | Self-hosting is free |
| Respond.io | about $79 to $99 per month for about 5 users | Also scales with monthly active contacts |
| Wati | about $39 to $49 per month for 5 agents | Per-message markup; user caps on cheap plans |
| Interakt | about $12 to $30 per month | Unlimited agents on every plan |
| Periskope (unofficial API) | about $20 per seat | Closest to this product (see doc 03) |

Sources: [CRM pricing benchmarks 2026](https://costbench.com/stats/crm-pricing-2026/), [small-business CRM compared](https://agiled.app/blog/small-business-crm),
[WhatsApp tools compared](https://entreresource.com/best-whatsapp-marketing-tools-in-2026-compared-by-price-ratings-features/), [Chatwoot pricing](https://www.eesel.ai/blog/chatwoot-pricing),
[Twenty pricing](https://toolradar.com/tools/twenty-crm/pricing). Doc [03](03-competitive-analysis.md) has the earlier research and the Meta India rates.

**Where this product sits.** It talks to WhatsApp through Baileys, an unofficial client, so there is **no per-message fee and no markup**
(the official API's fees are charged per message by Meta, and resellers add 12% to 25%). That is the pricing story. The matching honesty is
the ban risk: an unofficial number can be banned, which the product's anti-ban policy reduces and cannot remove, and customers must be told.

**A starting price list to react to** (placeholders in rupees, per organisation, not per message; Kushal sets the real numbers):

| Plan | Price per month | Includes |
|---|---|---|
| Beta | Free, invite-only | 1 number, 3 seats, fair-use sending |
| Starter | about ₹1,499 | 1 number, 3 seats |
| Team | about ₹3,999 | 3 numbers, 10 seats |
| Extras | about ₹399 per seat, about ₹999 per number | |

Quarterly and annual discounts later. If the official Cloud API arrives (D-34), Meta's fees pass through at cost. Why per organisation
plus numbers: a WhatsApp number is the scarce thing, a price a non-technical buyer understands is "this many numbers and people", and it
sits below Wati and Respond.io while above the per-seat CRMs that do not send WhatsApp at all.

---

## 5 · Billing, payments and limits (design, not built)

- **Org status.** Add a status to an organisation: trial, active, suspended. Today `org` has no such column and there are no billing tables.
- **Limits in one place.** Seats and numbers are checked by one function used by the API, the API keys and the gateway's send path (D-55),
  not scattered.
- **Operator override.** A per-organisation flag with a reason, audited (D-47), so a beta tester or a friendly customer is never blocked by
  billing. It is also how manual invoicing works (the operator marks an organisation paid).
- **Provider.** Chosen from doc 33. Working recommendation: **manual invoicing for the first few paying organisations**, then **Razorpay
  Subscriptions** (UPI AutoPay suits Indian customers and your bank situation), and a merchant-of-record only if customers abroad appear.
- **What the customer's admin sees.** Current plan, seats and numbers used against the limit, invoices, change plan, pause, cancel. Razorpay
  has no ready-made customer portal, so this screen is ours to build.
- **When payment fails.** Retries, a grace period, then **read-only**: the inbox stays readable and sending is blocked. Never delete data
  because of billing.
- **Provider events.** A webhook endpoint that checks the provider's signature, is safe to receive twice, and moves the organisation's status.

---

## 6 · Roadmap (all "not started, after the alpha test")

| Phase | What | Pins |
|---|---|---|
| 0 · Safe for strangers | Connect the alpha container as the non-superuser `crm_app` so row-level security is enforced, and make the API **refuse to start** in production on a superuser connection; rate-limit login per IP as well as per email and keep the counter across restarts; a reserved-slug list; the security test pass on the tenant boundary | D-48 |
| 1 · First-run wizard | A page shown only when no organisation exists; calls `createOrgWithAdmin()`; shows the password once | D-8 |
| 2 · Invite-only signup | A `signup_invite` table (code hash, created by, expiry, used by, note); the operator creates codes with `npm run admin -- invite`; `/signup` validates a code, creates the org and first admin, signs in; rate-limited | D-47 |
| 3 · Team polish | Force a password change at first sign-in; clearer revoke and restore wording; later, email invitations and password reset once an email service exists | D-33 |
| 4 · Status and limits | `org.status`, seat and number limits in one place, the operator override | D-55, D-47 |
| 5 · Billing | Plan and subscription tables, the provider webhook, a real Billing page, suspension rules | D-47, D-55 |
| Later | One encryption key per organisation, an email service, single sign-on, usage metering | D-31, D-56 |

### What exists today that this builds on
`createOrgWithAdmin()`, sessions (7 days, 12-hour idle), roles admin and agent, the Team screen, API keys, the audit log, the alpha container's
first-run setup, the front-end-only signup page, and a placeholder Billing page.

### Known gaps to close before any outsider is invited
Row-level security is not enforced in the alpha container (it connects as a superuser; the API only warns). The login lockout is kept in memory
and per email, not per IP. There is no reserved-slug list. Contact phone numbers and emails are stored unencrypted (D-32). The Baileys credential
store is not tenant-scoped. See doc [13](13-deployment.md) and doc [23](23-auth.md).
