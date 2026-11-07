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
  M --> N[An admin presses Start: audience is frozen]
  N --> O[Gateway sweep: dispatchCampaign claims pending recipients with SKIP LOCKED, up to the anti-ban policy's batch]
  O --> P[Each recipient gets a message row: image or video, the file, the caption]
  P --> Q{The number's lane gates:<br/>do-not-contact, number connected, the anti-ban policy}
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
  N --> O[Gateway gates and the anti-ban policy decide when it leaves]
```

## 5 · Importing contacts

(Code: `apps/web/app/import/`, `apps/web/lib/import.ts`, `packages/core/src/ingestion.ts`. The rules for rows and for importing a file again are in [`07-ingestion.md`](07-ingestion.md).) The extra columns are stored as one JSON object on the contact (`contact.custom_fields`, a `jsonb` column with a search index, docs/35), not as a database column each, so any number of sheet columns fit.

```mermaid
flowchart TD
  A([Drop a CSV or Excel file]) --> B[Upload and check at once: real stages shown, nothing saved]
  B --> B2{Same bytes seen before?}
  B2 -- yes --> B3[You uploaded this exact file before: Import it again, or Choose another file]
  B2 -- no --> C
  B3 --> C[Profile each column by its values, find the name and mobile number columns]
  C --> D{Two columns look like numbers?}
  D -- yes --> D2[Which one should we message? Pick one]
  D -- no --> E
  D2 --> E[Check card: real numbers as examples for the chosen country, other columns as a count, details people lack, three random people, People in your sheet]
  E --> F[Tag named after the file; the tag is required]
  F --> G[Import: blocked until the tag has a name]
  G --> H[Row by row into the ledger: find the person by phone or email, else create]
  H --> I[Existing person: newest file wins for kept columns, a blank or NA never erases, new numbers and emails only added]
  I --> J[Everyone tagged, atomically with the commit]
  J --> K[Done: Added, Already in your contacts, Skipped; view them, start a campaign, import another]
```

## 6 · One search rule for the list, the count and bulk tagging

```mermaid
flowchart LR
  A[Words + tag or file + filters + order] --> B[searchPredicate]
  B --> C[Contact list: pages of up to 250 by offset, with a total]
  B --> D[Count]
  B --> E[Bulk tag or untag in one statement, refused if the count changed]
  B --> F[Group message audience, workflow 3]
```

## 7 · The send pipeline for every outbound message

All sends, text or picture, human or AI or campaign, end here. (Code: `runLane` in `apps/gateway/src/lane.ts`, started by `handleSend` and the sweep in `work.ts`;
the rules are in [`08-antiban.md`](08-antiban.md).)

```mermaid
flowchart TD
  A([Message row: queued]) --> A2[Joins its number's lane: reply, agent, AI, campaign; oldest first]
  A2 --> B{Contact marked do-not-contact,<br/>and no admin override?}
  B -- yes --> C[Failed: do_not_contact]
  B -- no --> D{Number connected?}
  D -- no --> E[Stays queued: sender_not_connected]
  D -- yes --> H{Anti-ban policy: send, wait or hold?}
  H -- hold --> I[Stays queued with the reason and when it should lift]
  H -- wait --> W[Lane comes back at the moment the gap ends; typing runs inside the wait]
  W --> H
  H -- send --> N1{First message to a new chat?}
  N1 -- yes --> R1[Ask WhatsApp once if the number has an account]
  R1 -- not on WhatsApp --> C2[Failed: not_on_whatsapp]
  R1 -- yes or unknown --> J
  N1 -- no --> J[Read the file from storage if any]
  J --> K[Send through the channel]
  K --> L{Sent?}
  L -- yes --> M[Marked sent, provider id stored]
  L -- no --> N[Marked failed with the reason; a 463 also holds new sends to that contact]
```
The policy (`makeAntiBanPolicy`) is pure: it reads the number's state, the contact's state, the stored gap and the clock, and answers send, wait or hold. A message that has to wait does not block one that is held for a different reason (a new chat held by a timelock lets a known contact through), but it does hold up the lane behind it.

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

## AI campaigns: who writes the first message

A campaign made from an AI template (AI page → "Message a group") does not send its typed text. The gateway asks the AI to write one opening per person from the template's instructions, the person's name and stored columns, and the typed text as an outline. Only people with an opening are queued, and the AI's text is what goes out; the rest of the pipeline (the anti-ban policy, do-not-contact) is unchanged. If the AI is off, or no model is set, those campaigns wait. After three failed writes a person is skipped as `ai_opening_failed`. Code: `packages/core/src/ai-opening.ts`, `dispatchCampaign`, `apps/gateway/src/work.ts`.
