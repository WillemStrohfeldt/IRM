// Z5 overview — dense register with saved views and filters. Z5 number leads, products are secondary.

import { store, facts, VIEWS, Z5_STATUS } from '../store.js';
import { esc, dateCell, options, toCsv, download, z5Id, todayIso } from '../util.js';
import { sourceBadge } from '../forms.js';

const state = { q: '', status: '', product: '', code: '', lead: '', sort: 'no', dir: -1 };

export default function overview(el, { query, go }) {
  el.innerHTML = `<div data-part="head"></div>
    <div class="filters">
      <input class="input" data-f="q" placeholder="Filter by number, title, product, failure code, owner…" value="${esc(state.q)}">
      <select class="input" data-f="status">${options(Z5_STATUS, state.status, { blank: 'Any status' })}</select>
      <select class="input" data-f="product">${options(store.lists.products, state.product, { blank: 'Any product' })}</select>
      <select class="input" data-f="code">${options(store.lists.failureCodes, state.code, { blank: 'Any failure code' })}</select>
      <select class="input" data-f="lead">${options(people(), state.lead, { blank: 'Any owner' })}</select>
    </div>
    <div class="table-wrap" data-part="table"></div>`;
  let rows = [];
  const draw = () => { rows = drawInto(el, query); };
  draw();

  el.addEventListener('input', (e) => {
    const f = e.target.dataset.f;
    if (!f) return;
    state[f] = e.target.value;
    clearTimeout(state.t);
    state.t = setTimeout(draw, f === 'q' ? 150 : 0);
  });
  el.addEventListener('click', (e) => {
    const s = e.target.closest('[data-sort]');
    if (s) {
      state.dir = state.sort === s.dataset.sort ? -state.dir : 1;
      state.sort = s.dataset.sort;
      return draw();
    }
    if (e.target.closest('[data-act=csv]')) {
      const out = rows.map(({ z, f }) => ({
        z5: z5Id(z.no), source: z.source, title: z.title, failureCode: z.failureCode, priority: z.priority, status: z.status, stage: f.stage, parent: z.parent ? z5Id(z.parent) : '',
        products: f.products.join(' | '), projectLead: z.projectLead, engOwner: z.engOwner,
        followUpDate: z.followUpDate, committedDate: z.committedDate, z3s: f.allZ3.length, impact: f.impact,
      }));
      return download(`z5-overview-${todayIso()}.csv`, toCsv(out, Object.keys(out[0] || { z5: '' })));
    }
    const tr = e.target.closest('tr[data-href]');
    if (tr && !e.target.closest('a')) go(tr.dataset.href);
  });
}

const people = () => [...new Set(store.db.z5s.flatMap((z) => [z.projectLead, z.engOwner]).filter(Boolean))].sort();

