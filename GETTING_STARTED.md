# Getting started — clone to running

The shortest path from a fresh `git clone` to a working instance you can sign into and link a
number on. Written to be followed top to bottom with no prior knowledge of the project; if a term
is unfamiliar, [`20-orientation.md`](docs/20-orientation.md) explains the whole stack from zero.

> **Read this first.** This runs **Baileys**, an unofficial WhatsApp client. Pointing it at a real
> number can get that number **banned permanently, with no appeal** ([`08-antiban.md`](docs/08-antiban.md)).
> Use a number you can afford to lose. The anti-ban policy reduces the risk; it cannot remove it.

---

## 1 · What you need

- **Node 22 or newer** — check with `node -v`.
- **Docker** — used to run Postgres locally. Check with `docker ps`.
- **git**.

Nothing else. No global installs, no separate database to provision — Docker handles Postgres.

---

## 2 · Clone and install

```bash
git clone https://github.com/Kushalr3ddy/whatsapp-crm.git
cd whatsapp-crm
npm install
```

`npm install` pulls every package for the whole monorepo (API, gateway, web, shared libraries) in
one go.

---

## 3 · Create your `.env`

```bash
[ -f .env ] || cp .env.example .env
```

The `[ -f .env ] ||` guard matters: a plain `cp` over an existing `.env` would overwrite
`ENCRYPTION_KEY`, and **that key is the one secret with no recovery** — losing it makes every
stored message and every linked number permanently unreadable.

Now fill the **five required secrets** in `.env`. Generate four of them:

```bash
openssl rand -hex 32     # → APP_SECRET
openssl rand -hex 32     # → ENCRYPTION_KEY
openssl rand -hex 32     # → ENCRYPTION_INDEX_KEY   (must DIFFER from ENCRYPTION_KEY)
openssl rand -hex 32     # → API_KEY
```

The fifth is the database URL for the bundled container (copy it as-is):

```
DATABASE_URL=postgresql://dev:dev@localhost:5434/whatsapp_crm_dev
```

`PUBLIC_URL=http://localhost:3000` is fine for local use. Everything else in `.env` has a working
default.

> **Back up `ENCRYPTION_KEY` and `ENCRYPTION_INDEX_KEY` now**, in a password manager, somewhere
> that is **not** the repo and **not** a database backup. A backup holding both the encrypted data
> and its key is a backup of plaintext. See [`22-encryption.md`](docs/22-encryption.md).

---

## 4 · Set up the database

```bash
npm run db:setup
```

This starts the Postgres container (in a **named Docker volume**, so your data survives restarts
and even deleting the container) and applies all migrations to **both** databases — the real one
(`whatsapp_crm_dev`) and the test one (`whatsapp_crm_test`). Use this rather than migrating by
hand: migrating only one database leaves the test suite failing with `relation "org" does not exist`.

---

## 5 · Create your organisation and admin

Nothing works until an organisation exists — the app is multi-tenant, so every piece of data
belongs to an org.

```bash
npm run admin -- org --name "Your Company" --slug your-company --email you@example.com
```

This prints an **org id** and a **generated password** — save both; the password is how you sign
in. (There is no self-service password reset yet; an admin resets one with
`npm run admin -- password --email you@example.com`.)

---

## 6 · Run it

```bash
npm run dev:all
```

One terminal, everything: it starts the database, applies migrations, then runs all three
processes and streams their logs prefixed by which one spoke. **Ctrl-C stops everything it
started; Postgres is left running on purpose** (it holds your linked WhatsApp credentials).

| | | |
|---|---|---|
| api | `:3000` | the HTTP API |
| gateway | — | owns the WhatsApp sockets — **nothing sends or receives without it** |
| web | `:3001` | the inbox / UI |

Flags: `--no-web` (skip the UI, faster) and `--no-gateway` (no WhatsApp connection — right for
working on the API alone).

Prefer separate terminals? `npm run dev`, `npm run gateway`, `npm run web`. They are separate
processes on purpose, so restarting the API never drops a live WhatsApp socket.

### What `dev:all` does and does not do

It **runs** the stack; it does **not** do the one-time setup above. On a fresh clone you still need
steps 2–5 first (`npm install`, `.env`, `npm run db:setup`, provisioning). Concretely, `dev:all`:

- ✅ starts the Postgres container and applies migrations to the **dev** database
- ✅ starts the API, gateway and web, and waits for each to answer before reporting it ready
- ❌ does **not** run `npm install`, create or fill `.env`, provision the org/admin, or migrate the
  **test** database (only `db:setup` does both databases)

---

## 7 · Sign in and link a number

1. Open **http://localhost:3001/login** and sign in with the email and generated password from step 5.
2. Go to **Numbers** (`/link`), click **Link this number**, and scan the QR from your phone:
   **WhatsApp → Settings → Linked Devices → Link a device**. The QR expires in under a minute —
   click again for a fresh one. Once connected, the card shows the number as healthy.
3. Open the **Inbox**, pick a conversation, and send. Or over HTTP — see
   [`24-local-testing.md`](docs/24-local-testing.md) for getting an API key and exercising every endpoint.

---

## 8 · Check it works

```bash
curl -s localhost:3000/health     # {"status":"ok"} — the API is up
curl -s localhost:3000/ready      # also checks the database
npm run check                     # typecheck (server + web) + lint + the full test suite
```

`npm run check` needs the databases from step 4. The tests use the **separate** `whatsapp_crm_test`
database and truncate it freely, so they can never touch your real data.

---

## 9 · Stopping and starting again

```bash
npm run db:dev:down     # stop Postgres (data kept in the volume)
npm run db:dev:up       # start it again — same data
```

Ctrl-C on `dev:all` stops the three processes but leaves Postgres up. To stop that too, use
`db:dev:down`. **Never** run `npm run db:dev:reset` unless you truly want to delete everything,
including linked numbers — it asks for confirmation because it is irreversible.

---

## When something is stuck

| Symptom | Cause |
|---|---|
| `port 3000 is already in use` | A previous run is still up. Find it: `ss -ltnp \| grep 3000` |
| A message stays `queued` forever | The gateway is not running, or no number is linked |
| Migrations land in the wrong place | There may be a **second Postgres on 5432**; this project uses **5434** |
| Everything returns empty for a real org | Read the `rls:` line `dev:all` prints — a wrong database role shows up as silence, not an error ([`09-security.md`](docs/09-security.md)) |
| `npm run web:build` fails while the UI runs | Both write `apps/web/.next`; stop the dev server first |
| Sends work but nothing ever arrives | Check the gateway log for `Bad MAC`; unlink and re-link the number ([`26-linking-lifecycle.md`](docs/26-linking-lifecycle.md)) |

One more: **`SEND_TIMEZONE` is set explicitly, not read from the server region.** It sets the day the home page greeting uses.

---

**Next:** [`20-orientation.md`](docs/20-orientation.md) explains the stack and every code prefix;
[`24-local-testing.md`](docs/24-local-testing.md) is the by-hand API walkthrough; [`README.md`](README.md)
is the top-level overview.
