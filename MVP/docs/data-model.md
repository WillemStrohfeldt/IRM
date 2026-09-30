# IRM data model

The data folder (`dataDir` in `config.json`, default `MVP/data/`) holds **one JSON file per table**.
Table files list one row per line with a fixed column order, so they can be read, compared and diffed.
The three small settings documents are pretty-printed.

```
data/
  z5s.json              one row per Z5
  z5-workstreams.json   six rows per Z5 (PCCSIM)
  z5-updates.json       working notes / updates
  z5-comments.json      comments under working notes
  z5-records.json       triage-record minutes (DRB review, guidance, decisions …)
  z5-log.json           admin log (status changes, SAP changes, links …)
  z3s.json              one row per Z3
  attachments.json      index of uploaded files (the files themselves are in the upload folder)
  drb-sessions.json · drb-reviews.json · drb-guidance.json · drb-help.json
  teams.json · move-rate.json · imports.json
  users.json            demo login accounts (username, name, role, team, plain-text password)
  meta.json · settings.json · lists.json
  _backup/YYYY-MM-DD/   a copy of every table, once a day, newest 14 kept
  .lock                 which machine/process owns the folder while the server runs
```

Any table can be downloaded as CSV from **Data & settings → Data folder**.

## Who owns what

| Data | Master | Written by |
|---|---|---|
| Z3: number, name, failure code, product type, serial number, impact, created on, resolved on, production step, milestone, long text, resolution text, Z5 link | **SAP** | SAP import only |
| Z5: number, name, failure code, priority | **SAP** | SAP import only (except provisional Z5s) |
| Z5: status, owners, dates, description, PCCSIM, updates, minutes, files, duplicates | **App** | The app only — imports never touch these |
| Z3: IRM status (New → Worked upon → Closed), files | **App** | The app only; a SAP resolution date sets the status to Closed |
| DRB, teams, move rate, board settings, vocabulary | **App** | The app only |

## Numbers

- **SAP numbers** are stored as plain numbers: `000300012345` becomes `300012345`.
- **Provisional Z5s** are started in the app before SAP has a number. They are stored from `900000000000001`
  upwards (far above any SAP number) and shown as `P-001`. **Match to SAP Z5** moves all their work, Z3
  links and files onto the SAP number:
  - If that SAP Z5 is already imported, the provisional record is merged into it and removed.
  - If it is not imported yet, the provisional record takes the number (`sapStatus: "pending"`) and the next
    Z5 import fills in the SAP fields.

## Tables

### z5s
| Column | Meaning |
|---|---|
| `no` | Z5 number (SAP) or provisional number |
| `source` | `sap` or `provisional` |
| `sapStatus` | `current` · `pending` (matched from a provisional Z5, awaiting its first import) · empty for provisional |
| `lastSeen` | date of the last import that contained it |
| `title`, `failureCode`, `priority` | SAP-owned (editable only while provisional) |
| `status` | `New` → `Investigate` → `Ongoing` (accepted) → `Done`, or `Aborted` |
| `parent` | leading Z5 when this one is a duplicate |
| `projectLead`, `engOwner` | the two owner roles |
| `raised`, `committedDate`, `followUpDate`, `closedAt` | ISO dates `YYYY-MM-DD` |
| `description`, `created`, `matchedFrom` | free text; creation timestamp; `P-00n` it was matched from |

### z5-workstreams
`z5`, `step` (1–6), `key` (Problem … Monitor), `owner`, `planned`, `closed`, `entry`. The steps are sequential:
a step can only close after the one before it.

### z5-updates
`id`, `z5`, `date`, `ws` (workstream), `type`, `author`, `dueWas` (the follow-up date that was due), `onTime`, `at`, `text`.
`onTime` feeds the Teams and KPI rates.

### z5-comments
`id`, `z5`, `update` (the working note it belongs to), `author`, `at`, `text`.

### users
`username`, `name` (recorded on everything the account does), `role` (`admin` or `user`), `team` (the project lead
whose team a user belongs to; a user sees only that team on the Teams page), `password` (demo only).
`meta.json → secret` signs the login cookie; neither passwords nor the secret are ever sent to the browser.

### z5-records · z5-log
Minutes rows: `id`, `z5`, `date`, `type`, `ws`, `author`, `text`. Log rows: `z5`, `at`, `by`, `text`.

### z3s
| Column | Meaning |
|---|---|
| `no` | Z3 number (SAP) |
| `sapStatus`, `lastSeen` | `current`; date of the last import that contained it |
| `title`, `failureCode`, `product`, `serial`, `impact`, `productionStep`, `milestone`, `operatorText` (long text), `resolutionText` | SAP-owned |
| `found`, `resolved` | SAP creation and resolution dates (ISO) |
| `z5`, `z5Source` | linked Z5, and who linked it: `sap` (locked, change it in SAP) or `app` (manual, for Z3s SAP has not linked) |
| `status` | the only app-owned Z3 field |

### attachments
`id`, `entity` (`z5`/`z3`), `no`, `update` (update id when attached to a note), `name`, `size`, `type`, `path` (relative to
the upload folder), `uploaded`, `by`.

## SAP import rules

SAP exports cover a period, typically the last month. Every import is **appended** to the database.

1. Columns are matched by header name. Any header can be picked by hand, and the choice is remembered per
   export (`settings.json → importMappings`).
2. Preview first; nothing is written until **Apply**. The preview shows the period the export covers (by creation
   date) and warns when the exact same file was imported before.
3. New numbers create records. Numbers already in the database get SAP's latest values for the **SAP-owned fields**;
   each Z5 change is logged. Nothing is ever deleted, so overlapping periods and re-imports are harmless.
4. For Z3s, a Z5 number in the export sets the link (`z5Source: sap`). An empty Z5 number removes a SAP link, but
   keeps a link made in the app. Unknown Z5 numbers are created as placeholder Z5s; the next Z5 import names them.
5. A resolution date sets the Z3's IRM status to Closed. An empty resolution date on a known Z3 clears it (reopened
   in SAP). An empty creation date never overwrites a known one.
6. New failure codes, products, priorities, production steps and milestones are added to the vocabulary.
7. The raw file and a JSON report go to `imports/processed/<date>/` (git-ignored: it contains SAP data).

**First load:** start empty, import the historic export(s) once, then each month's export. The order within one
month: Z5 export first, then Z3 export.

The same import runs from the command line for scheduled jobs:
`node tools/import.js z3 export.csv --apply --user "Nightly job"`. It refuses to run while the server holds the
data folder.

## Open points

- Several people use one server through their browsers. The server is the only writer to the data folder, which is
  what makes a network share safe. When IT provides a database, `lib/storage.js` is the only module to replace.
