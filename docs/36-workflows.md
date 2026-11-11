# 36 · Workflows

How the main things work, as diagrams. Written 2026-10-21 from the code as built (what is **not** built is
marked). The diagrams are [Mermaid](https://mermaid.js.org): they draw themselves on GitHub and in most Markdown
viewers. Legend: rounded boxes are steps, diamonds are decisions, the shaded boxes are the AI model.

## 1 · AI templates: the Templates home and the editor

`/ai` is the Templates home (cards, a status line, a first-run checklist when the AI is not on yet); `/ai/new` and `/ai/t/<id>` are the editor; the AI provider is the second tab, `/ai/settings`.
(Code: `apps/web/app/ai/`, `packages/core/src/ai-templates.ts`, `ai-example.ts`.)

```mermaid
flowchart TD
  A([Open AI assistant]) --> B{AI on and a model set?}
  B -- no --> C[First-run checklist: add a model, accept the data note, switch on] --> D
  B -- yes --> D[Templates home: cards, status line, Deleted]
  D --> E[New template: say what it is for, or paste a job description]
  E --> F[[The AI writes a playbook: Goal, Facts you may share, What to find out, If they ask something not covered, How it ends, plus up to 5 questions for the owner]]
  F --> G[Editor: name, who gets the chat when it is not sure, questions, who it is for, what the AI knows, sensitive details, example]
  G --> H[Choose the file or tag; the AI suggests which columns it may see, from the column names only]
  G --> I[Find sensitive details: the owner marks each Show or Keep general; Rewrite with my choices keeps every other fact as written]
  G --> J[See exactly what the AI gets: read only, built from the one text on every save]
  G --> K[Example conversation with one real person, nothing sent]
  G --> L{Save}
  L -- no hand-over person or number --> G
  L -- ok --> M[Saved: Start a campaign opens New campaign with this template picked]
  D --> N[Duplicate, Delete: refused while an unfinished campaign uses it; otherwise Deleted for 30 days, Restore, Remove now]
```

**What the AI is told when it replies** (every time, in this order): who it writes for and how (a member of the organisation's
team, never "an assistant"; one short message and one question per turn), how to run the conversation to its end, the
**always-on rules** (locked, added in `systemText` so editing cannot remove them), what is known about this person (their name and
the columns the template allows), the answer format, then the template's instructions. The customer's messages are only ever
conversation turns. The description the owner typed is never sent to the reply model.

**What the AI answers with:** one JSON object, `reply` (the only text sent), `status`, `summary` and `handover`.

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

## 3 · Start a campaign from a template

The Templates home and the editor open New campaign with the template picked (`/broadcast/new?template=<id>`). The template's draft opening
goes into the message box and can be changed there; the audience is chosen on New campaign. The campaign keeps `ai_template_id`.
(Code: `apps/web/app/broadcast/new/`.)

```mermaid
flowchart TD
  A([Start a campaign on a template card]) --> B[New campaign opens with the template picked and its opening in the message box]
  B --> C[Choose the people: a file, a tag, a saved list]
  C --> D[Review shows the AI credits: each person's opening plus about 3 replies]
  D --> E[Draft campaign: an admin presses Start]
  E --> F[The AI writes each person's opening, then answers replies: workflow 4]
```

## 4 · An inbound message answered by the AI assistant

(Code: `packages/core/src/ai-reply.ts`, `ai-turn.ts`, `apps/gateway/src/main.ts`.) Only chats **assigned to the assistant** are answered; a campaign reply in a chat nobody owns is given to it.

```mermaid
flowchart TD
  A([A message arrives on a linked number]) --> B[Gateway stores it: decrypted, deduped by provider id, files typed from their bytes]
  B --> C{Chat assigned to the AI assistant?}
  C -- no --> D([Waits for a person: no run is recorded])
  C -- yes --> E{Assistant on, consent given,<br/>campaign AI not stopped, under the daily cap?}
  E -- no --> F[Notice on the thread, no reply]
  E -- yes --> G{Contact marked do-not-contact?}
  G -- yes --> H[No reply; an admin may allow one with a written reason]
  G -- no --> I{Text, or a photo, voice note or file?}
  I -- not text --> J[Fixed line, no model call, no credit]
  I -- text --> K[[Model gets: rules + the person's name and allowed columns + the template + the chat]]
  K --> L[Answer read as JSON: reply, status, summary, handover]
  L --> M[Status and summary saved on the person's row of the campaign]
  M --> N{handover true?}
  N -- no --> O[Reply queued like any message]
  N -- yes --> P[Closing reply queued; chat goes to the person the template names, with the summary as a note]
  O --> Q[Gateway gates and the anti-ban policy decide when it leaves]
  P --> Q
```

The AI finishes a conversation only after a recap the person confirmed, a clear no, or a request for a person. Having the person's
contact details, or not knowing one answer, does not end it.

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

A campaign made from an AI template (a template card's "Start a campaign", or "Use a template" on New campaign) does not send its typed text. The gateway asks the AI to write one opening per person from the template's instructions, the person's name and the columns the template allows, and the typed text as an outline. The opening is at most two short sentences and under 220 characters, from the organisation, never from "an assistant". Only people with an opening are queued, and the AI's text is what goes out; the rest of the pipeline (the anti-ban policy, do-not-contact) is unchanged. If the AI is off, or no model is set, those campaigns wait. After three failed writes a person is skipped as `ai_opening_failed`. Code: `packages/core/src/ai-opening.ts`, `dispatchCampaign`, `apps/gateway/src/work.ts`.
