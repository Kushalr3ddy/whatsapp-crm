# 22 · Encryption, end to end

How data is encrypted before it reaches Postgres, how it comes back, and what happens when a
key has to change. Written to be read from zero — if a term is new, it is defined here.

The design intent lives in [09 · Security](09-security.md#encryption-at-rest). **This document
also records where the code does not yet match that intent**, because the gap is the useful
part: it says what still has to be built.

---

## What is encrypted, and what is not

Encryption at rest protects one specific scenario: **someone gets a copy of the database** — a
stolen backup, a leaked dump, a compromised disk — but does *not* have the application's keys.
Without the keys the ciphertext is noise.

It protects nothing against an attacker who has the running application, because the running
application must be able to read its own data.

| Column | Encrypted | Why |
|---|---|---|
| `message.body_enc` | ✅ | The conversation itself |
| `channel_auth_state.value_enc` | ✅ | The WhatsApp session credentials — the crown jewels, they *are* the number |
| `message.body_hmac` | hashed, not encrypted | A blind index (below) — for duplicate detection without decrypting |
| `contact_identity.value_normalized` | ❌ | Phone numbers and emails, in clear. It carries a UNIQUE index — and you cannot build one on ciphertext that changes every write (see below) |
| `app_user.password_hash` | ❌ (hashed) | A hash is not encryption — there is deliberately no way back |

That last distinction matters and is worth stating plainly:

- **Encryption** is two-way. Ciphertext + key → plaintext. Used where the data must be read back.
- **Hashing** is one-way. There is no key that reverses it. Used for passwords, where nobody —
  including us — should ever be able to recover the original.

---

## The envelope

"Envelope" is used in this codebase to mean **a byte layout**, not a strategy. It is the blob
that goes into the `bytea` column. Like a paper envelope: the letter is sealed inside, and the
outside carries what you need in order to open it.

```
 byte   0        1              2 .. 13        14 .. 29        30 ..
      ┌────────┬────────────┬──────────────┬──────────────┬────────────────┐
      │version │ keyVersion │      iv      │   authTag    │   ciphertext   │
      │  1 B   │    1 B     │     12 B     │     16 B     │   remainder    │
      └────────┴────────────┴──────────────┴──────────────┴────────────────┘
```

Defined at [`packages/providers/kms/local/src/index.ts`](../packages/providers/kms/local/src/index.ts).
Every field earns its place:

| Field | What it does | Why it is there |
|---|---|---|
| `version` | Format version of this layout | So the layout can change later without making old rows unreadable |
| `keyVersion` | **Which key** encrypted this row | The rotation hook. Without it, a key change would orphan every existing row |
| `iv` | Random nonce, fresh per encryption | Encrypting `"hello"` twice gives two different ciphertexts. Without it, identical messages would be visibly identical in the database |
| `authTag` | GCM's tamper detector | Flip one byte of ciphertext and decrypt **throws** rather than returning plausible garbage |
| `ciphertext` | The encrypted bytes | — |

The header costs 30 bytes per value. That is the price of every row being self-describing.

### Why AES-256-GCM

GCM *authenticates* as well as encrypts. The alternative considered was CBC, which encrypts but
does not detect tampering — a modified ciphertext decrypts to garbage that looks like data. With
GCM the `authTag` makes tampering a loud, explicit failure.

---

## The keys

All symmetric — the same key both encrypts and decrypts. There is no public/private key
cryptography anywhere in this project.

| Config | Type | Job | Rotatable |
|---|---|---|---|
| `ENCRYPTION_KEY` | 32-byte AES-256-GCM | Encrypts every `*_enc` column | Yes — that is what `keyVersion` is for |
| `ENCRYPTION_INDEX_KEY` | 32-byte HMAC-SHA256 | Deterministic blind index | **No** — see below |
| `API_KEY` | random string, ≥32 chars | Not a cryptographic key at all; a shared password compared with `timingSafeEqual` | Yes, trivially |

Both encryption keys are validated at boot and must be exactly 32 bytes of hex. They must also
**differ from each other** — the driver's constructor throws if they are equal, because reusing
one key for both encryption and deterministic indexing leaks which plaintexts are identical.

### The blind index, and why its key is frozen

A blind index solves: *find the row whose encrypted value equals X, without decrypting anything.*

Because `encrypt()` uses a random `iv`, the same plaintext produces different ciphertext every
time — so you cannot search by comparing ciphertext. The blind index is a **deterministic** HMAC
alongside it: same input always yields the same digest, so equality is searchable.

```
  body = "hi"  ──encrypt()───→  different bytes every call   → body_enc   (unsearchable, reversible)
               └─blindIndex()─→ always the same digest       → body_hmac  (searchable, irreversible)
```

That determinism is exactly why its key is **never rotated**: change the key and every digest
changes, invalidating every stored index at once. Re-indexing is a separate, much larger
operation than re-encrypting, and is documented as such rather than bundled into rotation.

The trade-off accepted here: a deterministic index leaks *equality*. An attacker with the
database learns which messages are identical, without learning what any of them say.

---

## The write path

What happens between an HTTP request and a row in Postgres.

```
  POST /api/v1/messages  { "body": "your interview is at 4pm" }
            │
            ▼
  ┌───────────────────────────────────────────────────────────┐
  │ 1.  plaintext in application memory                       │
  │                                                           │
  │ 2.  kms.encrypt(plaintext)                                │
  │       → random iv                                         │
  │       → AES-256-GCM under ENCRYPTION_KEY                  │
  │       → prepend version ‖ keyVersion ‖ iv ‖ authTag       │
  │                                                           │
  │ 3.  kms.blindIndex(plaintext)                             │
  │       → HMAC-SHA256 under ENCRYPTION_INDEX_KEY            │
  └───────────────────────────────────────────────────────────┘
            │
            ▼
  INSERT INTO message (body_enc, body_hmac, ...)
  VALUES (<envelope bytes>, <hex digest>, ...)
            │
            ▼
  ┌───────────────────────────────────────────────────────────┐
  │ Postgres never sees the plaintext.                        │
  │ Neither do the WAL, the backups, or a `SELECT *`.         │
  └───────────────────────────────────────────────────────────┘
```

Encryption happens in the **application**, not in the database. Postgres offers `pgcrypto`, but
using it would mean the plaintext and the key both travel to the database in the query — which
puts both in the query log and defeats the point.

Written at [`apps/api/src/routes/messages.ts`](../apps/api/src/routes/messages.ts) for outbound
and [`packages/core/src/messages.ts`](../packages/core/src/messages.ts) for inbound. Both
converge on the same two calls, so there is one place where this can be got wrong.

## The read path

```
  GET /api/v1/conversations/:id/messages
            │
            ▼
  SELECT body_enc FROM message WHERE ...
            │
            ▼
  ┌───────────────────────────────────────────────────────────┐
  │ 1.  read byte 0  → envelope version. Unknown? throw.      │
  │                                                           │
  │ 2.  read byte 1  → keyVersion. Says which key is needed.  │
  │       driver does not hold it? throw, explicitly naming   │
  │       the version, so it reads as "fetch the old key",    │
  │       not as "the data is corrupt"                        │
  │                                                           │
  │ 3.  split out iv and authTag                              │
  │                                                           │
  │ 4.  AES-256-GCM decrypt + verify authTag                  │
  │       tampered? throw. Never return partial plaintext.    │
  └───────────────────────────────────────────────────────────┘
            │
            ▼
  { "body": "your interview is at 4pm" }
```

Every failure mode is a thrown exception rather than a fallback. A decryption that "mostly
works" is worse than one that stops.

---

## Rotation: a keyring, not a swap

The common misreading is that a new key must somehow decrypt old data. It cannot, and it never
needs to. **The driver holds several keys at once**, and each row states which one it needs.

```
                    ┌──────────────────────────────────────┐
                    │  driver keyring                      │
                    │    v1 ── decrypt only (retiring)     │
                    │    v2 ── encrypt + decrypt (current) │
                    └──────────────────────────────────────┘
                                   │
     row with keyVersion=1  ───────┤──→  v1 key  ──→  plaintext
     row with keyVersion=2  ───────┘──→  v2 key  ──→  plaintext

     every new write       ─────────────→ v2 key
```

v1 never decrypts v2 data and v2 never decrypts v1 data. Nothing crosses over. The `keyVersion`
byte means the code never has to guess, and never tries keys in turn.

Rotation then runs in three phases:

| Phase | State | What is true |
|---|---|---|
| 1 | Add v2. Encrypt with v2, keep v1 for decrypt | New rows are v2; old rows still v1 and still readable. No downtime |
| 2 | Backfill job walks every v1 row: decrypt v1 → encrypt v2 | Online and resumable. `keyVersion` makes "what is left?" a simple query |
| 3 | No v1 rows remain → delete the v1 key | Back to a single key. The two-key window is over |

So the mixed state is **temporary and self-liquidating**. It is not a permanent complication —
it lasts exactly as long as the backfill.

### Hygiene rotation vs compromise rotation

These feel like one operation and are not. Confusing them is dangerous.

| | Scheduled hygiene | After a key leak |
|---|---|---|
| Urgency | Relaxed; backfill can take days | Immediate; you are racing whoever holds the dump |
| Keeping the old key | Fine — it is not compromised | Irrelevant. They already have a copy; deleting yours changes nothing |
| What it achieves | Limits the blast radius of a *future* leak | Protects **future writes only** |

The blunt part, stated so nobody expects otherwise: **if an attacker already has a database dump
and the key, re-encrypting recovers nothing.** They read what they took. Rotation stops ongoing
exposure; it cannot undo a theft that has already happened.

---

## DEK and KEK — the two-layer design

This is the *other* meaning of "envelope", and the source of the name collision. Here it means
**key wrapping**, not a byte layout.

**DEK** — Data Encryption Key. Encrypts the actual data.
**KEK** — Key Encryption Key, the master. Encrypts the DEK. Never touches your data directly.

```
  KEK  (master — lives in .env, or a real KMS)
   │
   │ wraps
   ▼
  DEK  per org (stored, encrypted, in the database)
   │
   │ encrypts
   ▼
  message.body_enc · channel_auth_state.value_enc · contact_identity.value_enc
```

To read a row: unwrap that org's DEK with the KEK, then decrypt the row with the DEK.

Storing the DEK encrypted in the database is safe precisely because it is useless alone — a
dump yields wrapped DEKs and ciphertext, and neither opens without the KEK.

### Why bother with two layers

| Benefit | Detail |
|---|---|
| **Cheap master rotation** | Rotating the KEK re-encrypts a handful of DEKs, not every message row. Seconds instead of a long backfill |
| **Crypto-shredding** | Delete one org's DEK and that org's data is instantly unreadable. Clean offboarding and erasure without hunting rows |
| **Smaller blast radius** | A leaked DEK exposes one org, not every tenant |

Honest caveats: it only makes **KEK** rotation cheap. If a *DEK* leaks, that org's data still
needs the slow re-encryption. It also adds machinery — a key table, wrap/unwrap on every
operation. And the KEK still cannot be lost.

### Not built yet

[09 · Security](09-security.md#encryption-at-rest) describes this design, including an
`org_encryption_key(org_id, key_version, wrapped_dek)` table. **That table does not exist**, and
`LocalKms` encrypts directly with one global key. There is no DEK and no per-org key today.

At one tenant this is not a vulnerability — it is a missing capability. What it costs right now:

- KEK rotation would mean re-encrypting every row rather than a few key rows
- No crypto-shredding, so tenant erasure means finding and deleting rows
- One key covers every org, so its blast radius is everything

The refactor is cheapest **before** there is real message history to re-encrypt.

---

## What survives losing a key

The practical question: a non-technical operator loses something. What can a developer fix?

| Asset | Lost | Leaked |
|---|---|---|
| Admin password | Trivial — reset it. No data loss | Rotate, invalidate sessions |
| `API_KEY` | Trivial — revoke and reissue. Hashed at rest, so a database leak yields no working key | Revoke, reissue |
| Database password | Easy — change it in Postgres and `.env` | Same |
| `ENCRYPTION_INDEX_KEY` | Recoverable **only while `ENCRYPTION_KEY` survives** — decrypt each value and re-hash it | Leaks which plaintexts are equal. Rebuilding the index is the fix |
| **`ENCRYPTION_KEY`** | **Unrecoverable. Every message body and every WhatsApp session becomes permanently unreadable** | Anyone with it plus a dump reads everything. Rotate and re-encrypt immediately |
| `.env` | Everything above, simultaneously | Everything above, simultaneously |

**A developer can reset every row in that table except one.** `ENCRYPTION_KEY` is the single
point of catastrophic failure.

Worth being precise about the damage, because it is not total: losing it does **not** lose the
WhatsApp numbers. Re-linking by QR restores the channel — sessions are replaceable. What is gone
permanently is **message history**. No support call fixes that.

Which is why `ENCRYPTION_KEY` must be backed up **separately from the database**. A backup
containing both is a backup of neither: whoever holds it holds the plaintext.

---

## Known gaps

Tracked here so they are not rediscovered.

| # | Gap | Consequence |
|---|---|---|
| 1 | `LocalKms` holds exactly **one** key version and throws on any other | Rotation is impossible in practice. The `keyVersion` byte exists but has nothing to point at. Fix: let the driver accept previous keys for decrypt-only |
| 2 | No per-org DEK; one global key encrypts directly | `09-security.md` describes a design the code does not implement |
| 3 | No backfill job | Even with gap 1 fixed, phase 2 of rotation has no implementation |
| 4 | `09-security.md` lists `contact_identity.value_enc` among the encrypted columns. **No such column exists** — identities live in clear in `value_normalized` | Contact phone numbers and emails are not encrypted at rest. Fixing it needs the encrypt-plus-blind-index pattern already used for message bodies, because the uniqueness constraint has to move to the digest |
