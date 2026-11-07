---
title: "The AI assistant"
description: 'Switch the AI assistant on, hand it a chat, and give it instructions.'
---

The AI assistant is a **member of your team that is a program**. It has its own name ("AI assistant"), can own a conversation like a person, and everything it does is recorded in the audit log under its name. It does three things: answers chats you give it; runs campaigns when you tell it to; and messages one person when you ask. It is **off until an admin switches it on**.

:::caution
It writes in your name, on your number, and it can be wrong. Read what it sends, especially at first, and keep its instructions narrow.
:::

![The AI assistant page (admins only).](../../../assets/shots/15-ai.png)

## Choosing the AI model *(admin only)*

The **AI settings** tab (next to **Assistant**) is where you choose the company and model the AI runs on: pick a provider, paste its key, choose a model and press **Test**. The test makes two tiny real calls, so you know it works before anything is sent to a customer. If the model answers with nothing, a warning banner says so instead of failing silently.

## AI templates

On the **Assistant** tab, **Describe what you want** turns a few plain words into instructions for the AI, a suggested audience and a draft first message. Read and edit the result, then save it as a **template**. Saved templates appear under **Saved templates**; you can pick one when you create a campaign, or use it to message a group. The locked safety rules are always added in front, whatever a template says.

## Switching it on *(admin only)*

1.  **Tick the consent box.** To write a reply, the assistant sends the conversation (including the contact’s name and what they wrote) to an outside AI company. Only agree if your contacts have been told. Your choice is saved with the date.
2.  Tick **AI assistant is on**.
3.  Write what it **may talk about**, like a note to a new colleague: "You answer WhatsApp questions for Hiring Studios about openings, interview times and documents. Keep replies to one or two short, polite sentences. If unsure, or the person asks for a human, hand over."
4.  Set **Most messages it may send in a day** (default 200).
5.  Leave **The assistant may start and resume campaigns by itself** **off** until you trust it. Off means it prepares a campaign and you press Start.
6.  Press **Save**.

## Handing a chat to the assistant, and taking it back

-   In a conversation, set **Assignee** to **AI assistant**. When the customer writes, it replies.
-   Set Assignee to a person to **take over**. It stops at once, and a reply it was still writing is thrown away.
-   **Resolve** also stops it, because it only answers **open** chats.
-   If it cannot help, it gives the chat back by itself: the chat becomes **Unassigned** with a note saying why. Check **Unassigned** now and then.

It reads plain text only. If someone sends a photo, a voice note or a file, it replies once, "I can only read text messages here, so could you type that out for me?", and does not repeat it. It stays within its daily limit and **never** messages someone marked do-not-contact.

**It leads the conversation.** If your instructions describe a goal (for example: "find out their name, city, years of driving and when they can start"), it answers what the person asks and then asks the next question toward that goal, one at a time. When the goal is done, or the person asks for a human, it hands the chat back with a summary in the note.

:::caution
**It has no fact-checking yet.** If the instructions do not say something (pay, documents, requirements), it may still answer, and it can be wrong. Put the real facts in its instructions, and keep it to test chats until guardrails are added.
:::

:::caution
**Not built yet:** if a customer writes STOP or "unsubscribe", the assistant does not mark them do-not-contact automatically. A person has to flag them. Keep an eye on chats you hand over.
:::

## Telling it what to do

Type plain sentences in the box on the AI page, for example: *"Send the Friday interview reminder to everyone tagged pune."* *"Message Asha Rao and ask if she can start Monday."* *"Pause the Diwali campaign."* *"Change the wording of the walk-in campaign to mention parking."*

| You ask for | What happens |
| --- | --- |
| A message to a group | It creates a campaign for a tag or saved audience that already exists. If it is unclear which, it asks instead of guessing. |
| Pause, resume or edit a campaign | Edit changes the name or wording, and only while the campaign is a draft or paused. |
| A message to one person | It sends one message in the chat you already have with them, and takes over that chat so it can handle the reply. |

**It will refuse (and say why):** starting or resuming a campaign when the switch above is off; messaging someone marked do-not-contact; messaging into a chat owned by a person; a person with no chat yet; two contacts with the same name (use the phone number); cancelling a campaign; overriding any safety limit. It does at most five things per request, each shown with a ✓ or ✗.

## The queue

Requests run **one at a time, oldest first**.

| You see | It means |
| --- | --- |
| **#1 · waiting, next up** / **#3 · waiting, 2 ahead** | Not started. Its place in line. |
| A spinning ring and **working… 12s** | Running right now. |
| **✓ done** | Finished. Its answer and every action are shown, with links to campaigns it made. |
| **✗ failed** | It could not finish. The reason is written under it. |
| **— cancelled** | Cancelled before it started. |

**Cancel** appears on every waiting request. One that has started cannot be stopped, but it can be undone from the campaign or chat. Requests stay listed for 24 hours. Up to 20 can wait at once. Admins see everyone’s; others see only their own.

**Write with AI** on the new-campaign form uses the same queue: it shows "Waiting in the AI queue, 2 ahead of you" (with Cancel), then a spinner, then the text appears in the message box. Read and edit it; nothing is sent until you create and start the campaign.

## Warnings above the message box

| The banner says | What it means and what to do |
| --- | --- |
| **…the anti-ban engine is spacing out sends** | The number paces itself like a human. Nothing to do. Nobody can override it. |
| **…the number is quarantined / cooling off** | The number is resting. Wait. See Linked numbers. |
| **…it’s night where the contact is** | It waits for their morning. |
| **…the number isn’t connected** | Re-link it on Linked numbers. |
| **The AI assistant reached its daily message limit** | Wait, or an admin raises the limit. |
| **The AI assistant could not write a reply** | The AI company did not answer. A person should answer. |
| **…did not reply: this contact is marked do-not-contact** | They asked not to be messaged. See below. |

*(admin only)* For the do-not-contact banner only, an admin sees **Allow reply anyway (ban risk)**. It needs a written reason (10+ characters), allows **one** reply to their latest message and is saved in the audit log with your name. Use it only when you are sure, for example they wrote to you first and asked a question.

## Privacy

-   Contact messages go to an outside AI company when the assistant writes a reply. That is what the consent box is for. Some free plans let the provider keep or learn from what you send: check their terms before using real customer chats.
-   The assistant sees the recent messages of the chat it is answering and, for instructions, only the **names** of your tags, audiences, numbers and campaigns, never your contacts’ details.
-   Turn it off any time: untick **AI assistant is on** and save.
