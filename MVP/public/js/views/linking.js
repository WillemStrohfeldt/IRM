// Linking workspace — pick Z3s from the unlinked queue, search for a Z5, link manually.
// Candidates sharing a failure code or product are listed first, but the engineer decides.

import { api } from '../api.js';
import { store, facts, isOpen } from '../store.js';
import { esc, options, toast, dateCell, z5Id } from '../util.js';
import { z5Dialog, sourceBadge } from '../forms.js';

const state = { q: '', product: '', code: '', selected: new Set(), focus: null, z5q: '', limit: 150 };

export default function linking(el, { query, refresh }) {
  // Deep links: ?z3=N focuses one Z3 (also a linked one, to move it); ?z5=N pre-fills the Z5 search.
  if (query.get('z3')) { const n = Number(query.get('z3')); state.focus = n; state.selected = new Set([n]); }
  if (query.get('z5')) state.z5q = z5Id(query.get('z5'));
  const L = store.lists;

  el.innerHTML = `
    <div class="screen-head"><div><h1>Linking workspace</h1><p class="muted">Bucket Z3s into structural Z5s. Pick one or more Z3s on the left, then choose the Z5 on the right.</p></div></div>
    <div class="link-grid">
      <div class="panel queue">
        <div class="panel-head"><h2>Unlinked Z3 queue</h2><span class="muted small num" data-part="qcount"></span></div>
        <div class="filters tight">
          <input class="input" data-f="q" placeholder="Search text or number" value="${esc(state.q)}">
          <select class="input" data-f="product">${options(L.products, state.product, { blank: 'Any product' })}</select>
          <select class="input" data-f="code">${options(L.failureCodes, state.code, { blank: 'Any failure code' })}</select>
        </div>
        <div data-part="queue" class="queue-list"></div>
      </div>
      <div class="stack">
        <div class="panel" data-part="focus"></div>
        <div class="panel">
          <div class="panel-head"><h2>Find the Z5</h2><button class="btn btn-secondary small" data-act="new-z5">+ Provisional Z5 from selection</button></div>
          <input class="input" data-f="z5q" placeholder="Z5 number, title, product, failure code, owner…" value="${esc(state.z5q)}">
          <div data-part="cands" class="cands"></div>
        </div>
      </div>
    </div>`;

  const selectedZ3s = () => [...state.selected].map((n) => store.z3.get(n)).filter(Boolean);

  const drawQueue = () => {
    const q = state.q.toLowerCase();
    const queue = store.db.z3s
      .filter((z) => z.z5 == null || state.selected.has(z.no))
      .filter((z) => !state.product || z.product === state.product)
      .filter((z) => !state.code || z.failureCode === state.code)
      .filter((z) => !q || `z3-${z.no} ${z.no} ${z.title} ${z.serial} ${z.operatorText}`.toLowerCase().includes(q))
      .sort((a, b) => b.no - a.no);
    el.querySelector('[data-part=qcount]').textContent = `${store.db.z3s.filter((z) => z.z5 == null).length} unlinked · ${state.selected.size} selected`;
    el.querySelector('[data-part=queue]').innerHTML = queue.slice(0, state.limit).map((z) => `
      <label class="q-item ${state.focus === z.no ? 'focus' : ''} ${state.selected.has(z.no) ? 'sel' : ''}" data-z3="${z.no}">
        <input type="checkbox" ${state.selected.has(z.no) ? 'checked' : ''} data-check="${z.no}">
        <span class="q-body">
          <span class="q-top"><b class="num">Z3-${z.no}</b> <span class="strong">${esc(z.title)}</span> <span class="right num">impact ${z.impact}</span></span>
          <span class="small muted">${esc(z.product)} · S/N ${esc(z.serial || '—')} · ${esc(z.failureCode)}</span>
          <span class="clip-2 small">${esc(z.operatorText)}</span>
          ${z.z5 != null ? `<span class="small warn">currently on ${z5Id(z.z5)} — linking moves it</span>` : ''}
        </span>
      </label>`).join('') + (queue.length > state.limit ? `<div class="more"><button class="btn btn-secondary small" data-act="more">Show more</button></div>` : '')
      || '<p class="muted">The queue is empty — every Z3 is linked to a Z5.</p>';
  };

  const drawFocus = () => {
    const z = store.z3.get(state.focus) || selectedZ3s()[0];
    el.querySelector('[data-part=focus]').innerHTML = z ? `
      <div class="panel-head"><h2>Z3-${z.no}</h2><a href="#/z3/${z.no}" class="small">Open record →</a></div>
      <div class="chips"><span class="tag tag-neutral">${esc(z.product)}</span><span class="tag tag-outline">${esc(z.failureCode)}</span><span class="tag tag-outline">${esc(z.productionStep)}</span><span class="tag tag-outline">${esc(z.milestone)}</span><span class="tag tag-accent">impact ${z.impact}</span> ${dateCell(z.found)}</div>
      <p class="strong">${esc(z.title)}${z.serial ? ` · S/N ${esc(z.serial)}` : ''}</p>
      <p>${esc(z.operatorText)}</p>
      ${z.z5Source === 'sap' ? `<p class="small warn">Linked to ${z5Id(z.z5)} in SAP — change it in SAP.</p>` : ''}
      ${z.resolutionText ? `<p class="muted small"><b>Resolution:</b> ${esc(z.resolutionText)}</p>` : ''}
      ${state.selected.size > 1 ? `<p class="small"><b>${state.selected.size} Z3s selected</b> — they are linked together.</p>` : ''}`
      : '<div class="panel-head"><h2>No Z3 selected</h2></div><p class="muted">Tick one or more Z3s in the queue.</p>';
  };

  const drawCands = () => {
    const sel = selectedZ3s();
    const codes = new Set(sel.map((z) => z.failureCode));
    const prods = new Set(sel.map((z) => z.product));
    const q = state.z5q.toLowerCase();
    const cands = store.db.z5s.filter(isOpen).map((z) => {
      const f = facts(z);
      const sameCode = f.codes.some((c) => codes.has(c));
      const sameProd = f.products.some((p) => prods.has(p));
      return { z, f, sameCode, sameProd, score: (sameCode ? 2 : 0) + (sameProd ? 1 : 0) };
    })
      .filter(({ z, f }) => !q || `${z5Id(z.no)} ${z.no} ${z.title} ${z.description} ${z.projectLead} ${z.engOwner} ${f.products.join(' ')} ${f.codes.join(' ')}`.toLowerCase().includes(q))
      .sort((a, b) => b.score - a.score || b.z.no - a.z.no)
      .slice(0, 25);
    el.querySelector('[data-part=cands]').innerHTML = cands.map(({ z, f, sameCode, sameProd }) => `
      <div class="cand">
        <div class="cand-body">
          <div><a class="idlink" href="#/z5/${z.no}">${z5Id(z.no)}</a> <b>${esc(z.title)}</b> ${sourceBadge(z)} ${z.parent ? `<span class="muted small">dup of ${z5Id(z.parent)}</span>` : ''}</div>
          <div class="small muted">${z.status} · ${esc(f.stage)} · ${f.allZ3.length} Z3s · ${esc(f.products.join(', ') || 'no products')}</div>
          <div class="chips">${sameCode ? '<span class="tag tag-accent">same failure code</span>' : ''}${sameProd ? '<span class="tag tag-outline">same product</span>' : ''}</div>
        </div>
        <button class="btn btn-primary small" data-link="${z.no}" ${state.selected.size ? '' : 'disabled'}>Link ${state.selected.size || ''}</button>
      </div>`).join('') || '<p class="muted">No open Z5 matches. Create a new one from the selection.</p>';
  };

  const drawAll = () => { drawQueue(); drawFocus(); drawCands(); };
  drawAll();

  el.addEventListener('input', (e) => {
    const f = e.target.dataset.f;
    if (!f) return;
    state[f] = e.target.value;
    clearTimeout(state.t);
    state.t = setTimeout(f === 'z5q' ? drawCands : drawQueue, 120);
  });
  el.addEventListener('change', (e) => {
    const n = e.target.dataset.check;
    if (!n) return;
    const no = Number(n);
    if (e.target.checked) { state.selected.add(no); state.focus = no; } else state.selected.delete(no);
    drawAll();
  });
  el.addEventListener('click', async (e) => {
    const item = e.target.closest('[data-z3]');
    if (item && !e.target.closest('input')) {
      e.preventDefault();
      state.focus = Number(item.dataset.z3);
      if (!e.metaKey && !e.ctrlKey && !e.shiftKey) state.selected = new Set([state.focus]);
      else state.selected.add(state.focus);
      return drawAll();
    }
    const link = e.target.closest('[data-link]');
    if (link) {
      const target = Number(link.dataset.link);
      const nos = [...state.selected];
      try {
        await api.link(nos, target);
        toast(`${nos.length === 1 ? `Z3-${nos[0]}` : `${nos.length} Z3s`} linked to ${z5Id(target)}`);
        state.selected = new Set(); state.focus = null;
        if (location.hash.includes('?')) location.hash = '#/link'; else await refresh();
      } catch (x) { toast(x.message, 'error'); }
      return;
    }
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'more') { state.limit += 300; return drawQueue(); }
    if (a === 'new-z5') {
      const sel = selectedZ3s();
      const first = sel[0];
      z5Dialog(null, {
        linkZ3s: sel.map((z) => z.no),
        seed: first ? { title: first.title || first.failureCode, failureCode: first.failureCode, description: first.operatorText } : {},
        onSaved: async (z) => { state.selected = new Set(); state.focus = null; await store.load(); location.hash = `#/z5/${z.no}/z3s`; },
      });
    }
  });
}
