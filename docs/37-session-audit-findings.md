# 37 · Session audit: findings, bugs and bottlenecks

Written 2026-10-22 from a timed, recorded, ordered pass over the whole product (`tests/live/session-audit.live.ts`, run with `scripts/run-session.sh`).
A resource monitor (`tests/live/resmon.mjs`) sampled the machine every second beside it, and a visible Chromium recorded video. **This is the dry run**: the e2e test
organisation, the **fake** WhatsApp channel, a **fresh `next dev` server** (the machine was first cleared of a 4.5 GB, 15-hour-old one). The real run (the hiring-studios
organisation, your real linked number, real messages) is still to come and will add to this file. Raw output of each run is in `test-results/session-*/` (steps, resources, `report.md`, `session.webm`).

How to read the times: they are **wall-clock from the click until the page shows what the person is waiting for**, measured in `next dev` (which compiles a page the first
time it is opened and runs unoptimised) on a machine whose CPU was also driving the test browser and its video recording (Chromium averaged 109 % CPU and peaked at 310 %).
Production on the Linode box will be faster than every dev-mode number here. The *order* of the slow things is the useful part.

## 1 · What worked (no bug found)

| Step | Result |
|---|---|
| Wrong password, wrong email | Both show a clear error in about 1 s (1.4 s, 0.8 s). Show/hide password works. Correct sign in: 2.9 s to the dashboard. |
| Dashboard, element by element | The theme toggle and every link on the page (14) open and come back; warm opens take 0.5 to 3.4 s, "back" 0.2 to 0.5 s (Contacts excepted, below). |
| Inbox | Filters Closed / Mine / All / Open answer in 0.15 to 0.5 s. A message sent through the API and a reply typed in the inbox both left the gateway; the reply took 0.5 s to appear and **8.5 s to reach "sent / delivered" on the fake channel** (3 s gateway sweep plus pacing; the real number will differ). |
| Contacts | The row opens (1.3 s), the Dates and order box opens (0.3 s). **Import:** upload to rows read 0.9 s; Preview 0.5 s; Import 0.7 s; the same file again is refused ("already uploaded") in 0.3 s; **Upload anyway** works (1.0 s) and a second import updates the existing people. |
| Search | Every query returned the right count: a name (1), a phone with and without `+` (1), an email (1), a city (1 and 2), a shared word "Phone" (4), part of a number (1), and an unrelated word (0). |
| Team | Demoting yourself as the only admin is refused with **"At least one admin must stay. Make someone else an admin first."**, the role stays Admin after a reload, and Disable on your own row is greyed out. |
| AI assistant | Describe and Write took 2.4 s on the real model; the instructions are locked and "Edit by hand" warns; Save moves to page 2; the group section opens; the order queue finished a real instruction in 1 s. |
| AI settings | Groq: 11 models found (1.1 s), the picker opens and narrows, **Test it: "It works. openai/gpt-oss-20b answered in 0.7 s and can call functions"** (1.4 s), Use this saves (2.2 s), and a wrong key says "The test failed. The provider refused the key (401)…" in 0.8 s. |
| Security | The page opens in 0.8 s; **Verify with the new key: "All 66 sampled values opened with the current key, and none are still on a retired key"** (0.8 s). Buttons on the page: Generate a new key, Verify (only Verify was pressed). |
| Billing | Opens in 0.3 s; nothing pressed. |

## 2 · Bottlenecks, worst first

