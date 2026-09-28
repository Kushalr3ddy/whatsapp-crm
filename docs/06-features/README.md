# 06 · Features

One file per module. Each carries: purpose, user stories, acceptance criteria (`AC-*`),
API surface, test cases (`TC-*`), and open questions. Requirement ids (`FR-*`) refer to
`../02-requirements.md`; defect ids (`M*`) to `../00-prior-art.md`.

Status legend: **✅** built (V1 complete or all but trivia) · **⚠️** partial (a working first
slice, remainder tracked in `../21-deferred.md`) · **partial / seam only** as noted.

| | Module | V1 |
|---|---|---|
| [F1](F1-channels.md) | Channels & sessions | ✅ |
| [F2](F2-contacts.md) | Contacts & identity | ⚠️ partial |
| [F3](F3-inbox.md) | Shared inbox | ✅ (search + realtime pending — D-23) |
| [F4](F4-templates.md) | Templates | ⚠️ partial (plain body + canned replies; rich templates D-19) |
| [F5](F5-campaigns.md) | Campaigns | ⚠️ partial (first slice) |
| [F6](F6-antiban.md) | Anti-ban engine → `../08-antiban.md` | ⚠️ partial (layers 1–2 of 6) |
| [F7](F7-ingestion.md) | Ingestion → `../07-ingestion.md` | ⚠️ partial (CSV + Excel; mapping wizard / gsheets deferred) |
| [F8](F8-api.md) | Public API & webhooks → `../15-api.md` | ⚠️ partial (API only; webhooks not built) |
| [F9](F9-automation.md) | Automation | partial |
| [F10](F10-analytics.md) | Analytics | partial |
| [F11](F11-admin.md) | Admin & settings | ✅ |
| [F12](F12-ai-agent.md) | AI agent | seam only |
