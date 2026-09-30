// Data & settings — SAP import, who is working, where data and files live, vocabulary,
// KPI board settings, move rate, backup and reset.

import { api } from '../api.js';
import { store } from '../store.js';
import { esc, toast, parseCsv, toCsv, download, confirmDialog, todayIso, weekCode, fmtStamp } from '../util.js';
import { board } from '../charts.js';
import { weekStart } from '../metrics.js';
import { saveBoard, filterDialog, optionsDialog, WIDGET_TITLES, WIDGET_HAS_OPTIONS, DEFAULT_LAYOUT, TARGETS } from './board.js';

const LIST_LABELS = {
  failureCodes: 'Failure codes', products: 'Products', productionSteps: 'Production steps',
  milestones: 'Milestones', people: 'People', priorities: 'Priorities',
};

// Accepts ISO dates, dd-mm-yyyy and the house format YYWW.D.
function toIso(v) {
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  let m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = v.match(/^(\d{2})(\d{2})\.([1-7])$/);
  if (m) {
    const year = 2000 + Number(m[1]);
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const monday = new Date(jan4);
    monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (Number(m[2]) - 1) * 7 + Number(m[3]) - 1);
    return monday.toISOString().slice(0, 10);
  }
  return v;
}

// SAP exports are often UTF-16 or Windows-1252 rather than UTF-8.
async function readText(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1252').decode(buf); }
}

// The import in progress survives a redraw of the page.
const imp = { kind: 'z5', file: '', text: '', mapping: null, result: null };
let moveAll = false;

// ---------- KPI board settings + move rate ----------

