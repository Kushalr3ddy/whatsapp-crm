# 23 · Authentication, end to end

Who can reach what, and how a request proves who it is. Written to be read from zero.

The intent lives in [09 · Security](09-security.md#authentication--authorisation) and
[18 · Providers](18-providers.md). **This document also records what is not built**, because
the gap is the useful part.

---

## Three credentials, and why they are different

| Credential | Who holds it | Reaches |
|---|---|---|
| **Session cookie** | a signed-in person | whatever their **role** allows, in their org |
| **Per-org API key** (`crm_live_…`) | an integration | whatever its **scopes** allow, in its org |
| **`API_KEY` from `.env`** | the deployment itself | **provisioning only** — refused on every data route |

That third one earns its restriction. A single shared secret with full read and write over
every organisation is exactly the hole per-org keys exist to close, so it can do two things:
create an organisation, and mint that organisation's first key. It solves the chicken-and-egg
problem of a brand-new deployment that has no org and therefore no key, and nothing else.

**The org is never guessed.** An earlier version ran `SELECT id FROM org LIMIT 2` and refused
with `409 MULTIPLE_ORGS` the moment a second organisation existed, because a config-level key
could not say which tenant it meant. Every credential now names its own org.

---

## Signing in

```
  browser                 web app (:3001)              API (:3000)            Postgres
     │                          │                          │                     │
     │  POST /login             │                          │                     │
     │  email + password        │                          │                     │
     ├─────────────────────────►│                          │                     │
     │                          │  POST /api/v1/auth/login │                     │
     │                          ├─────────────────────────►│                     │
     │                          │                          │  find user by email │
     │                          │                          ├────────────────────►│
     │                          │                          │◄────────────────────┤
     │                          │                          │                     │
     │                          │                argon2id verify                 │
     │                          │                          │                     │
     │                          │                          │  INSERT session     │
     │                          │                          │  (hash of token)    │
     │                          │                          ├────────────────────►│
     │                          │  Set-Cookie: crm_session │                     │
     │                          │  Set-Cookie: crm_csrf    │                     │
     │                          │◄─────────────────────────┤                     │
     │  Set-Cookie (both)       │                          │                     │
     │◄─────────────────────────┤                          │                     │
     │  302 → /inbox            │                          │                     │
```

The web app relays the cookies rather than reusing the API's flags verbatim: it is writing to
its **own** origin, so it sets them deliberately.

### The two cookies, and why only one is hidden

| Cookie | `HttpOnly` | Why |
|---|---|---|
| `crm_session` | **yes** | The session token itself. No script should ever be able to read it — that is what makes an XSS bug fall short of a stolen session |
| `crm_csrf` | **no** | It exists to be read by script and echoed back in a header. Hiding it would break the only thing it does |

That asymmetry looks wrong at a glance and is deliberate. Explained under CSRF below.

---

## Every request afterwards — session forwarding

The web app holds **no credential of its own.** It forwards the signed-in person's session to
the API on every call.

```
  browser ──cookie──► web app ──Cookie: crm_session──► API
                          │                            │
                          │                     resolves the session,
                          │                     joins org_membership,
                          │                     authorises by ROLE
                          │                            │
                          └──────── rendered page ◄────┘
```

Why this and not a shared application key: with one org-wide key, **every signed-in user would
have full access regardless of role.** Login would gate the front door and nothing behind it,
and `conversation.assignee_user_id`, `admin` and `agent` would all be decorative. Forwarding
the session means the API authorises the *person* — so the same check applies whether the
request came from a browser or from curl.

It also answers a question that comes up: **a second person on a second machine needs nothing
but their password.** Nothing is installed and no key is distributed; they open the URL and
sign in. Any server-side configuration lives on the server, once.

### Resolution checks more than the token

```sql
session.token_hash matches
  AND session.revoked_at IS NULL
  AND session.expires_at > now()          -- absolute expiry
  AND session.last_seen_at > now() - 12h  -- idle timeout
  AND app_user.status = 'active'
  AND org_membership row still exists     -- ← the important one
```

That last line means **removing someone's membership ends their access immediately**, rather
than whenever their session happens to lapse. A check against the session row alone would
leave a dismissed colleague signed in for up to a week.

---

## CSRF, and why only cookies need it

A browser attaches cookies to cross-site requests **automatically**. That is the entire attack:
a page on another origin submits a form to your API, the browser helpfully includes the session
cookie, and the request succeeds.

An `Authorization` header is never sent automatically. So API-key requests need no CSRF
protection at all, and are passed straight through.

The defence is **double-submit**:

```
  cookie   crm_csrf = abc123        ← readable by script, same origin only
  header   x-csrf-token: abc123     ← set by our code, from that cookie

  API compares the two. Equal → proceed.
```

An attacker on another origin can *cause* the request but cannot *read* the cookie to populate
the header, because the same-origin policy stops them. Which is precisely why this cookie must
**not** be `HttpOnly` — it has to be readable by the code that echoes it.

Applied to cookie-authenticated **writes** only. Reads are exempt: a GET should not change
anything, and requiring it everywhere would break plain navigation.

---

## What guards what

```
  /login               ── public. It is how a credential is obtained
  attachPrincipal      ── works out who is calling. NEVER rejects
  requireCsrf          ── cookie writes only; header auth passes through
  requireAuthenticated ── the door closes here
  /admin               ── provisioning: before a tenant exists to belong to
  requireTenant        ── refuses the bootstrap key everywhere below
  /senders /messages   ── + requireScope per route
```

The split between `attachPrincipal` and `requireAuthenticated` exists because signing in cannot
itself require being signed in. Collapsing them made `/auth/login` unreachable, which is a bug
the tests caught.

### The middleware is a convenience, not a boundary

`apps/web/middleware.ts` redirects anyone without a session cookie to `/login`. It checks only
that a cookie is **present**, never that it is valid.

That is deliberate and worth being clear about: **a forged cookie gets past the middleware and
is then rejected by the API**, which owns the session table. The middleware exists so people do
not land on a broken page. The real check happens once, where the data is.

---

## What is stored

| Secret | Stored as | Why |
|---|---|---|
| Password | **argon2id**, OWASP 2024 parameters | Memory-hard, so GPU cracking is expensive. Not bcrypt (M16), which silently truncates at 72 bytes |
| Session token | **SHA-256** | A *fast* hash is correct: the input is 32 random bytes, so there is nothing to brute-force, and argon2 on every request would be a self-inflicted bottleneck |
| API key | **SHA-256** | Same reasoning. The `prefix` is kept in clear purely so a person can tell two keys apart in a list |

No credential is recoverable from the database. A leaked dump yields no working password, no
working session and no working key.

Argon2 parameters travel inside the PHC string (`$argon2id$v=19$m=19456,t=2,p=1$…`), so they
can be raised later without invalidating anything already stored — `needsRehash` reports which
hashes to upgrade on the owner's next successful sign-in.

---

## Two details that are easy to get wrong

**Login answers a missing account exactly as it answers a wrong password** — same status, same
code, same body, and the same amount of *time*, because it verifies against a dummy hash when
no user is found. Skipping the hash for an unknown email would make the response measurably
faster and turn the login form into an account-enumeration oracle.

**Changing a password ends every session that person holds.** A reset that left existing
sessions alive would not actually remove whoever the reset was for — which is usually the whole
reason it is being done.

---

## Provisioning, and an ordering that row-level security forces

`createOrgWithAdmin()` is the single seam through which an organisation comes into existence.
The admin CLI calls it; a future setup wizard (D-8) and a future `/signup` would too. One code
path, so there are no rows that nothing can reproduce.

The ordering inside it is not a style choice:

```
  1. generate the org id                ← in application code
  2. set_config('app.org_id', <id>)     ← BEFORE the insert
  3. INSERT INTO org (id, …)
  4. INSERT INTO app_user               ← not tenant-scoped; see below
  5. INSERT INTO org_membership
```

The `org` policy has **no `WITH CHECK`**, so Postgres reuses its `USING` clause for inserts and
accepts only a row whose `id` matches `app.org_id`. Done the other way round this fails under a
correctly configured role while **appearing to work as the table owner** — the exact trap
`inspectDatabaseSecurity()` warns about at boot.

### Three tables deliberately have no row-level security

`app_user`, `session` and `api_key`. All for the same reason: they are read *before* any tenant
context exists. Resolving a credential is what **establishes** which org a request acts in, so
a policy reading `current_setting('app.org_id')` could never match.

Enumeration is not a risk — each is looked up by the hash of a high-entropy secret — and every
query that follows still filters by the org those lookups return.

---

## Not built

| Gap | Consequence |
|---|---|
| **Self-service password reset** | Administrator-initiated only: `npm run admin -- password`. Needs the email driver, which is an empty directory |
| **`audit_log`** | "Who did this?" is not yet answerable. The columns exist on several tables; nothing writes a trail |
| **TOTP / MFA** | V2 in `09-security.md`. Note the secret would live in `app_user.mfa_secret_enc` — another thing `ENCRYPTION_KEY` controls |
| **OIDC driver** | Needs an IdP configured per deployment. The port exists so this is a driver swap, not a rewrite; authorisation stays local either way |
| **Rate limiting** | Only **login** is throttled, and in-process — several replicas would each count separately. `api_key.rate_limit_per_min` is stored and enforced nowhere (P9) |
| **Per-user permissions below role** | `admin` and `agent` only. `conversation.assignee_user_id` is populated by nothing yet |
