# 21 · Deferred decisions

Things deliberately **not** decided yet, each with the condition that should bring it back.

A parked decision is not a forgotten one. The point of this file is that nobody has to
re-derive the reasoning, and nobody revisits something before the thing that would change the
answer has actually happened.

Format: what · why parked · **what brings it back** · what it would cost to do later.

**Marks.** ✅ = built (fully or as the slice that was scoped). ~~Struck out~~ = not needed in this
repository: it belongs to the other project or to its own module (Kushal, 2026-10-10), kept only so it
is not re-proposed.

---

## Status at a glance (updated 2026-10-23)

✅ done · ◐ partly built · ▶ working on it · 🔺 priority · ⏸ parked (not working on it for now) · 📌 pinned (not started)

**Click a pin number to jump to it.** Done: 16 of 114 (the ✅ rows).

| Pin | What | Status |
|---|---|---|
| [D-1](#d-1--a-lightweight-database-browser-drizzle-studio-or-similar) | A lightweight database browser (Drizzle Studio or similar) | 📌 pinned |
| [D-1b](#d-1b--drizzles-query-builder-as-opposed-to-drizzle-itself) | Drizzle's query builder (as opposed to Drizzle itself) | 📌 pinned |
| [D-3](#d-3--licence) | Licence | 📌 pinned |
| [D-4](#d-4--the-ai-agent-f12---built-2026-10-21-kushals-ai-speedrun-guardrails-left-for-d-81) | The AI agent (F12) | ✅ built 2026-10-21 (settings, auto-reply, campaign tools, queue); its guardrails are D-81 |
| [D-5](#d-5--baileys-7x) | Baileys 7.x | ◐ on 7.0.0-rc14 since 2026-10-23 (#161) · 📌 stable 7.0.0 still awaited |
| [D-6](#d-6--uuidv7-primary-keys) | UUIDv7 primary keys | 📌 pinned |
| [D-7](#d-7--turborepo-and-splitting-the-queue-driver) | Turborepo, and splitting the queue driver | 📌 pinned |
| [D-8](#d-8--self-serve-setup-wizard-guided-walkthrough-whitelabelling--parked-kushal-2026-10-20-not-working-on-this-for-now) | Self-serve setup wizard, guided walkthrough, whitelabelling | ◐ partly built (what-next buttons) · ⏸ parked |
| [D-9](#d-9--generating-env-and-a-secrets-driver---ai-settings-tab-built-2026-10-22-was-kushals-priority) | Generating `.env`, and a secrets driver; **first an "AI settings" sub-tab in the AI tab (provider, key, model, test)** | ✅ AI settings tab built 2026-10-22 · 📌 the rest pinned |
| [D-10](#d-10--what-belongs-in-the-inbox--broadcast-output-and-unknown-senders) | What belongs in the inbox — broadcast output, and unknown senders | 📌 pinned |
| [D-11](#d-11--media-at-rest--encryption-retention-scanning-compliance---serving-built-the-rest-parked) | Media at rest — encryption, retention, scanning, compliance | ◐ partly built (serving; rest parked) |
| [D-13](#d-13--access-auditing--who-read-what---landed) | Access auditing — who *read* what | ✅ done |
| [D-14](#d-14--the-linked-number-receives-nothing--bad-mac-on-every-inbound---closed-2026-09-28) | The linked number receives nothing — `Bad MAC` on every inbound | ✅ done |
| [D-15](#d-15--a-documentation-site) | A documentation site | 📌 pinned |
| [D-17](#d-17--presence-typing-indicators-and-collision-detection-f3-realtime---built-viewing-pr-28-2026-10-12-typing-and-the-send-anyway-warning-d-54-pr-32-2026-10-13) | Presence, typing indicators and collision detection (F3 realtime) | ✅ done |
| [D-18](#d-18---meta-inbox-niceties-snooze-the-meta-24-hour-window-ui-keyboard-shortcuts) | 🔵 **META** Inbox niceties: snooze, the Meta 24-hour window UI, ~~keyboard shortcu | 📌 pinned |
| [D-19](#d-19---meta-rich-message-templates--user-managed-meta-aligned-with-media-and-import--deferred-priority-withdrawn-2026-10-16) | 🔵 **META** Rich message templates — user-managed, Meta-aligned, with media and im | 📌 pinned |
| [D-20](#d-20--sqlite-support-for-single-machine-deployments) | SQLite support for single-machine deployments | 📌 pinned |
| [D-21](#d-21--the-full-import-mapping-wizard--work-on-now-kushal-2026-10-20) | The full import mapping wizard | ▶ working on it · ◐ partly built (columns step, several phones, joined names; PR #83) |
| [D-22](#d-22--row-level-de-duplication-with-a-diff-style-review) | Row-level de-duplication with a diff-style review | 📌 pinned |
| [D-23](#d-23--inbox-search-f3-ac-7--pinned-research-later-kushal-2026-10-20) | Inbox search (F3 AC-7) | 📌 pinned |
| [D-24](#d-24--typing-simulation-p6-anti-ban-layer-3---landed-2026-09-29) | Typing simulation (P6 anti-ban layer 3) | ✅ done |
| [D-25](#d-25--outbound-media-sending-files---landed-2026-10-05) | Outbound media (sending files) | ✅ done |
| [D-26](#d-26--campaign-body-variation-spintax--per-recipient---landed-both-halves) | Campaign body variation (spintax + per-recipient) | ✅ done |
| [D-27](#d-27--opt-out-keyword-handling-stop--unsubscribe--out-of-alpha-scope-kushal-2026-10-06) | Opt-out keyword handling (STOP / unsubscribe) | 📌 pinned |
| [D-28](#d-28--dynamic-audience-segments-segregation---minimal-slice-landed-2026-09-30) | Dynamic audience segments ("segregation") | ◐ partly built (minimal slice) |
| [D-29](#d-29--an-anti-ban-advisory-mode--warn-but-do-not-enforce---built-2026-10-06) | An anti-ban "advisory mode" — warn but do not enforce | ✅ done |
| [D-30](#d-30--media-that-fails-to-store-is-invisible-to-the-operator) | Media that fails to store is invisible to the operator | ◐ partly built (reasons recorded; manual retry missing) |
| [D-31](#d-31--per-org-encryption-keys-the-dekkek-design-and-key-rotation---rotation-built-2026-10-13-per-org-keys-still-pinned-was-priority-kushal-2026-10-06) | Per-org encryption keys (the DEK/KEK design), and key rotation | ◐ partly built (key rotation) |
| [D-32](#d-32--encrypting-contact-identifiers-phone-numbers-and-emails) | Encrypting contact identifiers (phone numbers and emails) | 📌 pinned |
| [D-33](#d-33--p1-close-out-and-deployment) | P1 close-out and deployment | 📌 pinned |
| [D-34](#d-34---meta-the-meta-cloud-api-adapter-p8-and-the-real-number-pilot) | 🔵 **META** The Meta Cloud API adapter (P8) and the real-number pilot | 📌 pinned |
| [D-35](#d-35--contact-export-to-excel-xlsx---csv-and-vcard-export-built-2026-10-06-xlsx-not) | Contact export to Excel (.xlsx) | ◐ partly built (CSV and vCard; no .xlsx) |
| [D-36](#d-36--contact-import-from-a-vcard-vcf) | Contact import from a vCard (.vcf) | 📌 pinned |
| [D-37](#d-37---meta-meta-tier-and-quality-tracking-feeding-the-health-engine) | 🔵 **META** Meta tier and quality tracking, feeding the health engine | 📌 pinned |
| [D-38](#d-38---meta-meta-template-submission-approval-status-and-the-template-only-window) | 🔵 **META** Meta template submission, approval status, and the template-only windo | 📌 pinned |
| [D-39](#d-39---meta-per-transport-pacing-policy-and-the-meta-inboundstatus-webhooks) | 🔵 **META** Per-transport pacing policy and the Meta inbound/status webhooks | 📌 pinned |
| [D-40](#d-40--custom-fields-in-imports-segments-and-exports) | Custom fields in imports, segments, and exports | ◐ partly built (import into fields) |
| [D-41](#d-41--the-gateway-runs-outside-row-level-security---built-2026-10-13-was-priority-kushal-2026-10-06) | The gateway runs outside row-level security | ✅ done |
| [D-42](#d-42--human-takeover-from-an-ai-agent-inside-a-conversation---partly-built-2026-10-21) | Human takeover from an AI agent, inside a conversation | ◐ partly built: assigning the chat to a person is the takeover; no pause state |
| [D-43](#d-43--extra-restriction-alert-channels-webhook-email-canary-self-test) | Extra restriction-alert channels (webhook, email, canary self-test) | 📌 pinned |
| [D-44](#d-44--baileys-7-upgrade) | Baileys 7 upgrade: **duplicate of [D-5](#d-5--baileys-7x)** (kept for history; track it there) | ◐ on 7.0.0-rc14 since 2026-10-23 (#161) |
| [D-45](#d-45--link-a-lid-address-to-its-phone-number---built-2026-10-10-pr-6) | Link a `@lid` address to its phone number | ✅ done |
| [D-46](#d-46--ui-responsiveness--the-app-feels-laggy-when-used-fast--high-priority-kushal-2026-10-22) | UI responsiveness — the app feels laggy when used fast | 🔺 **HIGH PRIORITY** (Kushal, 2026-10-22) · 📌 pinned |
| [D-47](#d-47--signup-page-billing-gate-and-beta-tester-override--parked-kushal-2026-10-20-not-working-on-this-for-now) | Signup page, billing gate and beta-tester override | ⏸ parked |
| [D-48](#d-48--security-test-suite-owasp) | Security test suite (OWASP) | 📌 pinned |
| [D-49](#d-49--revamp-the-browser-e2e-suite-to-industry-standard-covering-every-ui-element) | Revamp the browser (e2e) suite to industry standard, covering every UI | 📌 pinned |
| [D-50](#d-50--test-the-frontend-and-backend-independently-modularity-check) | Test the frontend and backend independently (modularity check) | 📌 pinned |
| [D-51](#d-51--deleted-message-tracking) | Deleted-message tracking | 📌 pinned |
| [D-52](#d-52--deleting-previous-campaigns---priority-kushal-2026-10-23-unparked-after-mikhils-feedback-was-parked-2026-10-20) | Deleting previous campaigns (unparked after Mikhil's feedback) | 🔺 **PRIORITY** (Kushal, 2026-10-23) · 📌 pinned |
| [D-53](#d-53--assignment-model-and-message-authorship---built-authorship-pr-26-owner--participants-pr-27-2026-10-11) | Assignment model and message authorship | ✅ done |
| [D-54](#d-54--typing-indicator-and-the-just-replied-send-anyway-warning---built-2026-10-13-pr-32) | Typing indicator and the "just replied, send anyway?" warning | ✅ done |
| [D-55](#d-55--licence-enforcement-drm-usage-is-blocked-when-an-org-has-not-paid--pinned-to-be-revisited-last-kushal-2026-10-13-will-come-to-it-in-the-end--pinned-research-later-kushal-2026-10-20) | Licence enforcement ("DRM"): usage is blocked when an org has not paid | 📌 pinned |
| [D-56](#d-56--telemetry-metrics-tracing-and-error-tracking-beyond-logs--pinned-kushal-2026-10-13) | Telemetry: metrics, tracing and error tracking beyond logs | 📌 pinned |
| [D-57](#d-57--run-the-import-commit-as-a-background-job--pinned-2026-10-15) | Run the import commit as a background job | 📌 pinned |
| [D-58](#d-58--public-site-and-launch-readiness-checklist--pinned-kushal-2026-10-15) | Public site and launch-readiness checklist | 📌 pinned |
| [D-59](#d-59--file-support-in-chat-kushal-2026-10-16---priority-again-kushal-2026-10-21-files-in-campaigns-first-was-pinned-research-later-2026-10-20) | File support in chat (Kushal, 2026-10-16) | ◐ partly built: rounds 1 and 2, and **files in campaigns first slice built 2026-10-21** (one picture or GIF, 5 MB, no MP4 yet) |
| [D-60](#d-60--number-fallback-message-the-first-number-that-has-a-whatsapp-account---built-2026-10-16) | Number fallback: message the first number that has a WhatsApp account | ✅ done |
| [D-61](#d-61--lighter-web-tier-plain-react-with-refresh-buttons-instead-of-next-everywhere--pinned-kushal-2026-10-16) | Lighter web tier: plain React with refresh buttons instead of Next eve | 📌 pinned |
| [D-62](#d-62--ship-as-a-single-executable-if-possible--pinned-kushal-2026-10-16) | Ship as a single executable, if possible | 📌 pinned |
| [D-63](#d-63--centralised-file-store-s3-compatible-storage-alongside-local-smb-pinned-too---driver-built-2026-10-16-default-stays-local-kushal-2026-10-16) | Centralised file store: S3-compatible storage alongside local | ◐ partly built (S3 driver) · 📌 pinned |
| [D-64](#d-64--database-portability-move-the-database-side-logic-into-the-app-so-other-databases-can-work--pinned-kushal-2026-10-16) | Database portability: move the database-side logic into the app so oth | 📌 pinned |
| [D-65](#d-65--bugs-found-running-the-alpha-container-on-a-vm-2026-10-17-not-fixed--parked-kushal-2026-10-20-not-working-on-this-for-now) | Bugs found running the alpha container on a VM (2026-10-17), not fixed | ◐ partly fixed (1 of 8) · ⏸ parked |
| [D-66](#d-66--motion-on-most-pages-not-just-the-sign-in-screen--pinned-kushal-2026-10-17) | Motion on most pages, not just the sign-in screen | ◐ partly built (sign-in and Overview motion) |
| [D-67](#d-67--save-a-number-or-name-onto-a-lid-chat-like-add-contact-in-whatsapp--pinned-again-kushal-2026-10-21-it-was-the-priority-on-2026-10-20) | Save a number or name onto a `@lid` chat, like "add contact" in WhatsA | 📌 pinned again 2026-10-21 (was priority) · ◐ partly built (channels ignored; mapping investigated) |
| [D-68](#d-68--campaign-with-no-tagged-people-tell-the-user-to-tag-them-first---built-in-pr-56-kushal-2026-10-17) | Campaign with no tagged people: tell the user to tag them first | ✅ done |
| [D-69](#d-69--chats-available-inside-the-job-portal-and-any-other-web-app--pinned-kushal-2026-10-17) | Chats available inside the job portal (and any other web app) | 📌 pinned |
| [D-70](#d-70--contacts-page-refresh-admin-chosen-columns-tidier-layout-sort-and-search-by-date--work-on-now-kushal-2026-10-20) | Contacts page: refresh, admin-chosen columns, tidier layout, sort and  | ▶ working on it · ◐ built: tag fixes, Refresh, expandable rows, date range and order · ⏳ columns chosen by an admin is D-79 |
| [D-71](#d-71--a-big-background-picture-for-each-tab--pinned-kushal-2026-10-19) | A big background picture for each tab | 📌 pinned |
| [D-72](#d-72--mobile-friendly-ui--pinned-kushal-2026-10-20) | Mobile-friendly UI | 📌 pinned |
| [D-73](#d-73--message-these-people-right-after-an-import--pinned-kushal-2026-10-20--parked-kushal-2026-10-20-not-working-on-this-for-now) | "Message these people" right after an import | ◐ partly built (buttons) · ⏸ parked |
| [D-74](#d-74--add-number-form-country-code-dropdown-and-a-numbers-only-phone-field---built-2026-10-20) | Add-number form: country-code dropdown and a numbers-only phone field | ✅ done |
| [D-75](#d-75--number-assignment-who-each-whatsapp-number-belongs-to--pinned-kushal-2026-10-20-not-building-it-now) | Number assignment: who each WhatsApp number belongs to | 📌 pinned |
| [D-76](#d-76--notifications-tab-number-requests-and-approvals--pinned-kushal-2026-10-20) | Notifications tab, number requests and approvals (to be built on the D-114 approval system) | 📌 pinned |
| [D-77](#d-77--admin-controls-user-scopes-and-number-limits--pinned-kushal-2026-10-20) | Admin controls: user scopes and number limits | 📌 pinned |
| [D-78](#d-78--email-invitations-to-join-an-organisation-via-smtp-or-an-email-api-decide-later--pinned-kushal-2026-10-20) | Email: invitations to join an organisation, via SMTP or an email API ( | 📌 pinned |
| [D-79](#d-79--contacts-columns-chosen-by-an-admin-for-the-whole-team--pinned-kushal-2026-10-21) | Contacts: columns chosen by an admin for the whole team | 📌 pinned |
| [D-80](#d-80--create-and-edit-a-contact-page-save-an-unknown-sender-org-neutral-fields--pinned-kushal-2026-10-21) | Create and edit a contact page; save an unknown sender (org-neutral fields) | 📌 pinned |
| [D-81](#d-81--ai-assistant-guardrails--pinned-kushal-2026-10-21-it-needs-to-just-work-for-now-we-can-set-up-guardrails-later) | AI assistant guardrails (facts, opt-out words, approval mode, topics, spend) | 📌 pinned · Kushal: "later" |
| [D-82](#d-82--a-gateway-restart-can-break-the-whatsapp-session--pinned-found-2026-10-21) | A gateway restart can break the WhatsApp session (decrypt failures, nothing received) | ◐ partly built 2026-10-23 (ordered, flushed writes; visibility; see D-101) · 📌 pinned · hit 2026-10-21 |
| [D-83](#d-83--npm-run-devfast-leaves-some-screens-stale-after-an-action--pinned-found-2026-10-21) | `npm run dev:fast` (production build) leaves some screens stale after an action | 📌 pinned |
| [D-84](#d-84--the-ai-runs-whole-conversations--pinned-kushal-2026-10-21-it-should-take-over-the-entire-conversation) | The AI runs whole conversations: auto-assign new chats, follow-ups, a goal field | 📌 pinned |
| [D-85](#d-85--ai-templates-pick-a-template-fill-its-blanks-get-the-script--priority-kushal-2026-10-21-mockup-first-then-build) | AI templates: describe it, review, save, pick again; per chat, per campaign, all-chats default | 🔺 priority · ◐ built: describe, review, save, saved list, message a group · ⏳ test to myself, replies section, gallery, edit warning, precedence |
| [D-86](#d-86--ai-page-the-one-off-orders-box-moves-to-the-bottom-templated-orders-and-order-history--pinned-kushal-2026-10-21) | AI page: the one-off orders box moves to the bottom; templated orders and order history | 📌 pinned |
| [D-87](#d-87--rule-every-mass-message-goes-to-a-tag-so-no-one-is-messaged-untagged--pinned-as-a-rule-kushal-2026-10-21) | Rule: every mass message goes to a tag (no untagged audiences) | 📌 pinned · RULE · ◐ the AI page's group message follows it; the API does not enforce it yet |
| [D-88](#d-88--an-openapi-spec-and-a-swagger-page-for-the-api--pinned-kushal-2026-10-22) | OpenAPI spec and a Swagger page for the API (`/api/v1/openapi.json`, `/api/docs`) | 📌 pinned |
| [D-89](#d-89--speed-the-contacts-page-sign-out-and-measuring-in-production-mode--pinned-session-audit-2026-10-22) | Speed: the Contacts page, sign out, and a production build for measuring (from the session audit) | 📌 pinned |
| [D-90](#d-90--import-duplicates-newest-name-wins-now-a-needs-review-list-later-a-cleanup-script-for-old-copies--pinned-kushal-2026-10-22) | Import duplicates: newest name wins now; "Needs review" choices later; a cleanup script for old copies | ◐ built: newest wins + audit + preview list + `npm run dedup:cleanup` · 📌 pinned: Needs-review list |
| [D-91](#d-91--a-chat-the-ai-is-handling-cannot-be-typed-into-until-a-person-overrides-and-stops-the-ai--pinned-kushal-2026-10-22-raised-again-2026-10-23) | A chat the AI is handling cannot be typed into (admins and participants too) until a person takes over from the AI; also while the AI is mid-reply | 📌 pinned (Kushal, 2026-10-22; raised again 2026-10-23) |
| [D-92](#d-92--a-separate-feedback-portal-testers-google-doc-into-github-issues-with-ai-help-and-follow-up-questions-later--pinned-kushal-2026-10-22) | A separate feedback portal: testers' Google Doc is pulled into GitHub issues by a scheduled worker; AI parsing and clarifying questions later | 📌 pinned (Kushal, 2026-10-22) · first slice (the worker) next |
| [D-93](#d-93--a-separate-log-for-the-ai-assistant-through-the-whole-process--pinned-kushal-2026-10-22) | A separate log for the AI assistant, following one chat's reply through every step of the process | 📌 pinned (Kushal, 2026-10-22) |
| [D-94](#d-94--messages-the-owner-sends-from-their-own-phone-and-older-chat-history-are-missing-from-the-inbox--high-priority-kushal-2026-10-22) | Messages the owner sends from their own phone (and older chat history) are missing from the inbox | 🔺 **HIGH PRIORITY** · 📌 pinned (Kushal, 2026-10-22) |
| [D-95](#d-95--caching-and-extra-data-layers-redis-result-cache-views-replica-search-server---pinned-for-later-kushal-2026-10-23) | Caching and extra data layers: not faster today, revisit on a measured signal (docs/35 section 7) | 📌 pinned |
| [D-96](#d-96--forgot-password-a-way-to-reset-your-own-password---priority-kushal-2026-10-23) | Forgot password: a way to reset your own password (no self-service reset today; the beta server has no operator at a keyboard) | 🔺 **PRIORITY** (Kushal, 2026-10-23) · 📌 pinned |
| [D-97](#d-97--ai-settings-say-add-a-model-first-next-to-the-save-button-when-no-model-is-set-up---pinned-kushal-2026-10-23) | AI settings say "add a model first" next to Save when no model is set up (and disable Hand to AI with that reason) | 📌 pinned (Kushal, 2026-10-23) |
| [D-98](#d-98--a-usage-and-limits-check-for-the-chosen-ai-model-used-remaining-and-roughly-how-many-messages-it-can-still-handle---pinned-kushal-2026-10-23) | Usage and limits check for the chosen AI model: used, remaining, roughly how many messages it can still handle | 📌 pinned (Kushal, 2026-10-23) |
| [D-99](#d-99--contacts-add-one-contact-or-several-at-once-by-hand---pinned-kushal-2026-10-23) | Contacts: add one contact, or several at once, by hand (single and multiple modes) | 📌 pinned (Kushal, 2026-10-23) |
| [D-100](#d-100--campaigns-an-indicator-on-each-campaign-showing-whether-the-ai-is-used---pinned-kushal-2026-10-23) | Campaigns: an indicator on each campaign showing whether the AI is used (badge, template name, openings written, filter) | 📌 pinned (Kushal, 2026-10-23) |
| [D-101](#d-101--waiting-for-this-message-on-the-recipients-phone-even-when-the-ai-sends-it---priority-kushal-2026-10-23-raised-again-after-it-kept-happening) | "Waiting for this message" on the recipient's phone even when the AI sends it (phone-number vs LID session mismatch; docs/45) | 🔺 **PRIORITY** (Kushal, 2026-10-23) · ◐ built on a branch (Baileys 7.0.0-rc14), real-phone check pending |
| [D-102](#d-102--messages-typed-on-the-owners-phone-or-whatsapp-web-do-not-all-reach-the-inbox---priority-kushal-2026-10-23-same-root-as-d-101-follow-up-to-d-94) | Messages typed on the owner's phone or WhatsApp Web do not all reach the inbox (same LID session root as D-101; follow-up to D-94) | 🔺 **PRIORITY** (Kushal, 2026-10-23) · ◐ built with D-101, real-phone check pending |
| [D-103](#d-103--the-ai-tab-is-confusing-a-guided-walkthrough-of-what-has-to-be-set-up-in-order---pinned-kushal-2026-10-23) | The AI tab is confusing: a guided walkthrough of what to set up, in order | 📌 pinned (Kushal, 2026-10-23) |
| [D-104](#d-104--turn-the-ai-model-off-deletes-the-model-settings-there-is-no-way-to-pause-the-ai-and-keep-them---pinned-kushal-2026-10-23) | "Turn the AI model off" deletes the model, key and URL; add a real Pause that keeps them (and rename the delete) | 📌 pinned (Kushal, 2026-10-23) |
| [D-105](#d-105--contacts-dates-and-order-the-date-added--last-imported-choice-is-unclear---pinned-kushal-2026-10-23) | Contacts "Dates and order": the Date: Added / Last imported choice is unclear (rename, hint, show it as a sentence) | 📌 pinned (Kushal, 2026-10-23) |
| [D-106](#d-106--inbox-resolve--reopen-is-confusing-say-mark-as-completed--reopen-chat---pinned-kushal-2026-10-23) | Inbox: rename Resolve / Reopen to Mark as completed / Reopen chat (and the Closed tab to Completed) | 📌 pinned (Kushal, 2026-10-23) |
| [D-107](#d-107--import-two-different-things-are-both-called-preview-the-check-should-run-by-itself---pinned-kushal-2026-10-23) | Import: the sample table and the Preview button are both called preview; run the check automatically and show Import straight away | 📌 pinned (Kushal, 2026-10-23) |
| [D-108](#d-108--import-mark-invalid-phone-numbers-and-emails-in-the-preview-and-make-the-person-fix-or-drop-them-with-a-confirmation---pinned-kushal-2026-10-23) | Import: mark invalid phone numbers and emails in the preview; fix them inline or drop them with a confirmation | 📌 pinned (Kushal, 2026-10-23) |
| [D-109](#d-109--campaign-form-build-a-new-template-jumps-to-the-ai-tab-and-the-template-picker-does-not-make-the-campaign-an-ai-campaign---pinned-kushal-2026-10-23) | Campaign form: "Build a new template" jumps to the AI tab, and picking a template there does not make the campaign an AI campaign | 📌 pinned (Kushal, 2026-10-23) |
| [D-110](#d-110--tell-the-assistant-what-to-do-as-a-small-chat-bubble-on-the-right-side-of-the-page-not-a-section-in-the-ai-tab---pinned-kushal-2026-10-23) | "Tell the assistant what to do" as a small chat bubble on the right side of every page, not a section of the AI tab | 📌 pinned (Kushal, 2026-10-23) |
| [D-111](#d-111--import-de-duplicate-in-the-browser-before-upload-with-a-progress-bar-drop-exact-copies-ask-which-to-keep-when-copies-differ---pinned-kushal-2026-10-23) | Import: de-duplicate in the browser first (progress bar, drop exact copies, ask which to keep when copies differ); server still enforces | 📌 pinned (Kushal, 2026-10-23) |
| [D-112](#d-112--message-and-campaign-tracking-is-poor-say-who-sent-each-message-ai-or-a-person-and-show-it-in-campaigns-too---pinned-kushal-2026-10-23) | Message and campaign tracking: a small "Sent by the AI assistant / Sent by <name> / Campaign / phone" line under each message; sent text and state per campaign recipient | 📌 pinned (Kushal, 2026-10-23) |
| [D-113](#d-113--linked-numbers-replace-advisory-mode-with-a-plain-anti-ban-switch-on--off---pinned-kushal-2026-10-23) | Linked numbers: rename "Advisory mode" to a plain Anti-ban protection On / Off switch (words only; maybe auto-expire) | 📌 pinned (Kushal, 2026-10-23) |
| [D-114](#d-114--an-approval-system-requests-from-agents-to-admins-with-status-pages-and-notifications---pinned-kushal-2026-10-23) | An approval system: requests from agents to admins (numbers, campaigns, do-not-contact lifts, ...), My requests and Approvals pages, notifications; D-76 becomes its first use | 📌 pinned (Kushal, 2026-10-23) |
| [D-115](#d-115--campaigns-a-timeout-for-messages-the-ai-sends---pinned-kushal-2026-10-23-meaning-mostly-clear) | Campaigns: a timeout for AI-sent messages (how long the AI may wait or keep trying before giving up or handing the chat back) | 📌 pinned (Kushal, 2026-10-23): so the AI never waits forever on a message it sent |
| [D-116](#d-116--chats-a-button-to-jump-to-the-bottom-the-latest-message---pinned-kushal-2026-10-23) | Chats: a "go to the latest message" button that scrolls a long chat to the bottom | 📌 pinned (Kushal, 2026-10-23) |

## By theme (added 2026-10-23)

The same pins grouped by what they are about, so related work is found and built together. **Bold** = raised or changed in the 2026-10-23 session. A pin can appear under more than one theme. The table above stays the complete list.

| Theme | Pins, in a sensible order to read or build | Notes |
|---|---|---|
| **WhatsApp reliability: sessions, "Waiting for this message", missing own messages** | **D-101** (waiting for this message) and **D-102** (phone and WhatsApp Web messages missing) share one root cause: Baileys 6.7.24 has no phone-number to LID session mapping (docs/45). Fix with **D-44 / D-5** (Baileys 7) or a mapping shim. **D-82** (a restart breaks the session) is the visibility and shutdown half. **D-94** (own-phone messages, history), **D-67** (save a name onto a LID chat), D-14 and D-45 (done, earlier LID work). | Build D-101, D-102 and D-82 together; test on the Linode spare number. |
| **AI assistant: setup and clarity** | **D-97** (add a model first), **D-103** (guided walkthrough), **D-104** (pause without deleting the model), **D-98** (usage and limits), **D-110** (the orders box becomes a chat bubble; **replaces the "box moves to the bottom" part of D-86**), D-86 (templated orders, order history), D-9 (AI settings tab, done). | One pass over the AI tab: D-97 + D-103 + D-104 + D-110. |
| **AI assistant: behaviour and safety** | **D-91** (nobody types into an AI chat, admins included; take over from the AI), D-42 (human takeover), D-81 (guardrails, approval mode), D-84 (the AI runs whole conversations), D-85 (AI templates), D-93 (a separate AI log), D-4 (done). | D-91 now includes "also while the AI is mid-reply". |
| **Campaigns** | **D-52** (delete campaigns, PRIORITY, unparked), **D-100** (AI indicator), **D-109** (template picker and "Build a new template"), **D-112** (who sent each message; campaign recipient tracking), **D-115** (timeout for AI-sent campaign messages), D-87 (rule: every mass message goes to a tag), D-27 (opt-out words), D-73 ("message these people" after import), D-59 (files in campaigns), D-68 and D-26 (done). | D-100 + D-109 + D-112 are one campaign-page pass. |
| **Inbox and chat** | **D-116** (button to jump to the bottom of a chat), **D-106** (Mark as completed / Reopen chat), **D-112** (sender line under each message), **D-91**, D-10 (what belongs in the inbox), D-18 (snooze, shortcuts), D-23 (inbox search), D-51 (deleted-message tracking), D-54 and D-53 (done). | |
| **Contacts and import** | **D-99** (add one or several by hand), **D-105** (Dates and order wording), **D-107** (the import check runs by itself), **D-108** (flag invalid numbers and emails; fix or drop), **D-111** (de-duplicate in the browser first), D-90 (import duplicates, "Needs review"), D-22 (diff-style de-duplication), D-21 (the import mapping wizard), D-57 (import as a background job), D-70, D-79, D-80 (the Contacts page, columns, edit page), D-40, D-35, D-36 (fields, exports, vCard). | D-107 + D-108 + D-111 (and D-90, D-22) are one import-review flow; D-111 is the same job as D-22 done in the browser. |
| **Numbers and anti-ban** | **D-113** (Anti-ban protection On / Off instead of Advisory mode; D-29 is the original), D-75 (who a number belongs to), D-76 (number requests), D-77 (scopes and limits), D-37 (🔵 **META** tier and quality), D-43 (extra restriction alerts). | |
| **People, sign-in and approvals** | **D-96** (forgot password, PRIORITY), **D-114** (the approval system with status pages and notifications; **D-76 becomes its first use**), D-77 (scopes and limits), D-78 (email invitations; D-96's emailed link needs the same email driver), D-47 (signup page, billing gate), D-55 (licence enforcement). | Build the email driver once for D-96 and D-78. |
| **Speed, operations and deploy** | D-46 (laggy UI, HIGH PRIORITY), D-89 (speed: Contacts, sign out, production build), D-83 (`dev:fast` stale screens), D-56 (telemetry; logs are on the Linode already, docs/43), D-92 (feedback portal), D-65 (bugs from the VM run), D-58 (public site and launch checklist), **caching and extra data layers**: not faster today, revisit on a measured signal (docs/35 section 7; D-95 is pinned on PR #153's branch). | The beta Linode is documented in docs/43; findings in docs/44. |

**Priorities right now (Kushal, 2026-10-22 and 2026-10-23):** D-46, D-94, D-96, D-101, D-102, D-52, D-85, plus D-91 raised again.


---

## D-1 · A lightweight database browser (Drizzle Studio or similar)

**What:** a web UI for running SQL against the live database from any device — a phone, a
borrowed laptop — without installing anything.

**Why parked:** the need is real (checking data or debugging away from your own machine), but
every option carries a catch:

| Option | Catch |
|---|---|
| **Drizzle Studio** (`npm run db:studio`) | Works today, but the **UI is served from `https://local.drizzle.studio`** — a page on Drizzle's servers that connects to your local port. Data stays on your machine; the interface code does not. Needs internet, and puts a third party in the loop. |
| **pgweb** | Single Go binary, ~20 MB RAM. Self-hosted, no third party. Needs to be put behind authentication. |
| **Adminer** | One PHP file. Same shape as pgweb. |
| **Supabase dashboard** | Free SQL editor in the browser, no setup — but only if the database is hosted there. |
| **DBeaver / psql** | What to use on your own machine. Not the answer to "from my phone". |

Starburst-style query UIs (stages, metrics, execution plans) are enormously more than this
needs — that is a distributed-query problem, and this is one Postgres instance.

**What brings it back:**
1. **Consolidating infrastructure for Indian data-residency compliance.** When everything moves
   in-region under DPDP, *where the database browser's UI is served from* becomes a real
   question rather than a preference — a third-party page holding a live connection to a
   database of personal data is exactly the kind of thing that needs an answer. Choose the
   self-hosted option then, behind the same authentication as everything else.
2. Or: someone needs database access away from their own machine often enough to be annoying.

**Cost of deferring:** none. Every option is additive and none touches the schema or the
application. `psql` and DBeaver cover the day-to-day case now.

---

## D-1b · Drizzle's query builder (as opposed to Drizzle itself)

**Worth separating three things that all get called "Drizzle":**

| | Status |
|---|---|
| **Drizzle schema definitions** (`pgTable(...)`) | **In use, and load-bearing.** This is what migrations are generated from. Cannot be removed without giving up generated migrations. |
| **drizzle-kit migrations** | **In use.** `db:generate`, `db:migrate`. |
| **Drizzle's query builder** (`db.select().from().where()`) | **Parked.** Every query written so far uses raw SQL through the `sql` tag. |
| **Drizzle Studio** (the browser UI) | **Parked** — see D-1 above. |

**Why the query builder is parked:** raw SQL is faster to write for someone who already knows
SQL well, and several of the queries written so far — the single-statement inbound upsert, the
status-rank guard — are clearer as SQL than they would be assembled from method calls. The `sql`
tag parameterises properly, so this is not the injection risk that string-building would be.

**What it costs:** typed results. `db.execute(sql...)` returns an unknown shape that the
caller asserts by hand, which is why the code is full of
`(rows as unknown as Array<{ id: string }>)[0]!`. The query builder would type those
automatically. That is the actual trade, and it is a real one.

**What brings it back:** enough hand-written row assertions that one of them is wrong and a bug
gets through. At that point adopt the builder for simple reads and keep raw SQL for the complex
statements — both work on the same connection and in the same transaction, so this is not an
either/or.

---

## ~~D-2 · Jurisdiction-specific compliance (data residency, consent enforcement, DLT, …)~~

> ~~**Struck out (Kushal, 2026-10-10).** Region-specific legal machinery is the operator's, in the other project or its own module, not this repository's.~~ What stays here is only the anti-ban side (`do_not_contact`, D-27).

**What:** any *region-specific* legal machinery an operator's jurisdiction demands — data residency
(e.g. India's DPDP requiring in-region hosting), enforced purpose-separated consent, DLT
registration for SMS, and so on.

**Not the product's to bake in.** This is a **generic, self-hostable tool used worldwide**
(2026-09-29 decision), so it ships **no** jurisdiction's compliance regime. Each operator meets
their own region's rules on their own deployment. The product's job is to provide neutral tooling,
not to be a DPDP (or GDPR, or TCPA) appliance. See `09-security.md`.

**What stays in place regardless — because it is anti-ban, not merely legal:** `do_not_contact`
(built), opt-out handling (**D-27**), and not blasting non-opted-in purchased lists. A number that
ignores these gets **banned** whatever the jurisdiction (`08-antiban.md`). An **optional**,
operator-driven `consent_record` (D-2 no longer mandates it) is available for operators who want a
paper trail for their own regime.

**What brings it back:** an operator (or a future hosted offering) that chooses to target a
specific jurisdiction and wants first-class support for its rules — at which point it is that
deployment's concern, layered on, not a core requirement.

**Cost of deferring:** none for the core. The neutral primitives that matter for keeping a number
alive are already built or pinned as anti-ban work.

---

## D-3 · Licence

**Why parked:** it changes nothing technical.

**What brings it back:** making the repository public, or accepting the first outside
contribution — whichever comes first.

**Cost of deferring:** rises sharply after the first outside contributor, since changing a
licence then needs every contributor's agreement. Decide before, not after.

---

## D-4 · The AI agent (F12) — ✅ built 2026-10-21 (Kushal's "AI speedrun"; guardrails left for D-81)

**Built (PRs #86 to #93, all titled `ai-speedrun:`):** a provider-neutral model layer (`@crm/llm`: an OpenAI-format driver that covers
Gemini, Groq, OpenAI, OpenRouter and Ollama, plus native Anthropic; `none` stays the default); settings with a consent box; a bot user
that can own chats but cannot sign in; **auto-reply** on open chats assigned to it, with a hand-over tool; **campaign tools** (create,
pause, resume, edit; start only if the org allows it) and a one-contact `send_message`; "Write with AI" on the campaign form; the
**request queue** (one at a time per org, cancel while waiting); anti-ban warnings in the thread with an admin-only do-not-contact
override. User guide: `docs/CRM-user-tutorial.pdf`. Design and the list of what exists: `docs/06-features/F12-ai-agent.md`.

**Original reasons it was parked (kept for the record):**

**Why parked:** the heaviest dependency, the least certain value, and an unresolved privacy
question. A self-hosted model needs 5–7 GB of RAM; a hosted one sends contact data to a third
party. Most of what the previous system used AI for — classifying "yes, interested" — is better
served by rules that are free, instant, deterministic and correctable.

**What brings it back:** rule-based classification demonstrably failing on real conversations,
or a volume of inbound that humans genuinely cannot keep up with.

**Cost of deferring:** none. The seam exists — `LlmDriver` defaults to `none`, and the agent is
just another producer writing into the same outbox, so every safety gate already applies to it.

---

## D-5 · Baileys 7.x

**Update 2026-10-23:** the project now runs **7.0.0-rc14** (PR #161, the "Waiting for this message" fix, `docs/45`), because 6.7.24 had no phone-number to LID session mapping. Still a release candidate; watch it on the spare number. The original text below is why it was parked.

**Why parked:** pinned to `6.7.24`, the stable line. 7.x has sat in release-candidate status
across twelve iterations.

*Correcting an earlier claim: the objection was never the Rust dependency. `whatsapp-rust-bridge`
is WebAssembly, base64-inlined, with no native binaries, no install scripts and no platform
restrictions — it installs like any pure-JS package. The reason is RC churn alone.*

**What brings it back:** a stable 7.0.0, or 6.x breaking against a WhatsApp protocol change.

**Cost of deferring:** low by construction. The `ChannelProvider` port plus its contract suite
means evaluating 7.x is: write the adapter against the new version, run the same suite, compare.

---

## D-6 · UUIDv7 primary keys

**Why parked:** Postgres 16 has no native `uuidv7()`; it arrives in PG18. Keys currently use
`gen_random_uuid()`.

**What brings it back:** upgrading to Postgres 18, or index bloat from random keys becoming
measurable.

**Cost of deferring:** moderate. Changing key generation later affects new rows only, so old and
new coexist — workable, but it makes the ordering property unreliable until every old row ages
out.

---

## D-7 · Turborepo, and splitting the queue driver

> **In plain terms.** Two separate "maybe later" upgrades to how the code is built and how background jobs run.
>
> - **Turborepo** is a build helper for projects made of many packages (this one has an API, a gateway, a
>   web app and shared libraries). It remembers what it already built and skips it next time, so builds get
>   faster. Today `npm` workspaces are enough, because the project is small and builds are quick.
> - **The queue driver** is the part that hands background work (sending a message, importing a file) to
>   something that does it. Right now that something is **pg-boss**, which keeps the job list inside the
>   Postgres database we already have, so there is no extra server to run. **BullMQ** is the heavier option
>   that uses Redis and copes with many workers at once. We only switch when one machine of workers is not
>   enough, and because the queue sits behind an interface, switching does not touch the rest of the code.
>
> Nothing is broken and nothing needs doing until builds feel slow or the work outgrows one worker.

**Why parked:** npm workspaces are enough at this size, and `pg-boss` avoids running Redis at
all in the lean preset.

**What brings it back:** build times becoming annoying (Turborepo), or needing to scale workers
horizontally, at which point `pg-boss` stops being appropriate and BullMQ on Redis is correct.

**Cost of deferring:** none. Both sit behind interfaces already.

---

## D-8 · Self-serve setup wizard, guided walkthrough, whitelabelling — **PARKED (Kushal, 2026-10-20): not working on this for now**

**What:** a first-run wizard that provisions an org and its first admin in the browser, a guided
walkthrough for someone new, and the branding layer that makes the product not visibly one
company's.

**Why parked:** it is a coherent phase of its own rather than a feature, and none of it blocks
the in-house beta, where the two developers can provision by hand. It is also mostly **already
anticipated** elsewhere: P12's exit criterion is *"a stranger self-hosts it in under 10 minutes
from the README alone"*, and F11's Branding section already specifies product name, logo,
colours, favicon and sender display name as configuration rather than code.

**Raised to priority 2026-10-20 (Kushal)**, after starting over from a wiped machine and finding the manual setup
(secrets in `.env`, `db:setup`, a command-line `admin org`, then `dev:all`) slow and easy to get wrong. First slice: a **first-run
wizard** in the browser, shown when the database has no organisation, that creates the org and first admin (through the
existing `createOrgWithAdmin()` service) and shows the password once. Branding and the guided walkthrough come after.

**What brings it back:**
1. **A second deployment that neither developer runs** — the recruiter, another team, or a
   whitelabelled instance. The moment setup cannot be a phone call, it has to be a wizard.
2. Or: P12 proper, where the 10-minute self-host criterion has to actually be met.

**Cost of deferring:** low but not zero. The longer provisioning stays manual, the more
hand-created rows exist that no code path can reproduce — `sender_identity` already carries one
created by hand, and that single row caused two separate misdiagnoses before anyone worked out
where it came from. Keeping provisioning behind one `createOrgWithAdmin()` service, as decided,
is what keeps this cheap.

**Note: this came up while the other dev (Mikhil) was alpha testing** (2026-10-20). His words, the screenshots and Kushal's decisions are in [`dev-feedback-issues.md`](../dev-feedback-issues.md). Issue-1 ([#64](https://github.com/Kushalr3ddy/whatsapp-crm/issues/64)): "what to do next" links after each step. The ideal flow he describes: log in, link a number, import a sheet, open the tagged sheet, send messages.

✅ **"What next" after linking a number built 2026-10-20 (issue #64):** once a scan works, the card suggests "Import your contacts" and "Open campaigns" (suggestions only). The rest of the guided flow and the first-run wizard are still open.

**Plan written 2026-10-20:** see [`32 · Setup, signup, teams and billing`](32-onboarding-and-billing.md). The first-run wizard is phase 1 and the signup page is the same form behind an invite code (phase 2). **Documents only; no implementation until the alpha test is complete.**

**2026-10-20:** parked again; the plan in [`32`](32-onboarding-and-billing.md) stays as the reference. Not working on it for now.

**Added 2026-10-20 (Kushal):** a **tutorial / walkthrough for first-time users after they sign up** (step-by-step tips on the first visit to each page, dismissible, with a way to replay it). Part of the guided flow listed here.

---

## D-9 · Generating `.env`, and a secrets driver — ✅ **AI settings tab built 2026-10-22 (was Kushal's priority)**

### ✅ First piece BUILT 2026-10-22: an "AI settings" sub-tab inside the AI tab (decided with Kushal)

**Built as specified below, and proven on a real Groq key in a real second API process:** no model, then models listed (11), a passing test (1.1 s, with function calling), saved to the file (key not in the response), a template generated immediately with no restart, then turned off and refused again. Tests: 15 unit (file writing keeps every other line, backups, address guard, live reload, the test and its plain-words errors), 10 integration (the routes, admin-only, key never returned, audited without it, private address refused, rate limit), 2 browser. Documented in `docs/15-api.md`, `docs/18-providers.md` and workflow 8 in `docs/36-workflows.md`. **Later:** a `setup:ai` terminal command for headless installs; per-organisation keys; a model list cache.

**Where it stands.** The assistant is switched on in the app, but the model it talks to is chosen on the **server**, in five lines of `.env`: `LLM_DRIVER` (`none`, `gemini`, `openai`, `anthropic`, `ollama`,
`compatible`), `LLM_MODEL`, `LLM_API_KEY`, `LLM_BASE_URL` (needed for `compatible`: Groq, OpenRouter, vLLM) and `LLM_TIMEOUT_MS`. A person setting up has to know the provider names, the base address and a model
name that exists on that provider and can call tools, edit a file, and restart. A wrong value shows up later as "No AI model is configured" or "the provider refused the key".

**What Kushal wants, in his words:** a **sub-tab inside the AI tab, "AI settings"**, set up like OpenRouter's: choose the provider, enter the key, **test it with a model you choose**, and **that is what is used from now on.**
In the end it is stored as entries in the `.env` file.

**Decided (Kushal, 2026-10-22):**
1. **The key lives in `.env` only**: one provider, key and model for the whole install. No per-organisation keys for now.
2. **The settings are written from the web page.** An admin can change the provider, key and model in the app; it writes the `LLM_*` lines.
3. **OpenRouter-style setup:** a provider picker, a key box, a **model picker** (a searchable list fetched from the provider with the key where the provider offers one, with a recommended model marked, or type a name), and a **Test** button.
4. **The test makes a real, tiny, paid call.** That is accepted.

**How it works (to build):**
- **Tabs on `/ai`:** **Assistant** (today's page: templates, limits, orders) and **AI settings** (this). Admin only; a person who is not an admin sees which provider and model is in use, never the key.
- **AI settings tab:** provider (Groq, Gemini, OpenAI, Anthropic, OpenRouter, Ollama on this machine, Other OpenAI-compatible with a base address) → key (typed hidden; saved keys show only the last 4 characters and are never sent back to the browser) → model →
  **Test**: one small call that checks the key, the model, that it **answers**, and that it **can call a tool** (the failure `llm:check` found), with the reason in plain words if not (key refused, model not found, rate limited, no tool support, too slow) → **Use this** (only after a passing test, or after an explicit "use it anyway").
- **Saving writes `.env`:** only the `LLM_*` lines, atomically, file mode kept private, after a dated backup, never touching `ENCRYPTION_KEY` or any other line, and fixing a missing final newline first. In the container, where there is no checked-in `.env`, it writes the install's state env file that the container already loads.
- **Takes effect without a restart:** the API and the gateway (which writes the AI's replies) re-read the `LLM_*` values when they change (a notification to the gateway, as for other settings) and on their next model call, so "from now on" is true without anyone restarting a process.
- **Safety:** signed-in admin session only (an API key cannot change it); the key is never returned, logged or put in the audit log (the audit entry records who changed the provider and model, and when); the test and the key box are rate limited; a custom base address must be `https` and may not point at a private network
  address (`localhost` is allowed only for Ollama), so the settings page cannot be used to probe the server's network; a failed test changes nothing.
- **Also:** a status line on the Assistant tab when no model is set ("The AI is not set up: open AI settings"), replacing today's error that only appears when someone presses Write; the `setup:ai` terminal command for the same steps may follow for headless installs.
- **Why it matters now:** the assistant, the templates and the campaign wording all stop working without a valid model, and the first person to deploy (Kushal on Linode, and anyone after) hits this first. CI has no model set, which is also why model-dependent specs skip.
- **Related:** D-4 (the agent), D-81 (guardrails), D-85 (templates, the page this tab sits beside), `docs/18-providers.md` (the drivers and the measured comparison), `scripts/llm-check.ts`.

### The rest of D-9 (still pinned)


**What:** an idempotent `npm run setup:env` that generates the required secrets, and eventually
a `SecretsDriver` (Infisical, OpenBao, AWS Secrets Manager) plus a non-local `KmsDriver` so the
master key stops living in a file at all.

**Why parked:** two developers on laptops with a password manager is a genuinely adequate answer
today, and a secrets manager does **not** solve the thing that actually hurts — losing a key. It
moves where the key lives and adds rotation, audit and access control, none of which is pressing
at this size.

Note the asymmetry that makes this worth care rather than speed: `APP_SECRET`, `API_KEY` and the
database password are all regenerable, and losing them costs one inconvenient afternoon.
**`ENCRYPTION_KEY` is not regenerable** — losing it makes every stored message and every linked
number permanently unreadable ([22 · Encryption](22-encryption.md)).

That asymmetry is exactly why a naive generator would be **worse than no generator**: run over a
working install it would mint a fresh `ENCRYPTION_KEY` and silently destroy the data it was
meant to protect. When this is built it must fill in only absent values, never touch a key that
already has content, and exit non-zero rather than guess.

**What brings it back:**
1. **Deployment** — the key has to exist on a server that nobody should be hand-editing, which
   is the point `KMS_DRIVER` stops being decorative. `docs/18-providers.md` already specs it;
   `config.ts` does not yet read it.
2. Or: a third person needing to set the project up, where "ask one of the two devs" stops
   scaling.

**Cost of deferring:** none technically, but it carries a **standing manual obligation** in the
meantime — `ENCRYPTION_KEY` and `ENCRYPTION_INDEX_KEY` must be kept in a password manager, and
never in the same place as a database dump. A backup holding both the ciphertext and its key is
a backup of plaintext.

---

## D-10 · What belongs in the inbox — broadcast output, and unknown senders

> **2026-10-21:** unknown senders are defined and will be marked and offered "Save as contact" under D-67 and D-80. The separate tray below is still undecided.

**What:** two related questions about the inbox's contents, both raised by using it.

**1. Broadcast output would flood it.** A campaign to 500 contacts produces 500 outbound
messages across 500 conversations. Rendered the way the inbox renders anything else, it buries
every real conversation the moment a campaign runs — the inbox stops being a place where a
person answers people and becomes a send log.

**2. Unknown senders are mixed in with known contacts.** Anyone can message a linked number,
and today they appear in the same list as real contacts. WhatsApp privacy addresses make this
sharper: the contact has no phone at all, just a `wa_lid` identity, so there is nothing to
recognise them by.

**Why parked:** the second is not painful at this volume, and the first cannot be answered
properly until there is a campaign to look at — the right shape depends on whether people want
per-recipient detail in the inbox at all, which is genuinely unclear before anyone runs one.

**The options, so they are not re-derived:**

| Approach | Shape |
|---|---|
| **Filter** | One inbox, a toggle for "conversations with a human reply". Cheapest; the campaign is still in there |
| **Separate surface** | Campaign sends live under Broadcast and never enter the inbox until someone replies. A reply promotes the thread in. Closest to how people actually work |
| **Message-request tray** | Instagram's shape, applied to unknown senders: a separate tray until someone is accepted or replied to. Solves (2), not (1) |

Current leaning: **separate surface** for broadcast, because a campaign send is not a
conversation until somebody answers it; and the **tray** for unknown senders, but only once
volume makes it worth the extra place to look.

**What brings it back:** P7, at the point the first campaign is about to be sent to more than a
handful of people. Or: enough unsolicited inbound that finding a real conversation becomes
annoying.

**Cost of deferring:** none structurally — `conversation` already carries `status`, and a
campaign send is already distinguishable by `message.sent_by`, so either shape can be built
later without a migration. The cost is only that the first campaign run will be ugly if it
arrives before this is decided.

---

## D-11 · Media at rest — encryption, retention, scanning, compliance · ✅ serving built, the rest parked

**What:** everything about received files *except* storing and serving them, which is built as
the filesystem `StorageDriver` with provider-neutral keys.

**Parked, deliberately:**

| Question | Why it waits |
|---|---|
| **Encryption at rest** | Message bodies are encrypted; files would not be. A CV is *more* sensitive than the message carrying it — name, phone, address, salary. Encrypting costs cheap range requests and streaming, so it is a trade to make deliberately rather than by default |
| **Retention** | Specced at one year in `09-security.md`, with a nightly hard-delete job that does not exist |
| ~~**DPDP / erasure**~~ | ~~A deletion request has to reach the files, not only the rows — see D-2~~ Struck out (legal, 2026-10-10) |
| **Antivirus** | `SCANNER_DRIVER=clamav`, opt-in, ~1 GB RAM for daemon plus signatures, against a `lean` target of ~1 GB total |
| **Size caps and quotas** | WhatsApp permits ~16 MB images and ~100 MB documents. Candidate CVs accumulate quickly |

**NOT parked — and now built.** How files are **served** was the part that could not wait.
Storing an attachment is harmless; serving it is where the exploit lives. An HTML or SVG file
served from the app's own origin is stored XSS against a logged-in session, and the attacker
only has to message it. All of it landed with the first byte, in `apps/api/src/routes/media.ts`:
`Content-Disposition: attachment` on every response, content type from **magic bytes**
(`detectMediaType`) rather than the filename, never rendered inline, `X-Content-Type-Options:
nosniff`, and the same authentication as everything else. `tests/integration/media.test.ts`
holds a file whose name says PDF and whose bytes say HTML, and asserts it comes back as
`application/octet-stream`.

**Isolation does not extend to the filesystem, and this is the part to be careful about.**
Tenant isolation here is row-level security — forced on every tenant table and *measured* at
boot by `inspectDatabaseSecurity()`. RLS protects **rows**. Files live on a filesystem Postgres
cannot reach, so a stored attachment is protected only by whatever the download endpoint
remembers to check. The `media` row is covered; the bytes are not.

Two consequences, both now implemented:

1. **Every download resolves through the database** — file → message → conversation → org → the
   requesting principal — rather than trusting a path. The check that RLS performs for free on
   a row is written by hand for a file, in exactly one place: `resolveMedia()`.
2. **Storage keys are unguessable**: `org/<org>/media/<uuid>.<ext>`, built only by `mediaKey()`,
   never from the original filename and never sequential.

**On VirusTotal**, since it is the obvious reach:

- **Hash lookup** is privacy-safe — a digest reveals nothing — but nearly useless for this
  corpus. VT only knows files it has seen, and every CV is a unique document. The answer is
  "unknown" essentially every time.
- **Uploading the file is a data-protection breach.** VirusTotal's public API shares submitted
  samples with its security-community corpus, where paying subscribers can download them.
  Submitting a candidate's CV publishes their name, phone, address and salary history to third
  parties, with no consent and no way back. Enterprise private scanning exists, but it is paid
  and still a transfer to a third party. **ClamAV, locally, is the answer** — nothing leaves.

**What brings the parked half back:** enough stored media for retention to matter, a real
erasure request, or the first deployment onto a host where an unencrypted uploads directory is
not acceptable. Media now lands, so the clock on all three has started.

**Update 2026-10-16:** an S3-compatible driver now exists (D-63), so **moving files to a bucket is the next
trigger**. Decide encryption at rest *before* pointing a real deployment at one: encrypting in the application
before upload (with the same key ring as message bodies) means a stolen bucket yields nothing, but it costs
range requests and means rewriting every stored file if done afterwards.

**Cost of deferring:** encryption is the expensive one to retrofit — it means rewriting every
stored file, and the storage key layout should therefore allow a per-file marker from day one
so a mixed estate is readable during a migration.

---

## ~~D-12 · Resume parsing and ATS-friendliness scoring~~

> ~~**Struck out (Kushal, 2026-10-10).** Lives in the job-portal project / its own module. Already out of scope here; recorded so it is not re-proposed.~~

**Not deferred — out of scope for this repository, permanently.**

Recorded so it is not re-proposed. `docs/01-vision-scope.md:39` is explicit: *"Nothing
domain-specific in the schema. No `candidate`, no `job`, no `deal`."* Judging whether a résumé
is ATS-friendly is recruitment-domain by definition, and putting it here would break the single
rule that makes this product reusable by anyone who is not a recruiter — which is exactly how
the previous system became un-reusable.

**Where it belongs:** a module beside the job portal, consuming this CRM over HTTP, in the same
relationship this CRM already has with it (`docs/16-integration-jobportal.md`). This side
receives the file, stores it and exposes it through the API; the other side fetches it and makes
a judgement about it.

**What this repository owes that module:** a stable way to fetch an attachment and know which
contact it came from. Nothing more.

---

## D-13 · Access auditing — who *read* what · ✅ **LANDED**

**What:** recording reads, not just changes. Who opened this conversation, who downloaded this
attachment, who ran this export. The DPDP-shaped question.

**Trigger 1 fired: media landed, and this landed with it** rather than after, so there is no
gap at the start of the trail. Two actions exist today — `conversation.read` when a thread is
opened, and `media.downloaded` when a file is fetched, written *before* the transfer starts so
an abandoned download still counts. Both go in the same `audit_log`, as the table below says
they should. Listing the inbox is deliberately not recorded. Exports do not exist yet and join
this list when they do.

The volume question is unresolved rather than answered: nothing polls the thread endpoint
today, so it is one row per open. If P4's realtime work turns that into a poll, revisit it —
along with partitioning `audit_log` by month.

**Why it was parked, and what changed:** the audit log built today covers **state changes and authentication** — who
changed what, who signed in, who minted a key. That is the answerable half at this size. Read
auditing has a different cost shape: the table grows with *usage* rather than with *change*, so
a busy inbox writes an audit row every time someone opens a thread. Designing for that volume
before it can be measured means guessing.

It is also not yet useful. There is nothing sensitive to read: message bodies are already in
the inbox for anyone with access, and **attachments are not downloaded at all** (D-11). The
question "who read this CV?" cannot be answered because no CV is ever stored.

**What brings it back — any one of these:**

1. **Media lands.** The moment a candidate's CV is stored, "who opened it" becomes a real
   question, and it is far better to have the trail from the first file than to retrofit one
   and have a gap. This is the likeliest trigger and it is close.
2. **A DPDP access request**, or an obligation to show who has seen a data subject's record.
3. **More than a handful of agents**, where "who looked at this contact" stops being obvious
   from the fact that three people work here.

**Shape when it arrives**, so it is not re-derived:

| Decision | Leaning |
|---|---|
| What counts as a read | Opening a thread, downloading an attachment, running an export. **Not** every list query — a paginated inbox load is not a meaningful access event |
| Where it goes | The same `audit_log`, with `action` like `conversation.read`. A second table would split the answer to one question across two places |
| Volume | Revisit partitioning by month at the same time; `at` is already indexed for it |
| Sampling | Never. A sampled access log answers "probably nobody" to a question that deserves a real answer |

**Cost of deferring:** a gap in the trail for the period before it exists. That gap is harmless
while nothing sensitive is stored, and stops being harmless the day media lands — which is why
the first trigger above is the one to watch.

**Related, and deliberately out of scope:** the audit log lives in the same database as the data
it describes, so anyone holding the database can edit it. The `REVOKE UPDATE, DELETE` in
migration 0008 stops the *application* rewriting history, which is the realistic threat;
defending against a compromised database administrator needs append-only storage elsewhere —
a WORM bucket or an external log sink — and is a different problem.

---

## D-14 · The linked number receives nothing — `Bad MAC` on every inbound · ✅ **CLOSED 2026-09-28**

> **Closed.** The number was re-linked, inbound was verified and media was proven end to end against a real
> WhatsApp file. The text below is the diagnosis, kept so the evidence is not re-derived.

**What:** the companion WhatsApp session can **send** but cannot **receive**. Re-linking the
number is the fix; it is parked until there is a reason to spend the number's stability on it.

**The evidence, so nobody re-derives it.** Inbound stopped at **2026-09-20 09:12 UTC** while
outbound kept working — messages queued through the API reached the contact with status `sent`
the same evening. On a gateway restart WhatsApp delivered **17 `"tag": "message"` frames** and
every one failed:

```
Session error: Error: Bad MAC
ERROR: failed to decrypt message
  key: { remoteJid: "110762928373833@lid", fromMe: true, … }
  err: SessionError: No matching sessions found for message
```

All 18 failures were `fromMe: true` — echoes of **our own** sends syncing back. Baileys
discards what it cannot decrypt **before** `messages.upsert` fires, which was confirmed by
instrumenting that handler: it logged **zero** events across a restart that pulled 17 frames.
So the application sees silence, not an error, and nothing in our code is at fault.

The companion's Signal session state has diverged from the peer's. The usual causes are two
clients sharing one set of credentials, or a lost write to `channel_auth_state`.

**Why parked:** re-linking is not free. It burns a pairing on a number that is unofficial,
bannable and has no appeal route (`docs/08-antiban.md`), and the number is currently stable in
every other respect. Nothing being built right now needs inbound.

**What brings it back — any one of these:**

1. **Verifying media end to end.** This is the real cost: the download step has never met an
   actual WhatsApp file. `storeMedia`, typing, serving and auditing are all tested; the one
   link from provider to bytes is not, and no test can close that gap.
2. **Anything that consumes inbound** — P4's assignment and collision detection, P5 ingestion,
   or P6 scoring sender health on real inbound traffic.
3. **A second number being linked**, since whatever corrupted this session would be worth
   understanding before it happens twice.

**Cost of deferring:** the queued messages that failed with `Bad MAC` are almost certainly gone
already — WhatsApp stops re-delivering once retry receipts are exhausted — so that cost is
sunk rather than growing. What does grow is the media blind spot: every further layer built on
top of an unverified download is a layer that has to be re-checked when it is finally exercised.

**Two gotchas that came out of diagnosing it**, both now in `HANDOFF.md`: a corrupt session
looks like a *half-working* link rather than a broken one, because sending establishes its own
session; and this gateway appears to see traffic only in reconnect flushes, since
`markOnlineOnConnect: false` has WhatsApp notify the phone and queue for the companion.

---

## D-15 · A documentation site

**What:** the 25 files in `docs/` served as a real documentation site — searchable, linkable,
with a landing page — rather than markdown read on GitHub. Prompted by
[wacrm.tech](https://wacrm.tech), which is the presentation this project's docs do not have.

**The brief, so it is not re-derived:** Vercel's documentation theme is the reference — a
restrained, mostly monochrome palette, one accent colour, generous line height, a persistent
left nav, a right-hand table of contents, and code blocks that are the loudest thing on the
page. **Better than the reference, not merely similar:** this project's docs carry decision
records and rationale rather than feature tours, so the design has to make long prose readable
first and API reference second.

**Why parked:** it is presentation, and the content already exists and is already good. A site
makes the docs easier to *find*, which is a problem this project does not yet have — there are
no outside readers. Building it now would also mean maintaining a second artefact while the
docs themselves still change weekly.

**What brings it back — any one of these:**

1. **The repository going public**, or the licence decision landing (**D-3**). Nobody browses a
   private repo's docs site.
2. **The OpenAPI spec existing** (pinned as **D-88**). A generated spec wants somewhere to be rendered, and that is
   the natural anchor for the whole site (`docs/15-api.md`).
3. **JobPortal's team needing to self-serve** the integration rather than asking.
4. **The first outside user**, for whom `git clone` to read the docs is a poor first impression.

**Cost of deferring:** low, and that is the point. The content is portable markdown with
relative links; any static site generator consumes it as-is. The risk is only that the docs
drift into GitHub-specific formatting — so keep links relative and avoid anything that only
renders on github.com.

**When it is built:** generate from `docs/` rather than copying. Two sources of truth for a
sentence is how one of them becomes wrong, and this project has already had that happen with
the API document claiming an OpenAPI endpoint that did not exist.

---

## ~~D-16 · The legal front door (terms, privacy) — the operator's to provide~~

> ~~**Struck out (Kushal, 2026-10-10).** Terms, privacy and acceptance tracking are not built here.~~ The Baileys ban-risk warning shown before linking a number stays; that is honesty about risk, not legal boilerplate.

**What:** the terms and privacy policy a product puts in front of a person, and a record of who
accepted which version. **This is a generic worldwide tool, so the product ships none of these
baked in** (2026-09-29 decision) — an operator provides their own, appropriate to their
jurisdiction and business. If a future hosted/self-service offering needs acceptance tracking, a
`terms_acceptance(user_id, version, accepted_at, ip)` table is the shape, but it is that
offering's concern, not the core's.

**What the product keeps regardless — because it is anti-ban honesty, not legal boilerplate:**
**Baileys is unofficial and using it violates WhatsApp's Terms of Service; a number can be banned
permanently with no appeal.** This warning must be shown plainly to the operator before they link a
number — hiding it would be dishonest and useless, since it is *their* number at risk. It already
appears in `README.md`, `08-antiban.md`, `GETTING_STARTED.md` and the link screen, and it stays
whatever else is stripped.

**What brings the acceptance-tracking part back:** self-service signup, or a hosted multi-tenant
offering — i.e. the day someone other than the operator creates an account.

**Cost of deferring:** none for the core. The one thing that genuinely matters now — the
ban-risk disclosure — is already surfaced everywhere it needs to be.

---

## D-17 · Presence, typing indicators and collision detection (F3 realtime) — ✅ **BUILT** (viewing: PR #28, 2026-10-12; typing and the send-anyway warning: D-54, PR #32, 2026-10-13)

> **Built:** who has a chat open, by a 12 s heartbeat polled with the inbox (no websockets), shown in the thread
> header and on the inbox row; a typing indicator; a soft "send anyway?" warning beside the owner/participant lock.
> Presence, typing and viewers polling are plain `fetch` calls to a route handler (`/inbox/[id]/live`), **not**
> server actions, because Next runs server actions one at a time and the polling queued in front of the person's
> own Send. Live push (SSE) was not needed. The original description below is kept for the reasoning.

> **Priority.** Raised 2026-10-10 together with D-53 (assignment model and message authorship): knowing who
> is looking at a chat, who is typing, and who wrote each message is one feature set. Build them in the same
> slice, on one realtime channel.
>
> **What the screen should show:** "Asha is viewing" and "Bilal is typing…" on a thread (and a small dot
> on the conversation list), a warning in the composer when someone else is already typing, and presence
> only for people who can see the thread. **What it must not do:** show anything to the contact; this is
> teammates only (the WhatsApp "typing…" the contact sees is D-24, a different thing).
>
> **State today (verified 2026-10-10):** nothing realtime. The inbox refreshes by polling every 5 s, and the
> thread lock (409 `THREAD_ASSIGNED`) is the only collision protection.

**What:** the live parts of the shared inbox — showing that another agent is *viewing* a thread,
that they are *typing*, and by extension collision detection (two people not answering the same
contact at once). F3's AC-3. Distinct from **live inbound** (a new message appearing without a
refresh), which is a separate concern and is anyway blocked by **D-14**.

**Why parked:** it needs a transport the project does not have yet — a WebSocket (or SSE) channel
and a `conversation_participant` table — and its value is highest with several agents online at
once, which is not today's shape. The inbox already refreshes every 5 s by polling
(`apps/web/app/inbox/auto-refresh.tsx`), which is enough for one or two people.

**What brings it back — any one of these:**

1. **More than a couple of agents working one inbox**, where "did someone already reply?" starts
   to actually happen rather than being hypothetical.
2. **Live inbound being built** — once a realtime channel exists for new messages, presence and
   typing are cheap to add on the same channel, so they should land together rather than twice.
3. A concrete complaint of two agents double-replying.

**How hard later (so it is not re-guessed):** **moderate**, and most of the cost is the transport,
not the feature.

| Piece | Effort |
|---|---|
| `conversation_participant` table (`conversation_id`, `user_id`, `role`, `last_read_at`) + RLS | small — same pattern as `internal_note` (migration 0012) |
| A realtime transport (WS/SSE) the API and web share | **the real cost** — a new long-lived connection type; note the in-process-state caveat in `HANDOFF.md` (several replicas would each hold their own presence set, so this wants the shared cache layer from P9, or a Postgres `LISTEN/NOTIFY` fan-out like the gateway already uses) |
| Presence heartbeat + "viewing"/"typing" UI | small once the channel exists |

Because #2 makes presence nearly free once live inbound has a channel, the leaning is **not to
build presence on its own** — do it in the same slice as live inbound (which waits on **D-14**),
so the transport is paid for once.

**Cost of deferring:** none technically. The only loss is two agents occasionally replying to the
same contact, which polling's 5 s window narrows but does not close.

---

## D-18 · 🔵 **META** Inbox niceties: snooze, the Meta 24-hour window UI, ~~keyboard shortcuts~~

**What:** three F3 acceptance criteria deferred as not-needed-now.

| Item | AC | What it is |
|---|---|---|
| **Snooze** | AC-6 | Hide a thread until a chosen time, then re-open it. Needs a `snooze_until` column and something to un-hide it on schedule. |
| **Meta 24-hour window countdown + template-only composer** | AC-9 | WhatsApp's *official* API only allows free-form replies within 24 h of the contact's last message; after that only approved templates. The UI would show the countdown and lock the composer. |
| ~~**Keyboard shortcuts**~~ | ~~AC-10~~ | ~~Hotkeys for reply / assign / resolve / next-previous thread.~~ **Struck out (Kushal, 2026-10-10): not needed.** |

**Why parked:** none is load-bearing for the CRM working. Snooze is a workflow convenience; keyboard
shortcuts are a power-user speed-up; and the **Meta window UI is meaningless until the Meta Cloud API
adapter exists** — that is **P8 / D-5 territory**, and Baileys (the only transport today) has no such
window. Kushal called all three not required for now.

**What brings it back:**

1. **Snooze** — an operator asking to defer threads to "tomorrow" as a routine.
2. **Meta window UI** — the Meta adapter (P8) landing; build it *with* that adapter, not before.
3. ~~**Keyboard shortcuts** — enough daily inbox volume that mouse-driving becomes the bottleneck.~~ (struck out)

**How hard later:** snooze is **small** (one column + a sweep query, reusing the same pattern as the
rest of the inbox); keyboard shortcuts are **small** and pure front-end; the Meta window UI is
**small on its own** but gated behind the much larger Meta adapter.

**Cost of deferring:** none — all three are additive and touch no existing behaviour.

---

## D-19 · 🔵 **META** Rich message templates — user-managed, Meta-aligned, with media and import — deferred (priority withdrawn 2026-10-16)

> **Priority withdrawn (Kushal, 2026-10-16):** it was marked priority on 2026-09-29; it is back on the
> deferred list, not in the near-term queue. Body variation (D-26) was built without it.
>
> **How much it matters for anti-ban (assessed from this repo's own signal table in
> [08 · Anti-ban](08-antiban.md); not measured on a real number):**
>
> - **On the Baileys path, templates do not protect a number; the risk is the opposite.** The strongest
>   ban signals are reply ratio, contact-graph distance and block/report rate, and none of them is touched
>   by having a template library. The one signal templates do touch is *identical message bodies*
>   (rated High), and a library makes it easier to reuse one fixed body for everyone.
> - **That signal is already covered without templates:** spintax and `{{name}}` render a different body per
>   recipient (D-26), and a number may queue at most 50 identical bodies per rolling 24 h
>   (`IDENTICAL_BODY_DAILY_CAP`). So the floor is in place today.
> - **What a template system could add for anti-ban:** (1) several wording variants per template with weights
>   (the `template_variant` table), which varies messages more than spintax inside one text; (2) one place
>   to review the wording that goes to strangers, since content pattern matching is one of the detection
>   layers; (3) version history, so a drop in delivery or a restriction can be traced to a specific text.
> - **On the official Meta path it is not optional.** Outside the 24-hour window only an approved template
>   may be sent, its category sets the price and affects the quality rating, and marketing sends hard-stop at
>   a Low rating (`RB-03`). That is where templates matter for keeping a *number* healthy, and it arrives with
>   the Meta adapter (P8, D-34, D-38).
>
> **Net:** low to moderate value for the Baileys-only alpha, required once the Meta adapter exists.

**What:** the grown-up version of canned replies. Today `canned_reply` is a plain
shortcut + text body with `{{name}}` substitution (built, P4 chunk 2). The richer version is a
**template system a user manages themselves** — a tab to create, edit and organise templates —
that can carry **media** (an image/document header, like Meta's templates) and can be **imported**
from somewhere rather than all hand-typed. See `docs/06-features/F4-templates.md`.

**Why parked:** text is the priority now, and the plain canned replies already cover the everyday
"don't retype the same opener" need. The richer shape should be **modelled on Meta's own template
format** (WhatsApp message templates: category, header/body/footer, variables, buttons, and the
approval flow), and that reference work has not been done — designing it before looking at Meta's
examples would mean redoing it. It also overlaps the Meta adapter (P8) and the Meta-window UI
(D-18), so it wants to land near them, not before.

**What brings it back — any one of:**

1. **Referring to Meta's template examples** and deciding how closely to mirror them (so the same
   template can later be submitted to Meta for approval, not just used over Baileys).
2. Users asking to **manage their own templates** in the UI rather than an admin seeding rows.
3. **Media in templates** becoming a real need (an image header, a document) — which also depends
   on outbound media existing at all.
4. The **Meta Cloud API adapter (P8)** landing, since approved templates are how you message
   outside the 24-hour window there.

**What stays regardless:** the simple `canned_reply` table and its insert-with-`{{name}}` behaviour
are fine as they are; this is additive on top, not a rewrite of them.

**Cost of deferring:** none. Canned replies work now; this is enhancement.

---

## D-20 · SQLite support for single-machine deployments

> **See D-64** for the measured inventory of what depends on Postgres, and the shape a portable layer would take.

**What:** the option to run this against **SQLite** instead of Postgres, for a customer who
installs it as a self-contained module on their own machine rather than pointing it at a
centralised database.

**Why parked:** the current build leans on Postgres in load-bearing ways, so this is a
re-architecture, not a config flag:

| Depends on | Used for | SQLite equivalent |
|---|---|---|
| **Row-level security** | tenant isolation (the whole multi-tenant model) | none — would move to app-level enforcement |
| **LISTEN / NOTIFY** | the gateway command channel (link/unlink/send) | none — would move to polling |
| **jsonb + GIN** | `contact.custom_fields` and search | JSON1, weaker; different indexing |
| **triggers, `set_config`, transaction-scoped tenant** | isolation plumbing | rework |

The deployment decision (2026-09-27) is **multi-tenant on a centralised Postgres**, which needs
all of the above — so SQLite is not wanted for the primary mode. It only makes sense for a
**single-tenant, one-customer-one-machine** install, where multi-tenancy and RLS are moot anyway.

**What brings it back:** a concrete need to ship a single-machine install (a customer who will
not run Postgres). At that point this is its own track — likely a `DbDriver` port with a Postgres
adapter (RLS + NOTIFY) and a SQLite adapter (app-level scoping + polling), decided deliberately
and recorded here, since it changes the security model.

**Question (Kushal, 2026-10-21): could every Postgres function, trigger and rule be written into the backend code and helper scripts, so SQLite stays consistent the way Postgres keeps itself consistent today?** In principle yes: that is the portable layer D-64 describes. Each piece has a home in code, but only the first two are straightforward:
| Postgres does today | Code replacement | How well it holds |
|---|---|---|
| `notify_gateway()` and its 3 triggers (send, link, unlink wake the gateway) | an in-process event emitter when API and gateway share one process, or a short polling loop | easy; this is the part D-64 calls the easy part |
| `envelope_key_version()` (an indexed expression) | a plain column the code fills in on every write | easy |
| `FOR UPDATE SKIP LOCKED` (campaign dispatch claims) | a single process and one transaction, or a claim column with a compare-and-set update | fine on one machine |
| 24 row-level-security policies (every query is tenant-scoped by the database) | **one** query wrapper that adds the organisation to every statement, a lint rule against raw database access outside it, and a cross-tenant test sweep (D-48) | the real gap: the database refuses a forgotten `WHERE org_id` today; code can only make forgetting hard, not impossible |
| Append-only audit log (`REVOKE UPDATE, DELETE`) | a trigger SQLite does support, plus an app-level guard | workable; weaker, because the file owner can still edit the file |
| `jsonb`, arrays, `bytea`, `ON CONFLICT`, `LATERAL`, partial indexes | JSON functions and rewritten queries (about 254 call sites in 41 files) | the bulk of the work |
**To keep the two consistent** the way Postgres does itself: put all of this behind one `DbDriver` seam (D-64 step 1), keep Postgres as the reference behaviour, and run the **same integration suite against both drivers** so a difference fails a test instead of reaching a customer. For the single-tenant, one-machine install D-20 is about, there is no tenant isolation to re-implement, which removes the hardest row. Still pinned, not started.

**Cost of deferring:** none today. It grows with every feature that reaches for a Postgres-only
capability without a fallback in mind — so new isolation/notify logic should stay behind the
helpers that already wrap it (`setTenant`, the gateway command channel), not spread raw.

---

## D-21 · The full import mapping wizard — **WORK ON NOW (Kushal, 2026-10-20)**

> **2026-10-21:** how imports treat people who already exist, and hand edits made on the contact page (D-80), is written up in D-80. Per-column "overwrite on import" belongs to this entry's saved mappings and transforms.

> **Priority:** raised on 2026-10-10 while building the live walkthrough: production imports come from a Naukri
> Excel export, and its real layout is not in hand yet. Build this once that file (or a real sample of it) is
> available, so the wizard is shaped by the actual columns rather than a guess. Until then the synthetic
> Naukri-style workbook in `tests/live/naukri-sample.ts` stands in.

**What:** the complete mapping experience from `docs/07-ingestion.md`, on top of the **simple**
import tab being built now (upload .csv/.xlsx → pick the phone/name/email column → preview →
commit). The full version adds: multiple identity rules, per-column **transforms**
(trim/lower/upper/digits), **keep vs drop** unmapped columns, and **saved, reusable mappings** so
the same spreadsheet shape need not be re-mapped every time.

**Why parked:** the simple tab covers the real "upload a sheet of contacts" need with far less
UI. The wizard is worth building once there is a recurring import shape that the simple picker
cannot express, or enough imports that re-mapping each time is the annoyance.

**What brings it back:** a column layout the simple mapping cannot handle (several phone columns,
a name split across columns, transforms needed before matching), or repeated imports of the same
shape.

**Cost of deferring:** low — the API already accepts a full versioned mapping
(`mappingSchema` in `apps/api/src/routes/imports.ts`), so this is a UI-side expansion, not a
backend change. The simple tab posts a subset of that same mapping.


### A real Naukri recruiter export (2026-10-16)

Kushal supplied a real download from a recruiter (160 applicants to one job). **No row values are stored in
this repository**: the header row is in [`tests/fixtures/import-header-samples.json`](../tests/fixtures/import-header-samples.json)
and what follows is aggregate only. The file was a personal-data file (names, emails, phones, dates of birth,
home addresses), so keep it out of the repo and out of chat transcripts.

**Shape.** One sheet named `MySheet`, **82 columns**, one row per applicant, file named
`<Job Title>_<yyyymmddhhmmss>_<n>.xlsx`. Real Naukri headers, in order: `Job Title`, `Date of application`,
`Name`, `Email ID`, `Phone Number`, `Current Location`, `Preferred Locations`, `Total Experience`,
`Curr. Company name`, `Curr. Company Designation`, `Department`, `Role`, `Industry`, `Key Skills`,
`Annual Salary`, `Notice period/ Availability to join`, `Resume Headline`, `Summary`, then education
(`Under Graduation degree`, `UG Specialization`, `UG University/institute Name`, `UG Graduation year`, the
same four for post graduation and doctorate), `Gender`, `Marital Status`, `Home Town/City`, `Pin Code`,
`Work permit for USA`, `Date of Birth`, `Permanent Address`, then 33 recruiter-workflow columns (last activity,
pipeline stage, downloaded/viewed/emailed with who and when, calling status, five comment triples), `Source`,
ten `Ans(<screening question>)` columns specific to the job, and `Candidate profile` (a link).

**What is in it, as a mapping problem.**

| Finding | Detail | Consequence |
|---|---|---|
| **A third of phone cells hold two numbers** | 57 of 160 `Phone Number` cells (36%) are `9XXXXXXXXX, +<digits>`: a bare 10-digit number, a comma, then a second number with a `+`. The second part ranges from a lone country code (`+91`) to long strings. 103 cells are one bare 10-digit number and 1 is 12 digits | The importer's normaliser strips everything but digits and `+`, which glues the two together; **tested with fiction-range numbers, every two-number cell fails to normalise** (`2025550123, +12025550123` fails; `2025550123` alone passes). On this file that is about **36% of the people rejected as unusable phones** |
| Phones are stored as **text**, with no spaces or country code on the single ones | 10 digits, Indian default country needed | `defaultCountry: IN` is essential; already the default |
| `Name` is one column | 38 of 160 are ALL CAPS, 25 are a single word | Display-name tidying (title case) is a nice-to-have; no first/last split to handle here |
| `Email ID` | 46 of 160 contain capitals or spaces | Already lowercased and trimmed by the mapping |
| **`NA` means empty** | Used in almost every optional column (0% real data in the 33 workflow columns, 2% in doctorate, 19% in work permit) | An `NA` must be treated as blank, never imported as a value |
| Values are display text, not typed | Dates `19-Jun-2026`; experience `19 Year(s) 0 Month(s)`; salary `Rs 11.37 Lakhs` (also `Rs 9 Lakhs`); notice `1 Months`, `15 Days or less`, `Serving notice period` | Any numeric use (filtering by experience or CTC) needs parsing; the screening-answer columns hold clean numbers (`1137000`, `19`, `Yes`) and are easier to use than the display columns |
| Personal data beyond what messaging needs | Date of birth, permanent address, pin code, gender, marital status | The wizard should let a person **drop** these columns (`unmapped: drop`) rather than keep them in `import_row.raw`; with `keep` they are stored per row |
| The columns worth keeping as custom fields | `Current Location`, `Total Experience`, `Annual Salary`, `Notice period`, `Key Skills`, `Job Title` (the job applied for) | Needs D-40 (map a column to a custom field) |

**Built 2026-10-16: phone cells are lists, and `NA` is blank.** A phone cell is split on comma, semicolon,
slash, pipe and line breaks; each part is normalised; every valid, distinct number becomes a phone identity
on the same contact, the first as primary. Rules that are easy to get wrong:

- a part that is only a bare country code (`+91`) is ignored, as an empty second number;
- a bad part is dropped **only if another part is valid**, so one good number is never lost to a bad neighbour,
  and the original cell stays on the row ledger (`unmapped: keep`);
- a cell with nothing usable still fails the row, with the reason (text such as `not-a-phone` and too-short
  numbers are mistakes, not blanks);
- the same number written twice (`98…` and `+9198…`) is stored once;
- `NA`, `N/A`, `N.A.`, `nil`, `null`, `none`, `-`, `--` and `—`, as a **whole cell**, count as blank in phone,
  email, external-id and name columns. The one cost is a person whose entire name is "NA".

Code: `normalisePhoneCell`, `splitPhoneCell` and `isBlankMarker` in `packages/shared/src/phone.ts`, used by
`packages/core/src/ingestion.ts`. Tests: `packages/shared/src/phone.test.ts` and the "cells that hold more than
one number" block in `tests/integration/imports.test.ts` (fiction-range and existing fixture numbers only).
**Known limit:** if a row's second number already belongs to a different existing contact, that number is not
moved (the insert is skipped); the row still matches by its first number that is already on file. Merging such
contacts is D-22.

**Also built 2026-10-16: column scoring and a "rows to fix" box on the import screen.**

- **Column scoring.** On upload the server looks at the values in the first 200 rows of every column
  (`profileColumns` / `suggestColumns` in `packages/shared/src/column-guess.ts`): the phone column is the one
  whose cells parse as phone numbers (at least 60%, most matching cells wins, a phone-like header only breaks a
  tie), and the same for email; name follows the header and avoids those two. The response carries
  `suggestions` and per-column `columns` shares. The panel pre-selects from them, shows "N% of the values in
  <column> look like phone numbers", and warns in red when the chosen column is under 50%. A column called
  `Mob` or `Ph`, or `Contact Person` holding names, is now handled.
- **Rows to fix.** After Preview or Import, a small box lists the rows that could not be imported (sheet row
  number, the value as typed, the reason) and, more softly, rows that imported without one of their numbers
  (for example `9…, 1111111111` where the second is junk). It comes from the existing row ledger (a dry run
  already records it): `GET /imports/:id` now also returns `warnings`, and the run summary carries a `warnings`
  count. The ledger's `error` text column holds the note on a successful row. The sheet row shown is the
  ledger's data-row number plus one, because the header is row 1.
- Tests: `column-guess.test.ts`, the "column suggestions and rows to fix" block in
  `tests/integration/imports.test.ts`, and `tests/e2e/import-problems.spec.ts`.

Still true of the sample, not yet addressed: display values are text (`19 Year(s) 0 Month(s)`, `Rs 11.37 Lakhs`),
the personal-data columns can only be dropped by choosing `unmapped: drop` (the wizard UI for it is D-21), and
the columns worth keeping as fields need D-40.

### Column vocabulary from public sources (2026-10-16)

Because production data will not all come from Naukri, nine other header sets were collected from public
pages: header rows only, each marked published, reported or assumed in the same fixture. Many vendors show
their import template only as a download behind a login (Keka, Homerun, Lever, Zoho Recruit and Kredily list
fields in prose but not the exact headers), so most are "reported", not copied from a file.

What the importer's current auto-detect does with them (`apps/web/app/import/import-panel.tsx`: the first
header containing phone, mobile, number, contact or whatsapp is the phone; the first containing "name" is the
name; the first containing "mail" is the email). It finds a phone column in all of them. The gaps the wizard
has to close:

| Gap seen | Example | Effect today |
|---|---|---|
| **Several numbers in one cell** | Naukri `9XXXXXXXXX, +<digits>` (the real file above) | **Fixed 2026-10-16**: each valid number is imported |
| **Name split across two columns** | `First Name` + `Last Name` (datablist, LinkedIn, ATS templates) | Only the first name is kept |
| **Several phone columns** | `Phone 1`, `Phone 2`; `Contact No.` + `WhatsApp No` + `Alt Mobile` | Only one column can be mapped in the UI (the API mapping already accepts several phone rules) |
| **A phone-like word in a non-phone header** | `Contact Person`, `Total Number of Reviews` | Could be picked as the phone; the person can correct it |
| **No email column at all** | WhatsApp bulk-sender sheets, JustDial lists | Fine; email is optional |
| **Extra columns worth keeping** | `Current CTC`, `Notice Period`, `Total Experience`, `City` | Land in `import_row.raw` only; custom fields are D-40 |

That is the evidence for the wizard's first features: **split a multi-number cell, map more than one phone
column, concatenate columns into a name, treat `NA` as blank, drop columns, and map a column onto a custom
field.**

---|---|---|
| **Name split across two columns** | `First Name` + `Last Name` (datablist, LinkedIn, ATS templates) | Only the first name is kept |
| **Several phone columns** | `Phone 1`, `Phone 2`; `Contact No.` + `WhatsApp No` + `Alt Mobile` | Only one number is imported; the others are dropped |
| **A phone-like word in a non-phone header** | `Contact Person`, `Total Number of Reviews` | Could be picked as the phone; the person can correct it |
| **No email column at all** | WhatsApp bulk-sender sheets, JustDial lists | Fine; email is optional |
| **Number written as text, spaced or with `+`** | `+91 98…`, `098…` | Handled by phone normalisation |
| **Extra columns worth keeping** | `Current CTC`, `Notice Period`, `Total Experience`, `City` | Land in `import_row.raw` only; becoming custom fields is D-40 |

That table is the evidence for the wizard's first three features: **concatenate columns into a name,
map more than one phone column, and map a column onto a custom field.**

**Added 2026-10-17 (Kushal):** make the **column selector and the preview bigger** on the Import screen (the pickers, the
"keep these columns" box and the sample table are small for a sheet with ~80 columns). Picking columns to keep as custom
fields is built (PR #56); the size and layout of this step are what is left.

**Note: this came up while the other dev (Mikhil) was alpha testing** (2026-10-20). His words, the screenshots and Kushal's decisions are in [`dev-feedback-issues.md`](../dev-feedback-issues.md). Issue-2 ([#65](https://github.com/Kushalr3ddy/whatsapp-crm/issues/65)): show how many rows the file has. **Kushal's decision:** drop the Upload button; choosing or dropping a file uploads it straight away, and an invalid file or one without enough rows shows an error. Issue-10 ([#72](https://github.com/Kushalr3ddy/whatsapp-crm/issues/72)): the Match columns step is confusing. **Decisions:** add a big line after phone, name and email are chosen saying to select the columns to be stored (today only a small "Keep these columns on each contact" label), and a line above the preview: "Preview of all the columns you have selected from the excel/csv: <file name>".

✅ **Alpha-feedback issues 2 and 10 built 2026-10-20 (issues #65, #72):** choosing or dropping a file uploads it at once (no Upload button) with the row count and file name shown, and a file with no people is explained; the columns step has a plain "Which column is which?" and a big "Select the columns to be stored" line, and the preview shows only the chosen columns under "Preview of all the columns you have selected from <file>". The rest of the wizard is still open.

**2026-10-20: work on this now.** Built: upload on choosing a file, the clearer columns step and the trimmed preview. Still to do: several phone columns, joining first and last name, and dropping personal-data columns.

**Added 2026-10-20 (Kushal):** make the **column selector and the preview wider and bigger, with a slightly bigger font** on the Import screen. **Do not do it if it breaks the mobile layout later** (D-72): check phone width first, and prefer a layout that is roomy on a desktop and still scrolls cleanly on a phone.

**2026-10-20:** Kushal wants to see a **preview (mockup) of the remaining changes before any building**: several phone columns, joining first and last name, dropping personal-data columns, and the wider selector. Preview first, then go ahead.

✅ **Built 2026-10-21 (the previewed design):** the Match columns step is now divided into sections (file, phone columns, name and email, columns to store, preview, tag and import). **Several phone columns** can be ticked and are tried in order (a person with two numbers keeps both); a **first-name column plus a last-name column** are joined as written, never shortened (`Anita Sharma`; a one-letter first name becomes `a.sharma`); **personal-looking columns** (date of birth, pay, address, government ids) are marked and cannot be ticked while "never store columns marked personal" is on; the columns box scrolls; text is slightly bigger. Still open from this pin: dropping personal-data columns by an admin-set list, saved mappings, per-column transforms.

---

## D-22 · Row-level de-duplication with a diff-style review

**What:** de-duplication *within and against* an import, resolved by a person — not just the
file-level hash check that exists now. When an incoming row matches an existing contact (or
another row in the same file), **show the two side by side** (git-diff style, or something
friendlier — highlighted field differences) and let the user **choose which version wins**,
field by field or whole-row.

**Why parked:** the file-hash check (refuse the same bytes twice, `?force=true` to re-run) is
enough to stop the accident that actually happens — importing the same sheet twice. Row-level
merge review is a much larger interaction and belongs with the full wizard (**D-21**), not the
simple tab.

**What brings it back:** imports that legitimately overlap existing contacts often enough that
"which value is right?" needs a human answer rather than the current identity-rule precedence.

**What exists to build on:** identity resolution already matches a row to an existing contact
(`packages/core` import path), and the per-row ledger (`import_row`) records each outcome — so
the data to diff is already produced; this is the review UI and the merge-choice on top.

**Cost of deferring:** low. The current precedence (a sparse row cannot overwrite richer data,
M9) is a safe default; this replaces "safe default" with "user's explicit choice".

---

## D-23 · Inbox search (F3 AC-7) — **PINNED, research later (Kushal, 2026-10-20)**

> **Priority (2026-09-29):** in the near-term build queue. One thing to settle first: the
> blind-index vs. trigram decision on encrypted message bodies (below) — contact-field search can
> ship without waiting on it.


> **Decision (Kushal, 2026-10-13): date-range-scoped search, decrypt-and-scan, no plaintext copy.**
> Search runs **only inside a date range the person chooses**: a preset (last week, last month, this
> month, last 3 months, this year) or a custom day, month or year range. The server decrypts that
> window's messages in the API process and matches there. Nothing is stored in plaintext and no new
> index is built. Contact search stays as it is (those fields are not encrypted). Not chosen, and why:
> a plaintext search column or a "recent chats unencrypted" table would put the most sensitive, most
> recent conversations in a stolen backup, which undoes the encryption at rest.
>
> **Measured** (2026-10-13, this machine, Node, AES-256-GCM): decrypt and scan **100,000 messages in
> about 0.8 s** (about 8 microseconds each), CPU only; a million would be about 8 s before database
> transfer. A month or a quarter of one org's messages is comfortably inside a second.
>
> **Research** (best practice for searching encrypted data): the standard Postgres full-text index
> cannot be built over encrypted columns; the two real families are blind token indexes (HMAC'd words
> or trigrams, as in SysReptor and CipherStash; they leak which rows share a token and lag behind
> writes) and client-side search (WhatsApp, iMessage, Tutanota; a poor fit for a shared server-rendered
> inbox). A blind token index is the upgrade path if volume ever outgrows decrypt-and-scan.
>
> **Open decisions (ask before building):**
> 1. **Which presets and ranges**, and the default when none is chosen (suggest: last 30 days, shown
>    clearly, with "search a wider range" one click away).
> 2. **A ceiling:** the widest range allowed, and a cap on messages scanned per search (so one
>    "everything since 2020" cannot hold the API). What the person sees when the cap is hit.
> 3. **Caching** (recommendation below). Whether to cache a search's results at all; whether to cache
>    an **empty** result; and what an overlapping range means (the same words searched over a wider or
>    shifted range).
> 4. **Substring or whole word**: does "pun" need to find "Pune"? Decrypt-and-scan does either.
> 5. **Notes and file names**: notes are plaintext already; whether they are searched with bodies.
> 6. **Audit:** whether searches are written to the audit log (a search over customer chats is a read
>    worth accounting for, like D-13).
>
> **Recommendation on caching.** Do not cache search *results* at first. At the measured speed a
> bounded range is cheap, and a result cache has real correctness traps: it goes stale the moment a
> message arrives, an empty result is the most likely to be wrong a minute later, and an overlapping
> range cannot be built from a cached neighbour without re-checking the edges and anything new. If it
> proves slow, cache one layer lower: a **memory-only, bounded, per-org cache of decrypted bodies**
> (never written to disk, gone on restart). Then every range overlaps for free, nothing about
> "which range was searched" has to be reasoned about, and a new message is simply absent from the cache
> until read. If a result cache is wanted anyway: key it on org, normalised query and exact range, give
> it a short life (tens of seconds), cache empty results only for that same short life, and never answer
> a different range from it.

**What:** search across message bodies and contact fields — the last substantial P4 inbox piece.

**Why parked:** not blocking, and it carries a real **design decision** that should be made
deliberately rather than in passing: message bodies are **encrypted at rest** (`body_enc`), so
plaintext cannot be indexed. The two options —

| Option | What it buys | Cost |
|---|---|---|
| **Blind index** (deterministic HMAC per token/word, already have `kms.blindIndex`) | exact-term match over encrypted bodies without decrypting | no partial/fuzzy match; tokenisation choices leak some structure |
| **`pg_trgm` / full-text on decrypted text** | fuzzy, partial, ranked | requires a searchable plaintext copy — reopens "why is it encrypted at all" |

Contact fields (name, external ref) are not encrypted and can use `pg_trgm` directly regardless;
the decision is really about the message bodies.

**What brings it back:** an operator needing to find an old thread by its content often enough
that scrolling is the bottleneck. Kushal asked to keep it as a reminder (2026-09-28).

**Cost of deferring:** none — additive, and contact-field search can land first without touching
the encrypted-body question.

**2026-10-20: more research and planning needed before building.** Design is decided but six decisions are open (see above).

**2026-10-20:** back to pinned; the research and planning wait. (A question about where files could be stored, raised under this number, was written up under D-63.)

---

## D-24 · Typing simulation (P6 anti-ban layer 3) — ✅ **LANDED 2026-09-29**

> **In plain terms.** When a person messages on WhatsApp, the other side briefly sees "typing…" before the
> message arrives. A bot that sends instantly never shows that, and WhatsApp can notice. Typing simulation
> makes each automated send show "typing…" for a short, length-based moment first, then send, so it looks
> like a person. It is one of the anti-ban behaviours. It is **not** the "someone is typing" indicator
> between teammates in the inbox; that is D-17.

**Built.** Before each send the gateway emits a `composing` presence to the recipient, pauses a
beat proportional to the message length (`typingDelayMs` in `@crm/core` — Gaussian on the per-char
rate, clamped 0.7–8 s), then clears it with `paused`, at the one send chokepoint in `handleSend`.
Opt-in via `SEND_TYPING_SIMULATION` (default on), cosmetic and best-effort — a failed presence
update is swallowed and never fails the send. The `ChannelProvider` port gained an optional
`typing(sender, to, state)`, implemented by the Baileys adapter (`sendPresenceUpdate`) and the
fake (records the calls so a test can assert `composing` fired before the send). The beat is a
**compressed** pause, not literal 45-WPM typing time: a 30-second "typing…" bubble before every
send would stall the paced queue for no anti-ban gain, since the tell being removed is the
*instant* send, not a fast one. Original note kept below for the reasoning.

**What:** making an outbound send *look* human — emit a `composing` presence update to WhatsApp,
wait a realistic beat proportional to the message length, then send. The bot-behaviour half of
anti-ban, distinct from the pure pacing of layers 1–2 (warmup, ceilings, jitter, all built).

**Not to be confused with D-17.** D-17 is *agent* presence/typing in the shared inbox — showing a
teammate that a colleague is typing. This is the **sender** simulating typing at the WhatsApp
peer. Same word, opposite direction: D-17 is a human being shown to a human; this is a machine
pretending to a machine.

**Why parked:** Kushal set it aside (2026-09-28) to look at the rest of P6 layers 3–6 first. It is
gateway-side (the socket lives in `apps/gateway`), and it wants to land alongside the other
behavioural layers so the send path's human-rhythm logic is designed once, not bolted on in
pieces. Layers 1–2 already cap a burst; typing simulation is polish on *how* each individual send
looks, which matters less than the layers that decide *whether* and *when* to send at all.

**What brings it back — any one of:**

1. **Deciding to build P6 layers 3–6 as a slice** — typing simulation is the cheapest of the four
   and the natural first or last touch on the send path.
2. A real signal that instant, zero-delay sends are a ban vector for this number (health scoring,
   layer 6, would surface it).
3. Circadian pacing (layer 4) landing — once sends follow a daily rhythm, per-send typing is the
   obvious finish so a send inside an active window also *looks* live.

**How hard later:** **small.** Baileys exposes `sendPresenceUpdate('composing', jid)`; the work is
a length-proportional delay with jitter (reuse the Gaussian jitter already written for layer 2)
inserted at the one send chokepoint in the gateway, plus a test that the presence fires and the
delay is bounded. No schema change, no new table.

**Cost of deferring:** none — additive, touches only the gateway's send path, and layers 1–2
already provide the actual burst protection.

---

## D-25 · Outbound media (sending files) — ✅ **LANDED 2026-10-05**

> **Built.** `POST /api/v1/conversations/:id/attachments?filename=&caption=` takes the file as the raw
> request body (16 MB cap, `FILE_TOO_LARGE` otherwise). The type is decided from the bytes
> (`detectMediaType`): images, video, audio, PDFs and ZIP/Office containers are accepted; HTML, SVG and
> anything unrecognised is refused `415 UNSUPPORTED_FILE_TYPE`, never stored. `storeOutboundMedia`
> (`@crm/core`) stores it exactly like an inbound attachment (random key, per-org sha256 dedup) inside
> the request's tenant transaction, and the message is queued with `media_id` and the caption as its
> body, subject to the thread lock and `messages:send`. The gateway reads the file back from storage
> (`WorkContext.storage`) and `OutboundContent.freeform` now carries `media` (bytes + type + filename,
> replacing the unused `mediaUrl`); the Baileys adapter sends images/video/audio natively and the rest
> as a named document (`toBaileysContent`). It passes the same anti-ban pacing as any send. The web
> composer has a 📎 attach button (reply mode only). **Not built:** documents over 16 MB (WhatsApp allows
> ~100 MB), voice-note (`ptt`) sends, outbound media in campaigns, and templates with media (D-19).
> Original note kept below.

**What:** sending an image or document, not just receiving one. Inbound media is fully built —
downloaded, typed from magic bytes, stored, served, and shown in the thread — but the **send path
is text-only**: `POST /messages` takes only a `body`, and `handleSend` calls the provider with
`{ kind: 'freeform', body }` and no attachment.

**Why pinned rather than built now:** parked only to be scheduled deliberately, **not
deprioritised — this is the top of the queue.** It is the most visible half-built feature (you can
receive a CV but not send one back), and it is a contained vertical slice because the hard part —
storage, typing, unguessable keys, safe serving — already exists for inbound.

**What it takes (so it is not re-derived):**
- An **upload endpoint** (or multipart on `POST /messages`) that stores the file through the
  existing `StorageDriver` and creates a `media_asset` row, exactly as inbound does.
- Carry `media_id` on the queued `message` (the column already exists).
- Extend the send path: `OutboundContent` / `handleSend` pass the file to `provider.send`, and the
  Baileys adapter sends it as an image/document. The `ChannelProvider` port's `freeform(text,
  media?)` already anticipates this — `media?` is declared and unused.
- The composer in the web inbox gets an attach control.

**What brings it back:** it is the next build once the current one lands. No trigger needed beyond
scheduling it.

**Cost of deferring:** real but bounded — the product can receive files and not send them, which
is a visible gap for a CRM whose contacts send CVs. No data is lost by waiting; it is a missing
capability, not a defect.

---

## D-26 · Campaign body variation (spintax + per-recipient) — ✅ **LANDED (both halves)**

> **Built (2026-09-29):** the per-recipient rendering is done. `renderBody` in `@crm/core`
> (`body-variation.ts`) resolves **spintax** (`{Hi|Hey|Hello}`, nested, resolved first on the
> operator template) then fills **variables** (`{{name}}` / `{{contact.name}}` from the contact,
> inserted last so an odd display name can't corrupt the parse). `dispatchCampaign` renders each
> recipient's copy before encrypting it, so 500 sends are no longer 500 identical strings, and both
> campaign compose UIs hint at the syntax. **The identical-body guard is now built too** (2026-09-30):
> `dispatchCampaign` holds a sender to at most `IDENTICAL_BODY_DAILY_CAP` messages with the same
> `body_hmac` per rolling 24h (default 50), the excess left pending — moot when spintax varies the
> body, a real brake on a no-variation blast. The only remainder now is **richer variables beyond
> `{{name}}`** (e.g. custom fields), additive when wanted.

**What:** stop a campaign sending **byte-identical bodies** to everyone — spintax and
per-recipient variables so each rendered message differs, and the dispatcher refusing more than N
identical bodies in a window (`docs/06-features/F4-templates.md`, `08-antiban.md`). It is both a
template feature and an anti-ban signal.

**Why it was parked (and why it is fine to have waited):** the alpha *and* the beta are **closed**
(invited, controlled recipients, small volumes), so the identical-body ban signal is low-risk at
this scale and `do_not_contact` plus the other anti-ban layers cap the real exposure. It is now
prioritised because it rides with templates (**D-19**), which are prioritised — not because the
closed-alpha risk changed.

**What brings it back:** opening beyond the closed alpha/beta to real external recipients, or
campaign volumes large enough that repeated identical text becomes a fingerprint. Lands with D-19.

**Cost of deferring:** low while sends are small and to a known audience; it grows with volume and
openness. Worth stating plainly: **the engine's "refuse identical bodies" rule is not enforced
yet**, so this is a known soft spot, not a solved one.

---

## D-27 · Opt-out keyword handling (STOP / unsubscribe) — OUT OF ALPHA SCOPE (Kushal, 2026-10-06)

**What:** an inbound `STOP` / `UNSUBSCRIBE` (multi-language) that **automatically and irreversibly**
sets `do_not_contact` and drops the contact from every pending send. Distinct from the manual
`do_not_contact` flag, which exists — this is the *automatic* honouring of a person's reply.

**This is anti-ban first, compliance second.** Someone who cannot opt out just blocks or reports
the number instead, which tanks its quality rating and gets it banned (`08-antiban.md`) — so it
protects the number, not only a legal position, and is kept as engineering discipline whatever the
jurisdiction (the product bakes in no specific legal regime — see `09-security.md`).

**Why parked:** closed alpha/beta with invited recipients who can be opted out by hand, and the
manual `do_not_contact` gate already blocks sends — so the block/report risk is low at this scale.

**What brings it back:** the first recipient who is not on the team, or a public/open beta — once
strangers are messaged, an unhandled opt-out becomes a real block/report (ban) risk.

**What exists to build on:** `do_not_contact` / `dnc_reason` / `dnc_at` on `contact`, checked as
gate zero on every send. This is wiring inbound keyword detection to that gate, not new
infrastructure.

**Cost of deferring:** low while closed and small; **sharp** the day real strangers are messaged —
a missed opt-out becomes a block/report and a ban signal.

---

## D-28 · Dynamic audience segments ("segregation") — ✅ **MINIMAL SLICE LANDED 2026-09-30**

> **In plain terms.** A *segment* is a saved rule that picks people automatically, such as "everyone tagged
> `pune` who replied in the last 30 days". A tag is a fixed list you maintain by hand; a segment is a
> question the system re-asks every time, so the answer is always current. (The word "segregation" in the
> title was Kushal's shorthand for this: separating the contacts into groups.) What is built is the small
> version: tag, replied or never replied, and contacted within N days, combined with AND. It is used when you
> create a campaign, where it shows a live count of matches and can be saved as an "audience" for reuse. Rules
> like "city equals Pune" or OR-groups were left out on purpose, so it stays a CRM filter and not a query
> language.

> **Update 2026-10-10:** segments are now built **inline in the new-campaign form** (a filter with a live count,
> optionally saved for reuse); the standalone screen became **Saved audiences**, reached from Broadcast. One-off
> filters are `segment.saved = false`. Custom-field filters remain pinned (D-40).

> **Built (2026-09-30), minimal slice as scoped with Kushal.** A `segment` table (migration 0017,
> RLS forced) stores an allowlisted `definition`; `@crm/core` `segments.ts` turns it into a **bound**
> SQL predicate (`buildSegmentPredicate` / `countSegmentMatches`) — the JSON-to-SQL seam is closed by
> construction: only known keys emit SQL, every value is a bound parameter, unknown keys are dropped
> (and the API's `.strict()` zod rejects them). Criteria in this slice: **has-tag**, **replied
> ever/never**, **last-contacted-within-N-days**, AND-combined, with `do_not_contact` and soft-deleted
> always excluded. `GET/POST/DELETE /segments` + `POST /segments/preview` (live count); campaigns gain
> a fourth targeting mode `from_segment_id`, resolved and **frozen** in `snapshotAudience`/`previewAudience`
> like every other audience. A `/segments` page builds one (tag/reply/recency), previews the count, and
> saves; the new-campaign form can target a segment. **Deliberately not built** (the "not a query
> language" line): custom-field equals, AND/OR grouping, nested trees, more operators — add only on a
> concrete need.

**What:** a saved **filter** that re-evaluates on read — "everyone tagged `pune` who replied in the
last 30 days" — table `segment` (`kind`, a `definition` jsonb, a cached count), and a campaign
targeting it (resolve to contacts and freeze at launch, the snapshot rule that already exists).

**Why parked (and why the near-term work covers the need without it):** selecting people is handled
for now by **contact search + tags + an explicit id list** (being built) and by **whole-import
targeting** (already built). The dynamic filter is only needed for *criteria-based* audiences, and
it carries the one real risk — a **filter engine** that turns saved JSON into SQL, which must be
parameterised over an **allowlist** of fields, never string-built (injection). That is worth doing
deliberately, not in a rush.

**What brings it back:** wanting to target by criteria ("who replied", "in this city") rather than
by hand-picking or by import. Keep the filter small when built (has-tag, field equals, replied/not,
last-contacted-within-N-days, AND/OR) — a CRM, not a query language.

**Cost of deferring:** none for the near term — hand-pick (search + tags + explicit list) and
whole-import targeting cover it.

**Added 2026-10-20 (Kushal): the name "segment" is confusing; low priority.** It is jargon for a saved rule that picks a group
of contacts (tags, replied or not, last messaged within N days), re-checked each time it is used. It is **not required for the
core to work**: a campaign can go to a tag or to an import without it. What it adds is "A saved audience" and "Build a filter"
(with a live count) on the new-campaign page. The Segments screen is already folded into Campaigns, so the word shows up in only
a few places: the audience picker, the `/segments` page folder, the `/api/v1/segments` routes, the `segment` table and the docs.
To decide later: (1) rename what people see to **"Saved audience"** (the picker already says so) or "Smart list", and leave the
API and table names (renaming those is a migration and a breaking API change, rarely worth it alone); or (2) keep it and make it
earn its place with filters on custom fields such as city and skills (D-40, D-70).

---

## D-29 · An anti-ban "advisory mode" — warn but do not enforce — ✅ **BUILT 2026-10-06**

> **Update 2026-10-09:** do-not-contact is now actually enforced on every send path, and an admin can lift it per message or campaign (audited, with a reason); advisory mode still does not bypass it. The line below saying it stays hard is superseded.
>
> **Built** as a per-number `enforcement` setting (admin-only, reason required, audited via `sender.enforcement_changed`; `POST /senders/:id/enforcement`). Advisory lets a number past the pacing / health / recovery / contact-graph / recipient-hours holds and the identical-body cap, counting each bypass (`advisory_bypass_count`, `advisory_last_bypass`) and showing a persistent red banner on the Numbers page. `do_not_contact`, consent and a disconnected socket stay hard. The recipient-experience gates (engagement lock, 14-day cooldown, duplicate-campaign) are built too and overridable per campaign by an admin (`POST /campaigns/:id/start` with `overrideGates` + `reason`). The text below is the original pin.

**What:** an operator toggle that keeps the anti-ban engine **computing and surfacing** its
signals — the at-risk / cooling-off banners, the pacing reasons, the health score — but stops it
**enforcing** them. In advisory mode a send is not held, paced, capped, or paused: it goes out, and
the operator watches the warnings and accepts the risk themselves. Today every gate blocks; this
would make (most of) them advisory.

**Why parked — and it is *resisted*, not merely unbuilt.** The whole engine exists because a
Baileys number is unofficial and a ban is permanent with no appeal (`08-antiban.md`), and the design
draws a deliberate line: the hard gates — per-sender daily cap, rate/burst, warmup ceiling — are
*"overridable by nobody, including an admin, with no code path to do so"*, because *"an override
would be used the first time someone is in a hurry, which is exactly when the ceiling matters"*
(the `daily_cap_override` comment in `pacing.ts`, which may only *lower* a limit). Advisory mode is
precisely that code path. It is defensible for someone who **knowingly** accepts the risk — a
throwaway number, a test, or an official Meta number where the ban risk does not apply — but it is a
loaded footgun, so it is a deliberate decision to make carefully rather than a quick flag.

**Non-negotiable if it is ever built:**
- **`do_not_contact` and missing marketing consent stay HARD even in advisory mode.** They protect
  the *recipient*, not the number — a person who cannot be un-messaged is a compliance and
  block/report problem, not a pacing preference (`08-antiban.md`, the two-classes-of-gate split).
- **Admin-scoped, audited, and loud.** An `audit_log` row on every toggle, and a persistent
  "advisory mode — anti-ban is NOT enforced" banner wherever a number or campaign is shown, so it
  can never be left on by accident.
- **Scope decided explicitly:** per-sender or per-org `enforcement: 'enforce' | 'advisory'`, checked
  at each gate in `handleSend` / `dispatchCampaign` — advisory computes the decision, records the
  warning, then proceeds.

**What brings it back:** a concrete, evidenced operator need to send past a ceiling knowingly; or
the **Meta Cloud API adapter (P8)** landing — the official channel has no ban risk, so its pacing is
legitimately looser, and *per-transport policy* is a cleaner home for "looser" than a global
override bolted onto the Baileys path.

**Cost of deferring:** none — the safe default (enforce) holds, and it is what protects the asset.
Building it early mostly adds a way to lose a number in a hurry. The **visibility** half an operator
actually needs already exists: the Numbers-page at-risk / cooling-off banners and the per-recipient
campaign results show *why* a number is quiet without turning enforcement off.

---

## D-30 · Media that fails to store is invisible to the operator

**What:** when a received file's bytes cannot be stored, the message is kept and marked
`mediaUnavailable`, and **only a log line** records why — nothing surfaces it for an operator and there is
no retry. Related: no size cap on an inbound download (D-11 holds the quota question).

**Why parked:** Kushal pinned it (2026-10-05) while other work was prioritised. Nothing is lost — the
message text survives — it is a missing signal, not a defect in what is stored.

**What brings it back:** the first real "where did that CV go?" or a media-heavy deployment.

**What it takes:** record the failure on the message (an `error_code` for media), show it in the thread,
and add a retry that re-downloads through the live socket while WhatsApp still has the file.

---

## D-31 · Per-org encryption keys (the DEK/KEK design), and key rotation — ✅ **ROTATION BUILT 2026-10-13**; per-org keys still pinned (was **PRIORITY, Kushal, 2026-10-06**)

> **Built (rotation only, as chosen 2026-10-13):** a key ring (`ENCRYPTION_KEY_VERSION`, `ENCRYPTION_KEY`,
> `ENCRYPTION_KEYS_PREVIOUS`); the gateway re-encrypts `message.body_enc` and `channel_auth_state.value_enc`
> onto the current key in the background, per org, a batch per sweep, pausable, resumable; the API and gateway
> refuse to start if data sits on a key version the ring cannot read; `npm run keys -- status | generate`; and
> the **Security** page in the web app walks an admin through it. Tests: `tests/integration/key-rotation.test.ts`.
> **Still pinned:** per-org data keys wrapped by a master key (the DEK/KEK design), and crypto-shredding a
> tenant by destroying its key. The blind-index key (`ENCRYPTION_INDEX_KEY`) deliberately cannot rotate.

**What:** `docs/22-encryption.md` describes a two-layer design — a master key (KEK) wrapping a per-org
data key (DEK) — plus rotation. Today `LocalKms` encrypts directly with one global key, holds exactly one
key version, and has no backfill job, so rotation is impossible in practice and one key covers every org.

**Why parked:** pinned by Kushal (2026-10-05). It is not a vulnerability at one tenant, only a missing
capability: no cheap KEK rotation, no crypto-shredding for tenant erasure, a larger blast radius.

**What brings it back:** a second tenant, a real key-rotation need, or any erasure obligation.

**Cost of deferring:** it grows with every message stored — the refactor is cheapest before there is real
history to re-encrypt (22-encryption.md, "Not built yet").

**Note 2026-10-20:** one encryption key per organisation is a prerequisite for letting untrusted organisations share a database; it is listed as "later" in the roadmap in [`32`](32-onboarding-and-billing.md).

---

## D-32 · Encrypting contact identifiers (phone numbers and emails)

**What:** `contact_identity.value_normalized` holds phone numbers and emails in clear. `09-security.md`
lists `value_enc` among the encrypted columns — it does not exist. Encrypting needs the same
encrypt-plus-blind-index pattern message bodies use, with the UNIQUE constraint moved onto the digest.

**Why parked:** pinned by Kushal (2026-10-05). It also changes how contact search works (today a plain
`ILIKE`), so it should be decided together with D-23.

**What brings it back:** a deployment where a stolen database dump exposing every contact's number is not
acceptable, or any D-2 data-residency obligation.

---

## D-33 · P1 close-out and deployment

**What:** the compose file (`infra/compose/` is empty, so `docker compose --profile core up` does not
exist), the `email` and `secrets` drivers, and deploying anywhere — which is also when the production
database is chosen.

**Why parked:** held by Kushal (2026-10-05) — nothing needs it while the build is local.

**What brings it back:** the first deployment, or a second person who must run it.

**Note:** `ENCRYPTION_KEY` must be backed up separately from the database before any deployment.


**Decision (Kushal, 2026-10-06):** for now the `ENCRYPTION_KEY` lives locally in the `.env` file; back that file up separately from the database.

**Update (Kushal, 2026-10-13/14): hosting is cloud-only, and the plan is written.** [`docs/29-free-hosting-plan.md`](29-free-hosting-plan.md)
is the whole analysis. Constraints: no machine at home (the shelved homelab is out of reach); the AWS, Azure and
GCP free accounts were used in college and a card may not work; Oracle is burnt. **Finding:** no free, always-on
cloud host with 2 GB or more needs neither a card nor a first-time account. **Recommendation:** a 4 GB VPS paid by
UPI (about ₹600 first term, ~₹1,000/month renewal, in an India region), after a 72-hour test with one spare
number to see whether WhatsApp restricts the datacenter IP. **Open:** whether UPI works for him, whether
₹600–1,000/month is acceptable, whether the old GCP account is still active (the e2-micro Always Free tier is open
to existing customers), and whether Hiring Studios is a real company (startup credits). **What must be built on
our side either way:** production builds, a compose file, Caddy, migrations at start, a backup job, and an Arm/x86
test run (`infra/docker` and `infra/compose` are empty). Nothing is deployed.

---

## D-34 · 🔵 **META** The Meta Cloud API adapter (P8) and the real-number pilot

**What:** the official, paid transport (templates, the 24-hour window, tier and quality tracking) and the
controlled pilot `docs/08-antiban.md` calls for — one number, a 7-day warmup, ≤ 50 messages/day, watched
daily — which is also the only way to confirm anti-ban #5–#8 behave on real WhatsApp.

**Why parked:** held by Kushal (2026-10-05) as pending.

**What brings it back:** a need for anything business-critical to go over the official channel (P8), or
the decision to take the engine from the simulation to a real number (the pilot).

---

## D-35 · Contact export to Excel (.xlsx) · ✅ CSV and vCard export built (2026-10-06); `.xlsx` not

**What:** the admin contact export (built 2026-10-06 as CSV and vCard) as an `.xlsx` too. Pinned by Kushal
("just csv for now"). CSV opens in Excel already; `.xlsx` adds typed columns and a styled header, using the
`exceljs` dependency the import already carries.

**What brings it back:** someone asking for a formatted workbook rather than a CSV.

---

## D-36 · Contact import from a vCard (.vcf)

**What:** loading contacts from a phone's `.vcf` export (names, numbers, emails). Pinned by Kushal. The
shape is known: parse the vCard to rows and feed the existing import pipeline, the way an `.xlsx` is
converted to CSV, so duplicates and phone normalisation behave identically.

**What brings it back:** the first operator with their contacts on a phone rather than in a spreadsheet.

---

## D-37 · 🔵 **META** Meta tier and quality tracking, feeding the health engine

**What:** per Meta sender, poll the Cloud API for its **messaging tier** (250/day → 1K → 10K → 100K →
unlimited; Meta re-evaluates about every 6 h, advancing on unique customers over a rolling 7 days) and its
**quality rating** (green / yellow / red, driven by blocks and reports). Store both on the sender, show them
on the Numbers page, and feed them into the same health scoring and pacing: yellow slows, red pauses, and the
daily ceiling follows the tier instead of the Baileys warmup curve.

**Why parked:** pinned by Kushal (2026-10-06). Meaningless without the Meta adapter (D-34); every send today
goes over Baileys, which has no tiers or quality ratings.

**What brings it back:** D-34 landing.

---

## D-38 · 🔵 **META** Meta template submission, approval status, and the template-only window

**What:** the Meta-specific half of D-19 and D-18: submit a template to Meta for approval, sync its status
(approved / rejected / paused) back, and surface a rejection reason. Outside the 24-hour customer-service
window, only an approved template may be sent, so the composer shows the window countdown and locks to
templates once it closes (`conversation.window_expires_at` already exists for this).

**Why parked:** pinned by Kushal (2026-10-06). Needs D-19's template model and the adapter first.

**What brings it back:** D-34 and D-19.

---

## D-39 · 🔵 **META** Per-transport pacing policy and the Meta inbound/status webhooks

**What:** (a) pacing limits chosen **per transport**, so an official Meta number is legitimately looser than a
Baileys one, instead of one global policy (this is also the cleaner home for what advisory mode, D-29, is a
blunt version of); (b) the Meta **webhooks** that carry inbound messages, delivery/read statuses and quality or
template updates into the same ingestion and receipt paths Baileys events use today.

**Why parked:** pinned by Kushal (2026-10-06). Part of the Meta adapter's surface.

**What brings it back:** D-34 landing.

---

## D-40 · Custom fields in imports, segments, and exports

**What:** custom fields (defined per org, built 2026-10-06) work on the contact screen, over the API, and as
`{{key}}` in campaign messages. Not yet: mapping a spreadsheet column onto a field during import, a segment
filter such as "city is Pune", and a typed column per field in the CSV export (it still dumps them as one
JSON cell). Also: renaming a field's label or editing a select's options after creation.

**Why parked:** the first version was kept small (Kushal, 2026-10-06).

**What brings it back:** the first import that carries columns an operator wants as fields.

---

## D-41 · The gateway runs outside row-level security — ✅ **BUILT 2026-10-13** (was **PRIORITY, Kushal, 2026-10-06**)

> **Built:** every piece of gateway work now runs through a handle pinned to the owning org (`apps/gateway/src/tenant.ts`): each statement drops to `crm_app` and sets `app.org_id`, so Postgres refuses another org's rows. The sweeps list org ids with one privileged query and fan out per org; id-driven work (a send, a link, a connection event, a receipt) looks up its org first. Tests: `tests/integration/gateway-tenancy.test.ts`, and the whole gateway suite now runs as `crm_app`. **Still open:** the Baileys credential store (`channel_auth_state`) is read and written by the provider with only a sender id, outside this handle; it is encrypted and keyed by sender, but not yet tenant-scoped.

**What:** the API sets the org on every request (`setTenant`), so the database itself refuses cross-org
rows. The gateway process mostly does not: `handleSend` and the sweeps (`sweepPendingWork`,
`dispatchCampaigns`' first query, read receipts, entropy, health scoring) query the database directly, so
there row-level security is not the safety net — only each query's own `WHERE org_id` is. (Per-campaign
work in `dispatchCampaigns` does use `tenantRunner`; the rest does not. Confirm the gateway's DB role
bypasses RLS when fixing.)

**Fix:** have the gateway enter the owning org's tenant transaction (`tenantRunner`) before each unit of
work — list work across orgs with a narrow privileged query, then run each job under `setTenant`. Add a
test that a gateway job for org A cannot touch org B's rows.

**Why parked:** harmless while one team (plus JobPortal) shares an install; becomes a real cross-org risk
the moment unrelated customers share one. Pinned as priority by Kushal.

**What brings it back:** now, as priority; certainly before any multi-customer hosting.

---

## D-42 · Human takeover from an AI agent, inside a conversation — ◐ partly built 2026-10-21

> **2026-10-21:** the working version is simpler than the design below. A chat belongs to whoever is its assignee, and the assistant only
> answers an **open chat assigned to it**, so assigning the chat to a person (or resolving it) is the takeover, and a reply it was
> still writing is dropped. Not built: the `automation_state` column, hand-back notes for the AI to read, and a "Take over" button.

**What:** when an AI agent is talking with a contact (a candidate, say), a person can stop it and continue the chat
from there, and optionally hand it back. Requested by an end user, 2026-10-09.

**Shape (design notes, nothing built):**
- A per-conversation `automation_state` (`auto` | `paused_by_human`) with who, when and an optional reason.
- A visible "Take over" / "Hand back" control in the thread header; the thread shows who has control.
- While paused the AI worker must not send, and inbound messages are routed to humans only; the composer unlocks.
- Every switch is audited. The thread lock (assignee) and all anti-ban pacing still apply to a human's messages.
- Hand-back can carry a note ("candidate asked for a call tomorrow") for the AI to read.

**Why parked:** the AI / automation runtime (F9) does not exist yet, so there is nothing to take over from. The
conversation model, thread lock and audit log it would build on all exist.

**What brings it back:** the first AI agent that sends on a number (F9), which must ship with this control.

---

## D-43 · Extra restriction-alert channels (webhook, email, canary self-test)

**What:** the silent-restriction tracker (docs/27, built 2026-10) alerts **in the app only**: a banner, a timeline and
a nav badge. Not built, by choice: an outbound webhook (Slack / Discord / JobPortal), email, and a **canary
self-test**, a few test sends a day from each number to a team-owned phone, the most reliable way to catch a delay on
an otherwise idle number.

**Why parked:** Kushal chose in-app only (2026-10-09). Email needs a provider configured; webhooks wait for F8.

**What brings it back:** an operator who is not looking at the app when a number is restricted.

---

## D-44 · Baileys 7 upgrade

> **Duplicate of D-5 (Baileys 7.x), noted 2026-10-25.** Both pins describe the same upgrade. The project has run 7.0.0-rc14 since 2026-10-23 (PR #161, docs/45); track the rest (a stable 7.0.0, the release-candidate watch) under D-5. This section is kept for its history.

**What:** moving from `baileys` 6.7.24 to the 7.x line. **Not required** (assessed 2026-10-09): npm `latest` is
7.0.0-rc14, still a release candidate, and 6.7.24 is the `legacy` tag, not deprecated and already patched for the known
advisory. Reports exist of 7.x rcs failing QR pairing where 6.7.23 worked, and of 463 timelocks on rc13.

**What would break:** inbound identity (LID becomes the primary address, the phone number moves to `remoteJidAlt`; our
`storeInboundMessage` keeps one identity per message, so phone contacts would fork into `wa_lid` duplicates); stored
sessions migrate one way to LID addressing (snapshot `channel_auth_state` first; a rollback is a re-link); more auth-state
key types (`lid-mapping`, `device-list`, `tctoken`, ...) and a heavier Postgres key store; `isJidUser` is now `isPnUser`;
`chats.phoneNumberShare` is replaced by `lid-mapping.update`; `fetchLatestBaileysVersion` is brittle; new WASM/libsignal
dependencies. The imports we use compile unchanged, and only `packages/channels/baileys/src/{index,auth-adapter}.ts`
touch Baileys.

**What brings it back:** a stable 7.0.0, or WhatsApp breaking 6.x. Do D-45 first. Needs a throwaway number to test.

---

## D-45 · Link a `@lid` address to its phone number — ✅ **BUILT 2026-10-10 (PR #6)**

> **Built:** the adapter reads `key.senderPn` / `participantPn` and `chats.phoneNumberShare`, the gateway links the
> address to the phone before storing the message, and `linkLidToPhone` adds the identity or merges two contacts.
> Limits stand: WhatsApp only sometimes supplies the number. The text below is the original pin.

**What:** messages from a `...@lid` address carry no number, so the contact shows none. Baileys 6.7.24 already exposes
the number sometimes: `message.key.senderPn` / `participantPn`, and the `chats.phoneNumberShare` event (`{lid, jid}`).
Our adapter ignores both. Reading them would attach a phone identity to the `wa_lid` contact and merge it into the
existing phone contact when one matches. WhatsApp does not always supply it (people who hide their number may never
resolve), and 6.x has no on-demand lookup.

**Why parked:** offered to Kushal, not yet scheduled (optional PR 6 of the 2026-10-09 plan). It is also the same change
D-44 would force, so doing it first de-risks the upgrade.

---

## D-46 · UI responsiveness — the app feels laggy when used fast — **HIGH PRIORITY (Kushal, 2026-10-22)**

> **2026-10-22:** Kushal: "the whole interface is laggy asf; sometimes it is fast but most of the times it takes a lot of time from
> clicking to screen changes to reflect." Raise this **first whenever he starts anything else.** Evidence so far (session audit,
> `docs/37-session-audit-findings.md` on branch `test/session-audit`): in `next dev` every first visit to a page compiles it
> (2.6 to 8.5 s); the Contacts page is about 1 MB of HTML with 158 forms for 50 rows (6 to 9.5 s to open, about 3.4 s per search);
> sign out took 2 to 10 s; Mikhil's "All chip still loading after 2 minutes" is the same family (his prod runs on
> `localhost:5001`: **check whether that is a dev server**). **Work order:** (1) re-time the same clicks on a production build
> (`next build && next start`) to separate dev-compile time from real slowness; (2) slim the Contacts rows (lazy row controls, one
> shared do-not-contact form; D-89); (3) a pending indicator on every navigation and button (done for contacts tags and campaigns in
> PRs #104 and #106, and on 14 more buttons in the pending-buttons PR: sign out, tag ticked, create draft from checked, do-not-contact, save fields, remove tag, add field, enforcement switch, segments); (4) slow-query check on the contact list and tag filter (`searchPredicate`).

**What:** Kushal reports (2026-10-10) that the web app lags when he clicks through it quickly. His idea: keep Next.js
only for the few screens that need live updates (the inbox/thread) and make the rest (campaigns, contacts, import,
numbers, saved audiences) plain client-side React pages.

**What we know (not yet measured):** the inbox polls by `router.refresh()` on a timer
(`apps/web/app/inbox/auto-refresh.tsx`), which re-runs every server component for that route; the thread composer and the
Numbers link panel also poll; every page is a server-rendered round trip through the web server to the API, and local
use is `next dev`, which compiles each route on first visit. Which of these dominates is **unverified** — the first step is
to measure, not to rewrite.

**Candidate steps, cheapest first:** (1) measure on a production build (`next build && next start`) — dev mode alone may
explain much of it; (2) cut polling work: refresh only the thread list or message list, not the whole route, and back off
when the tab is hidden; (3) cache/dedupe the API reads the layout repeats on every navigation; (4) client-side data
fetching with a cache (e.g. SWR/React Query) for the list-heavy pages, so moving between them does not re-render on the
server; (5) only then the bigger split — a plain React SPA for the non-live pages — which is a large change that touches
auth forwarding (the UI forwards the user's session) and every server action.

**Why parked:** needs a measurement first, and a rewrite is a scope call for Kushal.

**What brings it back:** decide after step 1–2 numbers; step 5 only if they are not enough.

---

## D-47 · Signup page, billing gate and beta-tester override — **PARKED (Kushal, 2026-10-20): not working on this for now**

> **2026-10-17:** a **front-end-only** sign-up page exists at `/signup` (PR #53): it checks the fields in the browser and says nothing
> was created. The open decisions below still gate connecting it to a backend.

**What:** there is **no signup page** today — accounts and orgs come only from `npm run admin` (or the admin API).
Kushal wants a simple one (2026-10-10): a person signs up, and then (a) if they have **paid**, they land in the app
(or are sent to Billing to pay), and (b) a **beta tester** is sent to sign in, because an admin can **override the
payment requirement** for them so they can use the product without paying.

**Open decisions (ask before building):** which payment provider and whether payment is real in alpha (Billing is a
placeholder page today); whether signup creates a new *org* (self-serve tenant) or a user inside an existing org;
email verification (email is an optional driver, so a non-email path is needed); how a beta override is stored
(a per-org flag set by an admin, audited, with a reason — same shape as the DNC and gate overrides); abuse limits
(signup is the first unauthenticated write endpoint: rate limit, CAPTCHA/bot cost, org-slug squatting).

**Why parked:** it touches money, tenancy and the first public write route, so it needs Kushal's calls above first.

**What brings it back:** Kushal choosing the payment provider and the signup-creates-org question.

**Plan written 2026-10-20 (priority):** invite-only beta first, teammates added by an org admin (reset password, revoke access, never delete), payments after reading [`33 · Payment providers`](33-payment-providers.md); the design is in [`32 · Setup, signup, teams and billing`](32-onboarding-and-billing.md). **Documents only; no implementation until the alpha test is complete.**

**2026-10-20:** parked again (it had been raised to priority with the billing plan). Not working on it for now; docs [`32`](32-onboarding-and-billing.md) and [`33`](33-payment-providers.md) are the reference.

---

## D-48 · Security test suite (OWASP)

**What:** a deliberate, repeatable security test pass against the running app, mapped to the **OWASP Top 10** and
**ASVS** for the API and the web UI. Candidate free / open-source tooling to evaluate (to be checked online before
choosing, not yet verified): **OWASP ZAP** (baseline + API scan in CI), **Nuclei** (template-based checks),
**Semgrep** (static rules for Node/TS/Next), **osv-scanner / `npm audit`** (dependencies), **gitleaks** (already in
CI), **Schemathesis** (property-based API fuzzing once an OpenAPI spec exists), and a hand-written suite for what
tools miss in *this* app: cross-org access (IDOR) on every route, CSRF on session routes, session fixation/expiry,
login throttling, file upload and download headers, and authorization by role/scope.

**Why parked:** needs the tool survey and a decision on what runs per-PR versus nightly; some pieces want an OpenAPI
spec (P9) first.

**What brings it back:** before any real customer data, and before the deployment decision (D-33).

---

## D-49 · Revamp the browser (e2e) suite to industry standard, covering every UI element

**What:** the Playwright suite grew feature by feature. Rebuild it on current best practice: **page objects /
fixtures** instead of copy-pasted selectors, role- and label-based locators only (no CSS), per-test isolated data
(no shared dev DB noise), **accessibility checks** on every page (`@axe-core/playwright`), a **coverage map** of
every page, control and state (empty, loading, error, permission-denied) so "all UI elements" is measurable,
cross-browser and mobile-viewport projects, deterministic waits (no sleeps), trace/video on failure, and a
smoke / full split so PRs stay fast. The live walkthrough (`tests/live/`) stays separate and manual.

**Why parked:** large, and best done after the UI settles (D-46 responsiveness may change the page structure).

**What brings it back:** the UI stops moving, or a regression the current specs miss.


---

## D-50 · Test the frontend and backend independently (modularity check)

**What:** prove the two halves really are separable. **Backend alone:** exercise the API purely over HTTP with no
browser and no web app (contract tests against an OpenAPI description, once it exists; Schemathesis-style
generation). **Frontend alone:** run the web app against a **mocked API** (e.g. MSW or a recorded fixture server) so
every page renders and behaves with no real backend, which also proves the UI only talks to the API over its
documented contract (`CRM_API_URL`). Add an automated **boundary check** (e.g. `dependency-cruiser`/ESLint import
rules) that fails if `apps/web` imports server code from `packages/*`/`apps/api` or the reverse.

**Why parked:** depends on the OpenAPI spec (P9) for the contract half; the boundary check could be done sooner.

**What brings it back:** P9, or the day a second client (JobPortal, a mobile app) consumes the API.

---

## D-51 · Deleted-message tracking

**What:** WhatsApp lets a person "delete for everyone", which reaches us as a revoke event for a message we
already stored. Today we do not act on it: the thread keeps showing the original text as if nothing happened.
Pinned (Kushal, 2026-10-10): record that a message was deleted, by whom (the contact, or one of our own
agents from the phone), and when.

**Shape when it arrives, so it is not re-derived:** the gateway turns the revoke into an event, the message row
gets `deleted_at` and `deleted_by` (the body is kept encrypted for audit unless an operator purges it), the
thread shows "this message was deleted" in place of the text with the original reachable by an admin, and a
`message.deleted` row goes in the audit log. Open question for Kushal: keep the original visible to agents, or
hide it as WhatsApp does for the recipient. Edited messages are the sibling case and could share the work.

**Why parked:** pinned, not scheduled.

**What brings it back:** Kushal's go-ahead, or the first "where did that message go?" from an agent.

---

## D-52 · Deleting previous campaigns — 🔺 **PRIORITY (Kushal, 2026-10-23, unparked after Mikhil's feedback)** (was PARKED 2026-10-20)

**What:** campaigns can be cancelled but not deleted, so old drafts, cancelled runs and test campaigns pile up
in the Broadcast list (the dev database holds dozens). Pinned (Kushal, 2026-10-10): an operator needs to
delete previous campaigns.

**Shape when it arrives:** delete is allowed only for `draft`, `cancelled` and `completed` campaigns, never
a running or paused one. Prefer a soft delete (`deleted_at`, hidden from the list) so the messages already
sent, the per-recipient results and the audit trail stay intact; offer a purge for drafts that never ran. It
must not release the recipient-experience gates (a contact messaged by a deleted campaign is still inside
the 14-day cooldown), and it writes a `campaign.deleted` audit row. A "delete all cancelled" bulk action
would also clean up test runs.

**Update 2026-10-23, unparked:** Mikhil's testing feedback fixed deletes for contacts, tags, numbers and custom fields (#105, with a reusable confirm dialog) but **not campaigns**, which still cannot be deleted, so every test run stays in the Campaigns list. Kushal raised it again: priority.

**Scope for the build (adds to the shape above):**
- A **Delete** button on a campaign's page and a row action in the list, only for `draft`, `cancelled` and `completed`; for a running or paused one the button says "Cancel it first" instead of failing.
- **Reuse the confirm dialog from #105** ("Delete campaign 'Welding drive'? Its messages stay in the chats; people stay in the book") and show what is kept: the sent messages, the per-recipient results (as an archived, read-only record), the audit trail and the 14-day cooldown.
- **Bulk:** tick several campaigns, or "Delete all cancelled and drafts", with the same confirmation and the count.
- **Soft delete first** (`deleted_at`, hidden from the list; an admin can view "Deleted campaigns" and restore), plus a **purge** for a draft that never ran. A message sent by a deleted campaign keeps its `campaign_id` (the FK is `ON DELETE SET NULL`, so a hard delete would orphan the sender line "Campaign <name>" of D-112; soft delete avoids that).
- **Who:** admins; an agent's request goes through D-114 once that exists.
- **AI campaigns (#157):** deleting one must not leave chats the AI took over stranded; the chats stay with the AI or are handed back, and the page says which (ties to D-100, D-112).
- Audit row `campaign.deleted` (and `campaign.restored`), no message text in it.

**Tests:** an integration test for each allowed status and the refusals for running and paused, that sent messages and results survive a soft delete, that the cooldown still applies, restore and purge; a browser test of delete, the confirmation and the bulk action.


**2026-10-20:** parked again. Not working on it for now.

---

## D-53 · Assignment model and message authorship — ✅ **BUILT** (authorship PR #26; owner + participants PR #27; 2026-10-11)

> **Built:** every outbound message records the signed-in agent (`sent_by_user_id`) and the thread names them
> ("Campaign" for bulk sends, "API" for an integration). The owner is the existing `assignee_user_id`; participants
> are a `conversation_participant` table, **admin-only to add or remove**, may reply, and count under "Mine";
> reassigning drops the old owner. **Not built from the table below:** per-person workload counts and capacity,
> bulk reassign, "reassigned" events shown inline in the thread, `collaborator`/`watcher` roles.

**The questions, answered so they are not re-asked:**

| Question | Today | Proposed |
|---|---|---|
| **Two or more chats assigned to one person?** | **Works.** `conversation.assignee_user_id` is per chat, so one person can own any number. There is no view of workload and no cap. | Keep. Add a count per person on the assignee list and in a "My chats" header, and optionally a per-agent capacity (Chatwoot and Respond.io both have one) that auto-assignment respects. |
| **One chat assigned to several people?** | **Not possible.** The column holds one user. | Keep **one owner** and add **participants**: a `conversation_participant` table (`conversation_id`, `user_id`, `role` = owner / collaborator / watcher, `added_by`, `added_at`, RLS like `internal_note`). The owner is who the chat is "assigned to"; collaborators are added by @mention or by the owner. This is also the table D-17 already wanted, so it is paid for once. |
| **What does the thread lock do with several people?** | Only the assignee (or an admin) may reply. | Owner and collaborators may reply; watchers may only add notes. Unassigned chats are open to everyone. A reassignment writes an audit row and an inline event in the thread. |
| **Who is typing / viewing?** | Nothing. | D-17: presence on the same realtime channel, per participant. |
| **Who wrote each message?** | **Stored in the schema, never written, never shown.** `message.sent_by` and `message.sent_by_user_id` exist, but replies from the UI record `sent_by = 'api'` and leave the user empty, and the thread shows no author on outbound messages (only notes show one). | Record the signed-in user on every reply (`sent_by = 'agent'`, `sent_by_user_id`), `campaign:<id>` for broadcast sends, `api` for an API key, `bot` later. Show a small author name and avatar on each outbound bubble and a "via campaign X" label on broadcast messages. Inbound messages show the contact, and the number they arrived on. |

**Edge cases to decide when it is built:**
- When the owner leaves the org or is deactivated, the chat becomes unassigned (the column already
  `SET NULL`s) and an audit row says why; collaborators stay.
- A contact with chats on two numbers is two conversations, so two possible owners. Keep that, and show the
  other conversation as a link in the contact panel.
- An admin and an API key bypass the lock today; keep that, and record who acted either way.
- Bulk reassign (everything of a leaving agent to another) belongs with this work.

**Why parked:** pinned as a priority, not scheduled; it needs Kushal's go-ahead on the owner-plus-participants
shape before any migration.

**What brings it back:** Kushal's go-ahead. Authorship (writing `sent_by_user_id` and showing it) is a
small first slice that needs no realtime and can ship alone.


---

## D-54 · Typing indicator and the "just replied, send anyway?" warning — ✅ **BUILT 2026-10-13** (PR #32)

> **Built:** typing pings from a reply box with text (every 3 s, 8 s lifetime); "Priya is typing…" in the header
> and on the inbox row; `POST /messages` returns `409 COLLISION` naming the person when another agent replied in
> the last 15 s or is typing, and the composer offers Send anyway (`acknowledgeCollision`). API keys are exempt.
> Text replies only; sending a file does not check. Migration 0026 adds `conversation_presence.typing_at`.

The second slice of [D-17](#d-17). The first slice (who has a chat open, by heartbeat) shipped in PR #28; this is
the rest of what D-17 describes, split out so it is tracked on its own.

**What it is:**
- **Typing indicator:** "Priya is typing…" in the thread header and on the inbox row while someone has a
  non-empty draft in the composer. The composer would send a throttled signal (about once every 3 s while keys
  are being pressed) and the indicator expires about 6 s after the last one.
- **Collision warning:** when you press send and someone else typed or replied in the last few seconds, ask
  "Priya just replied. Send anyway?" instead of sending straight away.

**Why it was not in the first slice:** Kushal chose viewing-only first (2026-10-11) to see whether presence is
useful before adding keystroke traffic. Typing is chattier than a 12 s heartbeat, so it wants a look at load.

**Shape to decide when it is built:** the same polling channel as presence (probably a `typing_at` column on
`conversation_presence`, no new table) versus live push (SSE), which only pays off if 5 to 15 s of lag feels
wrong. The reply lock stays the hard rule; this stays a soft warning.

**What brings it back:** Kushal's go-ahead. Raised to priority with D-17 and D-53.

---

## D-55 · Licence enforcement ("DRM"): usage is blocked when an org has not paid — pinned, **to be revisited last** (Kushal, 2026-10-13: "will come to it in the end") — **PINNED, research later (Kushal, 2026-10-20)**

**What:** if an org (or a self-hosted install) has not paid, the product should stop being usable, not just show a
billing page. Companion to [D-47](#d-47) (signup, billing gate, beta override): D-47 decides who gets in and
how they pay; this is the enforcement that makes "unpaid" actually mean "blocked", everywhere, including the
API and the gateway.

**Open decisions (ask before building):**
- **Hosted or self-hosted?** For a hosted install the entitlement is a per-org state we control, and it is fully
  enforceable. For a self-hosted install the buyer holds the code and the database, so nothing is unbreakable; the
  honest options are a signed licence key checked at startup and on a timer (offline, expiring), or a periodic
  phone-home. Which of those matches the licence in [D-3](#d-3)?
- **What "blocked" means:** read-only (inbox and exports still open so a customer can leave with their data),
  sends and campaigns stopped, or fully locked? A grace period after a lapsed payment?
- **Where it is enforced:** it must sit on the paths that cost money or risk a number, not just the UI: the API
  write routes, the API-key path (an integration must not bypass it), and the gateway's send chokepoint so an
  already-queued campaign stops too. One check, not one per route.
- **The override:** the beta-tester override from D-47 (an audited per-org flag with a reason) is the one way
  through; nothing else should skip it.

**Why parked:** it touches money, tenancy and the licence, and needs the payment provider (D-47) and the
hosted-versus-self-hosted call before any design is honest.

**What brings it back:** Kushal's go-ahead with D-47, and the hosted/self-hosted answer.

**Plan written 2026-10-20 (priority):** limits for seats and numbers in one place, read-only when payment lapses, the operator override as the "paid" switch; see [`32`](32-onboarding-and-billing.md) section 5 and [`33`](33-payment-providers.md). **Documents only; no implementation until the alpha test is complete.**

**2026-10-20: more research and planning needed.** Research how projects whose **source code is available** enforce payment and licences, and what actually works against copying: study open-source and source-available products that sell licences (for example OpenVPN, Proxmox, Grafana, and others with open core or enterprise keys) and write down how each does it: signed licence files, phone-home checks, feature flags for paid tiers, enterprise-only code, and the licence terms that carry the real weight when the code can be read. Decide what is realistic for a product whose code is visible, then plan.

**Research written 2026-10-20:** see [`34 · Licensing and enforcement`](34-licensing-and-drm.md). Kushal's requirement: only the developers authorise who may use the software, and use is highly restricted outside the organisation. That rules out open-source and the public source-available licences; the fit is a **proprietary, all-rights-reserved licence with a private repository and a signed agreement per customer**, ideally **hosted by us**, plus an offline-checked signed licence token for limits (seats, numbers, expiry) with soft-then-read-only lapse. The "what other products do" table there is from memory and marked verify; more examples (and the actual licence pages of Proxmox, Grafana, OpenVPN, GitLab) still need reading.

**2026-10-20:** back to pinned; the research in [`34`](34-licensing-and-drm.md) stays as the starting point, and more examples wait.

---

## D-56 · Telemetry: metrics, tracing and error tracking beyond logs — pinned (Kushal, 2026-10-13)

**Decision:** logging is enough for now; telemetry is pinned, not scheduled. Kushal's rule (2026-10-13): "if
logging is there that's enough, else add logging."

**What exists today (so nobody re-checks):**
- Structured JSON logs (pino) to stdout, UTC, sensitive fields redacted by allowlist; pretty in development.
  In dev, `npm run dev:all` also writes `.dev-logs/{api,gateway,web}.log` (not rotated); `npm run verify` writes
  `/tmp/crm-verify-<time>/`. In production they go wherever the container runtime captures stdout.
- A request id on every API request, present in the logs and in error bodies.
- `GET /health` and `GET /ready` (database check).
- Product state in Postgres that doubles as telemetry: `audit_log`, `sender_health_event`, per-number health and
  risk score, per-message `hold_reason`, campaign progress.
- A `TELEMETRY_DRIVER=none|prometheus|otlp` setting that reserves the names; nothing reads it.

**What is missing:** metrics, traces, error tracking, alerting (see D-43), dashboards, log shipping and rotation.

**Shape to build when it comes back:** a `/metrics` endpoint with the few numbers that matter (queue depth, sends
and holds by reason, per-number risk score and delivery ratio, re-encryption progress), log rotation plus a
deployment note on where logs go, and error tracking only once a vendor is chosen. Most useful as the
observability for the real-number pilot, which is a week-long watch.

**What brings it back:** the real-number pilot, a hosted deployment (D-33), or the first incident that logs alone
cannot explain.

---

## D-57 · Run the import commit as a background job — pinned (2026-10-15)

**What:** `POST /imports/:id/run` does the whole import inside the HTTP request. Behind a Cloudflare tunnel
the request is cut at 100 seconds (a 524, see [30 · Cloudflare Tunnel](30-cloudflare-tunnel.md)), which at the
measured 2.4 ms per row is about 40,000 rows. The import would likely still finish on the server, but the
person sees an error, retries, and meets "already committed".

**Shape when it arrives:** the run endpoint returns at once with the run id; the gateway (or a sweep) works
through the rows in batches; the UI polls `GET /imports/:id` for progress. Most of the plumbing exists:
`import_run.status` and `counts`, the per-row `import_row` ledger, and its `UNIQUE (import_run_id, row_number)`
that makes a killed run resumable from the last committed batch.

**Why parked:** real files so far are well under the ceiling, and the alpha can state it.

**What brings it back:** the real-number pilot with a large export, or the first 524.

**Question (Kushal, 2026-10-21): could the table be built in the browser first, and the backend parse, validate and security-check it before anything is committed?** Yes, and it is a second way to fix the same problem. The rule that makes it safe: **the browser is only a convenience; the server re-checks every row** with the same code it uses today (`packages/core/src/ingestion.ts`: phone normalisation, the personal-column rule, the field and size limits), because anything the browser sends can be faked.
- *Shape:* the browser reads the sheet (a CSV/Excel reader library) and shows the preview instantly with no upload; on Import it sends the rows in **batches** (say 500 at a time). Each batch is a short request that the server parses, validates and commits through the existing `import_row` ledger (`UNIQUE (import_run_id, row_number)` makes a repeated batch harmless), and the page shows a progress bar. No request nears the 100-second cut-off, so D-57's 524 cannot happen.
- *Gains:* an instant preview, a progress bar, resumable by row number, no job runner needed.
- *Costs and risks:* the whole file sits in the browser's memory (fine to roughly a few hundred thousand rows, then it struggles, and worse on phones, D-72); closing the tab pauses the import (a server job keeps going); the original file is no longer received unless it is also uploaded, so the SHA-256 duplicate check and the audit copy (`storage_key`) need the file to be uploaded too; and there are two parsers to keep in agreement (the browser's preview must not promise what the server will refuse). The server stays the only writer, so no security check moves to the client.
- *Versus the server job above:* the job is simpler to trust (one parser, survives a closed tab, keeps the file). Batching from the browser feels better to use and needs no background worker. They combine: upload the file once for the audit copy and the duplicate check, then either drive the batches from the page or let a server job do it.
- *Not decided.* Recommended first step when it comes back: the server job, since it keeps one parser; add the browser-side preview only if the wait before the preview becomes a complaint.

---

## D-58 · Public site and launch-readiness checklist — pinned (Kushal, 2026-10-15)

**What:** a list of things a public-facing site or page normally needs, pinned so it is not lost. Kushal's list,
verbatim in intent:

| # | Item | # | Item |
|---|---|---|---|
| 1 | Custom 404 page | 11 | Sticky mobile CTA |
| 2 | CTA above the fold | 12 | Loading states |
| 3 | Meta title per page | 13 | Form error states |
| 4 | Meta description per page | 14 | Thank-you page |
| 5 | Open Graph image | 15 | Privacy policy page |
| 6 | Favicon set | 16 | Terms page |
| 7 | `robots.txt` | 17 | Cookie banner |
| 8 | `sitemap.xml` | 18 | Analytics installed |
| 9 | Alt text on every image | 19 | Real contact address |
| 10 | Mobile breakpoints | | |

**Read this against what the product is.** The CRM is a signed-in application, so most of this list (a CTA,
Open Graph, a sitemap, a thank-you page, a cookie banner, analytics) belongs to a **public marketing or
sign-up page** that does not exist yet (signup is D-47). Items that apply to the app itself today: 1 (the app
has no custom 404), 3 (page titles), 6 (favicon), 9, 10 (mobile breakpoints), 12 (loading states), 13 (form
error states) and 7 (`robots.txt`, to keep a private tool out of search engines). Items 15 and 16 interact
with D-16, which was struck out as not this repository's to ship; they come back only with a hosted offering.

**Why parked:** pinned, not scheduled. Nothing here blocks the alpha.

**What brings it back:** a public landing or signup page (D-47), or the hosted offering (D-33).

## D-59 · File support in chat (Kushal, 2026-10-16) — 🔺 **PRIORITY AGAIN (Kushal, 2026-10-21): files in campaigns first** (was pinned, research later, 2026-10-20)

> **2026-10-21 (Kushal): "bring file support to campaigns back to priority."** First slice: a campaign can carry one image or GIF (the message
> text becomes its caption), chosen on the new-campaign form and sent to every recipient through the same pacing as text; the AI assistant's
> `create_campaign` tool should be able to attach a file that already exists. This needs the campaign to point at a stored file (a `media_asset`),
> the dispatcher to send media with a caption, and a preview on the campaign page. The rest of this entry (multiple files, drag-and-drop, paste,
> bigger uploads, voice notes, a Files tab, manual Retry) stays pinned behind it.

**What:** sending and receiving files in a conversation, taken as one feature: what works today, what is
rough, and what is missing. Raised as a priority on 2026-10-16.

**What exists:**

- **Receiving:** the gateway downloads inbound files through the socket, types them from magic bytes, stores
  them under an unguessable key, dedupes per org by sha256, and the thread shows a download link
  (filename, type, size). Served only through the authenticated route, always as a download, never inline.
  Access is audited (`media.downloaded`). Proven end to end against a real WhatsApp file (D-11, D-14).
- **Sending (D-25):** the composer's attach button posts one file (raw body, 16 MB cap); images, video, audio,
  PDF and ZIP/Office files are accepted, HTML and SVG are refused; it passes the same anti-ban pacing as text.
- **Found 2026-10-15:** through the web UI, any file over **1 MB** failed (`Body exceeded 1 MB limit`),
  because uploads go through a Next.js server action. Fixed in #39 (`bodySizeLimit: 25mb`), so before that
  the 16 MB cap only held for API callers.

**What is missing or rough:**

| Item | Today |
|---|---|
| Composer | One file at a time. No multiple files, no drag-and-drop, no paste of an image (the input has no `multiple`, and nothing handles drop or paste) |
| Large documents | Capped at 16 MB; WhatsApp allows about 100 MB |
| Voice notes | Not sendable (`ptt`) |
| Inline preview | Deliberately none: images are download-only, which is a security choice (D-11), so a preview means a separate, safe thumbnail path |
| A file that fails to store | Round 1 (PR #60): retried three times and the thread says why it failed. Still missing: a manual **Retry** button. It needs the original WhatsApp message kept (so the file can be fetched again) and a way for the API to ask the gateway to do it (they are separate processes) |
| Files in campaigns | ✅ **First slice built 2026-10-21** (below the table). Was: not supported; text only. **Pinned 2026-10-17 (Kushal): add images and GIFs to campaigns** (one picture or GIF sent with the campaign message, caption = the message). Not this round; needs the campaign model to carry a media file, and WhatsApp sends a GIF as a looping video, so the type handling from round 1 comes first |
| Files in templates | Waits on D-19 |
| At rest | Not encrypted, no retention job, no virus scan (**D-11**) |

**✅ Built 2026-10-21 (Kushal): a campaign can carry one picture or GIF.** Images (JPG, PNG, WebP) and GIFs only; **MP4 and other video are refused for now** ("MP4 videos are not supported yet. Use a picture or a GIF"). Up to **5 MB**, decided from the file's bytes and enforced on the server (the form checks first and says why). The campaign message is the caption. On the new-campaign form: drop or choose a file (uploaded at once), a preview, **Remove**, and **"Use one I uploaded before"** (pictures are kept per organisation: `media_asset.campaign_picture`). The campaign page shows the picture and says it is sent with the message as caption. The dispatcher creates each message with the file (`content_type` image or video, `media_id`), so pacing, anti-ban and do-not-contact apply exactly as for text. **A GIF is converted at upload** (ffmpeg, in the container image now) to a silent looping H.264 clip and sent as a video with GIF playback, because WhatsApp has no animated image type; the original GIF is kept for the preview (first frame, via the existing safe thumbnail route). If ffmpeg is missing, GIF upload is refused with that reason and pictures still work. **The AI assistant's `create_campaign` takes `pictureName`**: it finds a picture already uploaded by the words in its file name, asks which one when several match, says so when none do, and never invents a file. Migration 0036 (`campaign.media_asset_id`; `media_asset.campaign_picture`, `gif_playback`, `source_asset_id`). Still pinned: MP4/video, an image on an AI template (next round), a Files tab, deleting a picture, and per-recipient personalised pictures.

**Open decisions (ask before building):** which of the rows above are the actual pain (multi-file and
drag-and-drop? bigger documents? seeing images in the thread?); whether inline preview is wanted at the cost
of a thumbnail pipeline; whether files should be encrypted at rest before more are stored (it is expensive
to retrofit, D-11).

**Why a priority:** a CRM whose contacts send CVs needs the file path to be dependable; the 1 MB defect shows
it had not been exercised through the UI.

**Decided 2026-10-16 (Kushal): chat files get a *virtual* folder, not a physical one.**

Where a file sits is not what ties it to a chat. A file belongs to a chat only through the database:
`message.media_id` to `media_asset`, then `message` to `conversation` to `contact` (that chain is also what
authorisation walks on every download). A physical `chats/<conversationId>/` directory was rejected because:

1. **It breaks dedup.** Files are deduplicated per org by sha256, so a CV forwarded into five chats is stored
   once today; a folder per chat would store it five times.
2. **A chat is not stable.** Contact merges and `@lid` linking (`packages/core/src/identity-linking.ts`) move
   messages between conversations, which would mean moving files and rewriting every `storage_key`.
3. **Nothing needs it.** The key never has to say which chat a file is in.

So the keys stay opaque (`org/<orgId>/media/<uuid>.<ext>`, built only by `mediaKey()`), and the per-chat "folder"
is a **Files tab on each chat**, plus one **Files list** for the org with filters (type, date, contact, direction),
both queried from `media_asset` joined through `message`. Downloads keep going through `GET /api/v1/media/:id`
(authenticated, attachment-only, audited). Not built yet. Content-addressed keys (`org/<orgId>/blobs/<sha256>`)
are a possible later layout once files live in a bucket.

**Cleanup design (not built; today nothing deletes a file and nothing calls `storage.list`):**
- *Orphans:* a `media_asset` that no message points at, after a grace period, is deleted with its object. With
  dedup, a file shared by two chats survives until the last reference goes.
- *Delete one chat:* remove that chat's messages' references, then collect orphans.
- *Erase one org:* `storage.list("org/<orgId>/")` and delete (the only intended caller of `list`).

**Still open:** encrypt files at rest before or after the bucket move (D-11, D-63); retention window (docs/09 says
a year); an inbound size cap and a per-org quota (inbound is uncapped, D-30); virus scanning (ClamAV, about 1 GB
RAM); which of the gaps in the table above to build first.

**What brings it back:** now, as a priority; the choices above come first.

**2026-10-20: more research and planning needed before round 3.** Rounds 1 and 2 are merged (file types, failed-download reasons, image previews). Round 3 is multi-file, drag-and-drop, paste, bigger uploads, voice notes, the Files tab, manual Retry, and images and GIFs in campaigns. Plan it properly before building.

**2026-10-20:** where files can be stored (Microsoft 365, Google, bring-your-own bucket, managed by us for a monthly fee) is written up under D-63.

**2026-10-20:** back to pinned; round 3 and the research wait.

---

## D-60 · Number fallback: message the first number that has a WhatsApp account — ✅ **BUILT 2026-10-16**

> **Built.** A contact can hold several phone numbers (the importer now reads cells like `98…, +91…`, D-21). The
> first is the primary and is the one messaged. Before the first send to a contact **with more than one number**,
> the gateway asks WhatsApp whether the primary has an account, and uses the next number that does.

**How it works** (`apps/gateway/src/number-fallback.ts`, called from `handleSend` after the pacing gates and the
pre-send pause):

- **The lookup** is Baileys' `onWhatsApp` (a contact-sync query on the sending number's session), exposed on the
  channel port as the optional `isRegistered(sender, phoneE164)`: `true`, `false`, or `null` when it could not be
  asked. Baileys returns only numbers that exist, so "absent" means no account and "no result" means unknown.
- **Order:** primary first, then the others in the order they were added. A known, fresh answer is used without
  asking. **One lookup per number**, stored on `contact_identity` (`wa_registered`, `wa_checked_at`, migration
  0029), trusted 30 days if it has an account and 7 days if not.
- **The first number with an account wins.** If it is not the primary it is **promoted to primary**, so every later
  message goes straight to it; the switch is written to the audit log (`contact.number_switched`, actor `system`).
- **If none has an account** the message is **not sent** and fails with `no_whatsapp_number`, instead of going to a
  number that cannot receive it and costing the sender its delivery ratio.
- **It never acts on "could not tell".** A closed socket or a failed query leaves the primary in use; nothing is
  switched or stored on a guess.
- **A contact with one number triggers no lookup at all**, because there is nothing to fall back to. That keeps
  lookups to the minority of contacts that need them (36% of rows in the real Naukri sample).
- **Switch:** `SEND_VERIFY_FALLBACK_NUMBERS` (default `true`); `false` always messages the primary.

**Why it is shaped this way:** a stream of existence lookups from one session is the pattern community reports link
to restricted numbers (anecdote; not measured here), so it is one number per send, cached, only when a fallback
exists, and inside the paced send path rather than a sweep at import time.

**Not built, and not tested on a real number:** a permanent *send* error as a second trigger for the switch; showing
"sent to the second number" in the thread; refreshing a stored answer on a schedule; ordering numbers at import
(the order written is kept). Tested with the fake channel only (`tests/integration/gateway-work.test.ts`, "number
fallback"): the `onWhatsApp` path has **not** been run against the real linked number.

---

## D-61 · Lighter web tier: plain React with refresh buttons instead of Next everywhere — pinned (Kushal, 2026-10-16)

**What:** replace the server-rendered Next.js app with a plain React single-page app on most screens, and keep
live updating only where it earns its cost. Pages that do not need to move on their own (contacts, import,
broadcast, saved audiences, security) get a small **refresh button** instead of polling or server rendering; the
inbox and the number-linking screen stay live. Motivation is resources: the Next server is its own always-on
process.

**What it costs today** (measured, `docs/19-capacity.md`, 2026-10-11): the web process is about **170 MB** of RAM
and is **not optional**, next to the API (about 265 MB) and the gateway (about 340 MB with one number). Every page is
also a server-rendered round trip, and the inbox refreshes by re-running every server component of the route on a
timer. That is the same thing D-46 reported as laggy, and 2026-10-15 measurement found the contacts page growing
with people x tags (fixed in #40).

**Shape when it arrives:**
- A static React bundle served by the API (or any file server), no Next process. The API already accepts the
  browser's cookie session with CSRF (the web app forwards the same cookies on the person's behalf today), so the
  SPA can call the API directly and the server-side forwarding layer, the server actions and the 25 MB
  server-action limit (added in #39) all go away.
- Live pieces (inbox, link screen) poll a small JSON endpoint instead of re-rendering a route; a refresh button
  elsewhere. SSE or websockets only if polling proves too coarse (see D-17/D-54, which settled on polling).
- It overlaps D-50 (test the front and back end independently): a static SPA against the HTTP API is exactly that
  boundary.

**Open decisions (ask before building):** which pages are "few" that stay live; whether the SPA keeps Next as a
build tool only, or moves to Vite; what to do about the work already in the server actions (the import flow, the
problem box, the contacts page); and whether the saved 170 MB matters yet (it does at the 2 GB box, less at 4 GB).

**Why parked:** large (it touches every screen and the auth hand-off), and it needs the "measure first" step D-46
asked for: a production build is already about 0.8 s on the heaviest page.

**What brings it back:** a smaller box than 4 GB, the D-46 lag on a production build, or D-50.

---

## D-62 · Ship as a single executable, if possible — pinned (Kushal, 2026-10-16)

**What:** one file that runs the app, instead of a Docker image plus a process supervisor. Today the alpha is one
container running three processes (`infra/docker/entrypoint.sh`): API, gateway and the Next web server, with
Postgres separate.

**What "single executable" can realistically mean here:** one **application** binary plus an external Postgres.
Postgres cannot be folded in (the system leans on row-level security, `LISTEN/NOTIFY` and a role switch, D-20).

**What is in the way, and the options** (research 2026-10-16 from the Node, Deno and Bun docs and comparison
pages; none of this was tried on this codebase):

| Option | Status | Fit |
|---|---|---|
| **Node single executable applications (SEA)** | Built into Node, but runs **one embedded CommonJS script**; native addons and files read from disk need workarounds | This code is ESM TypeScript with the native `@node-rs/argon2`; needs a bundling step to one CJS file |
| **`@yao-pkg/pkg`** | A packager that uses the same Node ABI, described as the most compatible with npm and native addons | The lowest-risk way to try |
| **Deno `compile`** | Embeds assets with `--include`; native Node addons need `--self-extracting` | Different runtime (V8 still); Baileys compatibility untested |
| **Bun `bun build --compile`** | Fastest, smallest binaries, but JavaScriptCore rather than V8, and trouble reported with packages that load `.node` files | Riskiest for Baileys and argon2 |
| **Next.js `output: 'standalone'`** | Smaller deployment, but still needs a Node runtime; not an executable | Helps size only |

**The blockers that matter:** the Next web server does not fit in an executable, so **D-61 comes first** (a static
SPA is just files the API serves); the API and gateway can already run in one process (`PROCESS_ROLE=all`), but
they were split on purpose so an API restart does not drop WhatsApp sockets (`docs/04-architecture.md`), which a
single binary must either keep as two entry points or accept losing; and the native argon2 and Baileys' crypto
are exactly what packagers trip on.

**Why parked:** depends on D-61, and the Docker image already gives a one-command install, which is what the alpha
needs.

**What brings it back:** D-61 landing, or a target that cannot run Docker.

## D-63 · Centralised file store: S3-compatible storage alongside local (SMB pinned too) — ✅ driver built 2026-10-16, default stays local (Kushal, 2026-10-16)

**What:** one shared place for files that the API, the gateway and any future second host can all reach, and that
survives the machine being replaced. Local disk is fine while everything runs in one container; it stops working
the moment two processes run on different hosts.

**Built:** an S3-compatible `StorageDriver` (`packages/providers/storage/s3`, package `@crm/storage-s3`, using
`@aws-sdk/client-s3`) behind the existing port, so nothing above it changed.

- **Choose it with `STORAGE_DRIVER=s3` (or `minio`).** `filesystem` is still the default and what the alpha uses.
- **Settings:** `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (all required once chosen), `S3_ENDPOINT`
  (unset for AWS; set for Cloudflare R2, Backblaze B2 or MinIO; required for `minio`), `S3_REGION` (default
  `auto`), `S3_FORCE_PATH_STYLE` (default on for `minio`, off for `s3`). A missing one stops the app **at boot**
  with the name of what is missing; it never falls back to local disk. Blank values (as the compose file passes
  them) count as unset.
- **Behaves like the filesystem driver:** the content type is stored as object metadata (no sidecar); `delete`
  answers truthfully (it checks existence first, since S3 deletes silently); `list` treats a prefix as a
  directory (`org/a` never matches `org/ab/...`); every method validates the key through the same
  `assertValidKey`. **Difference:** `list` reports `application/octet-stream` for every object, because a bucket
  listing carries no content type; `stat` gives the true one.
- **Still no signed URLs, on purpose** (D-11): every download is resolved through the database and streamed by the
  API, so the bucket can stay private.

**Tested:** the shared contract suite (`tests/contract/storage-driver.ts`, 25 tests) passes against the S3 driver
using **moto, an S3 emulator**, in CI as a service container and locally through `S3_TEST_ENDPOINT`. MinIO's own
images could no longer be pulled from Docker Hub or Quay when this was written (both refused), so it was not used.
**Not tested:** against a real Cloudflare R2, Backblaze B2 or AWS bucket, and not with the API and gateway running
on `STORAGE_DRIVER=s3` end to end (they see only the port, which the contract covers).

**Not built (follow-ups, in this order):**
1. **Decide encryption at rest** (D-11) before any real deployment points at a bucket.
2. **A copy job** from the local directory to the bucket. **Switching an existing install to S3 does not move its
   files:** they stay on disk and stop being found, because rows keep `storage_driver` and `storage_key` as they
   were. Do not switch a database that has files without copying first.
3. The **Files tab and Files list** (D-59), then the **cleanup job** (D-59), then **retention** (D-11).

**Open decisions (ask before building):** R2, B2, AWS or a self-hosted MinIO; one bucket for all orgs (the keys
are already org-prefixed) or one per org; whether to also keep a local copy during the move.

**Added 2026-10-21 (Kushal): also support SMB** (a network file share: a Windows share, a Samba server or a NAS), pinned in this spec and not built. Two ways, and they combine:
1. **Mount it, no code (works today).** The operating system mounts the share (on Linux, a CIFS mount) at a folder, and `STORAGE_DRIVER=filesystem` points at that folder. Nothing in the app changes. Good enough for one host or several hosts that each mount the same share.
2. **A native `smb` driver** behind the same `StorageDriver` port, chosen with `STORAGE_DRIVER=smb`, for when the app should connect to the share itself (a container with no mount privileges, or a clear error at boot when the share is unreachable). Settings would follow the S3 pattern: `SMB_HOST`, `SMB_SHARE`, `SMB_USERNAME`, `SMB_PASSWORD` (and `SMB_DOMAIN`), `SMB_BASE_PATH`; a missing one stops the app at boot naming what is missing and never falls back to local disk.
Things to settle before building the driver:
- **Which SMB library** (a maintained pure-JavaScript client versus shelling out to the system's tools); not chosen.
- **Version and security:** SMB 2 or 3 only (SMB 1 is insecure and is refused), SMB 3 encryption on the wire where the server offers it, and the password kept in the environment like the S3 secrets, never in the database.
- **Same behaviour as the other drivers:** the content type needs a place to live (the filesystem driver keeps a `.meta` sidecar file, which a share can hold too); `delete` answers truthfully; `list` treats a prefix as a directory; every method validates the key through `assertValidKey`. Windows shares are often case-insensitive and have path-length limits and reserved names, so the key rules need a check against those.
- **Weaker guarantees than local disk:** renames and locking are not as dependable over a network, and a dropped connection mid-write must leave no half file. The write path needs write-to-temporary-then-rename, tested.
- **Same test:** the shared contract suite (`tests/contract/storage-driver.ts`) must pass against it, using a Samba container in CI the way moto stands in for S3.
Still in D-63's order: the same follow-ups apply (decide encryption at rest first; a copy job before switching an install that already has files).

**Why a priority:** raised together with file support in chat (D-59); the alpha's local disk will not survive a
move to a split deployment (D-33).

**Other places to keep files (2026-10-20, Kushal asked: what if a customer has Microsoft 365 Premium with 5 TB, or Google premium storage, or should we charge monthly for managed storage?).** Everything goes behind the existing storage driver (`packages/providers/storage`, built for local disk and S3-compatible); a new place is a new driver, not a rewrite.

| Option | What it is | Good | Watch out for |
|---|---|---|---|
| **Local disk** (today's default) | Files on the server | Simple, free | One machine; backups are yours |
| **Any S3-compatible bucket** (built) | AWS S3, Cloudflare R2, Backblaze B2, Wasabi, Hetzner, MinIO | Cheap, standard; R2 has no egress fee; customer can bring their own bucket | A consumer with only Microsoft 365 or Google storage usually has no bucket |
| **Customer's OneDrive / SharePoint (Microsoft 365)** | Microsoft Graph API; an app-folder permission (`Files.ReadWrite.AppFolder`) keeps the app inside `Apps/<app name>`; or a SharePoint document library for a company | Uses storage they already pay for (a 5 TB plan) | OAuth tokens that expire and must be protected; throttling; chunked upload for big files; the folder stays **visible** to the user; a personal account ties files to one person (if they leave, files go), so prefer a company SharePoint site; Microsoft's docs disagree on which account types the app-folder scope covers, so verify |
| **Customer's Google Drive / Workspace** | Drive API with a narrow scope (`drive.file`) or the hidden app-data folder | Same: their storage | Same OAuth and quota issues; Google's app-data folder is hidden from the user (a plus and a minus); quotas not verified here |
| **Dropbox / Box** | Their APIs | Some customers live there | More drivers to maintain |
| **WebDAV / SFTP** | Nextcloud, many NAS boxes, some SharePoint setups | One driver reaches many self-hosted options | Speed and reliability vary |
| **Managed by us** | We keep their files in our bucket and **bill monthly** by storage used (for example per 50 GB) | Nothing for the customer to set up; we control backups and encryption | We carry the cost and the risk: egress fees, a per-org quota, retention, backups, and **encryption at rest first** (D-11); price it with a margin |
| **Hybrid** | Recent files with us, older ones moved to the customer's storage | Controls our cost | More moving parts |

For any customer-owned cloud the design is the same: files are **served through us** (no raw links, so the access check and the audit log still apply), the tokens are encrypted, a failed upload is visible (D-30) and retried, and a per-org setting chooses the driver. **Questions for Kushal:** which customers actually ask for this; managed storage as a paid add-on or included; and whether the first extra driver is "bring your own S3-compatible bucket" (cheapest to build) or Microsoft 365 (most requested by small offices). Sources: [Microsoft Graph app folder](https://learn.microsoft.com/en-us/graph/onedrive-sharepoint-appfolder). The Google Drive details were not found in this research and must be read from Google's documentation. (Raised under the label D-23; it is about files, so it lives here and in D-59.)

**2026-10-20:** back to **pinned** (Kushal). The S3-compatible driver stays built and the default stays local; the storage-options write-up above is the starting point when this returns.

---

## D-64 · Database portability: move the database-side logic into the app so other databases can work — pinned (Kushal, 2026-10-16)

**The question asked:** was the code written only for Postgres, and should every function, trigger and bit of
database-side logic move into the JavaScript so it could run on, say, SQLite (which has no such features)?

**Answer: it is written for Postgres, deliberately and deeply.** Measured on `main`, 2026-10-16:

| What leans on Postgres | How much |
|---|---|
| **Row-level security** (the tenant isolation: 24 policies, `ENABLE`/`FORCE` on every tenant table) and the role switch that makes it apply (`SET LOCAL ROLE crm_app` plus `set_config('app.org_id', …)` in `apps/api/src/tenant.ts`, `apps/gateway/src/tenant.ts`, `packages/db/src/security-check.ts`) | The foundation of multi-tenancy. A forgotten `WHERE org_id` is a denied read, not a leak. SQLite has nothing equivalent |
| **`LISTEN`/`NOTIFY`**: the gateway's command channel (`apps/gateway/src/main.ts`, `work.ts`), woken by the trigger function `notify_gateway()` and three triggers (`channel_session_link_requested`, `channel_session_unlink_requested`, `message_queued`) | How the API tells the gateway to send, link or unlink without polling. SQLite has no notifications; it would be polling |
| **Database functions**: `notify_gateway()` and `envelope_key_version()` (an indexed expression) | 2, in 3 of the 29 migrations |
| **`FOR UPDATE … SKIP LOCKED`** in campaign dispatch (`packages/core/src/campaigns.ts`) and `FOR UPDATE` in the campaigns route | Safe concurrent claiming of campaign recipients |
| **Postgres types and operators** in the schema and the queries: `jsonb` and `->>`, arrays, `bytea`, `uuid`, `timestamptz` casts, `gen_random_uuid()`, `now()`, `interval`, `ON CONFLICT`, `RETURNING`, `LATERAL`, partial indexes, `FILTER (WHERE …)`, `unnest`/`ANY` | 41 files of application code use raw SQL (the `sql` template tag) at about 254 `execute()` call sites; the schema is Drizzle's **`pg-core`** (`packages/db/src/schema.ts`); the driver is `postgres` (`packages/db/src/client.ts`) |
| **Privileges and roles**: a restricted `crm_app` role, `REVOKE UPDATE, DELETE` on the audit log | Part of the security model, not a convenience |

So moving "the functions and triggers into JS" is **not a small refactor**. The two functions and three triggers are
the easy part (the notify trigger becomes an in-process call or a polling loop). The hard parts are **tenant
isolation**, which is enforced by the database today and would have to be enforced by hand on every query
(exactly the failure mode M-series defects came from), and **every raw query**, which would need a portable form.
It would also lose guarantees that are tested today: the "no `org_id` filter at all" isolation tests and the
append-only audit log.

**Shape if it is ever done (a decision, not a plan):**
1. A `DbDriver` seam like the other ports (`docs/18-providers.md`): Postgres adapter keeps RLS and `NOTIFY`; a second
   adapter does application-level tenant scoping and polling.
2. Replace raw SQL with a portable query layer (Drizzle's query builder, which D-1b already parks) one module at a
   time, with the integration suite run against both.
3. Treat tenant isolation as an application-enforced property with its own cross-tenant test sweep (D-48).
It matches **D-20** (SQLite for single-machine installs): a single-tenant, one-machine SQLite mode is far smaller
than a portable multi-tenant core, because with one tenant there is no isolation to re-implement.

**Why parked:** the product is multi-tenant on Postgres by decision (2026-09-27), the alpha runs on a Postgres
container, and nothing asks for another database. It is a re-architecture, not a flag.

**What brings it back:** a concrete need to ship a single-machine install without Postgres (D-20), or a managed
database that cannot run these features.

**Cost of deferring:** it grows with every new raw query and trigger. New database-side logic should stay behind the
helpers that already wrap it (`setTenant`, the gateway command channel) rather than spread.

---

## D-65 · Bugs found running the alpha container on a VM (2026-10-17), not fixed — **PARKED (Kushal, 2026-10-20): not working on this for now**

Found by using the app for real (sign in, link a number, import, Team, Numbers) on a throwaway VM. Fixed and merged
the same day: the missing phone after linking, the terminal-only Numbers/Security/sign-in text, Import-before-Preview,
multi-email cells (#46, #47). **Still open:**

1. **False "possible ban" alarm.** Pressing **Try again** after an unscanned QR makes the gateway log the number out,
   WhatsApp answers 401 (nothing was ever linked), and the app shows two red notices ("WhatsApp logged this number
   out: check the phone first", "refused the saved login"), logs "number logged out by WhatsApp - possible ban" and
   left the number at "Degraded", risk 60. Nothing was banned. Likely fix: do not log out a number that has no stored
   credentials; do not raise the ban alarm for a 401 on a link attempt that never connected.
2. **Dead-end card** after that: no Link/Try again button until the page is reloaded.
3. **QR lasts about 55 s and sits below the fold** on a tall card; easy to miss.
4. **Browser tab title is "Inbox" on every page** (root layout metadata).
5. **Import counts:** the preview counted a row that the commit then merged as a duplicate of an earlier row; the
   summary does not mention the merge ("27 would be created", "26 created", 29 read, 2 errors).
6. **A bad email fails the whole row** even when the phone is good. Option: import the contact and warn about the email.
7. **Contacts shows inbound-only contacts by raw `...@lid` ids** with "no contact details".
8. **Security wizard step 2** (put the new key in the server's settings and restart) is manual by design; the web never
   sees the current key. A button that applies it would need a deliberate security decision first.
9. **Login over plain `http://` cannot keep a session** (Secure cookie); there is no test-install setting for it.
10. **Alpha container connects to Postgres as a superuser**, so row-level security is not enforced (log warning); fine
    single-tenant, not for several orgs.

**Note: this came up while the other dev (Mikhil) was alpha testing** (2026-10-20). His words, the screenshots and Kushal's decisions are in [`dev-feedback-issues.md`](../dev-feedback-issues.md). Issue-9 ([#71](https://github.com/Kushalr3ddy/whatsapp-crm/issues/71)): after scanning the QR the Linked numbers card still says "Not connected" until the page is reloaded. **Decisions:** auto-refresh when the link succeeds; once linked, grey out "Link this number", "Scan a QR" and "Type a code"; "linked" and "connected" mean the same, so use only "Linked".

✅ **Issue-9 built 2026-10-20 (PR #73):** the Linked numbers card refreshes itself the moment a scan succeeds; "Link this number", "Scan a QR" and "Type a code" are greyed out once linked; the word is "Linked" everywhere (Linked / Not linked / Linking…). The other bugs listed in this pin are still open.

**2026-10-20:** parked. These will be retested on a **new VM later, with Claude having full access over SSH**, so the fixes are done against a real deployment. Still open: the false "possible ban" alarm, the QR below the fold, tab titles, import count wording, a bad email failing a whole row, raw `@lid` ids in Contacts, the stale "Degraded" score. Only the stale "Not connected" card is fixed.

---

## D-66 · Motion on most pages, not just the sign-in screen — pinned (Kushal, 2026-10-17)

The sign-in screen has an animated background and Kushal likes it. He wants the same life across **most pages**: quick,
subtle motion inside the app (pages ease in, buttons press, cards lift on hover, stat numbers count up, skeleton
loaders while data loads, small toasts, a typing indicator and presence dots in the inbox), with the showy kind kept to
sign-in. Decided with it (2026-10-17): **one sans-serif font throughout**, a small set of consistent hand-drawn SVG icons
(no icon library, no UI library), light and dark on every page, and everything honouring `prefers-reduced-motion`.
Direction (clean light, brand sidebar, soft and friendly, or a mix) is chosen from the mockups in `mockups/` (git-ignored)
before any page is restyled. Direction A and Inter were chosen; the sign-in screen, Overview and shared styles carry the motion in PR #53. Most other pages still to do.

**Added 2026-10-19 (Kushal): loading animations for the few tasks that take a long time** (an import commit, a campaign
starting, a number linking, a big search). A visible animation with a plain-words label ("Importing 160 contacts…"), not just
a disabled button, so nobody thinks it froze. D-57 (import as a background job) is the same wish for imports.

**Added 2026-10-20 (Kushal):**
- **Look at how other SaaS products animate** (sign-in, onboarding, dashboards, loading, empty states) before choosing more motion; collect examples.
- **Sign-in transition:** when Sign in is clicked, the button **expands to cover the whole screen** and the app opens on the dashboard (a "burst" reveal).
- **Sign-in screen animation:** after the cash flows back to the organisation, a **revenue box pops up** (extends the lead scene in `apps/web/app/login/lead-scene.tsx`; no currency symbol, as before).
- **Theme changer at the top right** of the page, not the bottom left of the sidebar, with a **sun / moon icon** next to the Light / Dark text.
- **The "N" badge in the bottom corner** (the Next.js development indicator, shown only while running `next dev`): hide it, or confirm it does not appear in a production build (`devIndicators` in `apps/web/next.config.ts`).

---

## D-67 · Save a number or name onto a `@lid` chat, like "add contact" in WhatsApp — **pinned again (Kushal, 2026-10-21; it was the priority on 2026-10-20)**

Some chats arrive from WhatsApp with a hidden `…@lid` id instead of a phone number, so they show as a raw id in the
inbox and Contacts (see D-65). Kushal wants, at the top of such a chat, an **Add number / contact** action that works like
saving a new contact in WhatsApp: type the phone number and a name, and the chat is joined to that person (merged with an
existing contact if the number is already known). He also suspects the automatic lid-to-number mapping is not working;
check that first (does the gateway ever learn the number for a lid, and is it stored?). Pinned to come back to; not started.

**2026-10-20: more research and planning needed.** First find out why the automatic `@lid` mapping is not working. Research questions to answer before any build:
- **Which chats should never become contacts?** `@newsletter` addresses (channels), communities, groups and WhatsApp broadcast lists. Groups and `status@broadcast` are already skipped on the way in; check newsletters and communities too, and decide whether broadcasts should be ignored everywhere.
- **Unknown numbers.** What happens when a stranger who is not a contact messages in: spam, promotions, random people? Does it create a contact and a conversation? Options to weigh: a separate "unknown senders" inbox (see D-10), a block or mute action, rate-limiting or auto-archiving, and keeping spam out of campaign audiences.
- **The `@lid` mapping itself:** does the gateway ever learn the real number, and is it stored?

**Decisions (2026-10-20, Kushal):**
- **Ignore `@newsletter` chats and similar** (channels, communities, WhatsApp broadcast lists). Today only groups (`@g.us`) and `status@broadcast` are skipped on the way in (`packages/channels/baileys/src/index.ts` ~503); nothing skips newsletters or other broadcast addresses, so they would create contacts and conversations.
- **Alert the user on a message from an unknown number** (someone who is not a saved contact): a clear notice on the thread or in the inbox saying "message from an unknown number", with the pushed name if there is one, so spam and promotions are recognised and not mistaken for a customer. Related: D-10 (unknown senders).
- **Find out why the automatic `@lid` mapping is not working.**

**Findings from reading the code and the Baileys build (2026-10-20; not run, so unconfirmed in practice):**
1. The mapping has only two sources today. (a) `key.senderPn` / `participantPn`, which Baileys copies from the stanza's `sender_pn` / `participant_pn` attribute, **present only when WhatsApp includes it, which it often does not for privacy addresses**. (b) The `chats.phoneNumberShare` event (`index.ts` ~378), which fires only when the other person shares their number.
2. **Not used at all:** Baileys' `contacts.upsert` and `contacts.update` events. A `Contact` there carries **both `lid` and `jid`**, which is exactly a lid-to-number pair, plus `notify` (the name the person set for themselves) and `name` (the name saved on the linked phone). Nothing in the repo listens to them, so every pair WhatsApp already sends is thrown away. The history sync is another source.
3. **Baileys can give the person's own chosen name.** Every inbound message carries `pushName` (the display name the sender set for themselves; the same as `notify`), which the gateway does not store. A profile picture (`profilePictureUrl`), an about text (`fetchStatus`) and a business name (`verifiedName`, `getBusinessProfile`) can also be fetched. The phone number cannot be read from a name; only from the pairs in (1) and (2).
4. So the likely reasons the mapping seems broken: WhatsApp does not send `sender_pn` for these chats, we ignore the contact events that do carry the pair, and the display name is never saved, so a lid chat shows as a raw id.

**Next steps (research, then plan):** confirm on a real linked number which events arrive for a lid chat (log, do not store); decide to store `pushName` on the contact; add listeners for contacts events; write the ignore list; design the unknown-sender notice; then the "add a number to this chat" action.

**2026-10-20:** the only research item that is priority is **why the `@lid` mapping is not working** (findings above). The rest of this pin (ignoring newsletters, the unknown-number alert, the add-a-number action) follows from it.

**Results of the live investigation (2026-10-20, one real linked number, shapes only; supersedes findings 1-4 above where they differ).** A diagnostics switch logged what arrived, never a number, name or text:
- **The `@lid` mapping works when WhatsApp sends the number.** 13 of 13 real incoming messages from `@lid` addresses carried the sender's phone number (`senderPn`) and the sender's own chosen name (`pushName`). The database confirms it: that person is one contact holding **both a phone identity and the `@lid` identity**, with all 15 of their messages in one conversation. No failure reproduced in this sample.
- **The contacts events do not help**, contrary to the earlier guess: 14 `contacts.update` events arrived, all with a name the person chose (`notify`), **none with a `@lid`/number pair**. No `phoneNumberShare` event arrived at all. So the only working source today is `senderPn`; if WhatsApp omits it for some chat (privacy settings, first contact), the mapping has nothing to use. That is the remaining gap, and it was not seen this time.
- **Newsletters leak in.** Two incoming messages came from a `@newsletter` address (a channel the number follows), and the database now holds a **contact and a conversation named with the raw newsletter address** (29 characters, no phone). This is the confirmed bug behind "ignore `@newsletter` chats". Groups and the status list were already skipped (one group message arrived and created nothing).
- **Noise to ignore:** 361 of the 377 logged messages were `fromMe` echoes or empty stubs (our own sends and history sync) with no content; they are already skipped.
- **`pushName` is present on every real incoming message and is not stored.** Saving it would give each contact the name they chose for themselves instead of just their number.
- **Fix list now:** (1) skip `@newsletter`, other broadcast lists and communities in `#emitInbound` (`packages/channels/baileys/src/index.ts`), with a test in `mapping.test.ts`; (2) store `pushName` as the contact's name when the contact has none; (3) the unknown-number alert on first contact; (4) the add-a-number action for a `@lid` chat that arrives **without** `senderPn`. The diagnostics commit stays on the local branch `diag/lid-events`, unpushed.

**Estimate (asked 2026-10-21; my estimate for the app as it is now, nothing measured):** the pieces still open, with a rough size each, including tests and a PR:
1. *Keep the sender's own chosen name (`pushName`) as a setting:* small, about **half a day to a day** (a per-organisation switch, the gateway saves it as the contact's name only when the contact has none, a test).
2. *Unknown-number alert:* medium, about **1 to 2 days**. Today every first message from a stranger already creates a contact, so the work is deciding what "unknown" means (no saved contact versus never replied to), marking it on the contact, showing the notice on the thread and in the inbox, and keeping those people out of campaign audiences if wanted.
3. *"Add number" on a `@lid` chat that arrives without a number:* medium, about **1 to 2 days**. The screen and the action are small; the care goes into joining the chat to an existing contact when the number is already known (the identity-linking code in `packages/core/src/identity-linking.ts` already merges identities) and into the tests for that merge. Kushal's note says this waits on the Baileys 7 upgrade (D-44); the screen itself does not need it, only an automatic lookup would.
Together about **3 to 5 working days** for all three, one PR each. The `@newsletter` skip is already built.

**2026-10-21: put back into pinned; the AI assistant, files in campaigns and AI templates come first.** The decision below stands for when this comes back.

**Decision (2026-10-21, Kushal): what "unknown number" means.** Someone who **messaged first and is not in the contact book**. The thread shows a notice ("message from an unknown number", with their chosen name if there is one) and a **Save as contact** action. Saving opens the contact page of **D-80** (name, number, and whichever fields the organisation uses); it is not a fixed job-title form. Today there is no "saved" mark: every first message from a stranger creates a contact (`source = inbound_message`), so D-80 describes how "not in the book" is stored. Related: D-10 (unknown senders), D-65.

**Decisions after the findings (2026-10-20, Kushal):**
- **Saving the sender's own chosen name (`pushName`) is optional**, a setting and not automatic. Off means the contact is named by number as today.
- **Why a `@lid` chat can show a raw id while WhatsApp Web and the phone show the number.** The phone and WhatsApp Web know the person from your address book and from WhatsApp's own servers. A linked device through Baileys is handed only the privacy address (`@lid`) for some chats, plus the real number **only when WhatsApp chooses to include it** (it did for 13 of 13 messages in the test). When it does not, our code has nothing to map. This is partly a **Baileys 6.7.24 limitation**: newer Baileys (7.x) keeps its own lid-to-number table and can look a number up, which is part of why D-44 (Baileys 7 upgrade) matters here. So "add a number to a `@lid` chat that arrives without one" is a real gap, and the better answer may be the upgrade, with the manual add-a-number action as the fallback. Revisit after D-44 is looked at.
- Still to do from the fix list: skip newsletters, broadcast lists and communities; the unknown-number alert.

✅ **Built 2026-10-20: channels, broadcast lists and communities are ignored** (`isNotAPerson` in `packages/channels/baileys/src/index.ts`: `@g.us`, `@newsletter`, any `@broadcast`). A message from one no longer creates a contact or a conversation. A newsletter contact created earlier on a dev database is not removed by this and can be deleted by hand.

---

## D-68 · Campaign with no tagged people: tell the user to tag them first — ✅ built in PR #56 (Kushal, 2026-10-17)

When someone starts a new campaign and no contact has the tag they would pick (or no tags exist at all), the page should
say so and point them to Contacts to tag people, instead of leaving them with an empty list. Today the "A tag" tab is
simply hidden when no tags exist (`apps/web/app/broadcast/new/audience-picker.tsx`). Also noted the same day: an imported
Naukri file only brings in name, phone and email, so its other columns (location, skills, experience…) do not show on
Contacts; that is D-21 (map a column to a custom field), already a priority.

---

## D-69 · Chats available inside the job portal (and any other web app) — pinned (Kushal, 2026-10-17)

The conversations should be usable **from the job portal**, not only inside this CRM's own screens: the CRM should plug
into the portal (and into any other web app) so recruiters can read and answer a candidate's WhatsApp chat right where
they already work, on the candidate's own page. Not designed yet. Things to settle when it comes back: the shape of the
plug-in (an embeddable chat panel for one contact or conversation, the existing API and `packages/sdk` driven by the
portal's own screens, or both); how the portal's user signs in without a second login (a short-lived token the portal
asks for on the user's behalf); how a portal candidate is matched to a CRM contact (by phone or by the portal's own id,
kept in `external_ref`); whether the portal can only read a chat or also send; and that everything stays within the
anti-ban pacing and do-not-contact rules no matter where a message is sent from.

**Added 2026-10-17 (Kushal): the front end should be pluggable into other codebases and applications**, not just the chat.
The CRM's screens (inbox and thread, contact list, import, campaigns) should be droppable into an existing app as
components or an embeddable widget, themeable to the host's look, without taking this whole Next.js app with them.
Questions for later: ship them as a framework-free web component or an npm package of React components; keep them
talking only to the public API (so a host never reaches into the database); how a host overrides colours, fonts and
which actions show; and how this fits D-61 (plain React instead of Next) and D-62 (single executable).

Pinned to come back to; not started.

---

## D-70 · Contacts page: refresh, admin-chosen columns, tidier layout, sort and search by date — **WORK ON NOW (Kushal, 2026-10-20)**

Five wishes about the Contacts page, from testing the import with a real Naukri file (the first wish, a bigger column
selector and preview on Import, was filed under **D-21** instead):

1. **A refresh button** on Contacts, to reload the list without reloading the whole page. Related to D-46 (UI lag) and
   D-61 (plain pages with refresh buttons).
2. **Columns on Contacts, chosen by an admin.** Which fields show as columns in the list (name, phone, tags, and any custom
   field such as location or experience) is set once by an admin for the whole team, rather than fixed in the code.
   Custom fields are built (D-40, PR #56 for imports).
3. **Better formatting.** Today each row crams the name, numbers, tags, fields editor and actions together ("a
   clusterfuck of information"). Needs a calmer layout: a table with the chosen columns, details tucked into a side
   panel or an expandable row, tags as small chips (small rounded labels on the screen, like the tag name on a contact), consistent spacing. Copy the contact lists in the research apps
   (`docs/03-competitive-analysis.md`).
4. **Sort and search by the date a contact was added or imported**, and sort by any chosen column.
5. **Do the sorting and searching in the browser** with SQLite on the end user's side, to keep load off the server. Open
   question: this means shipping the contact list to the browser (size, privacy, staleness, and what an agent with limited
   access is allowed to hold locally), so it needs a decision before a build. Not the same as D-20 (SQLite as the
   server's database). The server-side alternative is a date filter and a sort parameter on `GET /contacts`.

Pinned to come back to; not started.

**Note: this came up while the other dev (Mikhil) was alpha testing** (2026-10-20). His words, the screenshots and Kushal's decisions are in [`dev-feedback-issues.md`](../dev-feedback-issues.md). Issue-3 ([#66](https://github.com/Kushalr3ddy/whatsapp-crm/issues/66)): the "Tag many at once" dropdown stretches out of its box; a UI fix. Issue-4 ([#67](https://github.com/Kushalr3ddy/whatsapp-crm/issues/67)): add a **"No tag"** option at the bottom of the tag list; choosing it warns that without a tag those contacts will have to be found and tagged again later; "choose a tag…" stays visible but greyed out. Issue-5 ([#68](https://github.com/Kushalr3ddy/whatsapp-crm/issues/68)): clicking a tag chip must filter (the tag ID in the address bar does not matter to users); once contacts are tagged or selected, suggest starting a campaign with them; if they are only selected and untagged, tag them first; if a campaign already exists that contains them as a subset, ask whether to use this tagged group or create a new one (see D-68, D-73). Issue-6 ([#69](https://github.com/Kushalr3ddy/whatsapp-crm/issues/69)): removing a tag with the × asks "Are you sure?" and says the contact may have to be searched for and tagged again.

✅ **Alpha-feedback issues 3-6 built 2026-10-20 (this PR, issues #66-#69). A "chip" here means a small rounded label on the screen, such as a tag name on a contact or in the Tag filter row:** the Tag many at once selects fit their box; a "No tag" option explains what it means; a tag chip shows it is loading and is marked current; with a tag filter on, the page suggests starting a campaign and names any campaign already using the tag (`GET /campaigns?tagId=`); removing a tag asks "Are you sure?" first. The rest of D-70 (refresh, admin-chosen columns, layout, date sort and search) is still open.

**2026-10-20: work on this now.** Built: the tag fixes.

✅ **Built 2026-10-21 (PR 1 of D-70, Kushal's decisions):** a **Refresh** button; the list is a line of columns (name, phone/email, tags, added) where each row **opens** to show the rest (adding a tag, do-not-contact, last imported, custom fields); a **Dates and order** box to limit by the day *added* or *last imported* (from / to, both included) and to order by newest, oldest, last imported or name. **Sorting and searching stay on the server** (the browser-side SQLite idea, wish 5, was set aside by Kushal): `GET /contacts` takes `from`, `to`, `dateBy` and `sort`, and returns `lastImportedAt`. The date range is part of the one shared rule (`searchPredicate`), so "tag everyone matching the current filter" tags exactly the people listed. Limits: paging by cursor only follows "newest added first" (other orders show the first 50); days are read in the database's time zone (UTC); ordering by last imported adds up every import row, which is fine at alpha size and wants an index on `import_row(contact_id)` for a big book. **Admin-chosen columns** were moved to D-79.

---

## D-71 · A big background picture for each tab — pinned (Kushal, 2026-10-19)

Each main page gets a **huge, faint illustration (an SVG) behind its content** that shows what the page is about: a contact
book on Contacts, a phone being linked (a phone and a QR code) on Linked numbers, speech bubbles on Inbox, a funnel or
megaphone on Campaigns, a file and arrow on Import, and so on. It sits at low contrast in the corner or centre so text stays
readable, works in light and dark, is drawn in the app's own style (the hand-drawn SVG set and green accent from D-66, no
illustration library), and does not move for anyone who asked for reduced motion. Related: D-66 (life across the pages).
Questions for later: one illustration per page or a shared set, and whether the empty states reuse them.

Pinned to come back to; not started.

---

## D-72 · Mobile-friendly UI — pinned (Kushal, 2026-10-20)

Every page should work well on a phone, not just a laptop: the inbox (list and thread as two screens with a back button, a
composer that sits above the keyboard, tap targets big enough), Contacts, Import, Campaigns and Linked numbers (including
scanning the QR with a second device), the sidebar as a bottom bar or slide-out menu, tables that become cards, and no
sideways scrolling. Some of it exists already (the sidebar has small-screen rules and the sign-in page is responsive), but it
was never tested or designed phone-first. Related: D-66 (look and motion), D-70 (the Contacts layout), D-61 (lighter web
tier). Questions for later: a responsive web app only, or an installable one (a PWA with home-screen icon and push
notifications for new messages); what to test on (real phones, and Playwright's mobile viewport, which D-49 also wants).

**Added 2026-10-21 (Kushal): mobile compatibility comes later.** Do the phone-width work as its own piece after the desktop
work (D-21, D-70) settles; until then new screens only need to not be made worse on a phone. The Import wizard sections (#83)
should get a phone-width look as part of it.

Pinned to come back to; not started.

---

## D-73 · "Message these people" right after an import — pinned (Kushal, 2026-10-20) — **PARKED (Kushal, 2026-10-20): not working on this for now**

After an import finishes, offer a quick way to send one message to everyone who was just imported: a **Message these people**
button on the result box that opens a new campaign with the audience already set to that import (and with a short, quick form
rather than the full campaign page). Most of the machinery exists: a campaign can already target "An import" as its audience
(`fromImportRunId`), the import is tagged with the file name by default, and sending goes through the same pacing and
do-not-contact rules as any campaign, so this is mostly a shortcut and not a new way to send. Things to settle: whether it is a
real campaign underneath (recommended, so it is paced, listed and auditable) with the page simplified, or something lighter; a
confirmation showing how many people it reaches and that some may be skipped (do-not-contact, recently messaged); and that a
big import cannot be blasted by accident. Related: D-68 (tag people first), D-57 (import as a background job), D-52.

Pinned to come back to; not started.

**Note: this came up while the other dev (Mikhil) was alpha testing** (2026-10-20). His words, the screenshots and Kushal's decisions are in [`dev-feedback-issues.md`](../dev-feedback-issues.md). Issue-1 ([#64](https://github.com/Kushalr3ddy/whatsapp-crm/issues/64)): after an import finishes the page just ends ("looks sus"). Show suggestions, never force: after linking a number, suggest Import or Campaigns; after an import, buttons to see the tagged contacts and to send them a message. Kushal: this may mean starting on the import wizard (D-21) too.

✅ **First slice built 2026-10-20 (issue #64):** a finished import shows "View the N imported contacts" and "Message these people" (opens a new campaign on that import). The faster one-step quick message is still open.

**2026-10-20:** parked again. The buttons after an import are built; the quick one-step message is the part that waits. Not working on it for now.

---

## D-74 · Add-number form: country-code dropdown and a numbers-only phone field — ✅ **BUILT 2026-10-20**

**Note: this came up while the other dev (Mikhil) was alpha testing** (2026-10-20). His words, the screenshots and Kushal's decisions are in [`dev-feedback-issues.md`](../dev-feedback-issues.md), issue-8 ([#70](https://github.com/Kushalr3ddy/whatsapp-crm/issues/70)). The optional phone field on Add a number makes people type the country code themselves, and
typing `9964122631` fails with "Write the number with its country code…". **Decisions:** a country-code dropdown next to the
field, defaulted from the person's location (browser locale or time zone is enough, no precise location needed), changeable;
if they start typing `+91`, `+63` and so on, switch the dropdown to that country and let them carry on, as Google's phone
field does; the field accepts digits only and asks phones for the numeric keypad (`inputmode="tel"`). Related: D-72 (mobile).

✅ **Built 2026-10-20 (PR #73):** a country list next to a digits-only phone box, defaulted from the browser language and changeable; typing `+91…` or `+63…` switches the country. Code: `apps/web/lib/dial-codes.ts`.

**Update 2026-10-20 (PR for the second alpha-test round):** Add a number now asks for a **name only**, and its QR opens straight away; the number is saved when the QR is scanned. The country list and digits-only box moved to the **Type a code** linking method, where WhatsApp needs the number up front (`apps/web/app/link/phone-field.tsx`). Sign-in also got a Show/Hide button.

---

## D-75 · Number assignment: who each WhatsApp number belongs to — pinned (Kushal, 2026-10-20): not building it now

Nothing assigns a WhatsApp number to a person today; every teammate sees every linked number. Decided (Kushal, 2026-10-20): **for now nobody is
restricted**. Agents can still see all numbers and **who each is assigned to**; assignment is shown, not enforced. Admins assign numbers to
people from the **Team tab** (a checklist per person) and the **Numbers tab** ("Assigned to: …" on every card, checkboxes for admins); the
**Inbox** shows which number a chat is on and who it belongs to. **Agents can add their own numbers** (not admin-only), and a number someone
adds is assigned to them automatically. **Warnings:** a member with no number assigned, or whose number is unlinked ("link it again or link a
new number"), is flagged to the member (a banner) and to admins (a chip on the Team row). Data: a `sender_member` table. Raised by the other dev's
alpha test and Kushal's own (the Team tab had no way to give a teammate a number). Related: D-53 (conversation owners and participants).

**2026-10-20:** pinned, not building it now. The plan is ready to pick up: a `sender_member` table, a numbers checklist per person on the Team tab, "Assigned to" on every Numbers card, the Inbox number chips and the no-number / unlinked warnings. Agents keep seeing all numbers meanwhile. Related: D-76, D-77.

---

## D-76 · Notifications tab, number requests and approvals — pinned (Kushal, 2026-10-20)

An in-app **Notifications** tab for each user: when a number is assigned, reassigned or removed, when a request for a number is sent, approved or
declined, and (later) when a number becomes unlinked. Admins see who requested a number, or a specific number, with Approve and Decline right
there. Not now: for the moment people ask the admin in person. Design notes so it is not re-derived: a per-user `notification` table (kind,
title, body, link, created, read), a `sender_access_request` table (user, number or "any", note, pending/approved/declined, decided by), events
written in the same transaction as the change, an unread count in the nav computed like the existing number alerts, and polling refresh like
`inbox/auto-refresh.tsx` (there is no push). Related: D-43 (other alert channels), D-75, D-77.

---

## D-77 · Admin controls: user scopes and number limits — pinned (Kushal, 2026-10-20)

Later, the admin decides who can see and do what. **Several user scopes** beyond admin and agent (for example sub-admin, manager, assistant
manager), each with its own powers. **Who sees which numbers:** agents (or a scope) limited to the numbers assigned to them, with a wrong number
answering 404 and not 403; the API paths that would need that check are already mapped (conversation list, one conversation, mark read, patch,
presence and typing, notes, sender status, thread messages, attachments, sending with a conversation or with a "to" number, media and its preview,
the senders list and link status, and campaign create, list, start, get, preview and recipients). **How many numbers each person may link**, or a
**predefined list of numbers the admin types or uploads** that may be linked to the CRM. **Who may add, link or unlink numbers** per scope (today
any signed-in person can). Related: D-75, D-76, D-53, D-47 (limits per organisation).

---

## D-78 · Email: invitations to join an organisation, via SMTP or an email API (decide later) — pinned (Kushal, 2026-10-20)

Email is **optional** and the choice is **not made yet**: either plain **SMTP** (any mail server the operator already has) or an **email API** (a hosted sending service). What it would unlock: an **invite sent from the Team tab** (today an admin creates the account and hands over the password), a self-service password reset, and email verification at signup. Until a choice is made the product works without email, and the admin-created-account flow stays. Today there is no email code at all (`packages/providers/email` is empty, no email settings in `packages/shared/src/config.ts`). To decide: SMTP vs an API provider, who pays for sending, and what an invite looks like (a single-use link). Related: D-8, D-33 (the unbuilt email driver), D-43 (email alerts), D-47, and docs [`32`](32-onboarding-and-billing.md).

---

## D-79 · Contacts: columns chosen by an admin for the whole team — pinned (Kushal, 2026-10-21)

Split out of D-70 (wish 2). An admin picks once which fields show as columns on the Contacts list for everyone (name, phone, tags,
added, and any custom field such as city or experience), instead of the fixed columns D-70 ships with. Needs a per-organisation
setting (list of column keys and their order), an admin-only screen or panel to change it, and the list reading it. Custom fields
already exist (D-40, PR #56); sorting by a chosen column is the follow-on from D-70. Related: D-70, D-72 (columns on a phone).

Pinned to come back to; not started.

---

## D-80 · Create and edit a contact page; save an unknown sender; org-neutral fields — pinned (Kushal, 2026-10-21)

**What:** a page to **create a contact and to edit an existing one**, where the person can add, change and remove the details the organisation keeps about people. It is also the target of **Save as contact** on an unknown sender (D-67). The product is meant to suit organisations that are not hiring too (leads, customers, members), so nothing on the page is job-specific.

**Does saving a contact mean job title, current company and so on? No.** The only built-in details are the **name**, the **phone numbers and emails** (identities), and the do-not-contact setting. Everything else is a **custom field** an organisation defines for itself (D-40, already built: text, number, date or choice, usable as `{{field}}` in a campaign, searchable). A hiring team defines "Job title" and "Current company"; a sales team defines "Lead source" and "Deal size"; a club defines "Member since". The page shows whichever fields the organisation has (admins define them, as on Contacts today) and lets a person add or clear values. A field a person does not fill in stays empty. Open: whether an admin may mark some fields as **required**, and whether any person (not only an admin) may define a new field from this page.

**What the page does:**
- **Create:** name, one or more phones, one or more emails, the organisation's fields, tags. The server already creates a contact this way (`POST /contacts`: a phone or an email is required, numbers are normalised, a duplicate is refused with a pointer to the existing person).
- **Edit:** change the name, add or remove a phone or email, set or clear field values (`PUT /contacts/:id/custom-fields` exists), tags, do-not-contact. Removing the last phone and email is refused (a contact needs one way to be reached).
- **Save an unknown sender:** open from the thread notice; the number, and the chosen name if any, are already filled in.
- **Deleting a contact** is not part of this; it stays an admin matter, and per the standing rule accounts and people are not hard-deleted without a decision.

**Does this mess with the synthetic key? No.** Every contact has a permanent internal id (a random UUID, `contact.id`). The phone number and email are not the key; they are **identities** attached to that id, each unique within the organisation. Changing a number changes one identity row; the id stays, and so do the conversations, messages, tags, campaign history and the import ledger that point at it. A host application can also store its own id for the person in `external_ref`. The one real hazard is an edit that gives a contact a number **another contact already holds**: that must not silently succeed. The page should say "this number belongs to <name>" and offer to **merge the two people** (the identity-linking code in `packages/core/src/identity-linking.ts` already knows how to join identities) or cancel.

**"Not in the contact book" needs a mark.** Today there is none: a first message from a stranger creates a contact (`source = inbound_message`) and a conversation. Proposed: a nullable `saved_at` on the contact. People created by hand, by import or over the API get it at creation; people created by an incoming message do not, until someone saves them (or an import matches them). Existing rows would be backfilled: everything not created by an incoming message is saved, and incoming-message contacts that have been tagged or edited are saved too. Unsaved people stay in the inbox (with the notice from D-67) and are left out of campaign audiences unless chosen on purpose. Open: whether to use `source` alone instead of a new column.

**What if a new Excel contains people who already exist? (checked in the code, `packages/core/src/ingestion.ts`):**
- A row is matched to an existing person by phone or email, in the order the mapping lists them. A match is **updated, never duplicated**; no new contact is made.
- The **name** is filled in only if the person has none (or only their number as a name). A hand-edited name is never overwritten.
- **Custom field values are added where empty and never overwrite** a value already there, so a hand edit survives a re-import. The cost: an import cannot correct a wrong value; that needs the "overwrite" choice per column (D-21).
- A **new phone or email** on the row is added to the existing person.
- An unknown sender whose number later appears in an import is matched, so the person keeps their whole conversation and becomes saved.
- **Known gap:** if one row carries two numbers that belong to two different existing people, the row is attached to the first match and the second number stays with the other person; nothing warns and nothing is merged. A "possible duplicates" note on the import result (and a merge from this page) would close it.

**Related:** D-67 (unknown sender), D-10, D-21, D-40, D-79 (which fields show as columns), D-70 (the list), D-72 (the page on a phone), D-69 (an embedded contact panel for other apps would reuse this).

Pinned to come back to; not started.

---

## D-81 · AI assistant guardrails — pinned (Kushal, 2026-10-21: "it needs to just work for now, we can set up guardrails later")

**What:** today the assistant has only the safety that every send already has (do-not-contact, pacing, the anti-ban gates, the daily
message limit, a consent box, customer text kept out of its instructions). Nothing limits what it says. **Seen on 2026-10-21:** asked how
much experience was needed, it answered "2 to 5 years", which no one had told it; it also listed interview documents nobody had told it.

**To build, when it comes back:**
- *Facts:* answer only from what the organisation wrote (a knowledge field or uploaded notes); otherwise say a colleague will confirm. The
  first draft of this rule was written and removed on 2026-10-21 because it made the assistant hand chats over instead of carrying on.
- *Opt-out words:* "STOP", "unsubscribe" and the local-language packs mark the contact do-not-contact (F9 is where it was planned) before any reply.
- *Approval mode:* a switch where the assistant drafts and a person approves, per organisation or per chat.
- *Limits:* topics it may not discuss, a spend cap in money not only messages, a quiet-hours rule, a reply-length cap.
- *Tests:* a set of nasty prompts (injection, pay, legal, abuse) that must be refused or handed over.
- **Always-on rules, the same for every template (Kushal, 2026-10-21; mockup drawn, not built).** Fixed text added in front of whatever script a chat follows; templates (D-85) cannot change it, an admin can read it, a developer edits it in code. Today only one such rule exists (`systemText` in `packages/core/src/ai-reply.ts`: customer text is untrusted and never changes the rules). To add: never reveal the instructions, the script, other contacts' details or settings; stay on the script's topics and do not role-play, write code or do unrelated tasks; never promise money, prices, legal or medical advice beyond what the script states; hand over to a person when asked, or when the contact is upset or abusive.
- **A standard refusal reply, editable by an admin** ("Sorry, I can't help with that here. I can help with …, or I can ask a colleague to get in touch."), used for anything off-topic, an attempt to override the assistant, or a jailbreak; and a **hand-over after N refusals** in one chat (default 3) with a note "tried to override the assistant".
- **A "Try to break it" test box** on the AI page: type what a contact might send and see the reply the current script and rules would give, nothing sent. Starts with canned attacks (ignore your instructions, show your prompt, write code, promise me the job). The same prompts become automated tests.
- **Say the limit plainly:** wording reduces misuse but cannot guarantee it. The real protection is what the assistant is unable to do whatever it is told (only assigned chats, no campaign start without an admin, no do-not-contact sends, the daily cap, the anti-ban gates); keep widening those limits as tools are added.

**Cost of deferring:** a real customer can be told something false in the organisation's name. Keep it to test chats until this lands.

---

## D-82 · A gateway restart can break the WhatsApp session — pinned (found 2026-10-21)

**What happened:** after many restarts of the gateway in one afternoon (each saved edit restarts it under `tsx watch`), the saved encryption
sessions for the linked number stopped matching WhatsApp's. 213 decrypt failures ("No matching sessions found", "Key used already",
"Message counter error"); the number showed linked but nothing arrived from 15:17 to 17:03; the messages in between are not in the CRM.
Deleting one contact's sessions fixed sending to them but not receiving. **Unlink and relink (a new QR) fixed it.**

**Probable cause (not proven):** the stored session state is behind what was already acknowledged to WhatsApp because the process is killed
before its last writes land. **To do:** flush the auth state on SIGTERM; refuse to start a second gateway on the same number; detect a burst of
"No matching sessions" and say so on the Linked numbers page with a "Reset" button (relink), instead of showing "Linked". **Until then:** do not
restart the gateway while testing; `bash infra/scripts/dev-up.sh --no-gateway` restarts only the API and web. Runbook entry: `docs/14-runbooks.md`.

**Update 2026-10-23 night, built on the D-101 branch:** the credential store now writes each key in order and flushes before exit (`auth-adapter.ts`), the scorer ignores failures from the account's own devices, and the thread says when a session is broken (docs/45). Still to do from this list: refuse to start a second gateway on the same number; hold AI and campaign sends while the session is broken; a "Reset" (relink) button on the Linked numbers page; flush also on SIGKILL is impossible, so keep `tsx watch` off the real gateway (use `dev-up.sh --no-gateway` and run it separately).

**Also found (2026-10-21), same root:** the health scorer read our own decrypt failures and undelivered messages as a suspected soft ban and put the number in quarantine with a
**48-hour pause** (risk 100), holding every send; it only cleared because Kushal turned **Advisory mode** on for that number (anti-ban enforcement off; turn it back after testing).
The scorer should ignore decrypt failures for `fromMe` messages and for a burst right after a restart, and a message the recipient could not read should not count as undelivered.
**Done in #96:** the gateway now answers a recipient's resend request for text (`resendText` / Baileys `getMessage`), so "Waiting for this message" can clear.

---

## D-83 · `npm run dev:fast` leaves some screens stale after an action — pinned (found 2026-10-21)

**What:** against the production build (`next start`) six browser specs fail that pass against `next dev` and in CI: `broadcast-flow`,
`bulk-tag-flow`, `contacts-dates`, `contacts-tags`, `fields-and-status`, `seeded-pages`. The pattern is "do something, the page does not
refresh": a removed custom field or tag stays on screen until a reload. Probably the client router cache. Not investigated. **Until fixed,
use `dev:fast` to look at pages and demo, and `dev:all` to test flows.**

---

## D-84 · The AI runs whole conversations — pinned (Kushal, 2026-10-21: it "should take over the entire conversation")

**Done so far:** the system text tells the assistant to lead (answer, then ask one question toward the goal in the organisation's
instructions, never repeat a question already answered) and to hand over with a summary only when asked or when the goal is done.
**Not built:** a *Goal* field in the AI settings (today the goal lives in the free-text instructions); **auto-assigning new chats** to the
assistant (today a person assigns each chat); **follow-ups** when the customer goes quiet; stopping rules (a maximum number of messages before a
person looks); a summary note at hand-over that is a real field, not text in the reason.

Pinned to come back to; not started.

---

## D-85 · AI templates: pick a template, fill its blanks, get the script — **PRIORITY (Kushal, 2026-10-21); mockup first, then build**

**Priority order set 2026-10-21:** (1) the AI assistant for chats (this and its live testing), (2) **file support in campaigns** (D-59, first slice), (3) these templates. D-67 and D-80 went back to pinned.

**What Kushal asked:** on the AI assistant page the box **"Tell the assistant what to do"** and the box **"What it may talk about, and how"** do two jobs with no help. Make the choice of job a **template**: a few fixed starter templates plus ones the organisation adds, and have the standing script in the lower box **generated from the template**, still editable.

**Decisions (Kushal, 2026-10-21):**
- **Template fills the lower box.** Pick a template, fill its few blanks (for example the role, the questions to ask in order, the tone, the hand-over line), and the lower "What it may talk about, and how" box is filled in from it. The text stays editable. The upper box keeps taking one-off orders ("message Asha and ask…").
- **Three levels, most specific wins: chat, then campaign, then "all the chats by default".** The screen calls the organisation-wide level **"All the chats by default"** (not "organisation default"); it is the template every chat assigned to the assistant follows unless something more specific is set. A **chat** can have its own, and so can a **campaign** (replies to that campaign's messages follow the campaign's template). The chat's own beats the campaign's, and both beat the all-chats default.
- **Tell the user when an override is in use.** Wherever a chat is handled by something other than the all-chats default, say so: a notice on the chat ("This chat follows the template <name> set on this chat" or "…set on the campaign <name>") and the same line on the campaign and on the AI page, so nobody is surprised that a chat is not following the default script.
- **How the text is made: both.** By default the blanks are filled into the template's wording exactly (no model call, so what you see is what it will do). An **"Improve the wording with AI"** button asks the model to rewrite it; the result is shown for approval and is never saved without a click.
- **Who can add templates:** an **admin adds, edits and removes** templates; the whole team uses them (an agent can pick one for a chat, not edit it).
- **Heading of the lower box (Kushal, 2026-10-21):** it reads **"What it may talk about, and how (instructions for the AI)"**, so it is clear that this box is what the model is told, and that it is the text templates write into. The same words go on the box wherever it appears (the AI page, the chat and campaign pickers).
- **Chats follow template edits, with a warning to the admin (Kushal, 2026-10-21).** A chat or campaign that uses a template keeps following it, so editing a template changes what the assistant says in every chat and campaign using it. Before saving an edit, the admin sees a warning: **"This changes the assistant in N chats and M campaigns that use it. It overrides what they follow now."**, with the list of where it is used and **Save changes** / **Cancel**. (A "save as a new template instead" choice avoids touching the others.) Deleting a template that is in use is refused; the admin picks a replacement first.
- **A template gallery, not just a list (Kushal, 2026-10-21).** Next to the template picker is a button (**Choose a template**) that opens a **small window over the page**, in the style of the sticker and add-on pickers on Instagram stories, the "pick a saved résumé" window on job portals and the template gallery on Wix: a grid of cards, each with a name, a one-line description and a **live preview of the script**, a search box, a filter by purpose, and a **Use this** button. Tabs or sections: **Recently used** (this organisation's last few), **Your organisation's templates** (saved by admins), and **Starter templates**. Choosing one fills the blanks form behind it; nothing is saved until the person saves. Every template, starter copy or organisation-made, lives in the database (see below) so it can be picked again later, and "used last on…" and the count of chats using it are shown on the card.
- **Starters cover more than hiring (Kushal, 2026-10-21):** the product is for any organisation: lead generation, notices for a club or society (a Rotary club, a school, a residents' group), customer care and general messages, as well as hiring. Starter set, grouped by purpose in the gallery:
  - *Leads and sales:* **Qualify a new enquiry** (find the need, ask a few set questions, hand over a summary); **Book a call or demo** (offer times, confirm one, hand over); **Re-engage a quiet lead** (a gentle check-in, one nudge, then stop).
  - *Notices and events (clubs, societies, communities):* **Event invitation and RSVP** (invite, collect yes/no and how many are coming, remind); **Meeting or programme reminder**; **Announcement with a thank-you** (send a notice, answer simple questions from supplied facts, hand over anything else); **Membership or subscription renewal** (remind, answer from facts, hand over payment questions to a person).
  - *Customer care:* **Answer common questions** (only from facts the admin supplies, hand over when the answer is not there); **Order or appointment update** (confirm, reschedule, hand over); **Collect feedback** (a few short questions).
  - *Hiring:* **Recruiter screening**; **Interview reminder**.
  - *General:* **Collect details** (a short form in chat: name, address, preference, anything the admin lists); **Follow up after no reply** (one nudge, then hand over).
  All are **organisation-neutral** and use "contact", "member", "enquiry" unless the admin writes otherwise. Starters can be copied and edited, not deleted; admins add their own. The final starter wording and blanks are still to be drawn (open below); the set is meant to grow, so the gallery's purpose filter and search matter.

- **"Draft a template with AI" (Kushal, 2026-10-21).** For an admin starting from nothing: a box where they describe the job in a sentence or two ("invite Rotary members to the monthly meeting and collect yes or no and how many are coming") and the model drafts a whole template: the wording and its blanks. It is AI-written from the start, so it carries the same warning and preview as below, and it is saved only when the admin clicks **Save as a template**; it then appears in the gallery under "Your organisation's templates". The model sees only the admin's sentence, never a contact's messages.
- **How a template becomes the script (clarified 2026-10-21):** filling the blanks into the template's wording is **plain text substitution, no model call**, the same result every time. A model is used only by the two buttons the admin presses (**Improve the wording with AI** and **Draft a template with AI**). At reply time the assistant is given the always-on rules (D-81), then the script as plain stored text, then the conversation, which it treats as untrusted.
- **The front door is "Describe what you want" (the other dev and Kushal, 2026-10-21; a working throwaway page exists, `mockups/ai-describe.mjs` + `.html`, git-ignored).** The owner writes or pastes plain words (a showroom, a Rotary meeting, a long job description). The configured model writes the instructions; the gallery and blanks are the second route, with no AI. Decided and tried in the page:
  - **No summarising.** The model is told to use all of the description and drop nothing; a pasted job description with nine specific details kept all nine. The instructions are bullet points under plain headings.
  - **Both boxes are always shown and editable**: the description and the "Instructions for the AI". The instructions are **locked until the person clicks "Edit by hand"**, which warns that hand edits can make the assistant behave differently from what they described. **Writing the instructions again over hand edits asks "This replaces your changes. Continue?"**
  - **Save only after regenerating.** If the description changed since the instructions were written, Save stays off with "Write the instructions again before saving".
  - **A locked "always added automatically" block** (the always-on rules of D-81) is shown under the instructions, cannot be edited, and is added in front of the instructions **every time the assistant replies**, so editing or deleting text cannot switch it off.
  - **A template stores the description and the instructions together**; picking it loads both. "Change something for this time" appends to the description and rewrites.
  - **Length:** the description is capped at **8,000 characters** (a counter, a block over the cap, the server enforces it); also a per-organisation limit of a few generations a minute so the backend and the model's rate limits are protected. Instructions are sent with every reply, so longer means dearer.
  - **What the reply model receives:** the app's fixed framing, the locked rules, the instructions, and the conversation (untrusted). It never receives the description, the template name, the audience or the first message.
- **Two pages (Kushal, 2026-10-21).** **Page 1 (`/ai`)**: status and consent, the describe box, saved templates, the review and save section (the page scrolls to it after the AI writes), the **limits**, and the one-off orders box at the bottom. **Page 2 (`/ai/t/<id>`)**, reached by **Save as a template**: **What next?** (message a group, test on myself, answer chats, done for now), the section for the chosen option filled in below it, and the **replies section** (the 5 most recent chats, a Refresh button, a click opens the chat in the Inbox) at the end. Built so far: page 1 (P1), and on page 2 "Let it answer all chats" and **"Message a group with this"** (a draft campaign from the template: audience is an existing tag, or a search whose people get a new, **editable** auto-named tag `<template>-N (date, time)`; the people are counted first; the campaign keeps `ai_template_id`, migration 0035, for replies to follow it later). Still "coming next": the test to myself, the replies section, and replies actually following a campaign's template.
- **After saving: sending (to design, not drawn yet).** "Use for a campaign" asks for: the audience (a tag, see D-87), the first message (the draft the AI wrote, editable), which number sends it; it creates a **draft campaign** that follows the template for replies; an admin presses Start (the assistant never starts one itself unless the org switch allows). The picker sits on the campaign form and on assigning a chat.
- **Where the template picker lives (to draw):** a **Choose a template** button opening the gallery window (recently used, the organisation's, starters, search, preview), on the AI page, the campaign form and the assign-a-chat step; the plain "Saved templates" list is only the fallback.
- **AI-written text is always flagged and previewed.** Anything the model writes (the "Improve the wording with AI" result, and any future AI-drafted script) shows a warning ("Written by AI: read it before you use it, it may be wrong or off-tone"), is shown as a **preview next to the current text**, and changes nothing until the person clicks **Use this version**. **Discard** keeps what was there. The model sees only the script, never a contact's messages. Chats following an AI-improved script keep the same notice as any template.
- **The "Tell the assistant what to do" box moves to the bottom of the page** (below the settings), because the templates and the script are what a new person needs first and one-off orders are used less. Its own further work (templated orders, such as "send the Friday reminder to everyone tagged pune", and order history) is pinned as **D-86**.

**What it would take (first look):**
- A `template` table per organisation: name, description, purpose (leads, notices, care, hiring, general), the wording with blanks, the list of blanks (label, kind: short text, list, choice), starter flag, created by, **last used at** and **use count** (for "Recently used"); plus `template_id` on the AI settings (the default), on a conversation, and on a campaign. The model reads the **filled-in text**; a chat follows its template, so an edit changes it (decided above, with the admin's warning). Tests also cover that warning's counts.
- The gallery window, the picker and blanks form on the AI page; "Use a template…" when assigning a chat to the assistant; a template choice on the campaign form; the notice in the thread (`apps/web/app/inbox/[id]/ai-notice.tsx` already shows an assistant notice).
- The auto-reply code (`apps/gateway/src/main.ts`, `packages/core/src/ai-settings.ts`) picks the script by the order above.
- Tests: the order (chat over campaign over organisation), a blank left empty, a template removed while in use, an admin-only guard.

**Open (for the mockup):** the exact blanks and wording of each starter; whether a blank can be a repeatable list (the questions); whether the AI "Improve" step sees the contact's messages (it should not: it only rewrites the script); the effect on the daily message cap (unchanged).

**Related:** D-4 (the agent), D-81 (guardrails), D-84 (the AI runs whole conversations), D-59 (files in campaigns, the next priority), D-80 (neutral wording).

Pinned as a priority; **mockup first** (Kushal, 2026-10-21), then build.

**Update 2026-10-22 (R-011, PR "campaign replies go to the AI"):** built the campaign half of P4: when someone replies to a message from a campaign that has an AI template and nobody owns the chat, the chat is handed to the assistant, and the assistant answers with **that campaign's template** (campaign over the organisation-wide default). Still open: a **per-chat** template (the top precedence level), the gallery, and the edit warning.

---

## D-86 · AI page: the one-off orders box moves to the bottom; templated orders and order history — pinned (Kushal, 2026-10-21)

On the AI assistant page the **"Tell the assistant what to do"** box (one-off orders such as "message Asha and ask if she can start Monday", "pause the Diwali campaign") goes **below the settings and the script**, with the queue under it, as part of D-85. Its further implementation is pinned here, not started:
- **Templated orders:** a short list of ready orders with blanks ("Send <message> to everyone tagged <tag>", "Remind <people> about <event> on <date>", "Pause <campaign>"), an admin can add their own, the same way script templates work (D-85).
- **Preview before it acts:** an order that touches many people or a campaign shows what it would do first (who, how many, which message) and waits for a click; it still only prepares campaigns and never starts one on its own (an admin presses Start).
- **Order history:** who gave which order, when, and what became of it (the queue today shows only recent ones); filter by person and by result.
- **AI wording warning:** when the model rewrites or drafts an order's message, the same "Written by AI: check it" warning and preview as in D-85.
Related: D-85, D-84 (the AI runs whole conversations), D-81 (guardrails).

Pinned to come back to; not started.

---

## D-87 · Rule: every mass message goes to a tag, so no one is messaged untagged — pinned as a RULE (Kushal, 2026-10-21)

**The rule:** a campaign (a message to many people, whoever starts it: a person, the AI assistant, an import's "Message these people") must have a **tag** as its audience, and everyone it reaches carries that tag. Nothing is sent to an untagged group. The reason is to keep the database and the backend simple: one way to say who got a message, one thing to look up, filter, re-send to or report on.
- **How, without making it a chore:** if the audience is chosen another way (ticked people, a filter, an import run, a typed list), the system **creates a tag for it automatically** (named from the campaign and the date, for example "Zephyr launch 21 Oct") and tags those people **before** the campaign is created; the person can rename it. The campaign then points at the tag.
- **Where it applies:** the campaign form, "Campaign from checked contacts", "Message these people" after an import (D-73), the AI's `create_campaign` tool, and the API. The API refuses a campaign that has no tag audience instead of guessing.
- **Already true in part:** campaigns can target a tag and an import is tagged with its file name by default; "Campaign from checked contacts" already says to tag first. The rule makes it the only way.
- **Open:** whether existing campaigns with other audience types are migrated (tag backfilled), and whether a tag can be shared by two campaigns (yes: reuse is the point).
Related: D-68 (tag people first), D-73, D-85 (templates choose a tag audience).

Pinned as a rule; not built.

---

## D-88 · An OpenAPI spec and a Swagger page for the API — pinned (Kushal, 2026-10-22)

**Asked:** "is there a Swagger API thing for this?" **No.** There is no OpenAPI spec and no `/api/v1/openapi.json`; `docs/15-api.md` says so in its first lines, and the only
substitutes are that document, [`24 · Testing it by hand`](24-local-testing.md) and the Insomnia collection (`tools/insomnia-collection.json`, about 88 requests, kept by hand). The API
now has about **100 route handlers** (38 GET, 46 POST, 4 PUT, 3 PATCH, 9 DELETE) across 13 files, so a hand-kept list is already behind (the AI settings, templates and campaign-picture
routes were added after the collection was last updated).

**What to build:**
- **A generated OpenAPI 3.1 document** served at `/api/v1/openapi.json`, built from the Zod schemas that already validate every request body, so it cannot drift from the code (M22).
  Most routes keep their schema inline in the route file; the work is a registry (one place that names each route, its method and path, its auth, and its request and response schemas), whether by an
  existing Zod-to-OpenAPI library or a small one of our own, and moving the inline schemas to be read from it.
- **A Swagger UI (or Redoc) page** at `/api/docs`, served from our own server with its script and styles bundled (no CDN), with **Try it out** working against the signed-in session or an API key.
- **Documented in the spec:** the two ways in (a session cookie plus the `x-csrf-token` header for the web app, and `Authorization: Bearer <key>` with its **scopes** such as `messages:send` and
  `conversations:read`), which routes need an **admin session** (an API key can never call them: AI settings, templates, switching the assistant on), the common error shape (`application/problem+json` with `code`
  and `detail`), the rate limits (templates generation, AI settings), the upload routes that take raw bytes (`/conversations/:id/attachments`, `/campaigns/media`, `/imports`), and pagination (`cursor` / `nextCursor`).
- **Kept honest by a test:** a check that fails when a route exists with no spec entry (and the reverse), so a new route cannot ship undocumented.
- **Then:** a typed client generated from the spec for `packages/sdk` (docs/15 already promises one), and **Schemathesis**-style fuzzing of the spec (D-49's list of testing tools).

**Decisions to make first (ask before building):**
1. **Who may see the docs page:** public (anyone who finds the address can read the whole surface), behind a signed-in session, admins only, or off in production by default. Recommended: signed-in admins only, and off unless asked for on a public install.
2. **Library or hand-rolled registry** (a maintained Zod-to-OpenAPI library is less code; a small registry has no new dependency). Not chosen.
3. **Whether the spec lists the internal admin and gateway routes** or only the public integration surface (what JobPortal and other apps call). Recommended: two tags, public and internal, with internal hidden by default.
4. **Versioning:** the spec carries the app version; breaking changes need `/api/v2`, which the current routes do not plan for.

**Why parked:** the API is still moving every week (see the AI and campaign routes added this week), and a spec that is hand-maintained is worse than none. The generated approach needs the registry first, which touches every
route file, so it is a deliberate piece of work, not a quick add.

**What brings it back:** JobPortal (or any integrator) needing to self-serve the integration (D-69), the repository or the docs site going public (D-15), or the first outside user who is not Kushal or Mikhil.

**Meanwhile:** use `docs/15-api.md`, `tools/insomnia-collection.json` (import it into Insomnia or Postman; it does not yet include `/ai/llm`, `/ai/templates` or `/campaigns/media`), and the curl recipes in
`docs/24-local-testing.md`. Related: D-15 (docs site), D-49 (testing tools), D-69 (job-portal chat plug-in), M22 (a spec written by hand drifts).

Pinned to come back to; not started.

---

## D-89 · Speed: the Contacts page, sign out, and measuring in production mode — pinned (session audit, 2026-10-22)

Findings are in [`37-session-audit-findings.md`](37-session-audit-findings.md). In short, a timed pass over every screen found **one real bottleneck, one unexplained delay, and a measuring problem**:
1. **Contacts is the slow page.** 6.3 to 7.2 s to open and 3.3 to 5.5 s per search (about 4.2 s on average), in a test org of about 110 people, against 0.3 to 3 s for every other page. It sends about 1 MB of HTML and 158 forms for 50 people because each row builds its hidden controls up front (the "rows that open" change of D-70). **Build the controls when a row opens, share one do-not-contact form, and re-measure.** At an idle machine it was 1.7 s; the target is under 1 s.
2. **Sign out took 9.9 s** (and 3.9 s to confirm the session was gone). Profile it.
3. **Measure in a production build**, not `next dev`: first visits took 2.6 to 8.5 s only because the dev server compiles on first request. D-83 (some screens stale after an action in `dev:fast`) needs fixing before production-mode numbers can be trusted for every flow.
4. **A held campaign should say why** (new-contact limit, quarantine, not connected, pacing): today it shows "Pending" with no reason for as long as it is held (a test sat 8 minutes). Each message already stores a `hold_reason`; show it on the campaign page with when it will resume.
5. **Dev hygiene:** `next dev` grew to 4.5 GB in 15 hours and, with a busy browser, pushed the machine into 7.8 GB of swap and made the test browser die. Restart it daily; close heavy Chrome tabs during measurements.

Related: D-46 (UI lag), D-61 (lighter web tier), D-70 (the Contacts page), D-83, D-72 (phone width).

Pinned to come back to; not started.
## D-90 · Import duplicates: newest name wins now; a "Needs review" list later; a cleanup script for old copies — pinned (Kushal, 2026-10-22)

**Why:** Mikhil imported two Excel files with the same phone number and different names; the contact kept the first name and nothing said so.

**Built (this PR):**
- **Newest name wins.** When an import carries a different name for someone already in the book, the name is replaced (a blank name never overwrites). The old and new name go to `audit_log` as `contact.name_replaced_by_import`, with the import run and row.
- The **Preview and the result** list those rows ("N people already in your book will have their name replaced", with `Was "old" → "new"`), apart from the rows that lost a number.
- **`npm run dedup:cleanup`** (`scripts/dedup-cleanup.ts`), run by hand. Dry run by default, writes `dedup-report-<time>.csv`; `--apply` asks for `yes`. It merges tags that differ only in capitals or spaces (people and campaigns move to the oldest), cancels identical draft campaigns (keeps the newest), and only *reports* repeated uploads and possible same-person contacts (same last ten phone digits).

**Not built (pinned): a "Needs review" choice.** Instead of silently taking the newest name, the import would import every non-conflicting row at once and park the conflicts in a list on the import (`existing → new`, Keep / Replace / Keep and note, with bulk buttons); rows not yet reviewed change nothing, and the result says "N imported, M waiting for your choice". It needs a new list screen and a state for "waiting", which is why it is not the first version.

**Dedup timing, in one line:** decide at import time, at Preview, before anything is written. A CRM keeps **one row per phone number** (it is what the 14-day cooldown and "do not message twice" rely on), so there is no ETL, partitioning or slowly-changing-dimension pipeline; the history that matters (the old name) lives in the audit log. A full valid-from/valid-to history (SCD type 2) only becomes worth it if someone needs "what was this person's name on date X".

**Contacts are never duplicated by re-importing a file:** the same phone or email always matches the same person (unique index `contact_identity_lookup_uidx`). What piles up are the records around it: import runs (marked replaced by "Upload anyway"), file-name tags, draft campaigns. Merging two *people* (different phone spellings) would mean merging their conversations, so `dedup:cleanup` only lists them.

Related: D-89 / D-46 (the Contacts page), D-45 (`@lid` linking).

---

## D-91 · A chat the AI is handling cannot be typed into until a person overrides and stops the AI — pinned (Kushal, 2026-10-22; raised again 2026-10-23)

**What:** while a conversation is **assigned to the AI assistant** (its assignee is the assistant's bot user, `app_user.is_bot`), the chat's text box is **blocked for people**. A person takes the chat by pressing **Override and stop the AI** first; only after that does the text box work. If they try to type or send before overriding, show a clear warning instead of letting it through:

> *The AI has been assigned this chat. Please override and stop the AI before you can take over the chat here.*

**Why:** two voices answering one customer at once (the AI and a person) is confusing for the customer and can contradict itself; and a person typing into a chat the AI also answers risks both replying.

**Shape (to confirm when built):**
- **Screen** (`apps/web/app/inbox/[id]/composer.tsx`, `ai-notice.tsx`, `thread-controls.tsx`): the box is disabled and shows the warning when the person clicks or focuses it or presses send; one button, **Override and stop the AI**, does the take-over.
- **Server** (`apps/api/src/routes/messages.ts`, which already refuses with `THREAD_ASSIGNED` when another human owns a thread): refuse a person's message to an AI-assigned chat with a clear `AI_ASSIGNED` code, so the rule holds for the API and not only the screen.
- **Override** = assign the chat to the person, which stops the assistant for this chat (it only answers chats assigned to it, `packages/core/src/ai-reply.ts`), and cancels any AI reply still queued for it. Audited like other assignment changes. The AI does not resume by itself; a person hands the chat back on purpose.

**Update 2026-10-23 (raised again: "block the user from texting if the chat is assigned to the AI or the AI is texting in the chat"). What is true today, checked in the code:**
- There is already a lock, but it is the *general* "another agent owns this thread" rule (`lockedByOther` in `apps/web/app/inbox/[id]/page.tsx`, mirrored by `THREAD_ASSIGNED` in `apps/api/src/routes/messages.ts`). It treats the AI's bot user like any colleague, so an agent sees "Assigned to AI assistant, reassign it to yourself, or ask an admin, to reply" and cannot send.
- **But admins and participants bypass it** (`me.role !== 'admin'`, `participants.some(...)`), so an admin, which is what Kushal is, can type straight into a chat the AI is answering, and the AI and the person can both reply. That is the gap this pin closes.
- There is no check for the moment between "the AI has been assigned" and "its reply goes out": an AI reply that is being written (the model call takes seconds) or is queued/held (`queued`, `hold_reason`) can land after a person's message.

**Wanted (add to the shape above):**
1. **The block applies to everyone, admins included, whenever the chat is assigned to the AI** (assignee `is_bot`), on the screen and in the API (`AI_ASSIGNED`, 409). Participants too. The only way through is the override.
2. **The override is the "Take back from AI" action that now exists (#158)**, shown right inside the composer as the one button "Take over from the AI", with the warning text above. It assigns the chat to the person, cancels any AI reply still queued for the chat, and is audited.
3. **While the AI is mid-reply** (a run in progress, or a reply of its own queued or held), say so in the composer: "The AI is writing a reply here", keep the box blocked, and on take-over cancel that queued reply so it is not sent after the person's message.
4. **A person's message and the AI never both go out for one inbound message:** if a person's message is sent first (after take-over), the AI's run for that message is dropped (`autoReply` already skips when a newer outbound exists and when the chat is no longer the AI's; add the same check at the gateway just before the send).
5. Internal notes stay allowed while the AI has the chat.

**To decide when we build it:** may any agent override, or admins only; whether the AI may be handed the chat back with one click; what the banner says to a second person looking at the same chat.

**Test:** a browser test that an AI-assigned chat's box is disabled, shows the warning, and works after Override; an integration test that the API refuses (tag it with the next R-number when it is built). Related: D-81, D-84, D-85, D-86.

Pinned to come back to; not started.

---

## D-92 · A separate feedback portal: testers' Google Doc into GitHub issues, with AI help and follow-up questions later — pinned (Kushal, 2026-10-22)

**What:** feedback intake lives **apart from the CRM**: not in its app, API or database. Decided so far: **no new server for now.** A **scheduled GitHub Actions worker** (every 5 to 10 minutes, or on demand) reads the shared Google Doc where Mikhil and the alpha testers paste their screenshots and describe each problem in their own words, and turns each problem into a GitHub issue (`bug`, `alpha-feedback`, `needs-triage`), never twice (a hidden marker per heading), and adds a comment when a problem is edited later. It feeds the same flow as `npm run feedback:import` (docs/39).

**Parsing:** **no AI needed for the template** ([`feedback/TEMPLATE.md`](feedback/TEMPLATE.md): a heading per problem, then lines such as *Which screen:* and *What happened instead:*): plain code reads it exactly. **AI later** (pinned): for messy free-text blocks (pull out screen, steps, expectation) and to **draft the clarifying questions** to send back. Phone numbers and e-mail addresses are masked before anything is posted; **screenshots stay in the Google Doc** (private) and are only referred to, because the repository is public.

**Clarifying questions:** for now **Kushal asks the testers himself** (there are only the other dev and a few alpha testers). For production level: the worker (or a later portal) posts the questions into the Doc as a comment or a reply and tracks who answered; the AI drafts them.

**Needs from Kushal to switch on:** a Google service account (read-only) whose key is stored as the GitHub secret `GOOGLE_SERVICE_ACCOUNT_JSON`, the document shared with that account, and the doc's id as `FEEDBACK_DOC_ID`. Until those exist the worker does nothing and does not fail. (Scheduled workflows on a public repository are paused by GitHub after 60 days without repository activity.)

**Later, if it outgrows this:** a small standalone portal (its own server and storage, never the CRM database) with logins for the team and testers.

**Update 2026-10-22 (PR "Google Doc ingester"):** the first slice is built: `npm run feedback:gdoc` turns the doc into the importer's markdown (one problem per numbered line or heading, screenshots counted not copied; a private doc is read with a Google service account, a link-shared doc needs nothing, a saved text file works), and `.github/workflows/feedback-ingest.yml` runs it with the importer every 10 minutes and on demand, doing nothing until `GOOGLE_SERVICE_ACCOUNT_JSON` and `FEEDBACK_DOC_ID` are set (setup steps in docs/40). **Also built the same night: a browser tool that needs no credentials at all:** `npm run feedback:bookmarklet` writes `tools/feedback-doc-reader.js` and a bookmark; run on the Google Doc's tab it reads the doc's simple HTML view with the person's own signed-in session and saves the markdown to Downloads, and `npm run feedback:latest` imports it (dry run, then `--apply`). Tried on the real doc: 4 problems, 5 screenshots counted. Still pinned: AI for messy docs, AI-drafted follow-up questions posted back to the tester, and a portal with its own storage.

Pinned to come back to; the AI parts and the questions are what is left.

---

## D-93 · A separate log for the AI assistant, through the whole process — pinned (Kushal, 2026-10-22)

**What:** the AI assistant gets **its own log**, apart from the gateway's and the API's, so one chat's AI reply can be followed from start to finish without searching a mixed stream: *inbound message received → is the chat assigned to the assistant → consent, on/off and daily-cap checks → do-not-contact check → the instructions and the rules used (template id, version) → model call (provider, model, how long, tokens) → any tool call (hand-over, start a campaign) → the reply queued → gateway pacing and send → delivered/read*. Each line carries the same ids (organisation, conversation, message, assistant run), so a person can filter one chat. **No message text and no phone numbers in the log** (the conversation is private data): ids, decisions, reasons and timings only.

**Why:** today the assistant's steps are spread over the API log and the gateway log (`packages/core/src/ai-reply.ts`, `apps/gateway/src/main.ts`), which makes "why did it not reply here?" or "why did it hand over?" slow to answer, and the same visibility is needed for the takeover lock (D-91) and for testing it.

**Shape (to decide when built):** a dedicated logger child (`component: "ai"`) written to its own file/stream (`ai.log`, rotated) as well as stdout, with a small viewer or a filter command (`npm run logs:ai -- --conversation <id>`); the audit table keeps recording the changes, this is the trace of the process. Related: D-84, D-85, D-91.

Pinned to come back to; not started.

---

## D-94 · Messages the owner sends from their own phone, and older chat history, are missing from the inbox — **HIGH PRIORITY** (Kushal, 2026-10-22)

**What:** Kushal: "chat history that is sent by the user [is] not visible in the inboxes." Today the inbox only shows what a contact sent **to** the linked number and what was sent **from the CRM**. Whatever the owner types **in the WhatsApp app on their own phone** to a contact never appears, so a thread in the CRM can show only half of a conversation, and a person picking up a chat cannot see what the owner already said.

**What the code does today (evidence):**
- `packages/channels/baileys/src/index.ts` (about line 516, inside the inbound handler) **drops every message whose key has `fromMe: true`**: `if (m.key?.fromMe === true || …) return;`. That is a message the owner sent from the phone (or another linked device), so it is thrown away on purpose before it is stored.
- `syncFullHistory: false` (line 367): the older history WhatsApp can hand a newly linked device is not requested either, so chats that existed **before** the number was linked start empty.
- In the gateway log of 2026-10-22 about **650 "failed to decrypt" errors were `fromMe: true` messages** (the owner's own sends arriving on the linked device and not being readable by a freshly linked session), which is the same family: those messages exist on WhatsApp's side and are lost to the CRM.

**What to decide and build:**
1. **Store the owner's own sends** from the phone as outbound messages in the right conversation (sender shown as "sent from the phone"), de-duplicated against messages the CRM itself sent (same provider message id), in order, with their delivery state. They must **not** trigger the AI assistant, a campaign cooldown, or an auto-reply.
2. **Older history on linking:** request a bounded history sync when a number is linked (a limited window such as the last 30 to 90 days, or the last N messages per chat), imported once, never re-sent, never counted against sending limits. Needs a size and privacy decision, and care with the anti-ban side (no sending is involved).
3. **Decryption of the owner's own messages** on a fresh link: find out whether those failures are recoverable (asking the phone to re-send history) or only appear after a re-link.
4. **Inbox:** show them in the thread in the same order, visibly different from CRM-sent messages; unread counts unaffected.

**Test:** an integration test that a `fromMe` message from the phone is stored once and shows in the thread (and not twice if the CRM sent it); a test that it does not wake the assistant; a regression R-number when built. Related: D-45 (`@lid` linking), D-82 (session desync, which also causes these decrypt failures), D-91.

**Update 2026-10-22 (PR "own messages", R-010):** built **step 1 and step 4**: a message the owner types on their own phone is now stored as an outbound message (`sent_by = 'phone'`, at WhatsApp's own time, no unread, never offered to the AI assistant), shown in the thread labelled "You, from your phone", and de-duplicated against the CRM's own sends (the provider remembers ids it sent, the gateway waits 10 s before storing, and the database allows one row per WhatsApp message id). The thread now also shows WhatsApp-style times (the time in the bubble, the full date on hover, "Today" / "Yesterday" day headings). **Still open:** step 2 (older history when a number is linked) and step 3 (the owner's own messages that arrive undecryptable on a fresh link). A gateway restart is needed for the new behaviour to take effect. Messages typed on the phone while the gateway was down are not recovered (they arrive as history, which is step 2).

Remaining work pinned as **high priority**.


## D-96 · Forgot password: a way to reset your own password — 🔺 **PRIORITY** (Kushal, 2026-10-23)

**What:** today there is no self-service reset. The sign-in page says "Ask an administrator to set a new password for you from the Team page", and the only other route is the command line (`npm run admin -- password --email …`, docs/23-auth.md). On the beta test server (a real instance other people use, no operator at a keyboard) someone who forgets their password, or the only admin who does, is locked out until a person with shell access acts.

**Why now:** the Linode beta (docs/43) is the first install people other than Kushal sign in to. The first admin's password is generated and shown once; losing it, with no backups and no second admin, means data nobody can reach.

**Options to choose from (not decided; ask Kushal first):**
1. **Emailed reset link (the usual way).** A "Forgot password?" link on the sign-in page, a one-time link by email, a new-password page. Needs the email driver, which is an empty directory today (`packages/providers/email`), plus a sending account (SMTP or a provider's API) and a domain or at least a sender address that mail providers will accept. Biggest build, normal behaviour.
2. **Admin-issued reset link, no email.** An admin on the Team page presses "Reset password" for a person and gets a one-time link (valid, say, 1 hour) to hand over by WhatsApp or in person. No email needed; does not help a lone admin.
3. **Recovery codes.** At first sign-in the admin is shown a set of one-time recovery codes to keep; a code lets them set a new password. Works for a lone admin with no email, one more thing to lose.
4. **Both 2 and 3** is the realistic beta answer; 1 can follow with a domain.

**Rules that must hold whichever is chosen** (docs/23-auth.md): changing a password ends every session that person holds; the reset never says whether an email or account exists; links and codes are single-use, short-lived and stored only as hashes; attempts are rate-limited like sign-in (3 wrong tries locks for minutes); every use is in the audit log; a person who is disabled or do-not-use cannot reset.

**Tests:** an integration test per route (link or code works once, expires, is refused on reuse, ends old sessions, is rate-limited, leaves an audit row) and a browser test of the forgot-password page. Per docs/39, none of this is a bug, so it goes straight to a feature PR.

## D-97 · AI settings: say "add a model first" next to the Save button when no model is set up — 📌 pinned (Kushal, 2026-10-23)

**What:** on a fresh install nothing tells a new user that the AI assistant needs a model before it can do anything: the AI settings, the template builder and "Hand to AI" all quietly do nothing useful. Put a plain line at the bottom of the AI settings, next to the Save button: **"Add a model first to start using the AI assistant"** (shown while no provider, key and model are saved; gone once a model is saved and tested). The same short line, linking to the settings, wherever the AI is offered but cannot work yet (the AI page, "Message a group", the thread's Hand to AI button, which should be disabled with that reason instead of failing later).

**Where in the code:** `apps/web/app/ai/settings/llm-form.tsx` (the Save button), the AI page and `apps/web/app/inbox/[id]/thread-controls.tsx`. The server already knows (`GET /ai/llm` says whether a model is configured; `answer-now` answers `AI_NOT_CONFIGURED`).

**Test:** a browser test that a fresh install shows the line beside Save and that saving a model removes it.

## D-98 · A usage and limits check for the chosen AI model: used, remaining, and roughly how many messages it can still handle — 📌 pinned (Kushal, 2026-10-23)

**What:** for whichever model the organisation set up, show on the AI settings page how much it has used and how much is left, and in plain words roughly how many more replies or campaign openings that is ("about 400 more replies today"), so the AI does not run out in the middle of a campaign without warning.

**What can be known, and from where**
- **Ours, always available:** every AI run already records its model and input and output tokens (`ai_run`), so tokens used today, this week and per kind (reply, opening, template) can be shown for any provider. The daily message cap (`ai_setting.daily_message_cap`) is already ours too.
- **The provider's, only when it says:** some providers (Groq and other OpenAI-compatible ones) return rate-limit headers on each call (requests and tokens remaining, and when they reset); others expose a usage or credit endpoint; some say nothing. Plan: read the headers on every real call and keep the last values, show "unknown" honestly where a provider gives none, never guess a balance.
- **The estimate:** average tokens per reply from our own recent runs (a reply today is about 650 in and a few hundred out; a reasoning model can use far more, R-012) divided into the remaining tokens or requests. Shown as a rounded range with the caveat "an estimate from your recent use".
- **The model's own size** is the number already shown next to each model in the picker: its context window (see below), which is not the same thing as usage.

**Warnings:** when the estimate drops under a threshold, or the provider answers 429 (rate limited) or a quota error, show the existing AI warning banner (`AiNoticeBanner`) with the cause, and hold AI-written campaign openings (D-97 neighbours: `ai-opening.ts`) rather than failing every recipient into `ai_opening_failed`.

**Where:** `packages/providers/llm` (capture headers in `openai-compatible.ts` and `anthropic.ts`), a small `ai_usage` read in `packages/core/src/ai-settings.ts`, the API (`/ai/llm`) and `apps/web/app/ai/settings/`.

**Test:** integration tests for the totals and the estimate with a fake model that returns rate-limit headers and one that returns none; a browser test that the panel shows "unknown" without headers.

**The numbers in the model list (answer to Kushal's question):** the "131k", "4k", "1k" beside each model are its **context window**: the most text the model can read and write in one request, counted in tokens (a token is about three quarters of an English word, so 131k is roughly 100,000 words and 4k roughly 3,000). They come from the provider's own model list (`context_length`), shown in `apps/web/app/ai/settings/model-picker.tsx`. Bigger is not "better": our replies are short, so 4k is enough for a short chat and 131k only matters for long histories. "tested" is a separate badge: the model we have run our own check against.

## D-99 · Contacts: add one contact, or several at once, by hand — 📌 pinned (Kushal, 2026-10-23)

**What:** the Contacts page only lists people. The only ways in are the import wizard (a whole file) and people who message in. Add an **Add contact** option on Contacts with two modes:
- **Single:** a small form: name, phone number (with country), optional email, optional tag, and a "also keep these columns" free field row if wanted. Same checks as an import row (the number is normalised and de-duplicated, a number already in the book says "already exists, open it").
- **Multiple:** paste several lines (one person per line, `name, phone` or just phones) or type them into a small table, with a preview of how many will be created, updated or refused (and why) before anything is written, then the same result summary as an import.

**Reuse, do not rebuild:** `POST /contacts` already exists (`apps/api/src/routes/contacts.ts`, scope `contacts:write`, schema `createContact`); the multiple mode should go through the import pipeline (`packages/core/src/ingestion.ts`, "newest name wins", phone and email matching, audit, the tag option, do-not-contact) as a small inline "import" so one code path decides who is a duplicate, not two. Works with the AI follow-up: a hand-added person can be put in a campaign like any other.

**Open question for Kushal:** "single/multiple contact option" was read as adding one or many contacts by hand. If it meant something else (for example choosing one or several contacts in the list to act on, which bulk tagging already does), say so and this pin is rewritten.

**Test:** an integration test per mode (creates, de-duplicates, refuses a bad number with the reason, writes an audit row) and a browser test of the form and the paste box.

## D-100 · Campaigns: an indicator on each campaign showing whether the AI is used — 📌 pinned (Kushal, 2026-10-23)

**What:** on the Campaigns list (`apps/web/app/broadcast/page.tsx`) and on each campaign's own page (`apps/web/app/broadcast/[id]`), show at a glance which campaigns use the AI and how:
- A small **AI** badge on every campaign that has an AI template (`campaign.ai_template_id`), with the template's name on hover or beside it, linking to the template. No badge on a plain campaign.
- On the campaign page, one plain sentence of what the badge means: "The AI writes each person's first message from the template X, and answers replies" (since #157 and R-011 both apply to such campaigns).
- Useful states, if cheap: **AI off** (the organisation has switched the assistant off or has no model, so this campaign is waiting or its openings are not being written), **openings written** (for example "12 of 40 written", `campaign_recipient.opening_enc` set), **skipped: AI failed** (`ai_opening_failed` count), and **chats the AI has right now** (conversations assigned to the assistant that came from this campaign).
- A filter on the list: All / AI campaigns / Plain.

**Why:** since #157 an AI-template campaign no longer sends the typed text, and the AI takes over its replies. Nothing in the list says which campaigns behave that way, so a person can start one without knowing the AI will write to people. It also explains a campaign that "does nothing" because the AI is off or the model is out of room (see D-97, D-98).

**Where:** the campaign list and detail API responses need `aiTemplateId` and the template name (`apps/api/src/routes/campaigns.ts`, `packages/core/src/campaigns.ts`), plus the opening counts per campaign; the web side is two components and the type in `apps/web/lib/crm.ts`.

**Test:** an integration test that the list and detail responses carry the template and the counts; a browser test that an AI campaign shows the badge and a plain one does not.

## D-101 · "Waiting for this message" on the recipient's phone, even when the AI sends it — 🔺 **PRIORITY** (Kushal, 2026-10-23, raised again after it kept happening)

**Symptom:** the contact's phone shows "Waiting for this message" instead of the text. Seen from the campaign's first message onward, now also on the AI's reply. Reported by the other dev on 2026-10-22 and again 2026-10-23.

**What was fixed before, and why it did not fix this:** #96 (answer a recipient's resend request, so a placeholder can clear), #110 (never message the sending number itself), #103 (a gateway crash left resend requests unanswered), relinking after a restart (D-82). Each removed one cause. None touched the cause below, so the symptom came back. Saying "traced" and "relink fixes it" was not a fix.

**Root cause (docs/45, high confidence, not yet reproduced in isolation):** Baileys 6.7.24 stores each Signal session under `user.device` with no link between a person's phone-number address (`919964122631`) and their LID address (`110762928373833@lid`), and WhatsApp now addresses the same person both ways. We send under the phone-number address; the recipient's device answers and retries under the LID address; our store has no session for it (`No session record`, then `No matching sessions found`), and the recipient cannot decrypt ours (retry request 0.5 s after the AI's message, 08:37:57). A retry and placeholder-resend storm follows, which churns sessions further.

**More evidence, screenshot 2026-10-23 (thread with `+919964122631`, number `kushal_test`):** two outgoing messages, "halo?" and "reply with "niga" if you can see this message" (a manual test that the other phone can read us), both labelled **delivered**, with no reply; above the composer the amber banner **"WhatsApp may be limiting kushal_test — messages from it could arrive late or not at all. You can still send; they are being paced more slowly."**
Two things follow, and both belong to this pin:
1. **"delivered" does not mean readable.** It is only WhatsApp's acknowledgement that the message reached the recipient's device; a message the device could not decrypt is still "delivered" while the phone shows "Waiting for this message". The thread gives the person no way to tell. Wanted: a state of its own when a **retry request** arrives for a message (the recipient could not read it): **"The other phone could not read this yet (retrying)"**, turning to "delivered" only when the retry succeeds or a read receipt arrives, and to "could not be read" after N retries. The gateway already logs `recv retry request` and `resending a message the recipient could not decrypt`; it only has to record it on the message.
2. **The amber banner is likely a false alarm caused by the same fault.** The restriction tracker (docs/27) and the health scorer read our own decrypt failures and unreadable messages as a suspected soft ban (D-82 recorded this: a 48-hour quarantine, risk 100), then **pace sends more slowly**, which makes a test look worse and delays the AI's replies. The banner must say what it is based on ("because 133 messages from your own phone could not be decrypted", not just "WhatsApp may be limiting"), must **not count decrypt failures and retry requests towards a ban score**, and should link to the relink fix. Add to D-82's list: "the scorer ignores decrypt failures and recipient retry requests".

**Options (smallest first; ask Kushal which to start, or do A then C):**
- **A. Send to the LID address when we know it.** Every inbound message tells us the contact's LID (`remoteJid`, with `senderPn`). Store it on the contact's identity and address replies, the AI's messages and resends to the LID JID, so both sides use the same session. Small, testable, no library upgrade; needs a check that 6.7.24 sends to `@lid` JIDs cleanly.
- **B. Upgrade Baileys to the 7.x line,** which has LID mapping and session migration. The proper fix, with the usual risk of a library upgrade (API changes, re-pairing); needs its own plan and a spare number on the Linode for a day or two.
- **C. Make it visible and safe (D-82):** when a decrypt-failure burst or a recipient retry request is recorded, show it on the Linked numbers page and the thread, hold AI and campaign sends for that number, and offer a one-click relink. Stops the AI sending into a broken session.
- **D. Also (D-82):** flush the auth state on SIGTERM, order key writes, run the gateway without `tsx watch` by default in `dev:all`, and make the health scorer ignore our own-account decrypt failures.

**Done means (acceptance):** on the Linode with a spare number, a campaign opening and an AI reply to a contact who has replied are read normally on the other phone; the log shows **no `recv retry request` within 5 s of a send and no `No session record` for the contact's LID**; and an integration test covers "a reply that arrives under a LID address finds the session made under the phone-number address".

**Process:** per docs/39 this is a bug: issue (#160), registry entry R-013 and a test first, then the fix PR.

**Update 2026-10-23 night: BUILT, not yet proven on a real phone.** Option B was done (Baileys 7.0.0-rc14) together with C's visibility (the thread says when the other phone could not read a message; a broken encryption session is said on the thread) and the first half of D (ordered, flushed credential writes; own-device failures out of the ban score). Offline proof is the R-013 integration test (real library, real credential store); a smoke test against the live WhatsApp servers connects and gets a QR. See docs/45, "The fix". **Still open:** the real-phone acceptance above on the Linode with a spare number; a number whose session is already broken still needs a relink (the laptop's was logged out on first connect under 7.x, probably because it had been unlinked by then; a number linked under 6.x on the Linode restored and connected fine under 7.x); holding AI and campaign sends while the session is broken; a relink button. Branch `fix/not-quitting-till-waiting-for-this-message-is-fixed`.

## D-102 · Messages typed on the owner's phone or WhatsApp Web do not all reach the inbox — 🔺 **PRIORITY** (Kushal, 2026-10-23; same root as D-101, follow-up to D-94)

**Symptom:** messages the owner sends from their phone or from WhatsApp Web to a contact often do not appear in the CRM thread. Some do (16 phone-sent messages are stored in the dev database from 08:09 to 09:16 UTC on 2026-10-23), many do not.

**What D-94 did and did not do:** D-94 (#144) stores a message typed on the phone as an outbound message (`sent_by = 'phone'`) **once the gateway receives and decrypts it**. That part works for the messages that arrive readable. It cannot help a message the gateway never manages to decrypt, and the log shows exactly that.

**Evidence (docs/45):** in the first gateway run of the day 251 decrypt failures are addressed from the owner's **own account's LID address** (`78847127097458@lid`): `SessionError: No matching sessions found for message`. Those are the owner's other devices (the phone and WhatsApp Web, each its own device on the account) writing to the linked number; our companion has no session under their LID address, the same phone-number-vs-LID session mismatch as D-101, here between the account's own devices. A message that fails to decrypt is never stored, so it never reaches the D-94 code.

**Fix:** the same as D-101 (an address-aware session store, or Baileys 7 with LID mapping and session migration), checked for the owner's own devices as well as contacts. Then re-test D-94's end-to-end case on the Linode: type a message on the phone and on WhatsApp Web, see both in the thread within seconds.

**Also (D-94 steps 2 and 3, still open):** older history from before linking is not imported; a message typed on a device that could not be decrypted is simply missing and cannot be recovered afterwards.

**Update 2026-10-23 night:** the same fix as D-101 (Baileys 7.0.0-rc14, docs/45) covers the owner's own devices; failures from the account's own addresses are now counted apart (`own_decrypt_burst_at`), kept out of the ban score, and the composer says so ("Messages you type on your own phone or WhatsApp Web cannot be read by this number ... link it again"). Real-phone check still to do.

**Done means:** with a linked spare number on the Linode, ten messages typed alternately on the phone and on WhatsApp Web all appear once, in order, as sent by "phone", with zero `No matching sessions` for the account's own LID in the gateway log; an integration test covers a `fromMe` message arriving under a LID address.

## D-103 · The AI tab is confusing: a guided walkthrough of what has to be set up, in order — 📌 pinned (Kushal, 2026-10-23)

**What:** the AI area has several parts (assistant settings, the model, templates, campaigns that use them, the queue) and nothing says what a new person must do first, or what depends on what. Add a short guided walkthrough, shown at the top of the AI tab until it is finished and reachable again from a "How this works" link:
1. **Choose and test a model** (provider, key, model, Test). Nothing else works without it (D-97: say so beside Save).
2. **Switch the assistant on and accept the data-sharing note** (customer chat text goes to the model's provider), and write the organisation-wide instructions.
3. **Make a template** (describe what you want in plain words, the AI writes the instructions).
4. **Message a group with it** (a campaign whose first messages the AI writes and whose replies it answers), or **hand one chat to the AI** from the inbox.
5. **Watch it** (the warning banner in a chat; the AI indicator on campaigns, D-100; usage and limits, D-98).

Each step shows done or not done (a tick), links to the right screen, and says in one sentence what it is for. A plain diagram on one screen: model → settings → template → campaign or chat → replies. Words, not jargon (explain "model", "key", "template", "token" in a line each).

**Where:** `apps/web/app/ai/` (the AI page and `settings/`); the done/not-done state is already known from `GET /ai/llm` and the AI settings. Related user doc to add or update: `docs/36-workflows.md` (an "AI from start to finish" section) and the in-app tutorial.

**Test:** a browser test that a fresh install shows the walkthrough with step 1 open and the later steps disabled with the reason, and that finishing a step ticks it.

## D-104 · "Turn the AI model off" deletes the model settings; there is no way to pause the AI and keep them — 📌 pinned (Kushal, 2026-10-23)

**What was found (Kushal asked):** the button **Turn the AI model off** on AI → Settings calls `DELETE /ai/llm` (`apps/api/src/routes/ai.ts`), which sets the driver to `none` and **erases the saved model, the key and the base URL** from the settings file (`LLM_DRIVER=none`, `LLM_MODEL`, `LLM_API_KEY`, `LLM_BASE_URL` unset). The page then shows "No AI model is set up yet. Choose a provider below, enter its key, pick a model and test it." and everything has to be entered again, including pasting the key. The confirmation does say "removes the key from the settings file", but the button is named "turn off" and a person reasonably expects a switch, not a delete.

**Fix:** two different actions with honest names:
- **Pause the AI** (or the existing assistant on/off switch used on its own): stops every AI reply and AI-written message but **keeps the provider, model and key**; one click to resume. Show the paused state on the AI tab and in the warning banner ("The AI is paused").
- **Remove this model** (the current behaviour), a separate and clearly destructive button that says it deletes the key, behind the existing confirmation, audited as today.

**Check the other switch too:** the assistant's own enabled flag (`ai_setting.enabled`) already pauses replies without touching the model; the pin should make sure the two are not confused on the page and that "pause" uses one of them consistently.

**Test:** an integration test that pausing leaves `LLM_MODEL` and the key in place and stops `autoReply` and `writeOpenings`; a test that remove still clears them; a browser test of both buttons and their labels.

## D-105 · Contacts "Dates and order": the "Date: Added / Last imported" choice is unclear — 📌 pinned (Kushal, 2026-10-23)

**What it is today (`apps/web/app/contacts/page.tsx`, "Dates and order"):** the **Date** dropdown does not filter anything by itself. It chooses **which date** the **From** and **To** boxes (and the "Order" choice beside them) are about:
- **Added** = the day the person first entered the CRM (their `created_at`, whatever the route: import, a message from them, by hand).
- **Last imported** = the day of the most recent import that created or updated them (`last_imported_at`; shown on the row as "Last imported"). A person can be added in March and re-imported in October, so the two dates differ.

So "Date: Added, From 1 Oct, To 7 Oct" means "people who first appeared in the CRM that week", and "Date: Last imported" means "people touched by an import that week".

**Why it is confusing:** a lone dropdown labelled "Date" with two bare words, no hint what it controls, placed before From and To, so it reads like a separate filter. The row label "Last imported" is also the first place the word appears.

**Fix (small, wording and layout):**
- Rename the group **"Filter by date"** and the dropdown options **"Date the person was added"** and **"Date of their last import"**, and put a one-line hint under it: "Pick which date the From and To boxes use."
- Show the choice as the sentence it makes: "People **added** between [From] and [To], newest first", updating as the boxes change; keep the existing "Showing people added …" line.
- Make From and To visibly belong to the dropdown (one row, the dropdown first, a short label such as "between").
- Check "Order" wording the same way ("Newest first" is clearer than the raw sort names).

**Test:** the existing browser test `contacts-dates.spec.ts` keeps working (labels change, `aria-label`s stay); add an assertion for the hint text.

## D-106 · Inbox: "Resolve" / "Reopen" is confusing; say "Mark as completed" / "Reopen chat" — 📌 pinned (Kushal, 2026-10-23)

**What:** the chat header has one button that reads **Resolve** on an open chat and **Reopen** on a closed one (`apps/web/app/inbox/[id]/thread-controls.tsx`, `status` open or closed). "Resolve" sounds like fixing a problem or a support ticket; this is a CRM chat, and the button only marks it finished.

**Change (wording only, no change to what it does):**
- Open chat: button **Mark as completed**. Closed chat: button **Reopen chat**.
- The inbox list tab **Closed** becomes **Completed**, and the small `closed` badge on a row becomes **completed** (`apps/web/app/inbox/conversation-list.tsx`).
- Say what completing does, once, in a tooltip or a line under the button: "Moves the chat out of Open. A new message from the contact opens it again." (**Check first** that a new inbound message reopens a closed chat; if it does not today, either make it so or leave that sentence out.)
- The stored value stays `closed` (no migration, the API and audit log keep their names); only the labels change.

**Tests to update:** `tests/e2e/seeded-pages.spec.ts` (clicks `Resolve` then `Reopen`) and any spec that opens the "Closed" tab; the AI Hand-to-AI behaviour and the assistant's own handling of closed chats (`autoReply` skips a chat that is not `open`) are unchanged.

## D-107 · Import: two different things are both called "Preview"; the check should run by itself — 📌 pinned (Kushal, 2026-10-23)

**What Kushal saw:** the import page shows a table headed **"Preview of the columns and rows that will be imported"** (3 of 160 rows) and, further down, a **Preview** button whose text says "checks your file and shows who is new and who is already in your book… The Import button appears once you have run a preview." That reads as asking for the same thing twice.

**They are different:**
- The table is only a **sample of the raw file**: the first few rows as read from the sheet, before any checking (`apps/web/app/import/import-panel.tsx`, the sample table, `upload.sample`).
- The **Preview button** is a dry run on the server: it normalises every phone number and email, matches people against the book, and reports how many are new, updated, skipped or have problems. It writes nothing.

**Fix:**
1. **Rename the sample** "A look at your file (first 3 of 160 rows, as written in the sheet)", so it is clearly not the result.
2. **Run the check automatically** as soon as the columns are chosen (and again, debounced, when the person changes a mapping), instead of making them press a button. Show its result in place ("160 rows: 142 new, 11 already in your book, 7 with problems") and show **Import** straight away; keep a small **Check again** link. The server work is the same dry run (`runSheet(..., dryRun = true)`); it is cheap for a few hundred rows and should be skipped or paged for very large files (say above 20,000 rows, where it keeps the button and says why).
3. The existing safety stays: nothing is written until **Import** is pressed, and a file whose check found problems says so before Import (D-108).

**Tests:** update the import browser specs that click Preview before Import (`import-flow`, `import-keep-columns`, `import-problems`, `import-notice-and-reset`); add one that the result appears without pressing anything.

## D-108 · Import: mark invalid phone numbers and emails in the preview, and make the person fix or drop them (with a confirmation) — 📌 pinned (Kushal, 2026-10-23)

**What Kushal saw:** a sheet whose first column holds values such as `8553912035, +9156006008553912035` (two numbers in one cell, the second one a run-together mistake, far too long to be a number) and plain 10-digit numbers with no country code. Nothing in the table marks them. Problems today only appear after the Preview button, in a separate "Rows to fix" box that lists rows (`ProblemBox`, `importProblems`, errors and warnings) and then imports the rest, with no way to correct or drop a row on the page.

**Wanted:**
1. **Flag them where the person is looking.** In the sample and in the checked result, mark each row with an **invalid phone** or **invalid email** badge (and a **second number dropped** note), with the reason in plain words ("too long to be a phone number", "no country code and not a valid Indian mobile", "email has no @").
2. **A list of problem rows with two choices per row (and for all at once):**
   - **Fix it** right there: edit the value in an inline box; the row is re-checked on the spot.
   - **Drop it**: leave this person out of the import. Dropping asks **"Are you sure you want to drop N rows? They will not be imported."** with Drop / Keep, and says the original file is untouched.
3. **The import button says what will happen:** "Import 153 people; 7 rows have problems (fix or drop them first)". Decide with Kushal whether rows with a problem **block** Import until each is fixed or dropped (recommended: yes, so nobody is silently skipped) or are skipped with a downloadable list (today's behaviour).
4. **Tag them** (optional, if Kushal wants): people imported with a dropped second number or a repaired value get a tag such as `import: needs review`, so they can be found later (ties to D-90, "Needs review").
5. A **Download the problem rows (CSV)** link stays, for fixing in a spreadsheet and re-uploading.

**Where:** validation already exists server-side (`packages/core/src/ingestion.ts`, phone and email normalisation, warnings and errors per row, `importProblems`); the new work is returning per-row problems with the check (D-107), editing and dropping in `apps/web/app/import/import-panel.tsx`, and applying the fixes and drops as part of the run (a small list of row overrides sent with the import).

**Rules:** never silently drop or change a person; a drop is confirmed; an edited value is shown as edited; phone numbers use the same normaliser as everywhere else (`DEFAULT_COUNTRY` IN); personal data stays out of logs.

**Tests:** an integration test that rows with a bad number or email come back flagged with a reason, that an override fixes a row and a drop removes it from the run; a browser test of fix, drop and the drop confirmation.

## D-109 · Campaign form: "Build a new template" jumps to the AI tab, and the template picker does not make the campaign an AI campaign — 📌 pinned (Kushal, 2026-10-23)

**What Kushal asked:** why does "Build a new template →" on the new-campaign page open the AI assistant tab?

**Why it does today:** the saved templates in the campaign form are **AI templates** (D-85): a person describes in plain words what they want, the AI writes the instructions and a first message, and the result is saved. The only place to make one is the AI tab, so the link in `apps/web/app/broadcast/new/template-picker.tsx` goes to `/ai`. In a campaign form the word "template" suggests a plain saved message, and nothing says it is leaving for another tab.

**A second, bigger confusion in the same place:** picking a template in this form only **copies its first message into the message box** (`choose()` in the same file). It does **not** attach the template to the campaign, so the campaign is a plain campaign: the AI does not write each person's opening (#157) and does not take over the replies (R-011). Those only happen for a campaign made from the AI tab with **Message a group with this** (`aiTemplateId` is set only there, `apps/web/app/ai/actions.ts`). So the same template gives two different behaviours depending on which screen it was used from, and nothing tells the person.

**Fix (pick one, ask Kushal):**
- **A. Make the picker honest and consistent (recommended):** the picker becomes **"Use an AI template"**; choosing one attaches it (`aiTemplateId`), shows the AI badge and the explanation from D-100 ("The AI writes each person's first message and answers replies"), and turns the message box into the outline (as the AI tab's form already does). A separate small link, **"Just copy its first message"**, keeps today's behaviour for anyone who wants plain text.
- **B. Keep it as copy-only but say so:** label it "Copy the first message from a saved AI template (the campaign stays a normal one)" and the link "Create an AI template (opens the AI tab)".
- **Either way:** the link says where it goes and returns to the campaign form afterwards (`?next=/broadcast/new`), and a person with no templates and no model sees the D-97 hint instead of an empty dropdown.

**Tests:** a browser test that picking a template in the campaign form results in a campaign with the AI badge (A) or an explicit copy-only note (B); an integration test that the create-campaign call carries `aiTemplateId` when the picker attached one.

## D-110 · "Tell the assistant what to do" as a small chat bubble on the right side of the page, not a section in the AI tab — 📌 pinned (Kushal, 2026-10-23)

**What:** today the box that tells the AI what to do ("pause that campaign", "start the welding one", a plain-language instruction for the AI to carry out, plus the queue of requests) is a full section of the AI tab (`apps/web/app/ai/ai-queue.tsx`, heading "Tell the assistant what to do"), which makes the tab long and confusing (D-103). Replace it with a **small assistant chat bubble on the right side of the page**:
- A round button fixed at the bottom-right of every signed-in page (added in the root layout, `apps/web/app/layout.tsx`, only for admins and only once the AI is set up; hidden or showing the D-97 hint otherwise).
- Clicking it opens a narrow panel on the right, in the style of a chat: the person's instruction as one bubble, the assistant's answer as another ("Paused 'Welding drive'. I did not start the other campaign: the organisation has not allowed the assistant to start campaigns."), with each action it took or refused listed under the answer. A text box at the bottom, Enter to send, Escape or a close button to hide it. It remembers the conversation while the page is open and survives moving between pages (kept in the layout, not in one page).
- The queue is shown inside the panel as a small "working on it / waiting / done / failed" line per request, with Cancel for a queued one (the existing queue rules stay: one request runs at a time per organisation, jobs are pruned after a day).
- The AI tab keeps only what belongs to setting up: model, instructions, templates (and the walkthrough, D-103). A line there says "Give it orders from the chat bubble on the right".

**Reuse, do not rebuild:** `POST /ai/commands`, the job queue (`enqueueAiJob`, `listAiJobs`, `cancelAiJob`, the `ai_job` table, `apps/api/src/ai-runner.ts`) and `AiCommandError` all stay as they are; the bubble is a new client component calling the same actions in `apps/web/app/ai/actions.ts`. Same rules as today: admin only (or an API key allowed to send), the assistant goes through the same checks as a person and can never lift an anti-ban or do-not-contact gate.

**Phones:** on a narrow screen the panel opens full width from the bottom; the bubble must not cover the chat composer (move it above it on the inbox thread page).

**Tests:** a browser test that the bubble is present for an admin once the AI is on, absent for an agent and when no model is set, that a sent instruction appears as a bubble and its answer follows, and that the panel stays open across a page change; the existing integration tests for commands and the queue are untouched.

## D-111 · Import: de-duplicate in the browser before upload, with a progress bar; drop exact copies, ask which to keep when copies differ — 📌 pinned (Kushal, 2026-10-23)

**What:** when someone imports a file with repeated people, or the same Excel file again, the duplicates should be dealt with **on the person's own computer, before anything is uploaded**, in three steps:
1. **A loading bar** while the file is read and checked in the browser ("Reading 160 rows… Finding duplicates… 60%"), so a large sheet does not look frozen.
2. **Exact duplicates are removed automatically** (the same person, with every kept column identical, appearing again in the file), and the page says how many: "Removed 14 exact copies."
3. **Duplicates that differ are shown to the person**, one group at a time or as a table: the copies side by side with the differing cells highlighted (a different name, a different second number, a different city), and a choice per group: **keep this one**, **keep the newest**, **keep all as separate people** (rare), or **merge** (take the non-empty value from each). Nothing is chosen for them, and "Keep the newest for every group" is a button, not a default. Dropping asks "Are you sure?" (as D-108) and says the original file is untouched.

**Two kinds of duplicate, both wanted:**
- **Inside the file:** the same phone number (any form: `+91 98765 43210`, `9876543210`, `09876543210` are one number) or the same email on several rows.
- **Against the book (the same Excel imported again):** people already in the CRM. Today the server refuses an identical file ("Upload anyway") and otherwise applies "newest name wins" (D-90, #107) and `npm run dedup:cleanup` for old copies. Here the browser should also fetch the keys of the people the file mentions (phone numbers and emails only, hashed or normalised, never the whole book) and show "27 of these people are already in your book" with the same keep / replace / skip choices.

**Why in the browser:** the person sees and decides before anything is stored, nothing half-clean is uploaded, and the data does not travel until it is clean. **But the server must still enforce it** (never trust the browser): the final import keeps the existing server-side matching (`packages/core/src/ingestion.ts`, unique phone and email per person), so a mistake or a changed page cannot create duplicate people; the browser only makes the choice earlier and visible.

**Cost and risks to settle when this is built:** reading `.xlsx` in the browser needs a spreadsheet library on the page (size, speed on big files and slow laptops: do the work in a Web Worker so the page stays responsive, and cap or warn above about 50,000 rows); the normalised phone rules must be the **same** as the server's (share one function or test them against each other, `DEFAULT_COUNTRY` IN); the choices must be sent to the server as explicit row decisions (a list of row numbers to drop and merge instructions), not as a rewritten file, so the audit trail shows what the person chose; the original upload stays as received.

**Ties to:** D-90 (duplicates and "Needs review"), D-107 (the check runs by itself), D-108 (fix or drop invalid rows, same confirmation), issue #117 (import duplicates).

**Tests:** unit tests for the browser de-duplicator (phone and email forms, exact vs differing, merge), an integration test that the server still rejects a duplicate sent despite the browser, and a browser test with a file that has 3 exact copies and 2 differing copies: the loading bar appears, 3 are removed, the 2 are shown, and the chosen one is the one imported.

## D-112 · Message and campaign tracking is poor: say who sent each message (AI or a person), and show it in campaigns too — 📌 pinned (Kushal, 2026-10-23)

**What Kushal said:** "campaign and message tracking sucks". Specifically: under every message in a chat, a **small line of text saying who sent it**. If the AI wrote it, say **"Sent by the AI assistant"**. If a regular user sent it, say **"Sent by <their name>"** instead. (Tracking in campaigns is the second half, below.)

**Today:** the sender label in a chat thread is only the text above a bubble from `authorLabel()` (`apps/web/app/inbox/[id]/page.tsx`): the user's display name if there is one, "You, from your phone" for `sent_by = 'phone'`, "Campaign" for `system`, otherwise "API". The AI's messages are stored `sent_by = 'agent'` with the assistant's bot user, so they usually show as the assistant's name and are not clearly marked as AI. Nothing says which campaign a message belongs to, whether the AI wrote its text, or whether an AI answer was sent on the AI's own or after a person asked it to ("Hand to AI", D-94-style "allow reply anyway").

**Wanted (small, at the bottom of each outgoing message, quiet text):**
- **AI assistant** (`sent_by = 'agent'`): "Sent by the AI assistant". If it was an AI-written campaign opening: "Written by the AI for campaign <name>".
- **A person** (`sent_by = 'user'`): "Sent by <display name>".
- **A campaign message with typed text** (`system`): "Campaign <name>".
- **From the owner's phone or WhatsApp Web** (`phone`): "Sent from the phone".
- **An API caller**: "Sent through the API (<key name>)".
- Also the delivery state next to it (sent, delivered, read, held and why, failed), which already exists as ticks.
Inbound messages keep their current look.

**Also seen in the same screenshot (2026-10-23): the sender line and the time under an outgoing message are almost invisible** (dark text on the dark-green bubble in the dark theme). Fix the contrast of the author line, time and delivery state in outgoing bubbles in both themes (this is where the new "Sent by …" line will live, so it must be readable) and check against the WCAG contrast ratio (4.5:1) in `apps/web/app/inbox/[id]/page.tsx` and the bubble styles.

**Campaigns (the "tracking sucks" half), related open issues:** #141 (show the sent text on the campaign recipient row), #142 (AI message tracking), #139 (AI "waiting for message"). Wanted on the campaign page: per recipient, the text actually sent (for AI campaigns each person's own, since #157), who/what sent it, the delivery state, whether they replied, and who has the chat now (AI, a person, nobody) with a link to the chat; counts on top (sent, delivered, read, replied, AI is handling, handed to a person); and the AI indicator from D-100.

**Where:** the message list API already returns `sentBy` and `sentByName`; add `campaignId` and campaign name, and an `aiWritten` flag (an opening written by `ai-opening.ts` or a reply from `autoReply`; the `ai_run` row ties a message to its model and token use). Web: the bubble component in `apps/web/app/inbox/[id]/page.tsx`, the recipient list in `apps/web/app/broadcast/[id]`. No migration is needed for the label; a column recording "AI-written" may be, if `sent_by = 'agent'` is not enough (a person's message the AI polished would need it, but nothing does that today).

**Tests:** an integration test that the message list tells AI, person, campaign and phone apart; a browser test of the four labels in one thread and of the recipient row showing the sent text.

## D-113 · Linked numbers: replace "Advisory mode" with a plain anti-ban switch (On / Off) — 📌 pinned (Kushal, 2026-10-23)

**What:** the Linked numbers page calls it **Advisory mode** (the control, the red banner "Advisory mode — anti-ban is NOT enforced on this number", the audit entry, the runbook), which nobody outside the code can decode. What it really does is **switch the anti-ban engine's blocking off for one number while still recording what it would have blocked**: pacing, daily caps, warm-up, health holds and the recovery pause are logged ("advisory mode: sending past an anti-ban hold") instead of obeyed (D-29, `sender_identity.enforcement` = `enforce` or `advisory`, `apps/web/app/link/page.tsx`).

**Rename to what it is:** a switch per number, **Anti-ban protection: On / Off**, with these words everywhere the old name appears:
- Control: **"Anti-ban protection"** with **On** (default) and **Off (testing only)**; turning it Off still needs a written reason (kept, audited) and an admin, as today.
- Banner while off: **"Anti-ban protection is OFF for this number. Messages go out without pacing, caps or health holds. A ban here can be permanent."** plus the reason, how many times a hold was bypassed and when last (the counts that exist today).
- Same wording in the audit log row, the number's list entry (a small "protection off" badge next to the name), `docs/14-runbooks.md`, `docs/36-workflows.md`, `docs/08-antiban.md`.
- The stored value can stay `advisory` (no migration); only the words change.

**What stays on even with it Off (say so on the page, in one line):** do-not-contact (only an admin can lift it, per message, with a reason), the own-number guard (#110), and WhatsApp's own limits. The page must not suggest "Off" makes everything allowed.

**Why it matters:** this is the switch that was turned on to get past the 48-hour false quarantine (D-82) on a test number. People reach for it because it is named like a mild setting, not a ban-risk one. Also decide whether Off should **expire by itself** (for example after 24 hours, with a reminder), so it cannot be left on by accident.

**Tests:** update the specs and tests that read "Advisory mode" (`team-and-numbers`, the integration tests on enforcement and the runbook strings); add one for the new banner text and the "protection off" badge on the list.

## D-114 · An approval system: requests from agents to admins, with status pages and notifications — 📌 pinned (Kushal, 2026-10-23)

**Is it pinned already? Only in part.** D-76 covers one request type (a request for a **WhatsApp number**) and a Notifications tab, marked "not now". D-81 has an AI "approval mode" (the assistant drafts, a person approves). D-77 is admin controls (scopes, number limits). `docs/17-roadmap.md` lists "approval workflow" for campaigns as a later feature. **Nothing pins a general approval system** across everything an agent cannot do alone, nor a page where a requester sees the status of their request, nor notifications for the whole flow. This pin is that system; D-76 becomes its first use and should be built on it, not separately.

**Who:** *agents* (regular, non-admin users, and API keys with limited scopes) ask; *admins* decide. Today an agent who hits "only an admin can do this" just gets a refusal and has to ask in person.

**What can be requested (each one a "kind"; start with the first three):**
1. **A WhatsApp number** (D-76): "give me access to number X" or "any".
2. **Start or schedule a campaign** (an agent builds it, an admin releases it; with the audience size and the first message or AI template shown to the approver).
3. **Lift a do-not-contact block for one message** (today only an admin can, per message with a reason): the agent asks with a reason, the admin sees the chat and decides.
4. Later: import a large file, delete contacts or a tag in bulk, change AI settings, turn anti-ban protection off for a number (D-113), export contacts, invite or approve a new user (the signup approval queue in docs/32).

**The flow:** a request is created by the agent (what, why, a note) -> status **pending** -> an admin sees it in an **Approvals** inbox with the full detail and **Approve / Decline** (a reason is required on decline, optional on approve) -> status **approved** or **declined**; the requester can **cancel** while pending; a pending request **expires** (say after 7 days). On approve the action is carried out by the same code path as if an admin had done it (so every existing check still applies; approving never bypasses the anti-ban rules, which nobody can lift, and nobody can approve their own request). Every step is in the audit log.

**Status pages:**
- **My requests** (every user): a list with kind, what, when, status (pending / approved / declined / cancelled / expired), who decided and their reason; click for detail; cancel while pending.
- **Approvals** (admins): pending first, with counts, filters by kind and requester, history below; bulk Approve for the same kind with a confirmation.
- A **status chip** where the request came from (for example the campaign page says "Waiting for admin approval, requested 2 h ago").

**Notifications for the whole flow (D-76's tab, extended):** a bell with an unread count in the nav and a Notifications page: the admin gets "Asha requested number X" / "Campaign 'Welding drive' is waiting for approval"; the requester gets "Approved by Kushal" / "Declined: <reason>" / "Your request expired". In-app first (a per-user `notification` table written in the same transaction as the change; polling refresh like `inbox/auto-refresh.tsx`, no push); then optional **email** once the email driver exists (D-96) and optional WhatsApp or other channels (D-43). Notifications never contain message text or phone numbers, only names and counts.

**Design notes so it is not re-derived:** one generic `approval_request` table (id, org, kind, payload JSON, requested_by, note, status, decided_by, decided_at, decision_reason, expires_at) instead of one table per kind (D-76's `sender_access_request` becomes `kind = 'number'`); a registry mapping each kind to its `apply()` function and the role allowed to approve; the approver's session, not the requester's, performs the action; idempotent (approving twice does nothing); an org setting per kind says "needs approval" or "agents may do this alone" (so a small team can leave it off). Scopes (D-77) decide who may *ask*; roles decide who may *approve*.

**Tests:** an integration test per kind (request, approve, decline, cancel, expire, cannot self-approve, audit rows, the underlying action runs only once and only on approve) and the do-not-contact and anti-ban rules still holding after approval; browser tests of "My requests", the Approvals inbox and the bell.
## D-115 · Campaigns: a timeout for messages the AI sends — 📌 pinned (Kushal, 2026-10-23), meaning mostly clear

**Purpose (Kushal, same day): "so the AI doesn't keep waiting on it."** After the AI sends a message in a campaign, it must not wait on that message forever (for a reply, or for it to be sent or delivered). After a set time it gives up on that message and moves on (next recipient, or hands the chat back), and the campaign page says so.

**What (his words):** "timeout for AI sent messages during campaign?" Pinned as a question, not a design. Since #157 the AI writes each person's opening, and since #158 a chat can be handed to the AI, so an AI campaign can stall on the AI in a few places. A timeout would mean the campaign does not hang or sit silent forever.

**Ask him which he means (likely one or more):**
1. **Writing the opening:** if the model is slow or returns nothing (R-012), how long before that recipient is marked failed, or the campaign pauses, instead of waiting? (Today the AI call has `LLM_TIMEOUT_MS`; what happens to the recipient after it is not pinned.)
2. **Sending:** a message queued for a number that is `closed` or slow (the 22 messages queued while closed, docs HANDOFF 2026-10-23) should give up after a set time and say so.
3. **The AI's follow-ups:** how long the AI keeps a chat after a campaign opening with no reply before it hands it back (ties to D-91, Take back from AI, #158).

**Shape to propose once confirmed:** one org setting with a sensible default and a visible failure reason per recipient on the campaign page (D-112), never a silent drop; the anti-ban pacing rules stay untouched.

**Ties to:** D-100 (AI indicator), D-112 (campaign recipient tracking), D-91, R-012, #157, #158.

## D-116 · Chats: a button to jump to the bottom (the latest message) — 📌 pinned (Kushal, 2026-10-23)

**What:** in a long chat, a small round **down-arrow button** appears at the bottom right of the message list once the person has scrolled up, and one press scrolls to the newest message. It hides again when they are at the bottom.

**Shape (to confirm when built):** a count on the button when new messages arrived while they were scrolled up (for example "3 new"); a chat opens at the bottom by default; a new message only pulls the view down if they were already at the bottom, so reading older messages is never interrupted (the inbox refreshes on a timer, `inbox/auto-refresh.tsx`). Small and front-end only. Keep it simple: a CRM chat view, not a WhatsApp clone.

**Ties to:** D-46 (lag), D-112 (the sender line under each message).

## D-95 · Caching and extra data layers (Redis, result cache, views, replica, search server) — 📌 pinned for later (Kushal, 2026-10-23)

**Question asked:** would adding them make it faster? **Answer today: no.** The measured API calls take 20 to 40 ms; the slowness people feel is the dev server compiling pages on first visit (fixed by `--fast-web`, PR #153) and the size of the Contacts page (D-46). A cache does not touch either, and it adds stale-data and cross-org-leak risks plus a third thing to host. So nothing is built.

**Revisit when** a number says so: a query over about 1 s in the API log, an org past roughly 50,000 contacts, a second API process (rate limits and sessions must then be shared, so Redis), or `/auth/me` and `/senders` (0.3 to 1 s in one log) still slow after fetching less data per page. Order: indexes, then send less data (D-46), then a short cache for one named read, then Redis. The full table of signals and first steps is in [`35-database-and-queries.md`](35-database-and-queries.md) section 7.