function boardSection() {
  const cfg = board();
  const mr = store.db.moveRate;
  const shownRates = moveAll ? [...mr].reverse() : [...mr].reverse().slice(0, 12);
  const filterText = `${cfg.products.length ? `${cfg.products.length} of ${store.lists.products.length} products` : 'All products'} · ${cfg.failureCodes.length ? `${cfg.failureCodes.length} of ${store.lists.failureCodes.length} failure codes` : 'all failure codes'}`;
  return `
    <div class="grid-2" id="board-settings">
      <div class="panel">
        <div class="panel-head"><h2>KPI board charts</h2><a href="#/board" class="small">Open board →</a></div>
        <p class="small muted">Tick to put a chart on the board, untick to remove it. Order and width are the board layout top to bottom.</p>
        <table class="table dense widget-table"><thead><tr><th>On board</th><th>Chart</th><th>Width</th><th>Order</th><th></th></tr></thead>
          <tbody>${cfg.widgets.map((w, i) => `<tr>
            <td><input type="checkbox" data-wshow="${w.id}" ${w.show ? 'checked' : ''}></td>
            <td class="${w.show ? 'strong' : 'muted'}">${esc(WIDGET_TITLES[w.id] || w.id)}</td>
            <td><select class="input status-select" data-wsize="${w.id}"><option value="full" ${w.size === 'full' ? 'selected' : ''}>Full</option><option value="half" ${w.size === 'half' ? 'selected' : ''}>Half</option></select></td>
            <td class="nowrap"><button class="btn btn-ghost btn-icon" data-wmove="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>↑</button><button class="btn btn-ghost btn-icon" data-wmove="${i}" data-dir="1" ${i === cfg.widgets.length - 1 ? 'disabled' : ''}>↓</button></td>
            <td>${WIDGET_HAS_OPTIONS[w.id] ? `<button class="btn btn-ghost small" data-wopts="${w.id}">Options…</button>` : ''}</td>
          </tr>`).join('')}</tbody></table>
        <div class="row-actions"><button class="btn btn-secondary small" data-act="layout-reset">Reset layout</button></div>
        <div class="subsection">
          <div class="panel-head"><h3>What goes into the charts</h3><button class="btn btn-secondary small" data-act="chart-filter">Choose products &amp; failure codes…</button></div>
          <p class="small">${esc(filterText)}${cfg.products.length || cfg.failureCodes.length ? ' <button class="btn btn-ghost small" data-act="chart-filter-clear">Include everything</button>' : ''}</p>
        </div>
        <form class="subsection" data-form="targets">
          <div class="panel-head"><h3>KPI targets</h3><span class="muted small">on spec ≤ target · watch just above · off spec beyond</span></div>
          <div class="form-grid cols-3">${TARGETS.map(([k, l]) => `<div class="field"><label>${l}</label><input class="input" type="number" min="0" name="${k}" value="${cfg.targets[k] ?? ''}" placeholder="no target"></div>`).join('')}</div>
          <div class="row-actions"><button class="btn btn-primary small">Save targets</button></div>
        </form>
      </div>

      <div class="panel">
        <div class="panel-head"><h2>Move rate</h2><span class="muted small">${mr.length} weeks · parts moved per week</span></div>
        <p class="small muted">Used to normalize the trend chart (Z3s or impact per 1k parts moved). One value per ISO week; any date in the week is accepted.</p>
        <form class="mr-add" data-form="mr-add">
          <div class="field"><label>Week (any date in it)</label><input class="input" type="date" name="week" value="${weekStart(todayIso())}"></div>
          <div class="field"><label>Parts moved</label><input class="input" type="number" min="0" name="parts" placeholder="e.g. 2000"></div>
          <button class="btn btn-primary">Add / update week</button>
        </form>
        <div class="table-wrap mr-wrap"><table class="table dense"><thead><tr><th>Week</th><th>Starts</th><th class="right">Parts moved</th><th></th></tr></thead>
          <tbody>${shownRates.map((r) => `<tr><td class="num">${weekCode(r.week).slice(0, 4)}</td><td class="num muted">${r.week}</td>
            <td class="right"><input class="input mr-input num" type="number" min="0" data-mr="${r.week}" value="${r.parts}"></td>
            <td><button class="btn btn-ghost btn-icon" data-mrdel="${r.week}" title="Remove week">×</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted empty-row">No move rate data yet.</td></tr>'}</tbody></table></div>
        ${mr.length > 12 ? `<button class="btn btn-ghost small" data-act="mr-all">${moveAll ? 'Show latest 12 weeks' : `Show all ${mr.length} weeks`}</button>` : ''}
        <div class="subsection">
          <div class="panel-head"><h3>Paste or import</h3></div>
          <p class="small muted">Two columns, <code>week,parts</code>. Dates may be ISO, <code>dd-mm-yyyy</code> or <code>2640.1</code>. Existing weeks are overwritten.</p>
          <textarea class="input mono" rows="4" data-mr-text placeholder="week,parts&#10;2026-09-21,1534&#10;2640.1,2046"></textarea>
          <div class="row-actions">
            <button class="btn btn-secondary small" data-act="mr-import">Import pasted rows</button>
            <label class="btn btn-secondary small">Import CSV file<input type="file" accept=".csv,.txt" hidden data-mr-file></label>
            <button class="btn btn-secondary small" data-act="mr-export">Download CSV</button>
            <button class="btn btn-ghost small" data-act="mr-clear">Remove all</button>
          </div>
        </div>
      </div>
    </div>`;
}

function wireBoardSection(el, refresh) {
  const root = el.querySelector('#board-settings');
  const list = () => board().widgets.map((w) => ({ ...w }));
  const importRates = async (text) => {
    const rows = parseCsv(text.includes(',') || text.includes(';') ? (/^\s*week/i.test(text) ? text : `week,parts\n${text}`) : '');
    const out = rows.map((r) => ({ week: toIso(r.week || r.Week || Object.values(r)[0]), parts: r.parts ?? r.Parts ?? Object.values(r)[1] }));
    if (!out.length) return toast('No rows found — use two columns: week,parts', 'error');
    try { await api.saveMoveRate(out); toast(`${out.length} weeks of move rate saved`); await refresh(); } catch (x) { toast(x.message, 'error'); }
  };

  root.addEventListener('change', async (e) => {
    const t = e.target;
    try {
      if (t.dataset.wshow) { const l = list(); l.find((w) => w.id === t.dataset.wshow).show = t.checked; return saveBoard({ widgets: l }, refresh); }
      if (t.dataset.wsize) { const l = list(); l.find((w) => w.id === t.dataset.wsize).size = t.value; return saveBoard({ widgets: l }, refresh); }
      if (t.dataset.mr) { await api.saveMoveRate([{ week: t.dataset.mr, parts: t.value === '' ? null : t.value }]); toast(`Week ${weekCode(t.dataset.mr).slice(0, 4)} saved`); return refresh(); }
      if (t.dataset.mrFile !== undefined && t.files[0]) return importRates(await t.files[0].text());
    } catch (x) { toast(x.message, 'error'); }
  });

  root.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    try {
      if (e.target.dataset.form === 'targets') {
        await saveBoard({ targets: Object.fromEntries(TARGETS.map(([k]) => [k, d[k] === '' ? null : Number(d[k])])) }, refresh);
        toast('KPI targets saved');
      }
      if (e.target.dataset.form === 'mr-add') {
        if (!d.parts) throw new Error('Enter the number of parts moved');
        await api.saveMoveRate([{ week: d.week, parts: d.parts }]);
        toast(`Move rate for week ${weekCode(weekStart(d.week)).slice(0, 4)} saved`);
        await refresh();
      }
    } catch (x) { toast(x.message, 'error'); }
  });

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t || (t.type === 'submit' && t.form)) return; // form submits are handled above
    e.preventDefault();
    try {
      if (t.dataset.wmove) {
        const l = list(); const i = Number(t.dataset.wmove); const j = i + Number(t.dataset.dir);
        [l[i], l[j]] = [l[j], l[i]];
        return saveBoard({ widgets: l }, refresh);
      }
      if (t.dataset.wopts) return optionsDialog(t.dataset.wopts, refresh);
      if (t.dataset.mrdel) { await api.saveMoveRate([{ week: t.dataset.mrdel, parts: null }]); toast('Week removed'); return refresh(); }
      const a = t.dataset.act;
      if (a === 'layout-reset') return saveBoard({ widgets: DEFAULT_LAYOUT.map((w) => ({ ...w })) }, refresh);
      if (a === 'chart-filter') return filterDialog(refresh);
      if (a === 'chart-filter-clear') return saveBoard({ products: [], failureCodes: [] }, refresh);
      if (a === 'mr-all') { moveAll = !moveAll; return refresh(); }
      if (a === 'mr-import') return importRates(root.querySelector('[data-mr-text]').value.trim());
      if (a === 'mr-export') return download(`move-rate-${todayIso()}.csv`, toCsv(store.db.moveRate, ['week', 'parts']));
      if (a === 'mr-clear' && await confirmDialog('Remove all move rate data?', 'The trend chart can then only show absolute values.', { confirm: 'Remove all' })) {
        await api.saveMoveRate([], true); toast('Move rate cleared'); return refresh();
      }
    } catch (x) { toast(x.message, 'error'); }
  });
}

const KIND_LABEL = { z5: 'Z5 export', z3: 'Z3 export' };
const FIELD_LABEL = { title: 'name', failureCode: 'failure code', product: 'product', serial: 'serial no.', impact: 'impact', operatorText: 'long text', priority: 'priority',
  found: 'created', resolved: 'resolved', productionStep: 'step', milestone: 'milestone', resolutionText: 'resolution text' };

function importSection() {
  const r = imp.result;
  const hist = store.db.imports || [];
  const list = (items, fmt, max = 60) => `<ul class="imp-list plain">${items.slice(0, max).map((x) => `<li>${fmt(x)}</li>`).join('')}${items.length > max ? `<li class="muted">…and ${items.length - max} more</li>` : ''}</ul>`;
  const zid = (no) => (imp.kind === 'z5' ? `Z5-${no}` : `Z3-${no}`);
  return `
    <div class="panel" id="sap-import">
      <div class="panel-head"><h2>Import from SAP</h2><span class="muted small">SAP is master for Z3s and for Z5 number, name, failure code and priority. Imports never touch the work managed here.</span></div>
      <p class="small">Each export (for example last month's) is <b>added</b> to the database: new numbers are created, numbers already here get SAP's latest values, and nothing is removed. Overlapping periods and re-imports are harmless.</p>
      <div class="seg-row">
        ${Object.entries(KIND_LABEL).map(([k, l]) => `<label class="radio"><input type="radio" name="impkind" value="${k}" ${imp.kind === k ? 'checked' : ''}><span class="dot"></span> ${l}</label>`).join('')}
        <span class="small muted">Import the Z5 export first, so Z3 links find their Z5.</span>
      </div>
      <label class="dropzone" data-imp-drop><span class="dz-text"><span>${imp.file ? `<b>${esc(imp.file)}</b> — drop another file to replace` : `Drop the SAP ${KIND_LABEL[imp.kind]} (CSV), or browse`}</span><span class="muted small">Comma, semicolon or tab separated; UTF-8, UTF-16 or Windows-1252.</span></span><span class="btn btn-secondary dz-btn">Browse</span><input type="file" accept=".csv,.txt,text/csv" hidden data-imp-file></label>
      <p class="small muted">No export at hand? Try a sample built from the demo data: <a href="/api/import/sample/z5">Z5 sample</a> · <a href="/api/import/sample/z3">Z3 sample</a> (one new and one renamed Z5, one new Z3).</p>
      ${r ? `
        <div class="subsection">
          <div class="panel-head"><h3>Columns</h3><span class="muted small">${r.total} rows · ${r.headers.length} columns · separator “${r.delimiter === '\t' ? 'tab' : esc(r.delimiter)}”</span></div>
          <table class="table dense map-table"><thead><tr><th>Field in the app</th><th>Column in the file</th><th>First value</th></tr></thead><tbody>
            ${r.fields.map((f) => `<tr><td>${esc(f.label)}${f.required ? ' <span class="warn">*</span>' : ''}</td>
              <td><select class="input" data-map="${f.key}"><option value="">— not in this file —</option>${r.headers.map((h) => `<option ${r.mapping[f.key] === h ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></td>
              <td class="clip small muted">${esc(r.sample[0]?.[f.key] ?? '')}</td></tr>`).join('')}
          </tbody></table>
        </div>
        ${r.missingRequired.length ? `<div class="notice warn-notice">Map the required column${r.missingRequired.length > 1 ? 's' : ''}: <b>${r.missingRequired.map(esc).join(', ')}</b>.</div>` : `
        <div class="subsection">
          <div class="panel-head"><h3>What will change</h3><span class="muted small">nothing is written until you apply</span></div>
          ${r.alreadyImported ? `<div class="notice">This exact file was already imported on <b>${fmtStamp(r.alreadyImported.at)}</b> by ${esc(r.alreadyImported.by)}. Importing it again changes nothing that SAP has not changed.</div>` : ''}
          ${r.period ? `<p class="small">Export covers ${imp.kind === 'z3' ? 'Z3s' : 'Z5s'} created <b class="num">${weekCode(r.period.from)}</b> (${r.period.from}) to <b class="num">${weekCode(r.period.to)}</b> (${r.period.to}).</p>` : ''}
          <div class="imp-counts">
            <div><span class="kpi-label">New</span><b class="num">${r.created.length}</b></div>
            <div><span class="kpi-label">Changed</span><b class="num">${r.changed.length}</b></div>
            <div><span class="kpi-label">Unchanged</span><b class="num">${r.unchanged}</b></div>
            <div><span class="kpi-label">Rows in file</span><b class="num">${r.total}</b></div>
            <div><span class="kpi-label">Rejected rows</span><b class="num ${r.rejected.length ? 'warn' : ''}">${r.rejected.length}</b></div>
            <div><span class="kpi-label">${imp.kind === 'z3' ? 'Link changes' : 'Warnings'}</span><b class="num">${imp.kind === 'z3' ? r.links.length : r.warnings.length}</b></div>
          </div>
          ${r.created.length ? `<details open><summary class="small strong">New (${r.created.length})</summary>${list(r.created, (x) => `<b class="num">${zid(x.no)}</b> ${esc(x.title)}${x.z5 ? ` <span class="muted">→ Z5-${x.z5}</span>` : ''}`)}</details>` : ''}
          ${r.changed.length ? `<details open><summary class="small strong">Changed in SAP (${r.changed.length})</summary>${list(r.changed, (x) => `<b class="num">${zid(x.no)}</b> ${Object.entries(x.diff).map(([k, [a, b]]) => `${FIELD_LABEL[k] || k}: <span class="diff-old">${esc(String(a).slice(0, 60))}</span> → ${esc(String(b).slice(0, 60))}`).join(' · ')}`)}</details>` : ''}
          ${r.links.length ? `<details open><summary class="small strong">Z5 links set by SAP (${r.links.length})</summary>${list(r.links, (x) => `Z3-${x.no}: ${x.from ? (x.fromProvisional ? 'provisional Z5' : `Z5-${x.from}`) : 'unlinked'} → ${x.to ? `Z5-${x.to}` : '<span class="warn">unlinked in SAP</span>'}`)}</details>` : ''}
          ${r.stubs.length ? `<p class="small">${r.stubs.length} Z5 number${r.stubs.length > 1 ? 's' : ''} referenced by Z3s are not in the app yet (${r.stubs.slice(0, 8).map((n) => `Z5-${n}`).join(', ')}${r.stubs.length > 8 ? '…' : ''}); they are created and get their name with the next Z5 import.</p>` : ''}
          ${r.rejected.length ? `<details open><summary class="small strong warn">Rejected rows (${r.rejected.length})</summary>${list(r.rejected, (x) => `line ${x.line}: ${esc(x.reason)}`)}</details>` : ''}
          ${r.warnings.length ? `<details><summary class="small strong">Warnings (${r.warnings.length})</summary>${list(r.warnings, (x) => `line ${x.line}: ${esc(x.reason)}`)}</details>` : ''}
          ${Object.values(r.vocab).some((v) => v.length) ? `<p class="small muted">New values added to the dropdowns: ${Object.entries(r.vocab).filter(([, v]) => v.length).map(([k, v]) => `${LIST_LABELS[k]}: ${v.slice(0, 10).map(esc).join(', ')}${v.length > 10 ? '…' : ''}`).join(' · ')}</p>` : ''}
          <div class="row-actions"><button class="btn btn-primary" data-act="imp-apply">Apply import</button><button class="btn btn-ghost" data-act="imp-cancel">Cancel</button></div>
        </div>`}` : ''}
      <div class="subsection">
        <div class="panel-head"><h3>Import history</h3><span class="muted small">raw files and reports are kept in <code>imports/processed/</code></span></div>
        ${hist.length ? `<div class="table-wrap"><table class="table dense"><thead><tr><th>When</th><th>By</th><th>Export</th><th>File</th><th>Period</th><th class="right">New</th><th class="right">Changed</th><th class="right">Rejected</th></tr></thead><tbody>
          ${hist.slice(0, 10).map((h) => `<tr><td class="num nowrap">${fmtStamp(h.at)}</td><td>${esc(h.by)}</td><td>${h.kind.toUpperCase()}</td><td class="clip" title="${esc(h.archived)}">${esc(h.file)}</td><td class="num small nowrap">${esc(h.period || '')}</td><td class="num right">${h.created}</td><td class="num right">${h.updated}</td><td class="num right ${h.rejected ? 'warn' : ''}">${h.rejected}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="muted small">No imports yet.</p>'}
      </div>
    </div>`;
}

// Users see who they are and where files go; imports, settings and resets are for admins.
function userPage(el) {
  const s = store.settings;
  el.innerHTML = `
    <div class="screen-head"><div><h1>Data &amp; settings</h1><p class="muted">SAP imports, vocabulary, board settings and backups are managed by an admin.</p></div></div>
    <div class="grid-2">
      <div class="panel"><div class="panel-head"><h2>You</h2></div>
        <dl class="kv"><dt>Name</dt><dd>${esc(store.user.name)}</dd><dt>Role</dt><dd>User</dd><dt>Team</dt><dd>${esc(store.user.team ? `${store.user.team}'s team` : '—')}</dd></dl>
        <p class="small muted">Everything you post, comment, upload or change is recorded under your name. Use the name button in the top bar to log out.</p></div>
      <div class="panel"><div class="panel-head"><h2>Files</h2></div>
        <p class="small">Uploaded files are saved to <code>${esc(s.uploadDirResolved)}</code>, one folder per Z5 or Z3.</p>
        <p class="small muted">Last SAP import: ${store.db.imports[0] ? `${fmtStamp(store.db.imports[0].at)} (${store.db.imports[0].kind.toUpperCase()}, ${esc(store.db.imports[0].period || store.db.imports[0].file)})` : 'none yet'}.</p></div>
    </div>`;
}

export default function data(el, { refresh }) {
  if (!store.isAdmin) return userPage(el);
  const s = store.settings;
  const lists = store.lists;
  const tables = Object.entries(s.tables || {});

  el.innerHTML = `
    <div class="screen-head"><div><h1>Data &amp; settings</h1><p class="muted">Bring SAP data in, see where data and files are kept, and set up the board.</p></div></div>
    ${importSection()}

    <div class="grid-2">
      <div class="stack">
        <form class="panel" data-form="settings">
          <div class="panel-head"><h2>You and your files</h2></div>
          <div class="field"><label>Logged in as</label><div><b>${esc(store.me)}</b> · admin</div>
            <span class="hint">Accounts are in <code>users.json</code> in the data folder (demo login: plain-text passwords).</span></div>
          <div class="field"><label>Upload folder</label><input class="input mono" name="uploadDir" value="${esc(s.uploadDir)}"><span class="hint">Absolute path (e.g. a folder on the secure network drive) or relative to the MVP folder. One sub-folder per record: <code>Z5-118/</code>, <code>Z5-P-001/</code>, <code>Z3-24412/</code>.</span></div>
          <p class="small">Currently saving to <code>${esc(s.uploadDirResolved)}</code></p>
          <div class="row-actions"><button class="btn btn-primary">Save upload folder</button><button type="button" class="btn btn-secondary" data-act="reveal">Open upload folder</button></div>
        </form>

        <div class="panel">
          <div class="panel-head"><h2>Data folder</h2><button class="btn btn-ghost small" data-act="reveal-data">Open folder</button></div>
          <p class="small">One readable JSON file per table in <code>${esc(s.dataDir)}</code>, one row per line. Set <code>dataDir</code> in <code>config.json</code> to move it, for example to the secure network drive. A dated copy is kept in <code>_backup/</code> each day.</p>
          <ul class="table-list">${tables.map(([name, n]) => `<li><a href="/api/export/table/${name}.csv" title="Download as CSV for Excel">${esc(name)}</a> <span class="muted num">${n}</span></li>`).join('')}</ul>
          <p class="small muted">Click a table to download it as CSV. The field-by-field description is in <code>docs/data-model.md</code>.</p>
        </div>
      </div>

      <div class="stack">
        <form class="panel" data-form="lists">
          <div class="panel-head"><h2>Vocabulary</h2><span class="muted small">one value per line</span></div>
          <p class="small muted">These fill the dropdowns and filters. SAP imports add any failure codes, products and priorities they bring.</p>
          <div class="form-grid cols-2">
            ${Object.entries(LIST_LABELS).map(([k, label]) => `<div class="field"><label>${label} <span class="muted num">${(lists[k] || []).length}</span></label><textarea class="input" rows="7" name="${k}">${esc((lists[k] || []).join('\n'))}</textarea></div>`).join('')}
          </div>
          <div class="row-actions"><button class="btn btn-primary">Save vocabulary</button></div>
        </form>

        <div class="panel">
          <div class="panel-head"><h2>Backup &amp; reset</h2></div>
          <p class="small">${store.db.z5s.length} Z5s (${store.db.z5s.filter((z) => z.source === 'provisional').length} provisional) · ${store.db.z3s.length} Z3s</p>
          <div class="row-actions">
            <a class="btn btn-secondary" href="/api/export">Download full backup (JSON)</a>
            <label class="btn btn-secondary">Restore backup<input type="file" accept=".json,application/json" hidden data-restore></label>
          </div>
          <div class="row-actions">
            <button class="btn btn-secondary" data-act="demo">Reload demo data</button>
            <button class="btn btn-secondary" data-act="empty">Start empty</button>
          </div>
          <p class="small muted">“Start empty” removes all Z3s and Z5s but keeps vocabulary, board layout, column mappings and move rate — the starting point before the first real SAP import (load the history first, then each month's export). Uploaded files are never deleted.</p>
        </div>
      </div>
    </div>
    ${boardSection()}`;

  wireBoardSection(el, refresh);

  // ---- SAP import ----
  const preview = async () => {
    try {
      imp.result = await api.importPreview({ kind: imp.kind, text: imp.text, file: imp.file, mapping: imp.mapping });
      imp.mapping = imp.result.mapping;
    } catch (x) { imp.result = null; toast(x.message, 'error'); }
    await refresh();
    document.getElementById('sap-import')?.scrollIntoView({ block: 'start' });
  };
  const loadFile = async (f) => { imp.file = f.name; imp.text = await readText(f); imp.mapping = null; await preview(); };
  const drop = el.querySelector('[data-imp-drop]');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', async (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) loadFile(f); });
  el.querySelector('[data-imp-file]').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) loadFile(f); });
  el.querySelectorAll('input[name=impkind]').forEach((r) => r.addEventListener('change', () => {
    imp.kind = r.value; imp.mapping = null;
    if (imp.text) preview(); else refresh();
  }));
  el.querySelectorAll('[data-map]').forEach((sel) => sel.addEventListener('change', () => { imp.mapping = { ...imp.mapping, [sel.dataset.map]: sel.value }; preview(); }));

  el.querySelector('[data-form=settings]').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await api.saveSettings({ uploadDir: new FormData(e.target).get('uploadDir') });
      toast(`Saved · uploads go to ${res.uploadDirResolved}`);
      await refresh();
    } catch (x) { toast(x.message, 'error'); }
  });

  el.querySelector('[data-form=lists]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = {};
    for (const [k, v] of new FormData(e.target)) out[k] = [...new Set(v.split('\n').map((x) => x.trim()).filter(Boolean))];
    try { await api.saveSettings({ lists: out }); toast('Vocabulary saved'); await refresh(); }
    catch (x) { toast(x.message, 'error'); }
  });

  el.querySelector('[data-restore]').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const json = JSON.parse(await f.text());
      if (!(await confirmDialog('Restore backup?', `This replaces all current data with ${json.z5s?.length ?? '?'} Z5s and ${json.z3s?.length ?? '?'} Z3s from ${f.name}.`, { confirm: 'Restore' }))) return;
      await api.restore(json); toast('Backup restored'); await refresh();
    } catch (x) { toast(x.message, 'error'); }
  });

  el.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act]');
    const a = t?.dataset.act;
    if (!a || t.closest('#board-settings')) return;
    try {
      if (a === 'reveal') await api.reveal('');
      if (a === 'reveal-data') await api.reveal('', 'data');
      if (a === 'imp-cancel') { Object.assign(imp, { file: '', text: '', mapping: null, result: null }); return refresh(); }
      if (a === 'imp-apply') {
        t.disabled = true;
        const res = await api.importApply({ kind: imp.kind, text: imp.text, file: imp.file, mapping: imp.mapping });
        toast(`SAP ${imp.kind.toUpperCase()} import: ${res.created} new, ${res.updated} changed${res.stubs ? `, ${res.stubs} Z5s created from links` : ''}${res.rejected ? `, ${res.rejected} rows rejected` : ''}`);
        Object.assign(imp, { file: '', text: '', result: null, mapping: null });
        return refresh();
      }
      if (a === 'demo' && await confirmDialog('Reload demo data?', 'All current Z3s and Z5s are replaced by the demo set.', { confirm: 'Reload demo' })) { await api.reset('demo'); toast('Demo data loaded'); await refresh(); }
      if (a === 'empty' && await confirmDialog('Start empty?', 'All Z3s and Z5s are removed. Vocabulary, board settings, column mappings and move rate are kept. Download a backup first if you need it.', { confirm: 'Remove all records' })) { await api.reset('empty'); toast('All records removed'); await refresh(); }
    } catch (x) { toast(x.message, 'error'); if (t) t.disabled = false; }
  });
}
