# 46 · Learning path: understanding this codebase, step by step

Written for Kushal (2026-10-25), who is learning web development while owning this project. Plain words, one idea at a time. Do the stages in order; each one
says **what to read, what to look at running, and a small exercise** that proves you understood it. Allow about 1 to 2 hours per stage, spread over a few weeks.
Tick a stage only when you can do its "check yourself" without looking.

If a word is unfamiliar, [`20-orientation.md`](20-orientation.md) explains the stack and the numbering schemes (F, P, D, R, RB) in plain language.

## The big picture in five sentences
1. A **web page** (`apps/web`, Next.js and React) is what people click.
2. The page talks to an **API** (`apps/api`, Express) over HTTP; the API reads and writes the **database** (Postgres, `packages/db`).
3. A separate program, the **gateway** (`apps/gateway`), holds the real WhatsApp connections (the Baileys library, `packages/channels/baileys`). It sends queued messages and stores what comes in.
4. The rules live in **`packages/core`**: pacing, anti-ban, campaigns, AI replies, importing. Everything else is wiring around it.
5. **Tests** (`tests/`) prove the rules, and **GitHub Actions** (`.github/workflows`) run them on every pull request.

```
person's browser ──► web (Next.js) ──► API (Express) ──► Postgres
                                          ▲                 ▲
                      WhatsApp ◄──► gateway (Baileys) ──────┘     rules shared from packages/core
```

---

## Stage 0 · Get oriented (1 hour)
**Read:** [`20-orientation.md`](20-orientation.md), then [`31-codebase-map.md`](31-codebase-map.md) (what every folder and important file is for) and
[`04-architecture.md`](04-architecture.md) (why it is built this way).
**Look at:** the folder tree: `apps/` (things that run), `packages/` (shared code), `tests/`, `docs/`, `infra/` (Docker and deploy).
**Check yourself:** say in one sentence what each of `apps/web`, `apps/api`, `apps/gateway`, `packages/core`, `packages/db` is for.

## Stage 1 · The database is the heart (2 hours)
Everything the app knows is in Postgres. Learn this first and the rest makes sense.
**Read:** [`05-data-model.md`](05-data-model.md) (what each table means; the new section at the end covers recent changes) and open
[`generated/schema.html`](generated/schema.html) in a browser: a diagram of every table and how they point at each other.
**Look at:** `packages/db/src/schema.ts` (the table definitions in code) and `packages/db/migrations/` (39 numbered SQL files = the history of the database).
**Learn these ideas:** a *table* and a *row*; a *foreign key* (`contact_id` points at a contact); *org_id on everything* (one organisation never sees another: row-level security, `docs/35` §2).
**Exercise:** pick the `message` table. Write down which tables it points at and what each column means. Then find the migration that added `retry_requests` (0038).
**Check yourself:** why does `contact_identity` exist separately from `contact`? (A person can have several phone numbers, an email, a WhatsApp privacy address.)

## Stage 2 · Follow one message in (inbound) (2 hours)
Best way to learn a system: follow one piece of data from one end to the other.
**Trace:** a customer replies on WhatsApp.
1. `packages/channels/baileys/src/index.ts`: `#emitInbound` turns WhatsApp's raw message into our own shape.
2. `apps/gateway/src/main.ts`: receives it and calls `storeInboundMessage`.
3. `packages/core/src/messages.ts`: `storeInboundMessage` finds or creates the contact and conversation and saves the (encrypted) message.
4. `apps/api/src/routes/messages.ts`: the endpoints the web page calls to list conversations and messages.
5. `apps/web/app/inbox/`: the pages that show it (`[id]/page.tsx` is one chat).
**Exercise:** with the app running, send yourself a message and find the new row in the `message` table (any Postgres viewer, or `docker exec` into the dev database).
**Check yourself:** where is the message body encrypted, and why can you not read `body_enc` in the database? (`packages/providers/kms/local`, docs/22.)

## Stage 3 · Follow one message out (outbound and campaigns) (3 hours)
**Read:** [`06-features/F5-campaigns.md`](06-features/F5-campaigns.md) and [`08-antiban.md`](08-antiban.md) (why sending is slow on purpose).
**Trace:** pressing *Start* on a campaign.
1. `apps/web/app/broadcast/`: the campaign pages and form.
2. `apps/api/src/routes/campaigns.ts`: `POST /campaigns`, `/start`, `/pause`.
3. `packages/core/src/campaigns.ts`: freezes the audience into `campaign_recipient` rows (this table *is* the queue).
4. `packages/core/src/pacing.ts` and `policy-gates.ts`: decide, per message, whether it may go now.
5. `apps/gateway/src/main.ts` sweep loop: turns allowed recipients into messages and sends them through the channel.
**Exercise:** run a campaign against the fake channel (`GATEWAY_CHANNEL=fake`) and watch rows move `pending → queued → sent` in `campaign_recipient`.
**Check yourself:** name three reasons a person is *skipped* (do-not-contact, recently messaged, no phone number) and where each rule lives.

