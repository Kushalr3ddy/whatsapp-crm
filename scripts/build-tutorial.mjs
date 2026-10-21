// Builds the user tutorial PDF: docs/CRM-user-tutorial.pdf.
//
//   npm run tutorial:pdf -- <folder of screenshots>
//
// The screenshots come from `npm run tutorial:shots -- <folder>` (a demo org with invented people). The words live in
// this file so the whole tutorial regenerates with one command when the screens change. Written for the people who
// use the CRM every day, not for developers: plain language, one idea at a time, numbered markers that match the
// numbered red circles on each screenshot.
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shots = resolve(process.argv[2] ?? 'tutorial-shots');
const outPdf = join(root, 'docs', 'CRM-user-tutorial.pdf');
const builtOn = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

/** A screenshot as an inline picture with a caption. */
const fig = (file, caption) => {
  const data = readFileSync(join(shots, `${file}.png`)).toString('base64');
  return `<figure><img src="data:image/png;base64,${data}" alt="${caption}"><figcaption>${caption}</figcaption></figure>`;
};
const tip = (html) => `<div class="box tip"><b>Tip</b> ${html}</div>`;
const care = (html) => `<div class="box care"><b>Careful</b> ${html}</div>`;
const admin = '<span class="tag">Admin</span>';
const markers = (items) => `<ol class="markers">${items.map(([n, t]) => `<li value="${n}">${t}</li>`).join('')}</ol>`;
const table = (head, rows) => `<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const steps = (items) => `<ol class="steps">${items.map((t) => `<li>${t}</li>`).join('')}</ol>`;

/** Chapters: [id, title, html]. Order is reading order. */
const chapters = [];
const chapter = (title, html) => chapters.push([`c${chapters.length + 1}`, title, html]);

chapter('Before you start', `
<p>This CRM is a shared inbox and a bulk-messaging tool for WhatsApp. Your team answers customers from one screen, you
keep a contact book with tags, and you send the same message to many people without sending it all at once.</p>
<h3>Two kinds of people</h3>
${table(['Role', 'What they can do'], [
  ['<b>Agent</b>', 'Work in the inbox, reply, add notes, tag contacts, import contacts, make and run campaigns.'],
  ['<b>Admin</b>', 'Everything an agent can, plus: manage the team, change the AI assistant, see the security page, export contacts, add extra people to a chat, and knowingly override a few safety rules (always with a written reason that is saved).']
])}
<p>Things only admins can do are marked with ${admin} in this tutorial.</p>
<h3>The one thing to understand about WhatsApp</h3>
${care('This product talks to WhatsApp the way a phone would. WhatsApp can <b>permanently ban a number</b> that behaves like a spam sender, with no appeal. The CRM protects your numbers on purpose: it sends slowly, spaces messages like a human would, and sometimes holds a message back. When it does, it tells you why. Please read the <b>Safety rules</b> chapter before your first campaign, and use a number you can afford to lose while you are learning.')}
<h3>How to read the pictures</h3>
<p>Each screenshot has <b>red numbered circles</b>. The number list under the picture explains each circle. All the people in
the pictures are invented.</p>
`);

chapter('Signing in and finding your way around', `
<h3>Signing in</h3>
${fig('01-login', 'The sign-in screen.')}
${steps([
  'Open the address your administrator gave you.',
  'Type your <b>Email</b> (your email address, not your name) and your <b>Password</b>. Use <b>Show</b> to check what you typed.',
  'Press <b>Sign in</b>. You stay signed in for 7 days.'
])}
<p><b>Forgot your password?</b> There is no self-service reset yet. Ask an admin to set a new one for you on the Team page.
<b>Creating your own account</b> from the sign-in screen does not work yet either: an admin adds people from the Team page.</p>
<h3>The menu on the left</h3>
${table(['Tab', 'What it is for'], [
  ['<b>Overview</b>', 'A summary of today and a checklist to get started.'],
  ['<b>Inbox</b>', 'Your conversations. Reply to customers here.'],
  ['<b>Contacts</b>', 'Your contact book: people, tags, custom fields.'],
  ['<b>Linked numbers</b>', 'The WhatsApp numbers you send from. A red count here means a number may be limited.'],
  ['<b>Import</b>', 'Bring contacts in from a CSV or Excel sheet.'],
  ['<b>Campaigns</b>', 'Send one message to many people.'],
  ['<b>Team</b> ' + admin, 'Add people, choose their role, reset passwords.'],
  ['<b>AI assistant</b> ' + admin, 'Switch on and instruct the AI assistant.'],
  ['<b>Security</b>', 'Encryption keys (admins only see the content).'],
  ['<b>Billing</b>', 'Not built yet.']
])}
<p>At the bottom of the menu: the <b>Theme</b> button cycles Auto, Light and Dark (your browser remembers it), and <b>Sign out</b> ends your session.
On a phone or a narrow window the menu becomes a bar of icons across the top.</p>
`);

chapter('Overview: your day at a glance', `
${fig('02-overview', 'The Overview page.')}
${markers([
  [1, 'The menu.'],
  [2, '<b>Import contacts</b>: jumps to the import wizard.'],
  [3, '<b>New campaign</b>: jumps to the campaign form.'],
  [4, '<b>Latest conversations</b>: the newest chats. Click one to open it.']
])}
<p>The four tiles show <b>Linked numbers</b> (connected out of total), <b>Open conversations</b> (and how many are unread),
<b>Contacts</b> and <b>Campaigns</b> running now. Under them: your numbers (<b>Manage</b>), the latest conversations
(<b>Open inbox</b>) and recent campaigns (<b>All campaigns</b>).</p>
<p>New workspaces also show a <b>Getting started</b> checklist, which disappears when every step is done:</p>
${steps([
  '<b>Add and link a WhatsApp number</b> — scan one QR code with the phone you want to send from.',
  '<b>Bring in your contacts</b> — upload a CSV or Excel sheet; the columns match themselves.',
  '<b>Invite your team</b> ' + admin + ' — add the people who will answer messages.',
  '<b>Send your first campaign</b> — pick an audience, write the message, preview and start.'
])}
<p>Two warnings can appear on this page. <b>"One number needs attention"</b> means a number is quarantined or degraded: open
<b>Linked numbers</b>. <b>"N messages are queued and not sent yet"</b> usually means a number is not connected or is pacing itself.</p>
`);

chapter('Linked numbers: connecting WhatsApp', `
${fig('10-link', 'Linked numbers.')}
${markers([
  [1, '<b>Add a number</b>.'],
  [2, 'The health badge ("Healthy", "Degraded", "Quarantined") and the risk score out of 100.'],
  [3, '<b>Advisory mode</b> (admins only; read the warning before touching it).']
])}
<h3>Adding and linking a number</h3>
${steps([
  'Press <b>Add a number</b>, give it a <b>Name</b> (for example "Sales line") and press <b>Add number</b>.',
  'A linking panel opens. Choose <b>Scan a QR</b> or <b>Type a code</b>.',
  '<b>Scan a QR:</b> on the phone, open WhatsApp, then <b>Settings → Linked Devices → Link a device</b> and scan the QR on screen. It shows a countdown ("Expires in m:ss").',
  '<b>Type a code:</b> enter the phone number in full international form (for example +919876543210), press <b>Link this number</b>, then on that phone choose <b>Settings → Linked Devices → Link with phone number</b> and type the code shown.',
  'When it works you see a green tick and the badge turns <b>Linked</b>. Any message that was waiting is sent within a minute. The page then offers <b>Import your contacts</b> and <b>Open campaigns</b>.'
])}
${tip('If the QR or code expires, nothing was connected. Press <b>Try again</b> for a fresh one.')}
<h3>Reading a number’s card</h3>
${table(['You see', 'It means'], [
  ['<b>Linked / Linking… / Not linked</b>', 'Whether the CRM is connected to that number right now.'],
  ['<b>Healthy / Degraded / Quarantined</b>', 'How safe the number looks to WhatsApp. Degraded sends slower. Quarantined holds sending until it recovers.'],
  ['<b>Risk N/100</b>', 'Green under 30, amber 30 to 59, red 60 or more. It rises when messages fail or are not replied to.'],
  ['<b>Delivery, Sent · 24h, Failed · 24h</b>', 'How the last day went.'],
  ['<b>Contacts: N replied · N no reply</b>', 'People who answer protect the number. A number that only sends and never gets replies looks like spam.'],
  ['<b>Cooling off after…</b>', 'WhatsApp pushed back (for example a rate limit). Sending pauses, then ramps back up.'],
  ['<b>WhatsApp may be limiting this number</b>', 'Delivery slowed or stuck. Sending is slowed. It clears itself if delivery recovers.'],
  ['<b>This number looks restricted by WhatsApp</b>', 'Messages are not being delivered. Its campaigns are paused. Do not push more through it.'],
  ['<b>WhatsApp refused / logged this number out</b>', 'Open WhatsApp on that phone and look for a ban notice. If there is one, stop and do not relink. If not, someone unlinked the device: link once more.']
])}
<h3>Unlinking</h3>
<p><b>Unlink / reset this number</b> logs it out and clears the stored sign-in, so linking again shows a fresh QR. Conversations stay in the
inbox under <b>Previously linked numbers</b>.</p>
<h3>Advisory mode ${admin}</h3>
${care('Under <b>Advisory mode…</b> an admin can turn anti-ban enforcement <b>off</b> for one number (a written reason is required). This is for throwaway test numbers only: a ban is permanent. Do-not-contact is never relaxed, even then.')}
`);

chapter('Importing contacts', `
<p>The import wizard takes a CSV or Excel (.xlsx) sheet and turns it into contacts. It works in three steps: <b>Upload</b>,
<b>Match columns</b>, <b>Review &amp; import</b>.</p>
<h3>Step 1 · Upload</h3>
${fig('07-import-upload', 'Step 1: drop a file or click to choose one.')}
<p>Drop your file on the box, or click it to choose one. It uploads straight away; there is no Upload button.</p>
<ul>
<li>Your sheet needs a <b>header row</b> on top and at least one person underneath.</li>
<li>The <b>same file cannot be imported twice</b>. If you upload identical bytes again you are told so, and an <b>Upload anyway</b> button
lets you start a fresh import (people already in the CRM are matched by phone or email and updated, not duplicated).</li>
</ul>
<h3>Step 2 · Match columns</h3>
${fig('08-import-match', 'Step 2: tell the CRM what each column is.')}
${markers([
  [1, '<b>Which columns hold phone numbers?</b> Tick every column that has a number. If a person has more than one, they are tried in the order shown. Use <b>Another column holds numbers…</b> to add more. Numbers with no country code are read as Indian numbers.'],
  [2, '<b>Name and email.</b> Pick the column for the name (or join a first-name and a last-name column) and, optionally, the email.'],
  [3, '<b>Select the columns to be stored.</b> Tick the extra columns you want kept on each person (up to 40). Unticked columns are not stored. Columns that look personal (date of birth, salary, Aadhaar, PAN, address, gender and so on) are marked <i>personal</i> and are <b>never stored</b> while "Never store columns marked personal" stays ticked.'],
  [4, '<b>Preview</b>: a dry run. Nothing is written.'],
  [5, '<b>Import</b>: does it for real.'],
  [6, '<b>Start over</b>: clears everything back to the file box.']
])}
<p>The phone column is the only required one: someone you cannot reach by number is not a contact. The CRM also guesses the phone column from the
values, so it is usually already ticked.</p>
<p>The <b>Tag everyone in this file</b> box is filled with the file’s name. Keep it (every imported person gets that tag, which makes them
easy to find later) or clear it to skip tagging.</p>
<h3>Step 3 · Preview, then import</h3>
${fig('09-import-preview', 'Preview: counts of what would happen, with nothing saved yet.')}
${steps([
  'Press <b>Preview</b>. You see: "N read · N contacts would be created · N updated · N errors".',
  'If a row has a bad number you get a <b>Rows to fix</b> box. Those rows are left out of the import. Press <b>Download these rows (CSV)</b>, fix them in your sheet and upload again.',
  'Press <b>Import</b>. You see "✓ Imported".',
  'Choose what next: <b>View the N imported contacts</b> or <b>Message these people</b> (starts a campaign for exactly this import).'
])}
${tip('Pressing <b>Import</b> before <b>Preview</b> shows a red note under the buttons asking you to preview first. If you leave the page halfway and come back, the wizard remembers where you were; once an import has finished, coming back starts fresh.')}
`);

chapter('Contacts: your contact book', `
${fig('06-contacts', 'The Contacts page.')}
${markers([
  [1, '<b>Search</b> by name, phone or email, then press <b>Search</b>.'],
  [2, '<b>Tag:</b> chips. Click one to show only people with that tag (the small number is how many).'],
  [3, '<b>Tag many at once</b>.'],
  [4, '<b>Campaign from checked contacts</b>.'],
  [5, '<b>Import contacts</b>.']
])}
<p>The list shows the first 50 matches. Use search, tags and the <b>Dates and order</b> section to narrow it
(by when people were added or last imported, and newest, oldest or A–Z).</p>
<h3>Opening a person</h3>
<p>Click a row to open it. You can see when they were added and last imported, add or remove tags (<b>+ tag…</b> then <b>Add</b>),
edit custom fields (<b>Save fields</b>) and mark the person <b>Do not contact</b> (<b>Allow contact</b> reverses it).</p>
${care('<b>Do not contact</b> means: never message this person. Replies and campaigns skip them. Use it for anyone who asks to stop. Only an admin can knowingly override it for one message or one campaign, with a written reason that is saved.')}
<h3>Tags</h3>
<p>A tag is a label such as "pune" or "interview-stage". Add one person at a time by opening their row, add many people at once with
<b>Tag many at once</b> (choose <b>Add tag</b> or <b>Remove tag</b>, pick the tag and who it applies to, press <b>Preview</b>, then <b>Confirm</b>),
or create a new tag in <b>New tag</b>. Tags are how you pick campaign audiences, so tag people as you go.</p>
<h3>Custom fields</h3>
<p><b>Custom fields</b> are extra columns of your own (text, number, date or a pick-list), for example "City". ${admin} Admins add and remove them.
Anything you add can be used in a campaign as <code>{{city}}</code>.</p>
<h3>Making a campaign from people you ticked</h3>
<p>Tick people in the list, open <b>Campaign from checked contacts</b>, type a name and message, choose the number and press
<b>Create draft from checked</b>. People marked do-not-contact cannot be ticked.</p>
<h3>Exporting ${admin}</h3>
<p>Admins see <b>Export CSV</b> and <b>Export vCard</b>. Every export is recorded.</p>
`);

chapter('Inbox: answering customers', `
${fig('03-inbox', 'The inbox list.')}
${markers([
  [1, 'Assignee filter: <b>Mine</b> (chats assigned to you or where you were added), <b>Unassigned</b>, <b>All</b>.'],
  [2, 'Status filter: <b>Open</b> (the default), <b>Closed</b>, <b>Any</b>.'],
  [3, 'A conversation. Click it to open.']
])}
<p>Each row shows the person, the last activity time, an unread count, how many messages, which of your numbers it is on, who owns it
(or <i>Unassigned</i>), a <b>closed</b> badge, and a red <b>⚠</b> if a message in it is waiting to be sent. The list refreshes itself every few seconds.</p>
<h3>Inside a conversation</h3>
${fig('04-thread', 'An open conversation.')}
${markers([
  [1, '<b>Assignee</b>: who owns this chat. Choose a person (or the AI assistant) to hand it over.'],
  [2, '<b>Resolve</b>: closes the chat (it leaves the Open list). It becomes <b>Reopen</b> on a closed chat.'],
  [3, '<b>Add person…</b> ' + admin + ': add an extra person who may reply and sees the chat under "Mine".'],
  [4, '<b>Reply</b>: the message goes to the customer.'],
  [5, '<b>Note</b>: an internal note only your team sees.']
])}
<p>The right-hand panel shows the contact, who it is assigned to, its status and the number of messages, with <b>Open in Contacts</b>.</p>
<h3>Replying</h3>
${steps([
  'Type in the box and press <b>Send</b> (or press Enter; Shift+Enter makes a new line).',
  'The 📎 button attaches a file (image, video, audio, PDF or Office document). It sends as soon as you choose it, and anything typed becomes its caption.',
  'If your organisation has <b>saved replies</b>, a <b>Saved reply…</b> dropdown inserts one; <code>{{name}}</code> becomes the person’s name.',
  'Watch the little status under each message: sent, delivered, read or failed.'
])}
<h3>Internal notes</h3>
${fig('05-note', 'Writing an internal note. Nothing here is sent to the customer.')}
<p>Press <b>Note</b>, type, and press <b>Add note</b>. Notes appear in the thread, centred and marked "internal, not sent". Use them to
hand a chat over ("asked about night shifts, call back after 4pm").</p>
<h3>Chat ownership: assigning, resolving, adding people</h3>
<ul>
<li><b>Assign</b> a chat to yourself to take it, or to a colleague to hand it on. If you assign it to the <b>AI assistant</b>, the assistant answers (see the AI chapter).</li>
<li>A chat owned by another agent is <b>locked</b> to you: you can read it and add notes, but Reply is disabled until it is reassigned to you.
Admins and people added to the chat are never locked.</li>
<li><b>Resolve</b> when the conversation is finished; <b>Reopen</b> if it picks up again.</li>
</ul>
<h3>Warnings you may meet in a chat</h3>
${table(['You see', 'What it means and what to do'], [
  ['<b>"Someone else is on this chat. Send anyway?"</b>', 'A colleague is typing or just replied. Press <b>Wait</b> to avoid answering twice, or <b>Send anyway</b>.'],
  ['<b>⚠ waiting: pacing — spacing sends to protect the number</b>', 'The number is pacing itself. Nothing to do; it sends on its own.'],
  ['<b>⚠ waiting: the number is quarantined / cooling off / isn’t connected</b>', 'The number needs attention. See <b>Linked numbers</b>. A message waits safely until it can go.'],
  ['<b>⚠ waiting: it’s night where they are</b>', 'It will go in their morning.'],
  ['<b>This contact is marked do not contact</b>', 'Replies are blocked. You can still add a note. ' + admin + ' An admin can tick <b>Send anyway (override do-not-contact)</b> and give a reason.'],
  ['<b>sent · no delivery for 30m</b>', 'WhatsApp has not confirmed delivery. The person may be offline.'],
  ['<b>attachment could not be fetched</b>', 'The file expired on WhatsApp’s side. Ask them to send it again.']
])}
`);

chapter('Campaigns: sending to many people', `
<p>A campaign sends one message to everyone in an audience. It is never instant: the CRM sends at a safe pace and tells you how long it will take.</p>
${fig('11-campaigns', 'The Campaigns list: Sending now, Drafts and Finished.')}
<p>Campaigns are grouped as <b>Sending now</b> (running or paused), <b>Drafts</b> and <b>Finished</b>. <b>Saved audiences</b> (top right) manages reusable audiences,
and <b>How sending is paced</b> explains the protections.</p>
<h3>Creating a campaign</h3>
${fig('12-campaign-new', 'The new campaign form.')}
${markers([
  [1, '<b>Write with AI</b> (appears when the AI assistant is on): describe the goal and the text lands in the message box for you to edit.'],
  [2, '<b>Name</b>: for you, not sent to anyone.'],
  [3, '<b>Message</b>: what each person receives.'],
  [4, 'Audience: <b>A tag</b>, <b>An import</b>, <b>A saved audience</b>…'],
  [5, '…or <b>Build a filter</b> on the spot.']
])}
${steps([
  '<b>Write the message.</b> Use <code>{{name}}</code> for the person’s name and <code>{Hi|Hey|Hello}</code> to vary wording: each person gets a slightly different message, which is safer than hundreds of identical ones. Custom fields work too, as <code>{{city}}</code>.',
  '<b>Choose who gets it.</b> Pick exactly one: a tag, an import, a saved audience, or a filter you build (has tag, reply status, "messaged in the last N days"; a live count shows "N people match right now"). The audience freezes the moment you start, so later changes never alter a running campaign. People marked do-not-contact are always left out.',
  '<b>Send from.</b> Choose the number.',
  'Press <b>Create draft</b>. Nothing is sent yet.'
])}
<h3>Checking and starting</h3>
${fig('13-campaign-detail', 'A draft campaign: the dry run and the Start button.')}
<p>A draft shows a <b>dry run</b>: "Would message N people · N skipped (no number) · N in the audience", and a <b>forecast</b>, for example "About 3 days to finish at 40/day (number still warming up, so the daily cap is low)". New numbers send few messages a day on purpose and build up over time.</p>
${steps([
  'Read the message and the numbers. If nobody is reachable, the page says so: check the tag.',
  'Press <b>Start</b>. The audience is frozen and sending begins at the safe pace.',
  'Watch progress: "N of M done" with tiles for <b>Total, Sent, Queued, Pending, Skipped, Failed</b>. Click a tile to filter the recipient list.',
  '<b>Pause</b> stops sending at once; <b>Resume</b> continues. <b>Cancel</b> ends it for good (people not yet reached are marked skipped).'
])}
<h3>Why someone was skipped</h3>
<p>Every skipped person is listed with a reason; nobody is dropped silently.</p>
${table(['Reason', 'Meaning'], [
  ['marked do-not-contact', 'They asked not to be messaged.'],
  ['no phone number', 'The contact has no number.'],
  ['an agent is mid-conversation', 'A colleague is chatting with them right now.'],
  ['sent a campaign within 14 days', 'They were messaged recently.'],
  ['in another live campaign', 'They are already waiting in a running campaign.'],
  ['campaign cancelled', 'The campaign was cancelled before their turn.']
])}
<h3>Automatic pauses</h3>
<p>A campaign pauses itself if WhatsApp seems to be limiting the number, or has refused or logged the number out. Open <b>Linked numbers</b> before resuming anything.</p>
<h3>Start with overrides ${admin}</h3>
${care('An admin can start a campaign <b>lifting</b> some people-protection gates (do-not-contact, an agent mid-conversation, the 14-day cooldown, a duplicate campaign) with a written reason of at least 10 characters. The daily limits, pacing and warm-up still apply and cannot be lifted by anyone. Messaging people who asked you to stop is the quickest way to get a number reported and banned.')}
<h3>Saved audiences</h3>
<p>Under <b>Campaigns → Saved audiences</b> you can name a filter once and reuse it. Fill in the name, choose <b>Has tag</b>, <b>Reply status</b> and <b>Contacted within (days)</b> (all conditions must match; "any" drops a condition), press <b>Preview count</b>, then <b>Save segment</b>. A saved audience is re-evaluated each time and freezes when a campaign starts.</p>
`);

chapter('Team', `
<p>${admin} The <b>Team</b> page is where admins add people and decide what they can do.</p>
${fig('14-team', 'The Team page.')}
${steps([
  'Press <b>Add a person</b>. Fill in <b>Name</b>, <b>Email</b> and <b>Role</b> (Agent works in the inbox; Admin manages everything including the team).',
  'A strong password is suggested. Use <b>Generate another</b> for a different one.',
  'Press <b>Add person</b>. A green box shows the email and password <b>once</b>. Copy them and send them to the person privately.'
])}
<ul>
<li>Change someone’s role from the dropdown on their row.</li>
<li><b>Reset password</b> sets a new one and signs that person out everywhere.</li>
<li><b>Disable</b> takes access away at once (<b>Enable</b> brings it back). You cannot disable yourself, and there must always be at least one active admin.</li>
<li>The <b>AI assistant</b> appears in the list with an AI badge. It is managed on its own page, not here.</li>
</ul>
`);

chapter('The AI assistant', `
<p>The AI assistant is a <b>member of your team that is a program</b>. It has its own name ("AI assistant"), can own a conversation like a person, and everything it does is recorded in the audit log under its name. It does three things: answers chats you give it; runs campaigns when you tell it to; and messages one person when you ask. It is <b>off until an admin switches it on</b>.</p>
${care('It writes in your name, on your number, and it can be wrong. Read what it sends, especially at first, and keep its instructions narrow.')}
${fig('15-ai', 'The AI assistant page (admins only).')}
${markers([
  [1, 'Type what you want it to do.'],
  [2, 'The <b>queue</b>: what is waiting, running and done.'],
  [3, '<b>Cancel</b> a request that has not started.'],
  [4, 'The consent box.'],
  [5, 'The on/off switch.'],
  [6, 'What it may talk about.'],
  [7, 'Whether it may start campaigns by itself.']
])}
<h3>Switching it on ${admin}</h3>
${steps([
  '<b>Tick the consent box.</b> To write a reply, the assistant sends the conversation (including the contact’s name and what they wrote) to an outside AI company. Only agree if your contacts have been told. Your choice is saved with the date.',
  'Tick <b>AI assistant is on</b>.',
  'Write what it <b>may talk about</b>, like a note to a new colleague: "You answer WhatsApp questions for Hiring Studios about openings, interview times and documents. Keep replies to one or two short, polite sentences. If unsure, or the person asks for a human, hand over."',
  'Set <b>Most messages it may send in a day</b> (default 200).',
  'Leave <b>The assistant may start and resume campaigns by itself</b> <b>off</b> until you trust it. Off means it prepares a campaign and you press Start.',
  'Press <b>Save</b>.'
])}
<h3>Handing a chat to the assistant, and taking it back</h3>
<ul>
<li>In a conversation, set <b>Assignee</b> to <b>AI assistant</b>. When the customer writes, it replies.</li>
<li>Set Assignee to a person to <b>take over</b>. It stops at once, and a reply it was still writing is thrown away.</li>
<li><b>Resolve</b> also stops it, because it only answers <b>open</b> chats.</li>
<li>If it cannot help, it gives the chat back by itself: the chat becomes <b>Unassigned</b> with a note saying why. Check <b>Unassigned</b> now and then.</li>
</ul>
<p>It reads plain text only. If someone sends a photo, a voice note or a file, it replies once, "I can only read text messages here, so could you type that out for me?", and does not repeat it. It stays within its daily limit and <b>never</b> messages someone marked do-not-contact.</p>
<p><b>It leads the conversation.</b> If your instructions describe a goal (for example: "find out their name, city, years of driving and when they can start"), it answers what the person asks and then asks the next question toward that goal, one at a time. When the goal is done, or the person asks for a human, it hands the chat back with a summary in the note.</p>
${care('<b>It has no fact-checking yet.</b> If the instructions do not say something (pay, documents, requirements), it may still answer, and it can be wrong. Put the real facts in its instructions, and keep it to test chats until guardrails are added.')}
${care('<b>Not built yet:</b> if a customer writes STOP or "unsubscribe", the assistant does not mark them do-not-contact automatically. A person has to flag them. Keep an eye on chats you hand over.')}
<h3>Telling it what to do</h3>
<p>Type plain sentences in the box on the AI page, for example: <i>"Send the Friday interview reminder to everyone tagged pune."</i>
<i>"Message Asha Rao and ask if she can start Monday."</i> <i>"Pause the Diwali campaign."</i> <i>"Change the wording of the walk-in campaign to mention parking."</i></p>
${table(['You ask for', 'What happens'], [
  ['A message to a group', 'It creates a campaign for a tag or saved audience that already exists. If it is unclear which, it asks instead of guessing.'],
  ['Pause, resume or edit a campaign', 'Edit changes the name or wording, and only while the campaign is a draft or paused.'],
  ['A message to one person', 'It sends one message in the chat you already have with them, and takes over that chat so it can handle the reply.']
])}
<p><b>It will refuse (and say why):</b> starting or resuming a campaign when the switch above is off; messaging someone marked do-not-contact; messaging into a chat owned by a person; a person with no chat yet; two contacts with the same name (use the phone number); cancelling a campaign; overriding any safety limit. It does at most five things per request, each shown with a ✓ or ✗.</p>
<h3>The queue</h3>
<p>Requests run <b>one at a time, oldest first</b>.</p>
${table(['You see', 'It means'], [
  ['<b>#1 · waiting, next up</b> / <b>#3 · waiting, 2 ahead</b>', 'Not started. Its place in line.'],
  ['A spinning ring and <b>working… 12s</b>', 'Running right now.'],
  ['<b>✓ done</b>', 'Finished. Its answer and every action are shown, with links to campaigns it made.'],
  ['<b>✗ failed</b>', 'It could not finish. The reason is written under it.'],
  ['<b>— cancelled</b>', 'Cancelled before it started.']
])}
<p><b>Cancel</b> appears on every waiting request. One that has started cannot be stopped, but it can be undone from the campaign or chat. Requests stay listed for 24 hours. Up to 20 can wait at once. Admins see everyone’s; others see only their own.</p>
<p><b>Write with AI</b> on the new-campaign form uses the same queue: it shows "Waiting in the AI queue, 2 ahead of you" (with Cancel), then a spinner, then the text appears in the message box. Read and edit it; nothing is sent until you create and start the campaign.</p>
<h3>Warnings above the message box</h3>
${table(['The banner says', 'What it means and what to do'], [
  ['<b>…the anti-ban engine is spacing out sends</b>', 'The number paces itself like a human. Nothing to do. Nobody can override it.'],
  ['<b>…the number is quarantined / cooling off</b>', 'The number is resting. Wait. See Linked numbers.'],
  ['<b>…it’s night where the contact is</b>', 'It waits for their morning.'],
  ['<b>…the number isn’t connected</b>', 'Re-link it on Linked numbers.'],
  ['<b>The AI assistant reached its daily message limit</b>', 'Wait, or an admin raises the limit.'],
  ['<b>The AI assistant could not write a reply</b>', 'The AI company did not answer. A person should answer.'],
  ['<b>…did not reply: this contact is marked do-not-contact</b>', 'They asked not to be messaged. See below.']
])}
<p>${admin} For the do-not-contact banner only, an admin sees <b>Allow reply anyway (ban risk)</b>. It needs a written reason (10+ characters), allows <b>one</b> reply to their latest message and is saved in the audit log with your name. Use it only when you are sure, for example they wrote to you first and asked a question.</p>
<h3>Privacy</h3>
<ul>
<li>Contact messages go to an outside AI company when the assistant writes a reply. That is what the consent box is for. Some free plans let the provider keep or learn from what you send: check their terms before using real customer chats.</li>
<li>The assistant sees the recent messages of the chat it is answering and, for instructions, only the <b>names</b> of your tags, audiences, numbers and campaigns, never your contacts’ details.</li>
<li>Turn it off any time: untick <b>AI assistant is on</b> and save.</li>
</ul>
`);

chapter('Security: encryption keys', `
<p>Messages and WhatsApp sign-ins are stored encrypted. The <b>Security</b> page (admin content) lets an admin change the key that protects them without downtime and without losing anything.</p>
${fig('16-security', 'The Security page: encryption keys.')}
<p>You only need this when you want to <b>rotate</b> the key (for example on a schedule, or if you think it leaked). The page shows the current key version and walks through five steps: make a new key; put it in the server settings and restart; re-encrypt the existing data (a progress bar, with pause and resume); verify that the new key opens everything; retire the old key. Steps 2 and 5 are done on the server by whoever runs it. <b>Back up the current key first</b>: without it, stored data cannot be read.</p>
`);

chapter('Safety rules in plain words', `
<p>These protect your numbers. They are not bugs and mostly cannot be switched off.</p>
${table(['Rule', 'Why it exists'], [
  ['<b>Sending is paced</b>', 'A human types one message at a time. The CRM spaces messages out, adds small random gaps, slows down at night and "types" before sending.'],
  ['<b>New numbers start slowly</b>', 'A brand-new number that suddenly sends hundreds of messages is the classic ban pattern. The daily allowance grows with time and with replies received.'],
  ['<b>Daily and hourly limits</b>', 'A ceiling per number. Nobody, including admins, can raise it.'],
  ['<b>Messages vary</b>', 'Hundreds of identical messages look like spam. Use <code>{{name}}</code> and <code>{option|option}</code> in campaigns.'],
  ['<b>Do-not-contact</b>', 'Being reported is the fastest route to a ban. People who asked to stop are never messaged. Only an admin can knowingly override it, per message or per campaign, with a reason.'],
  ['<b>Mid-conversation and cooldown protection</b>', 'Campaigns skip people a colleague is talking to, and people messaged in the last 14 days.'],
  ['<b>Health scoring</b>', 'The CRM watches delivery and replies for each number, slows or quarantines a number that looks risky, and pauses its campaigns if WhatsApp pushes back.'],
  ['<b>Everything is recorded</b>', 'Overrides, assignments, imports, exports and what the AI did are saved in an audit log with who did them.']
])}
${tip('The best protection is a number that people reply to. Message people who expect to hear from you, and answer replies promptly.')}
`);

chapter('Troubleshooting and common questions', `
${table(['Problem', 'What to try'], [
  ['I cannot sign in', 'Check the email (not your name). Ask an admin to reset your password on the Team page. The message "Email or password is wrong" is the same whether the email exists or not, on purpose.'],
  ['"Could not reach the API"', 'The server is not running or not reachable. Tell whoever runs it.'],
  ['My message is stuck on "⚠ waiting"', 'Read the reason after "waiting:". Pacing and night hours clear themselves. "The number isn’t connected" means re-link it on Linked numbers.'],
  ['I cannot reply: the box is greyed out', 'Either the chat is assigned to someone else (reassign it to yourself or ask an admin), the number is not connected, or the contact is do-not-contact. The notice above the box says which.'],
  ['Import says "no rows to import"', 'The sheet needs a header row and at least one person under it.'],
  ['Import says the file was already imported', 'The same file cannot be imported twice. Change something in it, or press <b>Upload anyway</b> if you really want to run it again.'],
  ['Some rows were left out of the import', 'Open <b>Rows to fix</b>, download them, correct the numbers in your sheet and import again.'],
  ['A campaign skipped many people', 'Open the campaign and filter by <b>Skipped</b>. Each person has a reason.'],
  ['A campaign paused by itself', 'WhatsApp may be limiting the number. Open <b>Linked numbers</b>, read the banner, and do not resume until it is clear.'],
  ['Pressing Start, Pause or Cancel seems to do nothing', 'Reload the page and look at the status. (Failures on these buttons are not shown yet.)'],
  ['The AI request failed: "took too long"', 'The AI company is slow. Send it again. If it keeps happening, tell whoever runs the server.'],
  ['The AI did not answer a customer', 'Is the chat <b>open</b> and <b>assigned to the AI assistant</b>? Is it a text message? Is there a banner above the message box?'],
  ['A page is slow to open the first time', 'Normal in a development setup; ask whoever runs the server about the fast mode.']
])}
`);

chapter('Glossary', `
${table(['Word', 'Meaning'], [
  ['<b>Agent / Admin</b>', 'The two roles. Admins can do everything; agents work in the inbox and campaigns.'],
  ['<b>Assignee</b>', 'The person (or the AI assistant) who owns a conversation.'],
  ['<b>Participant</b>', 'An extra person added to a chat who may reply but does not own it.'],
  ['<b>Audience</b>', 'The group of people a campaign goes to: a tag, an import, a saved audience or a filter.'],
  ['<b>Audit log</b>', 'A permanent record of who did what and when.'],
  ['<b>Campaign</b>', 'One message sent to many people, paced for safety.'],
  ['<b>Cooldown</b>', 'People messaged by a campaign in the last 14 days are skipped by a new one.'],
  ['<b>Custom field</b>', 'An extra column of your own on each contact, usable in messages as <code>{{field}}</code>.'],
  ['<b>Do not contact</b>', 'A flag meaning never message this person.'],
  ['<b>Draft</b>', 'A campaign that has been created but not started. Nothing is sent.'],
  ['<b>Gate</b>', 'A safety check a message must pass before it is sent.'],
  ['<b>Linked number</b>', 'A WhatsApp number connected to the CRM so it can send and receive.'],
  ['<b>Pacing</b>', 'Spacing messages out over time like a person would.'],
  ['<b>Queue (AI)</b>', 'The waiting list of requests to the AI assistant, run one at a time.'],
  ['<b>Quarantined</b>', 'A number the CRM has paused because it looks risky.'],
  ['<b>Saved audience (segment)</b>', 'A filter you name and reuse.'],
  ['<b>Spintax</b>', 'The <code>{Hi|Hey|Hello}</code> notation that makes each person get slightly different wording.'],
  ['<b>Tag</b>', 'A label on a contact such as "pune".'],
  ['<b>Warm-up</b>', 'The slow start of a new number: a low daily allowance that grows with time.']
])}
`);

const css = `
@page { size: A4; margin: 18mm 17mm 20mm; }
* { box-sizing: border-box; }
body { font: 10.5pt/1.55 "Inter","Helvetica Neue",Arial,"Liberation Sans",sans-serif; color: #1f2937; margin: 0; }
h1 { font-size: 24pt; margin: 0 0 4mm; color: #0f172a; page-break-before: always; padding-bottom: 3mm; border-bottom: 3px solid #16a34a; }
h2 { font-size: 15pt; margin: 8mm 0 3mm; color: #0f172a; }
h3 { font-size: 12pt; margin: 6mm 0 2mm; color: #15803d; page-break-after: avoid; }
p { margin: 0 0 3mm; }
ul, ol { margin: 0 0 3mm; padding-left: 6mm; } li { margin-bottom: 1.5mm; }
code { background: #ecfdf5; border: 1px solid #bbf7d0; border-radius: 3px; padding: 0 3px; font: 9.5pt "DejaVu Sans Mono", monospace; }
figure { margin: 4mm 0; page-break-inside: avoid; text-align: center; }
figure img { max-width: 100%; max-height: 150mm; border: 1px solid #d1d5db; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,.12); }
figcaption { font-size: 9pt; color: #6b7280; margin-top: 2mm; }
table { width: 100%; border-collapse: collapse; margin: 3mm 0 5mm; font-size: 9.5pt; page-break-inside: auto; }
th { background: #f0fdf4; text-align: left; padding: 2mm 3mm; border: 1px solid #d1d5db; }
td { padding: 2mm 3mm; border: 1px solid #e5e7eb; vertical-align: top; }
tr { page-break-inside: avoid; }
.box { border-radius: 6px; padding: 3mm 4mm; margin: 4mm 0; page-break-inside: avoid; }
.tip { background: #eff6ff; border-left: 4px solid #3b82f6; }
.care { background: #fef2f2; border-left: 4px solid #dc2626; }
.tag { display: inline-block; background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; border-radius: 9px; padding: 0 6px; font-size: 8pt; font-weight: 700; vertical-align: 1px; }
ol.markers { list-style: none; padding: 0; margin: 2mm 0 4mm; }
ol.markers li { counter-increment: none; position: relative; padding-left: 9mm; min-height: 6mm; }
ol.markers li::before { content: attr(value); position: absolute; left: 0; top: 0; width: 5.5mm; height: 5.5mm; border-radius: 50%; background: #dc2626; color: #fff; font-weight: 700; font-size: 8pt; line-height: 5.5mm; text-align: center; }
ol.steps { counter-reset: s; list-style: none; padding-left: 0; }
ol.steps li { counter-increment: s; position: relative; padding-left: 9mm; }
ol.steps li::before { content: counter(s); position: absolute; left: 0; top: 0; width: 5.5mm; height: 5.5mm; border-radius: 50%; background: #16a34a; color: #fff; font-weight: 700; font-size: 8pt; line-height: 5.5mm; text-align: center; }
.cover { height: 235mm; display: flex; flex-direction: column; justify-content: center; page-break-after: always; }
.cover .logo { width: 18mm; height: 18mm; border-radius: 50%; background: #16a34a; color: #fff; font-size: 26pt; font-weight: 800; text-align: center; line-height: 18mm; margin-bottom: 10mm; }
.cover h1 { font-size: 34pt; border: 0; page-break-before: auto; margin: 0; }
.cover .sub { font-size: 15pt; color: #4b5563; margin: 4mm 0 12mm; }
.cover .meta { color: #6b7280; font-size: 10pt; }
.toc { page-break-after: always; } .toc h2 { margin-top: 0; }
.toc ol { list-style: none; padding: 0; font-size: 12pt; } .toc li { margin: 2mm 0; }
.toc a { color: #0f172a; text-decoration: none; } .toc .n { color: #16a34a; font-weight: 800; display: inline-block; width: 9mm; }
`;

const toc = chapters.map(([id, title], i) => `<li><span class="n">${i + 1}</span><a href="#${id}">${title}</a></li>`).join('');
const body = chapters.map(([id, title, html], i) => `<h1 id="${id}">${i + 1} · ${title}</h1>${html}`).join('');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>WhatsApp CRM: user tutorial</title><style>${css}</style></head><body>
<div class="cover"><div class="logo">W</div><h1>WhatsApp CRM</h1><div class="sub">A walkthrough of the whole platform, and how to use it</div>
<div class="meta">User tutorial · ${builtOn}<br>Every screen in this guide shows invented people and numbers.</div></div>
<div class="toc"><h2>Contents</h2><ol>${toc}</ol>
<p style="margin-top:12mm;color:#6b7280">Things only admins can do are marked <span class="tag">Admin</span>. Red numbered circles on a picture match the numbered list beneath it.</p></div>
${body}</body></html>`;

mkdirSync(dirname(outPdf), { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'load' });
await page.pdf({
  path: outPdf, format: 'A4', printBackground: true, outline: true, tagged: true,
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: '<div style="width:100%;font:8px sans-serif;color:#6b7280;padding:0 17mm;display:flex;justify-content:space-between"><span>WhatsApp CRM · user tutorial</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>',
  margin: { top: '18mm', bottom: '20mm', left: '17mm', right: '17mm' }
});
await browser.close();
process.stdout.write(`wrote ${outPdf}\n`);
