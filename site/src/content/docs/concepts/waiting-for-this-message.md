---
title: '"Waiting for this message"'
description: What it means when a customer's phone says "Waiting for this message", and what to do.
---

Sometimes a customer tells you their phone shows **"Waiting for this message"** where your text should be, or the thread says the other phone **could not read it yet**.

## What is happening

WhatsApp encrypts every message so only the two phones can read it. Each pair of phones keeps a shared secret that moves forward with each message. If our side and their side disagree about that secret, their phone cannot unlock the message, so it asks us to send it again and shows "Waiting for this message" in the meantime.

## What you will see in the CRM

- Under a message you sent: **delivered, but the other phone could not read it yet (it asked for it again N times)**. This stays until the message is read.
- In the composer: **The encryption session of this number looks broken**. This means a burst of messages could not be read, and it is the fix that needs you.
- Messages you type on your own phone or on WhatsApp Web may be **missing from the inbox** when the problem is on the number's own devices.

## What to do

1. **Wait a moment.** One or two retries often fix themselves.
2. **If the composer says the session looks broken,** open **Linked numbers**, choose **Unlink / reset this number**, and link it again from the phone. Do not restart the server while a real number is linked unless you have to.
3. **Do not push more messages through a broken number.** Sending into a broken session makes it worse.

## Why it used to happen so often

WhatsApp now identifies the same person by two different addresses, their phone number and a private identifier. Older versions of the WhatsApp library kept a separate secret for each address, so a reply arrived on an address we had no secret for. The CRM now uses a newer library version that links the two addresses, keeps its stored keys in the right order, and tells you when a session is broken. A number that was already broken still needs one relink.

:::note
The newer library version is a release candidate. If you see this problem again after relinking, note the time and the number and report it.
:::