## Stage 4 · The web app (3 hours)
**Learn first (outside this repo, 2 to 3 hours total):** what HTML, CSS and JavaScript are; what React components and props are; what a "server component" and a "server action" are in Next.js (the official Next.js tutorial, chapters 1 to 4).
**Look at:** `apps/web/app/layout.tsx` (the frame around every page), `apps/web/app/contacts/page.tsx` (a typical list page), `apps/web/app/actions.ts` (what happens when a form is submitted), `apps/web/lib/crm.ts` (how the web server calls the API).
**Learn these ideas:** the page runs on the *server* and asks the API for data; a form posts to a *server action*; the inbox refreshes by re-running the page on a timer (`inbox/auto-refresh.tsx`). This is also why D-46 (the app feels laggy) and D-61 (a lighter web tier) exist: read them next.
**Exercise:** change a label on one page (for example the heading on Contacts), reload, see it. Revert it.

## Stage 5 · The API (2 hours)
**Read:** [`15-api.md`](15-api.md), then [`generated/api-reference.md`](generated/api-reference.md) (every endpoint, who may call it).
**Look at:** `apps/api/src/app.ts` (the middleware chain: sign-in, rate limit, CSRF, which router is mounted where) and one short router such as `apps/api/src/routes/tags.ts`.
**Learn these ideas:** an *endpoint* (method + path); *authentication* (who are you: cookie session or API key) versus *authorization* (what may you do: `requireScope`, `requireRole('admin')`); *validation* (zod schemas reject bad input).
**Exercise:** call `GET /api/v1/auth/me` with curl or Insomnia using the steps in the last section of `15-api.md`.

## Stage 6 · The WhatsApp side and why it is fragile (3 hours)
**Read:** [`26-linking-lifecycle.md`](26-linking-lifecycle.md), [`27-restriction-tracking.md`](27-restriction-tracking.md), and the story of the biggest bug so far: [`45-rca-waiting-for-this-message-2026-10-23.md`](45-rca-waiting-for-this-message-2026-10-23.md) (it now has a code-level section).
**Look at:** `packages/channels/baileys/src/index.ts` (the connection), `auth-adapter.ts` (the credential store), `decrypt-tap.ts` (how we notice problems), and `packages/core/src/health.ts` and `restriction.ts` (the ban-risk scoring).
**Learn these ideas:** a WhatsApp number is a *linked device* with an encryption session; a broken session is the worst failure; the gateway must not be restarted casually while a real number is linked.
**Check yourself:** explain in your own words why a phone-number address and a LID address broke message reading, and what Baileys 7 changed.

## Stage 7 · The AI assistant (2 hours)
**Read:** [`06-features/F12-ai-agent.md`](06-features/F12-ai-agent.md) and the AI chapter of `CRM-user-tutorial.pdf`.
**Look at:** `packages/core/src/ai-reply.ts` (answers a chat), `ai-commands.ts` (the "tell it what to do" box), `ai-opening.ts` (writes each campaign opening), `ai-templates.ts`, and `packages/providers/llm` (the part that talks to the AI company).
**Learn these ideas:** the model's text is *untrusted* (it can be wrong or tricked); locked rules are always added in front; every action is checked against the same anti-ban gates a person's action is.

## Stage 8 · Tests and how changes get safely in (2 hours)
**Read:** [`12-testing.md`](12-testing.md), [`39-bug-workflow.md`](39-bug-workflow.md), [`40-testing-and-bug-guide.md`](40-testing-and-bug-guide.md).
**Look at:** `tests/integration/` (real Postgres, no mocks), `tests/e2e/` (a real browser clicks through the app), `tests/regression/REGISTRY.md` (every bug we promised never to repeat: R-001 and on), `.github/workflows/ci.yml` (what must pass before a merge).
**Exercise:** read one regression test, for example the R-013 file, and explain what it proves.
**Learn the workflow:** branch, commit, pull request, CI turns green, you merge. Never push to `main` directly.

## Stage 9 · The map of what is not built (1 hour)
**Read:** [`21-deferred.md`](21-deferred.md): the clickable pin list at the top. Every idea, decision and bug we chose not to do yet is a numbered D-pin. Read D-46, D-61, D-95, D-101, D-88 first; they explain the speed, memory and reliability story.

---

## A habit that makes all of this faster
When you want to understand any piece of code, ask in this order:
1. *Where does the data come from?* (which table, which API call)
2. *Who is allowed to see or change it?* (org, role, scope)
3. *What can go wrong?* (the test files beside it list the edge cases)

## Words you will meet (short list; the full one is in `20-orientation.md`)
| Word | Meaning here |
|---|---|
| **Monorepo** | One repository holding several projects (`apps/*`, `packages/*`) |
| **Migration** | A numbered SQL file that changes the database shape; run in order |
| **RLS** | Row-level security: Postgres itself hides other organisations' rows |
| **Gateway** | The program that owns the WhatsApp connections |
| **Baileys** | The library that speaks WhatsApp's protocol |
| **LID** | WhatsApp's privacy address for a person (alternative to their phone number) |
| **Server action** | A function in Next.js that runs on the server when a form is submitted |
| **Scope / role** | What an API key or a person is allowed to do |
| **Pin (D-n)** | An idea or decision recorded in `21-deferred.md` |