function drawInto(el, query) {
  const viewId = query.get('view') || 'open';
  const stage = query.get('stage') || '';
  const view = VIEWS.find((v) => v.id === viewId) || VIEWS[0];
  const all = store.db.z5s.map((z) => ({ z, f: facts(z) }));
  const counts = Object.fromEntries(VIEWS.map((v) => [v.id, all.filter((r) => v.test(r.z, r.f)).length]));

  const q = state.q.toLowerCase();
  let rows = all.filter((r) => view.test(r.z, r.f))
    .filter((r) => !stage || (r.z.status === 'Ongoing' && !r.z.parent && r.f.current?.key === stage))
    .filter((r) => !state.status || r.z.status === state.status)
    .filter((r) => !state.product || r.f.products.includes(state.product))
    .filter((r) => !state.code || r.z.failureCode === state.code)
    .filter((r) => !state.lead || r.z.projectLead === state.lead || r.z.engOwner === state.lead)
    .filter((r) => !q || `${z5Id(r.z.no)} ${r.z.no} ${r.z.title} ${r.z.failureCode} ${r.z.description} ${r.z.projectLead} ${r.z.engOwner} ${r.f.products.join(' ')} ${r.f.codes.join(' ')}`.toLowerCase().includes(q));

  const key = {
    no: (r) => r.z.no, title: (r) => r.z.title.toLowerCase(), status: (r) => Z5_STATUS.indexOf(r.z.status) * 10 + r.f.closedCount,
    lead: (r) => r.z.projectLead, eng: (r) => r.z.engOwner || '~', follow: (r) => r.z.followUpDate || '9999',
    avail: (r) => r.z.committedDate || '9999', impact: (r) => r.f.impact, z3: (r) => r.f.allZ3.length,
  }[state.sort];
  rows.sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * state.dir);

  // Duplicates are shown nested under their parent when the parent is in the list.
  const shown = new Set(rows.map((r) => r.z.no));
  const top = rows.filter((r) => !r.z.parent || !shown.has(r.z.parent));
  const kids = (no) => rows.filter((r) => r.z.parent === no);

  const th = (k, label, cls = '') => `<th class="sortable ${cls}" data-sort="${k}">${label}${state.sort === k ? (state.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;

  const row = ({ z, f }, child = false) => `
    <tr data-href="#/z5/${z.no}" class="${child ? 'child-row' : ''} ${f.open ? '' : 'row-closed'}">
      <td class="nowrap">${child ? '<span class="tree">└</span>' : ''}<a class="idlink" href="#/z5/${z.no}">${z5Id(z.no)}</a></td>
      <td><div class="clip strong">${esc(z.title)} ${z.source !== 'sap' ? sourceBadge(z) : ''}</div><div class="muted small clip">${esc(z.failureCode || 'no failure code')} · ${esc(f.products.join(' · ') || 'no products yet')}</div></td>
      <td><span class="status s-${z.status.toLowerCase()}">${z.status}</span><div class="small muted">${esc(f.stage)}</div></td>
      <td class="pccsim-cell">${z.workstreams.map((w, i) => `<span class="pip ${w.closed ? 'done' : i === f.currentIdx && z.status === 'Ongoing' ? (f.wsOverdue.includes(w) ? 'late' : 'cur') : ''}" title="${w.key}${w.closed ? ' closed' : ''}"></span>`).join('')}</td>
      <td class="nowrap">${esc(z.projectLead)}</td>
      <td class="nowrap">${z.engOwner ? esc(z.engOwner) : f.open ? '<span class="warn">unassigned</span>' : '—'}</td>
      <td>${dateCell(z.followUpDate, f.followOverdue ? 'late' : '')}</td>
      <td>${dateCell(z.committedDate, f.availLate ? 'late' : '')}</td>
      <td class="num right">${f.allZ3.length}</td>
      <td class="num right">${f.impact}</td>
    </tr>`;

  el.querySelector('[data-part=head]').innerHTML = `
    <div class="screen-head">
      <div><h1>Z5 overview</h1><p class="muted">${rows.length} of ${all.length} Z5s${stage ? ` · stage ${esc(stage)} <a href="#/z5?view=${viewId}">clear</a>` : ''}</p></div>
      <div class="head-actions"><button class="btn btn-secondary" data-act="csv">Export CSV</button></div>
    </div>
    <div class="views">${VIEWS.map((v) => `<a href="#/z5?view=${v.id}" class="view-tab" ${v.id === view.id ? 'aria-current="true"' : ''}>${v.name} <span class="num">${counts[v.id]}</span></a>`).join('')}</div>`;
  el.querySelector('[data-part=table]').innerHTML = `
      <table class="table dense z5-table">
        <thead><tr>${th('no', 'Z5 no.')}${th('title', 'Name · failure code · products')}${th('status', 'Status')}<th>PCCSIM</th>${th('lead', 'Project lead')}${th('eng', 'Eng. owner')}${th('follow', 'Follow-up')}${th('avail', 'Committed')}${th('z3', 'Z3s', 'right')}${th('impact', 'Impact', 'right')}</tr></thead>
        <tbody>${top.map((r) => row(r) + kids(r.z.no).map((k) => row(k, true)).join('')).join('') || `<tr><td colspan="10" class="muted empty-row">No Z5s match. ${all.length ? 'Try another view or clear the filters.' : 'Create the first one with “+ New Z5”.'}</td></tr>`}</tbody>
      </table>`;
  return rows;
}
