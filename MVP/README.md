# IRM MVP — Z3 → Z5 issue resolution

A working proof of concept of the IRM brand-palette mockup. SAP is master for Z3s and for the Z5 number, name,
failure code and priority; they come in through the SAP import. All work-package management around a Z5 happens
here: owners, dates, PCCSIM, updates, DRB, teams and files. The data is kept as readable tables, and uploads go to a
folder you choose.

## Run it

Needs Node 18 or newer. There are no dependencies to install.

```bash
cd MVP
npm start          # or: node server.js
```

Then open <http://127.0.0.1:4310> and log in with a demo account:

| Login | Name | Can see |
| --- | --- | --- |
| `admin` / `admin` | R. Aalders | everything, including the KPI board, all teams, settings, SAP import and resets |
| `user` / `user` | S. Oyelaran (K. Baars' team) | everything except the KPI board; Teams only for their own team; no settings, imports or resets |

The login decides who is recorded on updates, comments, uploads, imports and the log. It is a demo login: the
accounts and plain-text passwords are in `data/users.json`, and the session is a signed cookie.

 On first start the app loads a demo set (11 live Z5s and 67 recent Z3s, plus two years of closed history and move rate for the trend charts) with dates relative to
today, so the KPI board has something overdue. **Data & settings → Start empty** removes the demo records and keeps
the dropdown lists: that is the starting point before the first real SAP import. The demo includes filled-in PCCSIM workstreams and ten weeks of working notes with comments on the
accepted Z5s.

## Where things are stored

| What | Where | Change it |
| --- | --- | --- |
| All data | `MVP/data/`: one readable JSON file per table (`z5s.json`, `z3s.json`, `z5-workstreams.json` …), a daily copy in `_backup/` | `dataDir` in `config.json`, or `IRM_DATA_DIR=/path npm start` |
| Uploaded files | `MVP/storage/` with one sub-folder per record, e.g. `Z5-118/`, `Z5-P-001/`, `Z3-24412/` | **Data & settings → Upload folder**, `uploadDir` in `config.json`, or `IRM_UPLOAD_DIR=/path npm start` |

Every table and field, the SAP ownership rules and the import rules are described in
[`docs/data-model.md`](docs/data-model.md). A database from an earlier MVP version (`data/irm.json`) is converted to
tables automatically on first start; the original is kept next to it.

Only one server may use a data folder at a time. It holds a `.lock` file, and a second server on another machine
refuses to start instead of overwriting the data. That is what makes a folder on a network drive safe. Everyone else
uses the app through their browser.

The upload folder can be any absolute path, e.g. a OneDrive or SharePoint-synced folder or a mounted network share.
Duplicate file names get ` (2)`, ` (3)` … appended instead of being overwritten. Deleting a record or resetting data never
deletes files from disk.

To demo on another laptop on the same network, set `"host": "0.0.0.0"` in `config.json` and open
`http://<your-ip>:4310`. There is no login, so only do this on a trusted network.

## Putting your own data in

- **From SAP:** use **Data & settings → Import from SAP**. Import the Z5 export (number, name, failure code, priority)
  first, then the Z3 export (number, name, failure code, product type, serial number, impact, created on, resolved on,
  production step, milestone, long text, resolution text, Z5 number). Each export (for example last month's) is
  **appended**: new numbers are added, known numbers get SAP's latest values, and nothing is removed. Columns are
  matched by name, can be adjusted, and are remembered. The preview shows the period covered, new, changed and
  rejected rows, and warns if the same file was already imported. Imports only change SAP-owned fields, so work
  done in the app is never overwritten. Sample exports built from the demo data are linked on the same page.
  For scheduled jobs: `node tools/import.js z3 export.csv --apply` (with the server stopped).
- **Provisional Z5:** **+ Provisional Z5** starts a work package before SAP has a number (`P-001` …). Once SAP has the Z5,
  **Match to SAP Z5…** on its page moves all work, Z3 links and files onto the SAP number.
- **Linking:** Z3s that SAP already links to a Z5 are locked to that link. The **Linking** queue is for Z3s SAP has not
  linked.
- **Vocabulary:** the failure codes, products, steps, milestones and people lists are editable on the same page. Replace
  the placeholders with the real lists.
- **Backup:** use **Download full backup (JSON)** and **Restore backup**, or download any single table as CSV under **Data folder**.
- **KPI board:** the same page has chart on/off, width and order settings, per-chart options, the product and failure-code filter, and KPI targets.
- **Move rate:** parts moved per week. You can type it in per week, paste `week,parts` rows, import a CSV, or download it. The trend chart uses it for the move-rate normalized basis, and weeks without data show as a gap.

## What works

| Screen | Functionality |
| --- | --- |
| KPI board | The mockup's charts, all calculated from live data: the five KPI tiles with target / on-spec state, open Z5s by current workstream (donut plus overdue per workstream), the trend (week, month or quarter; impact, Z3 count or impact per Z3; absolute or normalized on move rate, with a moving average), impact by failure code, open Z5s built up by priority or failure code, needs attention, top Z5s overall and by new impact, follow-ups due, linking queue, teams at a glance, and the monthly digest with its "what moved" list. **Customize board** lets you remove, add back, reorder and resize charts; ⚙ opens a chart's options. **Filter charts** leaves chosen products or failure codes out of every chart. |
| Z5 overview | Saved views, filters, sortable columns, duplicates nested under their parent, CSV export. |
| Z5 detail | Tabs: **Resolution** (PCCSIM workstreams), **Working notes** (updates with files and comments by anyone logged in, plus Z5 files), **Triage record** (timeline, outcome, and minutes merged with the admin log; a record of type *Update given* counts as an update), **Linked Z3s**, and **Child Z5s** (link or unlink duplicates, rolled-up totals). |
| Linking | Unlinked Z3 queue with multi-select. Z5 search shows candidates with a matching failure code or product first; the engineer still picks the Z5. You can also create a new Z5 from the selection. |
| Z3 register / detail | Paged list and filters for large volumes. The detail page shows every SAP field read-only (including created/resolved dates, step, milestone, resolution text), the IRM status (the only editable field; a SAP resolution date closes it), files, and the Z5 link. You can move or unlink a link made in the app; a SAP link can only be changed in SAP. |
| Search | One query across Z5s and Z3s, including update text and workstream entries. |
| DRB | The weekly review agenda is built from live data: overdue updates, triage decisions, follow-ups due this week, guidance falling due and help requests waiting on a decision. Each Z5's review is recorded into its minutes. You can close a session, and the next one is planned a week later. The screen also tracks guidance (actions with an owner and due date) and help requests (FTE, tool time and so on, with a status). |
| Teams | An overview of all teams, including committed Z5s by workstream. Each project lead has a page with committed Z5s, on-time update rate against the 80% target, overdue items, past-availability items, and Z5s closed in 10 weeks. It also shows a 10-week updates chart, workstreams closed on time, updates due soon, and the committed worklist with an 8-week strip per Z5. Teams can be added and edited on the page. |

### Rules the server enforces

- Z5 lifecycle: New → Investigate → Ongoing (accepted) → Done, and Aborted from any open state.
- PCCSIM workstreams can only be closed after the Z5 is accepted, and only in order. Only the last closed workstream can be reopened.
- **Done** requires all six workstreams to be closed.
- A duplicate Z5 stays open and is linked to one leading Z5. A duplicate cannot lead other duplicates, so there are no chains.
- SAP-owned fields cannot be edited in the app. SAP Z5s cannot be deleted (use Abort); provisional Z5s can.
- A SAP import never deletes: exports cover a period and are appended.

## Code map

```
server.js          HTTP server, rules, provisional matching, uploads (no dependencies)
lib/storage.js     table storage: split/join, lock, atomic writes, daily backup
lib/importer.js    SAP import: column mapping, preview diff, apply (SAP-owned fields only)
lib/csv.js         CSV reading/writing (comma/semicolon/tab, quotes, BOM)
tools/import.js    command-line SAP import
seed.js            demo data, default lists, migrations between versions
docs/data-model.md tables, fields, ownership and import rules
config.json        port, host, data folder, upload folder
imports/processed/ archived SAP files and import reports (git-ignored)
public/index.html  app shell
public/css/        industry.css (design system copy) + app.css (brand palette + screens)
public/js/         app.js router · store.js derived facts/KPIs · metrics.js team/week metrics · charts.js board chart data · api.js · forms.js · util.js
public/js/views/   board, drb, teams, overview, detail, linking, z3list, z3detail, search, data
```

## Not in the MVP yet

- Real login. The demo login has two fixed roles and plain-text passwords; connect it to company sign-in (AD/SSO) before real use. Two people editing the same field at the same time: the last save wins.
- A real database. The table folder is fine for a POC with tens of thousands of Z3s. When IT provides a database,
  `lib/storage.js` is the one module to replace.
- The GitHub Pages workflow publishes this folder as static files, but the app needs `server.js` running, so the Pages copy only shows a "cannot reach server" message.
