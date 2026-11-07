---
title: Choose the AI model
description: Pick the company and model the AI assistant runs on, test it, and save it.
---

The AI assistant needs a language model to write with. You choose it in the app, not in a settings file. This page is for **admins**.

## Steps

1. Open **AI assistant** in the left menu, then the **AI settings** tab.
2. Pick a **provider** (the company that runs the model). For a provider not on the list, choose "other" and give its address.
3. Paste the provider's **API key**. A blank key keeps the one already saved. Only the last four characters are ever shown again.
4. Press **Find models** to list what the key can use, and choose a **model**.
5. Press **Test**. It makes two tiny real calls and tells you whether the model answers and whether it can use tools. Nothing is saved yet.
6. Press **Save**. A model that fails the test is refused unless you choose to save it anyway.

:::tip
Some "reasoning" models spend their whole answer budget thinking and return nothing. If a model returns an empty answer the app shows a warning banner instead of failing silently. Try a different model if you see it.
:::

## Good to know

- The key is stored on the server and never sent back to the browser.
- **Turn the AI model off** removes the model, key and address from the settings. To stop the AI answering without deleting them, switch the assistant off on the **Assistant** tab instead.
- Contact messages are sent to the provider you choose when the assistant writes a reply. See [The AI assistant](../../guides/ai-assistant/) for the consent step and the privacy notes.
