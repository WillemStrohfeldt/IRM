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
- `IRM - Z5 Issue Resolution.dc.html` — the hi-fi UI mockup (current work).

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

## Still open / to confirm with the user

- Real failure-code list and naming convention for products.
- Real production-step and milestone vocabulary.
- Z5 metadata beyond the fields listed above.
- Whether the review board needs its own escalation screen.
