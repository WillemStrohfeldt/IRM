// Search — one query across Z5s and Z3s. Multiple words must all match.

import { store, facts } from '../store.js';
import { esc, z5Id } from '../util.js';

export default function search(el, { query }) {
  const q = (query.get('q') || '').trim();
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (text) => terms.every((t) => text.includes(t));
  const mark = (s) => {
    let out = esc(s);
    for (const t of terms) out = out.replace(new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>');
    return out;
  };

  const z5s = terms.length ? store.db.z5s.map((z) => ({ z, f: facts(z) })).filter(({ z, f }) =>
    hit(`${z5Id(z.no)} z5-${z.no} ${z.title} ${z.failureCode} ${z.description} ${z.projectLead} ${z.engOwner} ${z.status} ${f.products.join(' ')} ${f.codes.join(' ')} ${z.workstreams.map((w) => w.entry).join(' ')} ${z.updates.map((u) => u.text).join(' ')}`.toLowerCase())) : [];
  const z3s = terms.length ? store.db.z3s.filter((z) =>
    hit(`z3-${z.no} ${z.title} ${z.serial} ${z.product} ${z.failureCode} ${z.productionStep} ${z.milestone} ${z.reporter} ${z.status} ${z.operatorText} ${z.resolutionText}`.toLowerCase())) : [];

  el.innerHTML = `
    <div class="screen-head"><div><h1>Search</h1><p class="muted">${terms.length ? `${z5s.length} Z5s and ${z3s.length} Z3s for “${esc(q)}”` : 'Search across every Z5 and Z3 — numbers (Z5, P- and Z3), names, owners, products, serial numbers, failure codes, long text, updates.'}</p></div></div>
    <form class="filters" data-form><input class="input big" name="q" value="${esc(q)}" placeholder="e.g. overlay DRY 0.7, Z3-24412, Roth, reticle heating" autofocus><button class="btn btn-primary">Search</button></form>
    ${terms.length ? `
    <div class="panel">
      <div class="panel-head"><h2>Z5s</h2><span class="muted small num">${z5s.length}</span></div>
      ${z5s.length ? `<table class="table dense"><thead><tr><th>Z5</th><th>Title</th><th>Status</th><th>Lead</th><th>Eng. owner</th><th>Products</th></tr></thead><tbody>
        ${z5s.slice(0, 100).map(({ z, f }) => `<tr><td><a class="idlink" href="#/z5/${z.no}">${z5Id(z.no)}</a></td><td>${mark(z.title)}</td><td>${z.status} · ${esc(f.stage)}</td><td>${mark(z.projectLead)}</td><td>${mark(z.engOwner || '—')}</td><td>${mark(f.products.join(', '))}</td></tr>`).join('')}
      </tbody></table>` : '<p class="muted small">No Z5s.</p>'}
    </div>
    <div class="panel">
      <div class="panel-head"><h2>Z3s</h2><span class="muted small num">${z3s.length}${z3s.length > 200 ? ' · first 200 shown' : ''}</span></div>
      ${z3s.length ? `<table class="table dense"><thead><tr><th>Z3</th><th>Name</th><th>Product · serial</th><th>Failure code</th><th>Long text</th><th>Z5</th></tr></thead><tbody>
        ${z3s.slice(0, 200).map((z) => `<tr><td><a class="idlink" href="#/z3/${z.no}">Z3-${z.no}</a></td><td>${mark(z.title)}</td><td>${mark(z.product)} <span class="small muted">${mark(z.serial)}</span></td><td>${mark(z.failureCode)}</td><td><div class="clip-2">${mark(z.operatorText)}</div></td><td>${z.z5 != null ? `<a class="idlink" href="#/z5/${z.z5}">${z5Id(z.z5)}</a>` : '<span class="warn">unlinked</span>'}</td></tr>`).join('')}
      </tbody></table>` : '<p class="muted small">No Z3s.</p>'}
    </div>` : ''}`;

  el.querySelector('[data-form]').addEventListener('submit', (e) => {
    e.preventDefault();
    location.hash = `#/search?q=${encodeURIComponent(new FormData(e.target).get('q').trim())}`;
  });
  const top = document.getElementById('global-q');
  if (top && q) top.value = q;
}
