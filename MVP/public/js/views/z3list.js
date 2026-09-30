// Z3 register — every production issue, filterable. Paged so tens of thousands of rows stay fast.

import { store, Z3_STATUS } from '../store.js';
import { esc, dateCell, options, toCsv, download, todayIso, z5Id } from '../util.js';

const state = { q: '', product: '', code: '', step: '', status: '', linked: '', limit: 200 };

export default function z3list(el, { refresh, go }) {
  const L = store.lists;
  el.innerHTML = `
    <div class="screen-head">
      <div><h1>Z3 register</h1><p class="muted" data-part="count"></p></div>
      <div class="head-actions">
        <a class="btn btn-primary" href="#/data">Import from SAP</a>
        <button class="btn btn-secondary" data-act="csv">Export CSV</button>
      </div>
    </div>
    <div class="filters">
      <input class="input" data-f="q" placeholder="Number, name, serial number or text" value="${esc(state.q)}">
      <select class="input" data-f="product">${options(L.products, state.product, { blank: 'Any product' })}</select>
      <select class="input" data-f="code">${options(L.failureCodes, state.code, { blank: 'Any failure code' })}</select>
      <select class="input" data-f="step">${options(L.productionSteps, state.step, { blank: 'Any step' })}</select>
      <select class="input" data-f="status">${options(Z3_STATUS, state.status, { blank: 'Any status' })}</select>
      <select class="input" data-f="linked">${options(['Linked', 'Unlinked'], state.linked, { blank: 'Linked or not' })}</select>
    </div>
    <div class="table-wrap" data-part="table"></div>`;

  let rows = [];
  const draw = () => {
    const q = state.q.toLowerCase();
    rows = store.db.z3s
      .filter((z) => !state.product || z.product === state.product)
      .filter((z) => !state.code || z.failureCode === state.code)
      .filter((z) => !state.step || z.productionStep === state.step)
      .filter((z) => !state.status || z.status === state.status)
      .filter((z) => !state.linked || (state.linked === 'Linked') === (z.z5 != null))
      .filter((z) => !q || `z3-${z.no} ${z.no} ${z.title} ${z.serial} ${z.operatorText} ${z.resolutionText} ${z.milestone}`.toLowerCase().includes(q))
      .sort((a, b) => b.no - a.no);
    el.querySelector('[data-part=count]').textContent = `${rows.length} of ${store.db.z3s.length} Z3s`;
    const page = rows.slice(0, state.limit);
    el.querySelector('[data-part=table]').innerHTML = `
      <table class="table dense">
        <thead><tr><th>Z3 no.</th><th>Name</th><th>Product</th><th>Serial no.</th><th>Failure code</th><th class="right">Impact</th><th>Long text</th><th>Created</th><th>Resolved</th><th>Status</th><th>Z5</th></tr></thead>
        <tbody>${page.map((z) => `
          <tr data-href="#/z3/${z.no}">
            <td class="nowrap"><a class="idlink" href="#/z3/${z.no}">Z3-${z.no}</a></td>
            <td><div class="clip">${esc(z.title)}</div></td>
            <td class="nowrap">${esc(z.product)}</td><td class="nowrap num">${esc(z.serial)}</td><td>${esc(z.failureCode)}</td>
            <td class="num right">${z.impact}</td>
            <td><div class="clip-2">${esc(z.operatorText)}</div></td>
            <td>${dateCell(z.found)}</td>
            <td>${dateCell(z.resolved)}</td>
            <td class="nowrap">${esc(z.status)}</td>
            <td class="nowrap">${z.z5 != null ? `<a class="idlink" href="#/z5/${z.z5}">${z5Id(z.z5)}</a> <span class="src ${z.z5Source === 'sap' ? 'src-sap' : 'src-app'}" title="${z.z5Source === 'sap' ? 'Linked in SAP' : 'Linked in the app'}">${z.z5Source === 'sap' ? 'SAP' : 'app'}</span>` : `<a href="#/link?z3=${z.no}" class="warn">link →</a>`}</td>
          </tr>`).join('') || `<tr><td colspan="11" class="muted empty-row">No Z3s match.</td></tr>`}</tbody>
      </table>
      ${rows.length > page.length ? `<div class="more"><button class="btn btn-secondary" data-act="more">Show ${Math.min(500, rows.length - page.length)} more</button></div>` : ''}`;
  };
  draw();

  el.addEventListener('input', (e) => {
    const f = e.target.dataset.f;
    if (!f) return;
    state[f] = e.target.value;
    state.limit = 200;
    clearTimeout(state.t);
    state.t = setTimeout(draw, f === 'q' ? 150 : 0);
  });
  el.addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'more') { state.limit += 500; return draw(); }
    if (a === 'csv') {
      const cols = ['no', 'title', 'failureCode', 'product', 'serial', 'impact', 'found', 'resolved', 'productionStep', 'milestone', 'z5', 'z5Source', 'status', 'operatorText', 'resolutionText'];
      return download(`z3-register-${todayIso()}.csv`, toCsv(rows, cols));
    }
    const tr = e.target.closest('tr[data-href]');
    if (tr && !e.target.closest('a')) go(tr.dataset.href);
  });
}
