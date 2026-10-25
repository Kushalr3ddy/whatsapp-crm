---
title: Endpoint reference
description: Every endpoint of the API, who may call it, and what it does. Generated from the code.
---

Generated from the route files on 2026-10-25 by `npm run api:docs`. **Do not edit by hand**; change the route or its comment and regenerate.
For how to sign in, errors, rate limits and examples see [the API overview](../overview/).

**104 endpoints.** "Who" is `scope: x` (a signed-in person or an API key holding scope x), `role: admin` (admins only), or `signed in` (any signed-in person); every route except `/health`, `/ready` and `/api/v1/auth/*` needs one of them, and every write from a browser session also needs the CSRF header.
Paths with `:id` take a UUID. A route's request body and response are described by the code beside it (zod schemas) and, for the main ones, in the API overview.

| Group | Endpoints |
|---|---|
| [admin](#admin) | 8 |
| [ai](#ai) | 23 |
| [app](#app) | 2 |
| [auth](#auth) | 3 |
| [campaigns](#campaigns) | 11 |
| [contacts](#contacts) | 8 |
| [custom-fields](#custom-fields) | 3 |
| [encryption](#encryption) | 5 |
| [imports](#imports) | 4 |
| [media](#media) | 2 |
| [messages](#messages) | 19 |
| [segments](#segments) | 4 |
| [senders](#senders) | 8 |
| [tags](#tags) | 4 |

## admin

| Method | Path | Who | What it does |
|---|---|---|---|
| GET | `/api/v1/admin/keys` | role: admin | Lists this org's keys. |
| POST | `/api/v1/admin/keys` | signed in | Mints a key, showing the secret exactly once. |
| DELETE | `/api/v1/admin/keys/:id` | role: admin | Revokes a key. |
| POST | `/api/v1/admin/orgs` | signed in | Creates an org and its first admin. |
| GET | `/api/v1/admin/users` | role: admin | Everyone in this org, for the Team page. |
| POST | `/api/v1/admin/users` | role: admin | Adds someone to this org. |
| PATCH | `/api/v1/admin/users/:id` | role: admin | Changes a member's role, or disables or re-enables them. |
| POST | `/api/v1/admin/users/:id/password` | role: admin | Sets a new password for a member and ends their sessions. |

## ai

| Method | Path | Who | What it does |
|---|---|---|---|
| GET | `/api/v1/ai/always-on-rules` | role: admin | The fixed always-on rules, so the page can show exactly what is added in front of every set of instructions. |
| POST | `/api/v1/ai/commands` | scope: messages:send | Tells the assistant, in plain language, to run campaigns: create one, pause, resume or edit. |
| POST | `/api/v1/ai/conversations/:id/allow-reply` | role: admin | An admin lets the assistant answer the contact's latest message even though they are flagged do-not-contact. |
| POST | `/api/v1/ai/conversations/:id/answer-now` | scope: conversations:write | After a person hands a chat to the assistant: have it answer the contact's latest message now, if that message is still waiting for an answer. |
| GET | `/api/v1/ai/conversations/:id/notice` | scope: conversations:read | Why the assistant is stuck on a conversation (anti-ban spacing, a do-not-contact flag, its daily limit, a model error), or null. |
| POST | `/api/v1/ai/draft-campaign-text` | scope: messages:send | Writes campaign wording from a short goal, for the campaign form. |
| GET | `/api/v1/ai/jobs` | scope: messages:send | The queue: what is waiting (with its place in line), what is running, and the last day's finished requests. |
| POST | `/api/v1/ai/jobs` | scope: messages:send | Puts a request in the AI queue: `command` (an instruction, admins and message-sending API keys) or `draft` (campaign wording, anyone signed in). |
| POST | `/api/v1/ai/jobs/:id/cancel` | scope: messages:send | Cancels a request that has not started. |
| DELETE | `/api/v1/ai/llm` | role: admin | Turns the model off: the assistant keeps its settings but cannot answer until a model is set again. |
| GET | `/api/v1/ai/llm` | scope: conversations:read | The providers the page offers and what is in use now. |
| PUT | `/api/v1/ai/llm` | role: admin | Makes this the model the install uses from now on: tests it first (unless `anyway` is sent after a failed test the admin chose to ignore), then writes the `LLM_*` lines to the env file. |
| POST | `/api/v1/ai/llm/models` | role: admin | The models this provider and key offer, for the picker. |
| POST | `/api/v1/ai/llm/test` | role: admin | Tests a model with two tiny real calls. |
| GET | `/api/v1/ai/settings` | role: admin |   |
| PUT | `/api/v1/ai/settings` | role: admin |   |
| GET | `/api/v1/ai/status` | scope: conversations:read | Whether the assistant is on, so screens can offer its helpers. |
| GET | `/api/v1/ai/templates` | role: admin |   |
| POST | `/api/v1/ai/templates` | role: admin |   |
| DELETE | `/api/v1/ai/templates/:id` | role: admin |   |
| GET | `/api/v1/ai/templates/:id` | role: admin |   |
| POST | `/api/v1/ai/templates/:id/use` | role: admin |   |
| POST | `/api/v1/ai/templates/generate` | role: admin | Writes a template from a plain-words description. |

## app

| Method | Path | Who | What it does |
|---|---|---|---|
| GET | `/health` | nobody (open) | Liveness: the process is up. |
| GET | `/ready` | nobody (open) | Readiness: the database answers. |

## auth

| Method | Path | Who | What it does |
|---|---|---|---|
| POST | `/api/v1/auth/login` | nobody (open) | Exchanges an email and password for a session cookie. |
| POST | `/api/v1/auth/logout` | signed in | Ends the current session and clears both cookies. |
| GET | `/api/v1/auth/me` | signed in | Reports who the caller is. |

## campaigns

| Method | Path | Who | What it does |
|---|---|---|---|
| GET | `/api/v1/campaigns` | scope: conversations:read | Lists campaigns, newest first. |
| POST | `/api/v1/campaigns` | scope: messages:send | Creates a draft. |
| GET | `/api/v1/campaigns/:id` | scope: conversations:read | The campaign, its progress, and how much longer it has. |
| PATCH | `/api/v1/campaigns/:id` | scope: messages:send | Changes a campaign's name or wording, while it is a draft or paused. |
| POST | `/api/v1/campaigns/:id/cancel` | scope: messages:send | Cancels a campaign permanently. |
| POST | `/api/v1/campaigns/:id/pause` | scope: messages:send | Pauses a running campaign. |
| GET | `/api/v1/campaigns/:id/preview` | scope: conversations:read | A dry run: the audience a draft *would* freeze, and how long it would take — without writing anything (F5 AC-1). |
| GET | `/api/v1/campaigns/:id/recipients` | scope: conversations:read | Lists a campaign's recipients — the per-recipient results view (F5 AC-5). |
| POST | `/api/v1/campaigns/:id/start` | scope: messages:send | Starts a campaign: freezes the audience and lets the gateway begin. |
| GET | `/api/v1/campaigns/media` | scope: conversations:read | The organisation's campaign pictures, newest first, for "use one I uploaded before". |
| POST | `/api/v1/campaigns/media` | scope: messages:send | Stores one picture or GIF for campaigns: the raw file as the body. |

## contacts

| Method | Path | Who | What it does |
|---|---|---|---|
| GET | `/api/v1/contacts` | scope: contacts:read | Lists and searches contacts, newest first. |
| POST | `/api/v1/contacts` | scope: contacts:write | Creates a contact with its identities, refusing when an identity already names someone. |
| PUT | `/api/v1/contacts/:id/custom-fields` | scope: contacts:write | Sets or clears custom field values on a contact: `{ "values": { "city": "Pune", "stage": null } }`. |
| PUT | `/api/v1/contacts/:id/do-not-contact` | scope: contacts:write | Flags or clears do-not-contact. |
| POST | `/api/v1/contacts/:id/tags` | scope: contacts:write | Attaches a tag to a contact. |
| DELETE | `/api/v1/contacts/:id/tags/:tagId` | scope: contacts:write | Removes a tag from a contact. |
| GET | `/api/v1/contacts/count` | scope: contacts:read | How many contacts match a search / tag filter — the number a bulk action would affect. |
| GET | `/api/v1/contacts/export` | role: admin | Exports everyone the system holds about the people it messages, as CSV or vCard. |

## custom-fields

| Method | Path | Who | What it does |
|---|---|---|---|
| GET | `/api/v1/custom-fields` | scope: contacts:read |   |
| POST | `/api/v1/custom-fields` | role: admin |   |
| DELETE | `/api/v1/custom-fields/:key` | role: admin | Removes a definition and clears its value from every contact, so nothing orphaned lingers. |

## encryption

| Method | Path | Who | What it does |
|---|---|---|---|
| GET | `/api/v1/encryption` | role: admin |   |
| POST | `/api/v1/encryption/new-key` | role: admin | Makes a fresh key for the next version and hands it over once. |
| POST | `/api/v1/encryption/pause` | role: admin |   |
| POST | `/api/v1/encryption/resume` | role: admin |   |
| POST | `/api/v1/encryption/verify` | role: admin | Decrypts a random sample from this org's data and says how many values could not be read. |

## imports

| Method | Path | Who | What it does |
|---|---|---|---|
| GET | `/api/v1/imports` | scope: contacts:read | Lists committed import runs, newest first — the ones a campaign can target as an audience. |
| POST | `/api/v1/imports` | scope: contacts:write | Stores a file and reports what is in it. |
| GET | `/api/v1/imports/:id` | scope: contacts:read | The run, its summary, and the rows that went wrong. |
| POST | `/api/v1/imports/:id/run` | scope: contacts:write | Runs a mapping over an uploaded file. |

## media

| Method | Path | Who | What it does |
|---|---|---|---|
| GET | `/api/v1/media/:id` | scope: conversations:read | Streams one attachment to a caller that is entitled to it. |
| GET | `/api/v1/media/:id/thumb` | scope: conversations:read | A small preview of an image, for the thread. |

## messages

| Method | Path | Who | What it does |
|---|---|---|---|
| GET | `/api/v1/canned-replies` | scope: conversations:read | Lists the org's saved replies, most recently updated first. |
| POST | `/api/v1/canned-replies` | scope: conversations:write | Creates a saved reply. |
| GET | `/api/v1/conversations` | scope: conversations:read | Lists conversations, most recently active first. |
| GET | `/api/v1/conversations/:id` | scope: conversations:read | Returns one conversation on its own. |
| PATCH | `/api/v1/conversations/:id` | scope: conversations:write | Changes a conversation's status or assignee. |
| POST | `/api/v1/conversations/:id/attachments` | scope: messages:send | Queues an outbound message. |
| GET | `/api/v1/conversations/:id/messages` | scope: conversations:read | Returns one thread, oldest first, with bodies decrypted for display. |
| GET | `/api/v1/conversations/:id/notes` | scope: conversations:read | Lists a thread's internal notes, oldest first, with the author's name resolved. |
| POST | `/api/v1/conversations/:id/notes` | scope: conversations:write | Adds an internal note to a thread. |
| POST | `/api/v1/conversations/:id/participants` | role: admin | Adds a participant to a thread. |
| DELETE | `/api/v1/conversations/:id/participants/:userId` | role: admin | Removes a participant from a thread. |
| DELETE | `/api/v1/conversations/:id/presence` | scope: conversations:read | "I closed this thread." Best effort; the 30 s expiry covers a tab that never says goodbye. |
| GET | `/api/v1/conversations/:id/presence` | scope: conversations:read | Who else has this thread open, and who of them is typing. |
| POST | `/api/v1/conversations/:id/presence` | scope: conversations:read | "I have this thread open." Called every ~15 s by a thread open in a browser; anyone seen in the last 30 s counts as viewing (D-17). |
| POST | `/api/v1/conversations/:id/read` | scope: conversations:read | Marks a conversation read, clearing its unread badge. |
| GET | `/api/v1/conversations/:id/sender-status` | scope: conversations:read | Whether the number this thread sends from can send right now. |
| POST | `/api/v1/conversations/:id/typing` | scope: conversations:read | "I am typing a reply here." Pinged about every 3 s while the reply box has text. |
| POST | `/api/v1/messages` | scope: messages:send |   |
| GET | `/api/v1/users` | scope: conversations:read | Lists the org's members, so the inbox can offer an assignee. |

## segments

| Method | Path | Who | What it does |
|---|---|---|---|
| GET | `/api/v1/segments` | scope: contacts:read | Lists the org's segments, each with how many contacts it matches right now. |
| POST | `/api/v1/segments` | scope: contacts:write | Creates a segment. |
| DELETE | `/api/v1/segments/:id` | scope: contacts:write | Deletes a segment. |
| POST | `/api/v1/segments/preview` | scope: contacts:read | Counts the contacts a filter matches right now — for the builder, before saving. |

## senders

| Method | Path | Who | What it does |
|---|---|---|---|
| GET | `/api/v1/senders` | scope: senders:read | Lists senders with their live connection state and risk score. |
| POST | `/api/v1/senders` | scope: senders:write | Creates a sender. |
| POST | `/api/v1/senders/:id/enforcement` | role: admin | Switches a number between `enforce` (the default) and `advisory` (D-29): the engine keeps computing every signal, but the number-protecting holds are recorded instead of obeyed. |
| GET | `/api/v1/senders/:id/health-events` | scope: senders:read | The timeline for one number: restrictions suspected or cleared, possible hard bans, newest first. |
| GET | `/api/v1/senders/:id/link` | scope: senders:read | Returns the challenge once the gateway has it, or reports that it is still pending. |
| POST | `/api/v1/senders/:id/link` | scope: senders:write | Starts linking. |
| POST | `/api/v1/senders/:id/remove` | role: admin | Removes a number from the Numbers page (admin only, audited). |
| POST | `/api/v1/senders/:id/unlink` | scope: senders:write | Unlinks a number so it can be linked again. |

## tags

| Method | Path | Who | What it does |
|---|---|---|---|
| GET | `/api/v1/tags` | scope: contacts:read | Lists the org's tags with how many contacts carry each — for a tag bar or picker. |
| POST | `/api/v1/tags` | scope: contacts:write | Creates a tag. |
| DELETE | `/api/v1/tags/:id` | scope: contacts:write | Deletes a tag (needs the contacts:write scope, audited). |
| POST | `/api/v1/tags/:id/bulk` | scope: contacts:write | Adds or removes this tag across many contacts in one statement: everyone, everyone matching a search / tag filter, everyone in a segment, or an explicit list. |

