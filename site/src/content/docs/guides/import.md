---
title: "Import contacts"
description: 'Bring contacts in from a CSV or Excel sheet: drop the file, read the check, name the tag, import.'
---

Import turns a CSV or Excel (.xlsx) sheet into contacts. It is one screen: you drop the file, the CRM **checks it and shows what will happen**, and only then do you press **Import**. **Nothing is saved until you do.**

## Drop the file

Drop your file on the box, or click it to choose one. It is checked straight away; there is no Upload button. While it works the screen shows the real stages (sending and reading the sheet, finding the name and number, checking each person against your contacts) and a running clock. Big sheets take a while; you can keep the tab open and nothing is lost.

-   The sheet needs a **header row** on top and at least one person underneath.
-   Numbers with no country code are read for the **Country** you choose (every country is listed, India first).
-   Uploading the exact same file again says **You uploaded this exact file before**. Choose **Import it again** (people already in Contacts are matched by number and updated, not duplicated) or **Choose another file**.

## What the check shows

-   **Name and mobile number.** The CRM finds these columns itself and shows real numbers from your file as examples. If two columns look like numbers it asks **Which one should we message?** (pick one, then press **Use these**). You can use one name column, or **First name + last name, joined**. A column cannot be both the name and a number. If nobody in the file has a mobile number it can use, it says so and nothing can be imported.
-   **Other columns** are optional and come in as they are. The screen shows them as a count with a few column names.
-   **Details some people are missing**, with how many people lack each.
-   **A few people from your file**: three people picked at random, with everything the file says about them, so you can see it was read the right way.
-   **People in your sheet**: the sheet as a small read-only table (25 people a page, every column, with the sheet’s own row numbers). The details people lack are filter chips at the top; tick several and choose **Lack any of these** or **Lack all of these**, or use **Search every column**. One **Download** gives everyone the table shows (not only the page), as your sheet’s own columns, so you can fill the gaps and import again. You cannot edit people here.

## The tag

Every person in the file gets a tag, and the tag is **required**: it is shown at the top and next to the Import button, and Import stays blocked until it has a name. It starts as the file’s name. The tag is how you find these people later and how you pick them for a campaign.

## Rules the import follows

-   A person already in Contacts is matched by number and updated, never duplicated. If a value in the sheet differs from the one saved, **the newer file wins**. A blank cell or *NA* never erases anything.
-   A row with no name is saved with no name (campaigns then say “Hi there”). Names are never changed.
-   The same number twice in one file counts as one new person and one already there.
-   A bad email does not fail a row with a good number. A row with an email but no number is still imported.

## Importing

1.  Check the file, the tag and the country.
2.  Press **Import**. The screen lists what it does, in order. Large sheets take a few minutes; it says so and keeps working.
3.  The Done screen shows **Added to your contacts**, **Already in your contacts** and **Skipped** (the skipped rows can be downloaded), with **View them in Contacts**, **Start a campaign** (or **Link a number first** if no WhatsApp number is linked) and **Import another file**.

:::tip
Your place is kept if you reload the page, and leaving halfway asks first.
:::
