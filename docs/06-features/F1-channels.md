# F1 · Channels & sessions

**Covers** FR-10…FR-18 · **Fixes** M1, M26, M29, M30 · **Tier** V1

## Purpose

Own the connection to every messaging transport, behind one port, so the rest of the system
never knows which one it is talking to. Two adapters in v1 (Baileys, Meta Cloud API) plus a
`fake` adapter that makes everything downstream testable without a real phone.

## User stories

- As an operator I link a WhatsApp number by scanning a QR **or** by entering a pairing code
  on my phone, so I can link a number I am not physically holding.
- As an operator I see each number's live connection state.
- As an operator my numbers reconnect themselves after a restart, with no manual step.
- As an admin I reassign a number from one user to another when someone leaves.
- As a developer I add a new transport by writing one class that passes the contract suite.

## Design notes

**Sender identity vs session.** A `sender_identity` is the number and its accumulated
reputation; a `channel_session` is one connection to it. The old system conflated them, which
is why caps counted the wrong thing (M11) and why re-linking a number silently broke sends.

**Auth state in Postgres.** Baileys' `useMultiFileAuthState` is explicitly marked *"DO NOT USE
IN PROD"*, and disk state is lost on any ephemeral filesystem (M30). One row per key in
`channel_auth_state`, encrypted, means restart-safe sessions and a DB restore that brings the
numbers back (M29).

**Capability declaration, not discovery.** Each adapter declares what it can do; the dispatcher
refuses illegal sends up front rather than finding out at the wire. The 24-hour window and
template pre-approval are real product-level differences and are not hidden.

**One bad recipient never kills a session (M26).** Resolving a recipient is the adapter's job
and may fail per recipient; the socket is supervised independently of the traffic on it.

## Acceptance criteria

- **AC-1** A number links by QR and by pairing code; both paths produce the same
  `sender_identity` + `channel_auth_state` rows.
- **AC-2** Restarting the gateway restores every `active` sender with no human action, and the
  restore is visible in logs and metrics.
- **AC-3** Disconnects are classified into typed reasons (401, 403, 408, 429, 463, 515, …),
  each with its own backoff and risk weight.
- **AC-4** A number down for more than 5 minutes raises a Critical alert linked to a runbook.
- **AC-5** Sending to a privacy-mode (`@lid`) contact resolves via `contact_identity` and, if it
  fails, fails **that recipient only** — the session stays up and other sends continue.
- **AC-6** `ChannelProvider.capabilities` is declared statically and the dispatcher rejects a
  freeform send outside the Meta window **before** calling the provider.
- **AC-7** Every adapter — including `fake` — passes the identical contract suite.
- **AC-8** No module outside `packages/channels/*` imports a transport SDK; the lint rule fails
  the build if one does.
- **AC-9** An admin can reassign ownership of a number; the change is audited.

## API surface

```
GET    /api/v1/senders                     list with health and risk
POST   /api/v1/senders                     create (provider, label)
GET    /api/v1/senders/{id}
PATCH  /api/v1/senders/{id}                label, owner, cap override
DELETE /api/v1/senders/{id}                retire (never hard-delete: history references it)
POST   /api/v1/senders/{id}/link           start linking → {mode: qr|pairing, payload}
POST   /api/v1/senders/{id}/reconnect
POST   /api/v1/senders/{id}/logout
GET    /api/v1/senders/{id}/health-events   what has happened to the number (refused, logged out, device removed)
```

## Test cases

| id | Case | Expect |
|---|---|---|
| TC-1.1 | Link via QR, fake adapter | Session `active`, auth state rows written |
| TC-1.2 | Link via pairing code | Same end state as TC-1.1 |
| TC-1.3 | Kill gateway mid-conversation, restart | Session restores, no message lost, no duplicate |
| TC-1.4 | Provider returns 401 | Sender → `retired`, Critical alert, no reconnect loop |
| TC-1.5 | Provider returns 429 | Backoff applied |
| TC-1.6 | Send to unresolvable `@lid` recipient | That recipient fails; session stays `active`; other sends unaffected |
| TC-1.7 | Freeform send outside Meta's 24h window | Rejected by the dispatcher; provider never called |
| TC-1.8 | Contract suite across `baileys`, `meta`, `fake` | Identical behaviour for every shared assertion |
| TC-1.9 | Two gateway replicas, one sender | Only one holds the socket; the other defers (no double connection) |
| TC-1.10 | Import a transport SDK from `core` | Lint fails |

## Open questions

- Pin which Baileys version? **Decided: `6.7.24`, pinned exactly** — 7.x is still a release
  candidate (`7.0.0-rc14`) with breaking changes. See `10-stack.md` and D-5.
- Proxy binding per sender (each number egressing from its own IP) — V2, but does it change
  the `sender_identity` schema? Probably `proxy_ref` now, unused.
- Meta: direct Cloud API vs a BSP. Direct is cheaper and has no markup; a BSP simplifies
  onboarding and verification. → blocked on who owns the WABA.
