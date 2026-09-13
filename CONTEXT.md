# CONTEXT — delta log

Append-only. Every working session adds one entry at the **bottom**; nothing above is
ever edited or deleted. Read top-to-bottom to see how the system came to be the way it is.

Rule (see `docs/11-conventions.md`): **no session ends without an entry here.**
Scaffold one with `infra/scripts/context-append.sh`.

Entry template:

```markdown
## YYYY-MM-DD · Session NNN · <short title>
**Decided:**  what was chosen
**Why:**      the reasoning, especially what was rejected and on what grounds
**Built:**    what actually landed
**Open:**     what is still undecided or half-done
**Next:**     the intended next step
**Files:**    paths touched
```

---

## 2026-09-13 · Session 001 · Planning, research & architecture

**Decided:**
- Build from scratch. The existing `github.com/Mikhil31/WhatsAppCRM` (private, last commit
  2026-08-03) is reference material only — see `docs/00-prior-art.md` for the 30-item
  catalogue of what went wrong and the rule each defect becomes.
- Full TypeScript monorepo: NestJS (Fastify adapter) + Drizzle + Next.js, BullMQ or pg-boss
  behind a queue port, Postgres 16 as the only required datastore.
- Baileys embedded directly in a dedicated gateway process — **not** behind a third-party
  gateway. Auth state in Postgres, never on disk.
- Every external resource sits behind a driver port with a free self-hosted default and a
  managed/paid alternative (`docs/18-providers.md`).
- Three presets — `lean` (default, ~700 MB–1 GB, one process, no Redis, no telemetry),
  `standard`, `scale`. Telemetry, LLM, SMS, antivirus are all **off by default**.
- Single-tenant deploy, multi-tenant-ready schema: `org_id` on every table, RLS enabled
  from the first migration.
- Generic by construction: no `candidate`/`job` tables. Contacts with user-defined fields,
  user-defined pipelines, `external_ref` to whatever system owns the domain objects.

**Why:**
- One language lowers the cost of handing this to another developer, and Baileys is
  Node-only — a Python core would mean operating two runtimes to avoid writing ~2k lines
  of TypeScript.
- The old system's private OpenWA-gateway fork made ~40% of its WhatsApp code pure
  workaround for someone else's defects.
- The job portal's own spec (`JobPortal/docs/06-comms-layer.md`) independently defines a
  `CommsProvider` port, an ownership split, and nine integration seams. Designing to it
  now makes that integration configuration rather than a rewrite.
- Telemetry costs ~1–2 GB RAM — more than the application itself on a small VPS, so it
  cannot be the default. A self-hosted LLM costs 5–7 GB, so it must be opt-in too.

**Built:** `docs/00`–`docs/19` (incl. `06-features/F1`–`F12`), ADR-0001/0002, README,
STRUCTURE, CONTRIBUTING, SECURITY, the empty directory skeleton, and this file.
No application code — P0 is documentation only.

**Open:**
- Licence: AGPL-3.0 vs MIT (ADR-0001, undecided).
- Whether F12 (AI agent) ships in V2 or stays a seam — the job portal defers the same
  question as its T23.
- Baileys version to pin: 7.x is a release candidate (`7.0.0-rc14`); last stable was
  Nov 2025 (ADR-0002).
- The interactive capacity calculator is specified in `docs/19-capacity.md` but not built.
- Who owns the WhatsApp Business Account, and when Business Verification starts — blocks
  P8, not a code decision.

**Next:** P1 — monorepo skeleton, Docker Compose, migrations, config validation, the
provider layer with its contract suite, and CI including the JSDoc lint rule.

**Files:** `docs/**`, `README.md`, `CONTEXT.md`, `.gitignore`

---

## 2026-09-13 · Session 002 · Capacity calculator

**Decided:** The calculator ships as a standalone, dependency-free HTML file under `docs/`,
not as part of the application. It is documentation, so it must open from disk with no server,
no build step and no network.

**Why:** A self-hoster's first question is "what box do I need?", and the two answers that
matter most are not intuitive — the telemetry stack costs more RAM than the application, and
Baileys throughput is bought with phone numbers rather than hardware. A table in a document
does not make either land; a slider does.

**Built:** `docs/capacity-calculator.html` (~34 KB, no dependencies, theme-aware).
Three presets, six load sliders, per-component RAM breakdown as a stacked bar, disk projection
to 24 months, VPS recommendations, self-hosted vs managed cost comparison, and Meta message
spend at Indian rates. Every coefficient lives in one `ASSUMPTIONS` object at the top of the
script. Verified in a browser: no console errors; `lean` defaults compute to **881 MB / 0.9
vCPU / 5.1 GB year-one**, which agrees with the ~0.7–1 GB claimed in `docs/19-capacity.md`.

Two bugs found and fixed during verification: default slider positions opened the page on a
red "not enough numbers" error state, and clicking the `scale` preset displayed "standard"
because the label was re-inferred from config instead of honouring the click.

**Open:** All coefficients are **estimates**, not measurements — P11 replaces them. The page
says so at the top, twice.

**Next:** Still P1 (skeleton) or a P3 vertical slice — awaiting a decision on which feature to
build first.

**Files:** `docs/capacity-calculator.html`, `docs/19-capacity.md`, `README.md`, `CONTEXT.md`

