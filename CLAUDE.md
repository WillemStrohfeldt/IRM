# Project context — Z3 → Z5 Issue Resolution Management (IRM)

Keep this file current. It is the recovery point if a session crashes mid-build.

## Domain

High-tech manufacturer of near-identical products that differ at nanometre level.

- **Z3** = an individual production issue, resolved locally.
- **Z5** = a structural issue that similar Z3s are bucketed/linked into.
- **Z5 number is leading; product is secondary.** One Z5 can span multiple products.
- Scale: tens of thousands of Z3s. Filters/search are the navigation, not browsing.

### Z3 record
- Unique sequential number, auto-generated
- Failure code from a predefined finite list (coarse, not detailed)
- Impact score — size of impact of that specific Z3
- Long free text written by the operator who found the issue
- Long free text on how that specific issue was resolved
- Production step (steps repeat across the manufacturing lifecycle)
- Milestone (milestones do NOT repeat)
- Product it occurred on

**Z3 lifecycle:** new → worked upon → closed

### Z5 record
- Unique sequential number
- Linked Z3s
- PCCSIM way of working (see below)
- Status: new / ongoing / done
- Project lead owner **and** engineering owner (two separate roles)
- Committed availability date
- Follow-up date for the next update on the issue
- Individual close dates per PCCSIM workstream
- Further metadata TBD

**Z5 lifecycle:** triage (new → investigate → accepted to work on), with cases for
aborted, or — if a new Z5 duplicates an existing one — linking the redundant Z5 to a
leading/parent Z5.

### PCCSIM
Problem · Containment · Cause · Solution · Implement · Monitor.
Individual workstreams but **sequential** — no skipping. Each has its own close date.

### Products
Two families, **dry** and **wet**. Naming convention TBD; placeholders in use:
DRY 1.0, DRY 0.7 … / WET 1.0 … WET 6.7.

## Decisions from the user (via question forms)

- **Users:** process/production engineer (Z3s), quality/reliability engineer (Z5 patterns),
  program/ops manager (cross-product), cross-functional review board (Z5 escalation).
- **Demo goal:** prove the Z3→Z5 workflow has clear ownership and states.
- **Bucketing:** engineer *manually* links a Z3 to an existing or new Z5. No auto-clustering.
- **Linking starts** from an unlinked-Z3 queue: pick a Z3, then search for a Z5.
- **Duplicates:** duplicate stays open, shown nested under its parent.
- **KPI board is required** — is updating happening on time? Z5 tracing + IRM matter.
- **KPI metrics chosen:** Z5s with overdue follow-up date · Z5s past committed availability
  date · open Z5 count by status · PCCSIM workstreams overdue · Z5s with no engineering owner.
- **Screens in scope:** Z5 dashboard w/ KPIs · Z5 overview list · Z5 detail with PCCSIM
  workstreams and linked Z3s · linking/clustering workspace · search across everything.
- **Fidelity:** wireframes first, then UI mockup (current phase).

## Design system

**Industry** (bound at `_ds/industry-c30c53d8-54fa-4e59-b523-7f5958b16435/`).
Blueprint aesthetic: light ground #f2f2f3, single steel accent #5980a6, Barlow Condensed
headings over Barlow, square corners, hairline borders, `+` registration marks
(`.blueprint` + four `<i class="corner tl/tr/bl/br">`). Transparent cards — no surface
fills. Primary button is the one solid accent object. Load `styles.css` AND
`_ds_bundle.js` in `<helmet>` of every DC. Use `var(--*)` tokens, never raw hex/px.

## Files

- `Z5 Issue Resolution - Wireframes.dc.html` — turn 1, hand-sketch low-fi. Superseded.
- `Z5 Issue Resolution - Wireframes v2.dc.html` — turn 2, three structures on Industry
  tokens with real fields. Options: **2a** KPI console (metrics as front door),
  **2b** PCCSIM board (Z5s in workstream columns + triage lane),
  **2c** search-first register (filters as nav + linking workspace).
