// Z3 detail — the issue as SAP has it (read-only), its IRM status, files and the Z5 link.

import { api } from '../api.js';
import { store, Z3_STATUS } from '../store.js';
import { esc, weekCode, fmtStamp, toast, z5Id, options } from '../util.js';
import { attachmentList, dropZone, wireFiles, sapBlock, sourceBadge } from '../forms.js';

const paras = (text) => String(text || '').split(/\n\s*\n/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');

export default function z3detail(el, { params, refresh }) {
  const no = Number(params[0]);
  const z = store.z3.get(no);
  if (!z) { el.innerHTML = `<div class="empty"><h2>Z3-${no} does not exist</h2><a href="#/z3">Back to the register</a></div>`; return; }
  const z5 = z.z5 != null ? store.z5.get(z.z5) : null;
  const siblings = z5 ? (store.z3ByZ5.get(z5.no) || []).filter((x) => x.no !== no) : [];
  const sapLink = z.z5Source === 'sap';

  el.innerHTML = `
    <div class="crumbs"><a href="#/z3">Z3 register</a> / Z3-${no}</div>
    <div class="screen-head">
      <div>
        <h1><span class="num">Z3-${no}</span> ${esc(z.title || z.failureCode)} <span class="src src-sap" title="Z3s come from SAP">SAP</span></h1>
        <div class="chips">
          <span class="tag tag-accent">${esc(z.status)}</span>
          <span class="tag tag-neutral">${esc(z.product)}</span>
          ${z.serial ? `<span class="tag tag-outline">S/N ${esc(z.serial)}</span>` : ''}
          ${z.productionStep ? `<span class="tag tag-neutral">${esc(z.productionStep)}</span>` : ''}
          ${z.milestone ? `<span class="tag tag-neutral">${esc(z.milestone)}</span>` : ''}
          <span class="tag tag-outline">impact ${z.impact}</span>
        </div>
      </div>
      <div class="head-actions">
        <div class="field" title="The only Z3 field kept in the app"><label>IRM status</label><select class="input" data-status>${options(Z3_STATUS, z.status)}</select></div>
      </div>
    </div>

    <div class="grid-2 wide-left">
      <div class="stack">
        <div class="panel"><div class="panel-head"><h2>From SAP</h2><span class="muted small">${z.lastSeen ? `last import ${weekCode(z.lastSeen)}` : 'read-only'}</span></div>
          ${sapBlock([['Name', z.title], ['Failure code', z.failureCode], ['Product type', z.product], ['Serial number', z.serial],
            ['Impact', z.impact], ['Created on', z.found ? `${weekCode(z.found)} · ${z.found}` : ''], ['Resolved on', z.resolved ? `${weekCode(z.resolved)} · ${z.resolved}` : ''], ['Z5 in SAP', sapLink ? z5Id(z.z5) : ''],
            ['Production step', z.productionStep], ['Milestone', z.milestone]])}
          <h3 style="margin-top:14px">Long text</h3>
          ${paras(z.operatorText) || '<p class="muted">—</p>'}</div>
        <div class="panel"><div class="panel-head"><h2>How it was resolved</h2><span class="src src-sap">SAP</span></div>
          ${z.resolutionText ? paras(z.resolutionText) : '<p class="muted">No resolution text in SAP yet.</p>'}</div>
        <div class="panel">
          <div class="panel-head"><h2>Files</h2><button class="btn btn-ghost small" data-reveal="Z3-${no}">Open folder</button></div>
          <p class="muted small">Saved to <code>${esc(store.settings.uploadDirResolved)}/Z3-${no}/</code></p>
          ${dropZone('z3', { hint: 'Photos, metrology exports, lot records' })}
          ${attachmentList(z.attachments || [], { kind: 'z3', no })}
        </div>
      </div>
      <div class="stack">
        <div class="panel">
          <div class="panel-head"><h2>Z5 link</h2>${z5 ? `<span class="src ${sapLink ? 'src-sap' : 'src-app'}">${sapLink ? 'linked in SAP' : 'linked in the app'}</span>` : ''}</div>
          ${z5 ? `<p><a class="idlink" href="#/z5/${z5.no}">${z5Id(z5.no)}</a> ${esc(z5.title)} ${sourceBadge(z5)}</p>
            <p class="muted small">${z5.status} · lead ${esc(z5.projectLead || '—')} · eng ${esc(z5.engOwner || 'unassigned')}</p>
            ${sapLink ? '<p class="small muted">SAP holds this link. To move the Z3, change it in SAP; the next import updates it here.</p>'
              : `<div class="row-actions"><a class="btn btn-secondary" href="#/link?z3=${no}">Move to another Z5</a><button class="btn btn-ghost" data-act="unlink">Unlink</button></div>`}`
          : `<p class="warn">Not linked to a Z5 in SAP or in the app yet.</p><a class="btn btn-primary" href="#/link?z3=${no}">Link in the workspace</a>`}
        </div>
        ${siblings.length ? `<div class="panel"><div class="panel-head"><h2>Other Z3s on ${z5Id(z5.no)}</h2><span class="muted small num">${siblings.length}</span></div>
          <ul class="plain-list">${siblings.slice(0, 15).map((s) => `<li><a class="idlink" href="#/z3/${s.no}">Z3-${s.no}</a> <span>${esc(s.product)}</span> <span class="muted clip">${esc(s.title)}</span></li>`).join('')}</ul></div>` : ''}
        <div class="panel"><div class="panel-head"><h2>Record</h2></div>
          <dl class="kv">
            <dt>IRM status</dt><dd>${esc(z.status)}</dd>
            <dt>Last SAP import</dt><dd class="num">${z.lastSeen ? weekCode(z.lastSeen) : '—'}</dd>
            <dt>In the app since</dt><dd class="num">${fmtStamp(z.created)}</dd>
          </dl>
          <p class="small muted">A resolution date from SAP sets the status to Closed.</p></div>
      </div>
    </div>`;

  wireFiles(el, () => ({ kind: 'z3', no }), refresh);

  el.querySelector('[data-status]').addEventListener('change', async (e) => {
    try { await api.updateZ3(no, { status: e.target.value }); toast(`Z3-${no} → ${e.target.value}`); await refresh(); }
    catch (x) { toast(x.message, 'error'); }
  });
  el.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'unlink') {
      try { await api.link([no], null); toast(`Z3-${no} back in the linking queue`); await refresh(); } catch (x) { toast(x.message, 'error'); }
    }
  });
}