| # | Where | Measured | Why (found) | What to do |
|---|---|---|---|---|
| 1 | **Contacts page** | Open **6.3 to 7.2 s**; Refresh 4.7 s; each of 11 searches **3.3 to 5.5 s** (about 4.2 s on average); "back" from it is instant | About 110 contacts in the test org. The page sends about **1 MB of HTML and 158 forms for 50 people**: every row builds its hidden controls (add a tag, do-not-contact, custom fields) up front, and a server action id is repeated in each form. At an idle machine it measured 1.7 s; under the load of this run it is 4 to 7 s. | Build a row's extra controls only when it is opened, use one shared do-not-contact form, trim the page; test it in production mode. (D-89 below.) |
| 2 | **First visit of every page in dev mode** | 2.6 to **8.5 s** each (`/ai/settings` 8.5 s, `/link` 7.9 s, `/contacts` 7.4 s, a campaign page 7.2 s, `/inbox` 5.9 s) | `next dev` compiles on first request. Not present in a production build. | Measure and demo on a production build (D-83 caveat: some screens went stale after an action in that mode). |
| 3 | **Sign out** | **9.9 s**, then 3.9 s to confirm the session is gone | Not explained yet; every other button answered in under 3 s. Possibly the server ends the session and re-renders the shell under load. | Profile the sign-out action (D-89). |
| 4 | **A conversation page** | 2.2 to **3.4 s** warm (5.3 s first), for threads of up to a few dozen messages | Rendering every message and its controls on the server. | Fine for now; watch it with long threads (paging, D-46). |
| 5 | **Campaign page** | 1.4 to 2.0 s warm (7.2 s first) | A recipient list is rendered in full. | Acceptable; page the list when audiences get large. |
| 6 | **Message to "sent"** | 8.5 s on the fake channel | Gateway sweep every 3 s plus pacing. | Measure on the real channel in the real run. |

## 3 · Product findings and bugs

1. **A held campaign says nothing about why (UX gap, real).** With the e2e number's new-contact limit used up (5 a day by default), three recipients sat at **"Pending"** for 8 minutes. The campaign page only said "3 left, finishes today at 1468/day". The gateway log knew the reason (`new_contact_throttle`, retry in one hour) and each message stores a hold reason. The page should say "Waiting: the number has reached its limit of new contacts today. It will resume at …". (Your real number is in advisory mode, which skips these holds.)
2. **The City column is not saved unless ticked**, so searching a city finds nothing until it is stored. This is the intended "never store what you did not choose" behaviour, but a person importing "Full Name, Mobile, Email, City" may expect city to be kept. Consider ticking the non-personal columns by default, or saying so on the result ("City was not saved").
3. **After "Upload anyway" you must press Preview before Import.** The page says so ("Click Preview first…"), so it is consistent, but it is one more click than the first import.
4. **Test-data clutter in the e2e org** (12 linked numbers, 11 "Not linked"; eight team members) makes the dashboard long. Not a product bug, but it inflates page sizes in measurements.
5. **No functional bug was found in sign-in, search, import, import-again, team, AI, AI settings, security or billing.**

## 4 · The machine (what slowed everything)

| | Before clearing | During this run |
|---|---|---|
| CPU | pinned near **98 %** while idle | average 68 %, peak 100 % (Chromium of the test alone averaged 109 %, peak 310 %) |
| Memory | 14.2 of 15.7 GB used, about 1.5 GB available | lowest available 3.0 GB, 12.7 GB used at the peak |
| Swap | **7.8 GB** in use | 4.0 GB |
| Web server (`next dev`) | **4.5 GB** after 15 hours | 2.6 GB peak, fresh |
| API / gateway / Postgres | 0.2 GB / 0.4 GB / 0.3 GB | all small; Postgres peaked at 71 % of one core |

The first run **crashed the test browser**: with the CPU at 98 % and 7.8 GB in swap a page stalled for 20 s and then the browser closed. Restarting the dev web server freed 6 GB and stopped it. Before a long session close Chrome tabs (it used 4 to 5 GB) and restart `next dev` if it has been up for hours: it grows (about 4.5 GB at 15 h).

## 5 · Problems with the test tool itself (found and fixed on the way)

- A step waiting for a button that was not on the page waited forever (Playwright's default is no limit); the script now sets a 30 s limit.
- One failed step used to send the page home and break the steps that depended on it; the script now keeps going on the page it is on and stops after 12 failures in a row.
- The test browser died when the machine was starved (above); the monitor shows it.
- The first upload of the CSV is refused when the organisation has seen the file before ("already uploaded"); the script must press Upload anyway in that case (fixed for the next run).

## 6 · Not measured yet

The **real run**: the hiring-studios organisation, `kushal_test` sending real messages to the test number and to the three numbers in the CSV, the Spanish number's delivery time, advisory mode, and the real gateway's memory. That needs the real gateway started once and, if WhatsApp wants it, a QR scan on your phone.
