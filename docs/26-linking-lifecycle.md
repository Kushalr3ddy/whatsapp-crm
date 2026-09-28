# 26 · Linking — how the gateway, the database and the phone stay in sync

What "linked" means, who is the authority on it, and how a status change travels between the
three things that each hold a piece of the truth. Written because "it says connected but nothing
arrives" (D-14) is the confusion this whole page exists to prevent.

---

## The three actors

| Actor | Holds | Authority over |
|---|---|---|
| **WhatsApp on the phone** | the account; the list of linked devices | whether a link exists at all — it can revoke ours at any time |
| **The gateway** (`apps/gateway`) | the live socket + in-memory crypto state, one per number | whether a socket is *currently* open |
| **The database** (`channel_session`, `channel_auth_state`) | the durable record: stored credentials + last-known state | what the rest of the app believes, across restarts |
| **The web UI** | nothing — it reads the database through the API | showing the person what the database says |

The phone is a **primary device** and ours is a **companion** (the same relationship as WhatsApp
Web). The account lives on the phone; we hold a linked-device session, and the phone can end it
unilaterally. **We are never the authority on whether a link exists — the phone is.**

---

## Where each piece of state lives

Two columns describe a number, and they mean different things — conflating them is the D-14 trap:

- **`channel_session.connection_state`** — the **socket**: `connecting` / `open` / `closed`.
  Written by the gateway as the socket opens and closes. This says whether bytes can flow, not
  whether the number is healthy.
- **`sender_identity.status`** — the **business** state: `linking` / `active` / `degraded` /
  `quarantined` / `retired`. Whether the app should route sends here at all. (Don't confuse this
  with `app_user.status`, which is a separate table using `active` / `disabled` for a person's
  login — see `05-data-model.md`.)

The credentials themselves are rows in **`channel_auth_state`**, encrypted (see `22-encryption.md`).
Their *presence* is what makes a number "linked" from our side: the gateway can only restore a
socket for a number that has stored credentials, and Baileys only issues a fresh QR for a number
that has **none**.

> **Rule, learned three times the hard way:** a column describing live state must be written in
> **both** directions. `status` going `active` and never coming back, `connection_state` going
> `open` and never closing — each was a real bug. On unlink and on disconnect, both are reset.

---

## The command channel (API → gateway)

The API cannot touch the socket — it lives in another process. So it leaves a **durable row** and
fires a Postgres **`NOTIFY 'gateway'`**; the gateway is `LISTEN`ing and acts at once
(`0006_link_handshake.sql`, `apps/gateway/src/main.ts`). If the gateway was down and missed the
notification, a **boot sweep** finds the leftover row — durable first, instant on top.

```
web UI ──HTTP──► API ──row + NOTIFY──► gateway ──socket──► WhatsApp
   ▲                │                     │
   └──── polls ─────┴─── writes state ────┘   (all state goes back through the database)
```

Every status the UI shows has travelled: **phone → gateway → database → API → UI.** The UI never
talks to the gateway directly, which is why a link status can only ever be as fresh as the last
row the gateway wrote (the inbox and link screen poll; realtime is D-17).

---

## Linking, step by step

1. **UI → API.** The person clicks *Link this number*; the API sets `link_requested_at` on
   `channel_session` (`POST /senders/:id/link`).
2. **Trigger → NOTIFY.** A trigger fires `NOTIFY 'gateway' {kind:'link', id}`.
3. **Gateway opens a socket.** It calls the Baileys adapter, which — finding **no** stored
   credentials — asks WhatsApp for a QR (or a pairing code) and writes the challenge back onto
   the row. The UI, polling `GET /senders/:id/link`, shows it.
4. **The phone scans.** WhatsApp issues credentials and **immediately closes the socket with
   `515 restart_required`.** This is the normal last step of pairing, not a failure — the gateway
   reconnects at once with the new credentials. (Nothing reconnecting is why early attempts stored
   credentials and left the number offline.)
5. **Connected.** The socket opens, the gateway writes `connection_state = 'open'`, and the
   credentials are saved to `channel_auth_state`. The UI shows *Connected*.

## Unlinking, step by step (the recovery path)

1. **UI → API.** *Unlink / reset* sets `unlink_requested_at` (`POST /senders/:id/unlink`).
2. **Trigger → NOTIFY** `{kind:'unlink'}`.
3. **Gateway logs out.** `provider.logout()` tells WhatsApp to drop the companion **and clears the
   stored credentials** from `channel_auth_state`.
4. **State reset.** `connection_state → 'closed'`, `status → 'linking'`, link fields cleared — the
   number is back to never-linked, so a fresh link can show a new QR.

Clearing the credentials is the whole point: without it, the next link attempt reloads the old
(possibly corrupt) credentials and Baileys never issues a QR.

## When the phone ends it

If someone removes the linked device in WhatsApp on the phone, the socket closes with
**`401 logged_out`**. That is terminal — the gateway does not reconnect, because the phone has
spoken and it is the authority. (It does not itself clear the stored credentials today; use
*Unlink / reset* to clear them before re-linking.)

---

## The D-14 trap, stated plainly

**"Connected" (socket open) is not "healthy" (receiving).** An outbound send establishes its own
Signal session, so a number whose *companion* session has diverged can still **send** — which
means `connection_state` is `'open'`, the UI says *Connected*, and yet every inbound frame fails
to decrypt (`Bad MAC`) and is dropped before the app ever sees it. Sending working tells you the
socket is up; it tells you nothing about whether inbound decrypts.

This is exactly why the *Unlink / reset* button is shown **even on a connected number** — the one
state where you most need to reset it is the one that looks fine. The fix is always the same:
unlink (clears the corrupt credentials), then link again for a fresh session. See **D-14** in
`21-deferred.md` for the full evidence.
