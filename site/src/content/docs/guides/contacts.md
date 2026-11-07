---
title: "Contacts"
description: 'Your contact book: files, tags and saved lists, filters, and do-not-contact.'
---

Contacts is one table of everyone, with the places they came from down the left side.

## Finding people

-   **Down the left:** **Imported files**, **Your tags** and **Saved lists**. Click one to show only those people (on a phone these are behind one **Source** button). Each file’s own tag is listed first among a person’s tags.
-   **The table** shows Name, Phone, Email, Tags, Last campaign, Imported and Last active (*Never replied* when they never wrote), with the total and page numbers.
-   **Search** looks in name, phone and email only.
-   **Filters** are grouped: **How they responded**, **What you have sent**, **Can you reach them** and rules on the columns of your files. A live count shows how many people match, the filters appear as chips you can remove, and **Clear all filters** starts again.
-   **Columns** chooses which of your file’s columns to show in the table. Every column is kept, and all of them are hidden at first.
-   **Save as a list** keeps the current filters as a **Saved list**. A saved list can be picked as the audience of a campaign.

## Opening a person

Click a row to open the person at the side. You see their details, every column kept from your file, the campaigns that messaged them and **Open chat**. It stays open if the list reloads underneath.

:::caution
**Do not contact** means: never message this person. Replies and campaigns skip them, and they show as *Do not contact* in the table. Use it for anyone who asks to stop. Only an admin can knowingly override it for one message or one campaign, with a written reason that is saved. The switch to turn it on or off is on the classic Contacts page, `/contacts/classic` (not linked from the menu).
:::

## Tags

A tag is a label such as “pune” or “interview-stage”. Every import gives its people the tag you chose for that file. To tag many people at once, tick them (or choose all the people the filters match), choose **Add tag**, then find a tag or type a new name. The change can be undone straight afterwards. A tag you no longer need can be deleted with **Delete tag**.

## Custom fields

Extra columns of your own (text, number, date or a pick-list), for example “City”, are defined on the classic Contacts page, `/contacts/classic`. *(admin only)* Anything you add can be used in a campaign as `{{city}}`.

## Messaging people from here

Start a campaign and choose files and tags, or **Pick people in Contacts** (see **Campaigns**).

## Exporting *(admin only)*

Admins see **Export**, which downloads the people in the current view as a CSV. Every export is recorded.