- `IRM - Z5 Issue Resolution.dc.html` — earlier hi-fi mockup (frozen).
- `IRM - Z5 Issue Resolution - Brand palette.dc.html` — current mockup, brand palette, interactive.
- `MVP/` — working MVP/POC built from the brand-palette mockup (started 2026-09-30). Node server with no
  dependencies (`cd MVP && npm start` → http://127.0.0.1:4310). Data = folder of readable JSON tables
  (`MVP/data/`, `dataDir` in config; `lib/storage.js`), uploads in `MVP/storage/<Z5-n|Z5-P-n|Z3-n>/`.
  Vanilla ES-module front end in `MVP/public/`. See `MVP/README.md` and `MVP/docs/data-model.md`.

## Current direction for the mockup

One app with working left-nav screen switching, combining:
- **IRM Board** (from 2a) — the five KPI tiles as the landing screen, each drilling into
  a filtered Z5 overview.
- **Z5 Overview** — dense table, saved views, Z5 no. leading with products secondary.
- **Z5 Detail** — both owners, committed availability + follow-up dates, PCCSIM stepper
  with per-workstream close dates, linked-Z3 tree with duplicates nested under parents.
- **Linking workspace** (from 2c) — unlinked-Z3 queue on the left (product, failure code,
  impact score, operator text), manual Z5 search and link on the right.
- **Search** — one query across Z3s and Z5s.

- **Teams** — three project leads (M. Devries, K. Baars, P. Sandu) with named resources.
  Per team: committed Z5 worklist (Z5, title, eng owner, workstream, due) with an 8-week
  performance strip per Z5 (update given / workstream closed / follow-up missed / due this
  week), plus team metrics: committed Z5s, on-time update rate, overdue now, past availability.

## MVP phase (current)

User asked for an MVP/POC that goes beyond clicking through: enter their own Z3s/Z5s (forms + CSV import),
save uploaded files to a chosen location, and demo real functionality. Screens built: KPI board, Z5 overview,
Z5 detail, linking, Z3 register/detail, search, data & settings, plus DRB and Teams (added 2026-09-30).
Z5 detail tabs match the mockup: Resolution · Working notes · Triage record · Linked Z3s · Child Z5s.
KPI board (2026-09-30): all mockup charts, computed live, as configurable widgets (show/hide, order, width,
per-chart options, product/failure-code filter, KPI targets) stored in `settings.board`; move rate (parts/week)
in `db.moveRate`, editable in Data & settings. Demo seed adds 2 years of closed history for the trends.

## Data & SAP decisions (2026-09-30)

- MVP moves to another device; data will sit on a secure internal network drive. Multiple users via browser,
  one server = single writer (lock file). Local files for now; IT may provide a database later (swap `lib/storage.js`).
  Node availability on the target device is still unconfirmed (portable Node or packaged exe as fallback).
- **SAP is master for Z3s** (read + re-import): number, name, failure code, product type, serial number, impact,
  created on (`found`), resolved on (`resolved`), production step, milestone, long text, resolution text, and the
  Z5 number (SAP links Z3→Z5). Only the IRM status is app-owned; a SAP resolution date sets it to Closed.
- **SAP exports cover the last month and are appended** (upsert, never delete; no "missing" flagging). Re-imports
  and overlapping periods are harmless; the preview warns on an identical file (content hash).
- **SAP is semi-master for Z5s**: number, name, failure code (category of predefined failure types), priority.
  All work-package management (owners, dates, PCCSIM, updates, DRB, teams) is app-owned; imports never touch it.
- Z5s can be started in the app as **provisional** (`P-001`, stored from 9e14) and matched to the SAP number later.
- Z3s cannot be created/deleted in the app; only the IRM status is editable.
- **Demo login** (2026-09-30): `admin/admin` (R. Aalders, sees all) and `user/user` (S. Oyelaran, K. Baars' team:
  no KPI board, Teams only own team, no settings/imports/resets). Accounts in `data/users.json`; signed cookie
  `irm_session`; admin-only enforced server-side. The logged-in name is recorded on all changes.
- Working notes have comments (`z5-comments.json`). Demo seed has narrative PCCSIM entries and notes per Z5.

## Still open / to confirm with the user

- Real SAP export header names (importer maps by alias; mapping is adjustable and remembered).
- Real failure-code list and naming convention for products.
- Real production-step and milestone vocabulary.
- Z5 metadata beyond the fields listed above.
- Whether the review board needs its own escalation screen.
