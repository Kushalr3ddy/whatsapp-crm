# 36 · Workflows

How the main things work, as diagrams. Written 2026-10-21 from the code as built (what is **not** built is
marked). The diagrams are [Mermaid](https://mermaid.js.org): they draw themselves on GitHub and in most Markdown
viewers. Legend: rounded boxes are steps, diamonds are decisions, the shaded boxes are the AI model.

## 1 · AI templates: describe it, review, save, use

Page 1 is `/ai`; saving moves to page 2, `/ai/t/<id>`. (Code: `apps/web/app/ai/`, `packages/core/src/ai-templates.ts`.)

```mermaid
flowchart TD
  A([Open the AI tab]) --> B{AI switched on?}
  B -- no --> C[Tick the data-sharing note and switch on] --> D
  B -- yes --> D[Describe what you want in plain words, up to 8,000 characters]
  D --> E[Write the instructions]
  E --> F{Over the limit, or more than<br/>5 a minute for this org?}
  F -- yes --> G[Refused with the reason] --> D
  F -- no --> H[[The AI model writes bullet instructions from ALL of the description, never summarising]]
  H --> I{Usable answer?}
  I -- no --> J[Clear message, nothing saved] --> D
  I -- yes --> K[Review: instructions locked, always-on rules shown locked, AI warning]
  K --> L{Edit by hand?}
  L -- yes --> M[Warned, then editable] --> N
  L -- no --> N{Description changed since it was written?}
  N -- yes --> O[Save is off: write the instructions again] --> E
  N -- no --> P[Save as a template]
  P --> Q[Page 2: What next?]
  Q --> R[Let it answer all chats: becomes the default instructions]
  Q --> S[Message a group with this: workflow 3]
  Q --> T[Done for now]
```

**What the assistant is told when it replies** (every time, in this order): the app's fixed framing, then the
**always-on rules** (locked, same for every template, added in `systemText` so editing cannot remove them), then the
instructions, then the conversation, which is treated as untrusted. The description is never sent to the reply model.

## 2 · A campaign with a picture or GIF

(Code: `packages/core/src/campaign-media.ts`, `media-convert.ts`, `campaigns.ts`, `apps/gateway/src/work.ts`,
`packages/channels/baileys/src/outbound-content.ts`.)

```mermaid
flowchart TD
  A([New-campaign form]) --> B[Choose or drop a file]
  B --> C{Browser check:<br/>JPG PNG WebP GIF, up to 5 MB?}
  C -- no --> D[Reason shown, nothing uploaded]
  C -- yes --> E[Upload to the API]
  E --> F{Server check from the bytes:<br/>type, size, not MP4 or a document}
  F -- no --> G[Refused with the reason]
  F -- yes --> H{Is it a GIF?}
  H -- no --> K
  H -- yes --> I[ffmpeg turns it into a silent looping H.264 clip]
  I --> J{Converted?}
  J -- no --> G2[GIF refused, pictures still work]
  J -- yes --> K[Store the file once per organisation, same bytes = same copy, keep the clip next to the GIF]
  K --> L[Preview from a safe re-encoded thumbnail]
  L --> M[Create the draft with media_asset_id]
  M --> N[An admin presses Start: audience is frozen, forecast shown]
  N --> O[Gateway sweep: dispatchCampaign claims pending recipients with SKIP LOCKED, within the number's allowance and the identical-body cap]
  O --> P[Each recipient gets a message row: image or video, the file, the caption]
  P --> Q{handleSend gates:<br/>do-not-contact, number connected, quarantine, pacing}
  Q -- held --> R[Stays queued with the reason, retried by the sweep]
  Q -- ok --> S{GIF clip?}
  S -- no --> T[Sent as a photo with the caption]
  S -- yes --> U[Sent as a video with GIF playback, so it loops silently]
```

## 3 · Message a group from a template (the tag rule)

Every mass message goes to a tag (D-87). The tag name is `<template>-N (date, time)` and editable.
(Code: `apps/web/app/ai/t/[id]/group-section.tsx`, `apps/web/app/ai/actions.ts`.)

```mermaid
flowchart TD
  A([Message a group with this]) --> B{Who gets it?}
  B -- an existing tag --> C[Pick the tag]
  B -- everyone a search finds --> D[Search words, optional tag, optional date range added or last imported]
  D --> E[Check how many: shared search rule, nothing written]
  E --> F{Anyone found?}
  F -- no --> D
  F -- yes --> G[Tag name offered, editable, 60 characters at most]
  G --> H[Create the tag]
  H --> I[Tag exactly those people in one statement, refused if the number changed since the count]
  C --> J
  I --> J[Create the draft campaign: name, first message, number, tag, template link, optional picture]
  J --> K[Draft page: an admin presses Start]
```

## 4 · An inbound message answered by the AI assistant

(Code: `packages/core/src/ai-reply.ts`, `apps/gateway/src/main.ts`.) Only chats **assigned to the assistant** are answered.

```mermaid
flowchart TD
  A([A message arrives on a linked number]) --> B[Gateway stores it: decrypted, deduped by provider id, files typed from their bytes]
  B --> C{Chat assigned to the AI assistant?}
  C -- no --> D([Waits for a person])
  C -- yes --> E{Assistant on, consent given,<br/>under the daily cap?}
  E -- no --> F[Notice on the thread, no reply]
  E -- yes --> G{Contact marked do-not-contact?}
  G -- yes --> H[No reply; an admin may allow one with a written reason]
  G -- no --> I{Text, or a photo or voice note?}
  I -- photo or voice --> J[One polite please-type-that reply, not again for 10 minutes]
  I -- text --> K[[Model gets: framing + always-on rules + instructions + the conversation as untrusted text]]
  K --> L{Model asks to hand over?}
  L -- yes --> M[Chat goes back to a person with a summary note]
  L -- no --> N[Reply queued like any message]
  N --> O[Gateway pacing and anti-ban gates decide when it leaves]
```

## 5 · Importing contacts

(Code: `apps/web/app/import/`, `packages/core/src/ingestion.ts`.) The extra columns are stored as one JSON object on the contact (`contact.custom_fields`, a `jsonb` column with a search index, docs/35), not as a database column each, so any number of sheet columns fit.

```mermaid
flowchart TD
  A([Choose a CSV or Excel file]) --> B[Upload at once; same bytes seen before is refused, with Upload anyway]
  B --> C[Profile each column by its values, suggest the phone column]
  C --> D[Match columns: tick every phone column, name or first plus last joined, email, columns to keep]
  D --> E{Columns to store}
  E -- All columns, the default --> F[Every other column is stored on each person, personal ones too, up to 200]
  E -- Choose columns --> F2[Tick the ones to keep; personal ones carry a label]
  F --> G[Preview: nothing written yet]
  F2 --> G
  G --> H[Import]
  H --> I[Row by row into the ledger: find the person by phone or email, else create]
  I --> J[Existing person: name only if empty, new numbers added, field values never overwritten]
  J --> K[Everyone tagged with the file name, or the tag you typed]
  K --> L[Next steps: view the people, message them]
```

## 6 · One search rule for the list, the count and bulk tagging

```mermaid
flowchart LR
  A[Words + tag + date range + order] --> B[searchPredicate]
  B --> C[Contact list, 50 rows, keyset cursor for newest-first]
  B --> D[Count]
  B --> E[Bulk tag or untag in one statement, refused if the count changed]
  B --> F[Group message audience, workflow 3]
```

## 7 · The send pipeline for every outbound message

All sends, text or picture, human or AI or campaign, end here. (Code: `handleSend` in `apps/gateway/src/work.ts`;
the rules are in [`08-antiban.md`](08-antiban.md).)

```mermaid
flowchart TD
  A([Message row: queued]) --> B{Contact marked do-not-contact,<br/>and no admin override?}
  B -- yes --> C[Failed: do_not_contact]
  B -- no --> D{Number connected?}
  D -- no --> E[Stays queued: sender_not_connected]
  D -- yes --> F{Quarantined by the health score?}
  F -- yes, enforcing --> G[Stays queued: quarantined]
  F -- no, or advisory mode --> H{Pacing: per-minute and per-day allowance,<br/>new-contact limits, circadian rhythm}
  H -- over --> I[Stays queued: paced]
  H -- within --> J[Read the file from storage if any, optional typing pause]
  J --> K[Send through the channel]
  K --> L{Sent?}
  L -- yes --> M[Marked sent, provider id stored]
  L -- no --> N[Marked failed with the reason]
```
Advisory mode (D-29) lets a number send past the number-protecting holds; the do-not-contact gate is never bypassed.

## 8 · Choosing the AI: the AI settings tab

Second tab inside the AI tab, `/ai/settings`. (Code: `apps/web/app/ai/settings/`, `apps/api/src/routes/ai.ts`, `packages/providers/llm/src/`.) Admin only.

```mermaid
flowchart TD
  A([Open AI, then AI settings]) --> B[In use now: provider, model, key ending, or No model set]
  B --> C[Choose a provider: Groq, Gemini, OpenAI, Anthropic, OpenRouter, Ollama, or other]
  C --> D{Other?}
  D -- yes --> E[Type the address: must be https and public]
  D -- no --> F
  E --> F[Paste the API key, hidden; blank keeps the saved key for the same provider only]
  F --> G[Find models: the provider's own list, searchable, recommended one marked]
  G --> H[Pick or type a model]
  H --> I[Test it: two tiny real calls, an answer and a function call]
  I --> J{Usable?}
  J -- no --> K[Plain-words reason: key refused, model not found, rate limited, too slow] --> L{Use it anyway?}
  L -- no --> F
  L -- yes --> M
  J -- yes --> M[Use this]
  M --> N[Backup the settings file, write only the five LLM lines, audit without the key]
  N --> O[API and gateway see the changed file on their next model call: no restart]
  O --> P([The assistant, templates and campaign wording now use it])
```
