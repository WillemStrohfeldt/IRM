// Z5 detail — ownership, dates, sequential PCCSIM workstreams, updates with files,
// triage record with minutes, linked Z3 tree and child (duplicate) Z5s.

import { api } from '../api.js';
import { store, facts, isOpen, WORKSTREAMS } from '../store.js';
import { esc, weekCode, dateCell, todayIso, addDays, fmtStamp, options, toast, dialog, confirmDialog, z5Id, z5Folder, daysFromToday, icon, fmtSize } from '../util.js';
import { z5Dialog, attachmentList, dropZone, wireFiles, sourceBadge } from '../forms.js';

const TABS = [
  ['resolution', 'Resolution', 'PCCSIM workstreams'],
  ['updates', 'Working notes', 'updates and files'],
  ['triage', 'Triage record', 'lifecycle and minutes'],
  ['z3s', 'Linked Z3s', 'issues bucketed here'],
  ['children', 'Child Z5s', 'duplicates'],
];
const RECORD_TYPES = ['Update given', 'DRB review', 'Triage decision', 'Guidance', 'Help request', 'Decision', 'Note'];

export default function detail(el, { params, refresh, go }) {
  const no = Number(params[0]);
  const tab = params[1] || 'resolution';
  const z = store.z5.get(no);
  if (!z) { el.innerHTML = `<div class="empty"><h2>${z5Id(no)} does not exist</h2><a href="#/z5">Back to the overview</a></div>`; return; }
  const f = facts(z);
  const parent = z.parent ? store.z5.get(z.parent) : null;
  const counts = { updates: z.updates.length, triage: z.records.length + z.updates.length, z3s: f.allZ3.length, children: f.children.length };

  const act = async (fn, msg) => {
    try { await fn(); if (msg) toast(msg); await refresh(); } catch (e) { toast(e.message, 'error'); }
  };
  const patch = (body, msg) => act(() => api.updateZ5(no, body), msg);

  const statusActions = {
    New: [['Investigate', 'Start investigation'], ['Ongoing', 'Accept to work on']],
    Investigate: [['Ongoing', 'Accept to work on']],
    Ongoing: [['Done', 'Set done']],
    Done: [['Ongoing', 'Reopen']],
    Aborted: [['New', 'Reopen into triage']],
  }[z.status];

  el.innerHTML = `
    <div class="crumbs"><a href="#/z5">Z5 overview</a> / <a href="#/z5/${no}">${z5Id(no)}</a> / <b>${(TABS.find(([k]) => k === tab) || TABS[0])[1]}</b>${parent ? ` · duplicate of <a href="#/z5/${parent.no}">${z5Id(parent.no)}</a>` : ''}</div>
    <div class="screen-head">
      <div>
        <h1><span class="num">${z5Id(no)}</span> ${esc(z.title)} ${sourceBadge(z)}</h1>
        <p class="muted">${esc(z.description || 'No description yet.')}</p>
        <div class="chips">
          <span class="status s-${z.status.toLowerCase()}">${z.status}</span>
          <span class="tag tag-outline">${esc(f.stage)}</span>
          ${z.failureCode ? `<span class="tag tag-accent" title="Failure code from ${z.source === 'provisional' ? 'the app' : 'SAP'}">${esc(z.failureCode)}</span>` : ''}
          ${f.products.map((p) => `<span class="tag tag-neutral">${esc(p)}</span>`).join('')}
          ${f.codes.filter((c) => c !== z.failureCode).map((c) => `<span class="tag tag-outline" title="Failure code on linked Z3s">${esc(c)}</span>`).join('')}
        </div>
      </div>
      <div class="head-actions">
        ${statusActions.map(([s, label]) => `<button class="btn ${s === 'Done' || s === 'Ongoing' ? 'btn-primary' : 'btn-secondary'}" data-status="${s}" ${s === 'Done' && f.closedCount < 6 ? 'disabled title="Close all six workstreams first"' : ''}>${label}</button>`).join('')}
        ${isOpen(z) ? '<button class="btn btn-secondary" data-status="Aborted">Abort</button>' : ''}
        <button class="btn btn-secondary" data-act="edit">Edit</button>
      </div>
    </div>

    ${z.source === 'provisional' ? `<div class="notice prov-banner"><span><b>Provisional Z5.</b> Started in the app; SAP has no number for it yet. Once SAP has the Z5, match it — all work, Z3 links and files move onto the SAP number.</span><button class="btn btn-primary" data-act="match">Match to SAP Z5…</button></div>` : ''}
    ${z.sapStatus === 'pending' ? `<div class="notice">Matched from ${esc(z.matchedFrom || 'a provisional Z5')}. SAP name, failure code and priority follow with the next Z5 import.</div>` : ''}
    <div class="facts">
      <div class="fact"><span class="fact-label">Project lead</span><input class="fact-input" list="people" data-field="projectLead" value="${esc(z.projectLead)}"></div>
      <div class="fact ${f.noEng ? 'fact-alert' : ''}"><span class="fact-label">Engineering owner</span><input class="fact-input" list="people" data-field="engOwner" value="${esc(z.engOwner)}" placeholder="unassigned"></div>
      <div class="fact ${f.availLate ? 'fact-alert' : ''}"><span class="fact-label">Committed availability <span class="num">${weekCode(z.committedDate)}</span></span><input class="fact-input" type="date" data-field="committedDate" value="${esc(z.committedDate)}"></div>
      <div class="fact ${f.followOverdue ? 'fact-alert' : ''}"><span class="fact-label">Next follow-up <span class="num">${weekCode(z.followUpDate)}</span>${f.followOverdue ? ` · ${-daysFromToday(z.followUpDate)}d late` : ''}</span><input class="fact-input" type="date" data-field="followUpDate" value="${esc(z.followUpDate)}"></div>
      ${z.source === 'provisional' ? `<div class="fact"><span class="fact-label">Priority</span><select class="fact-input" data-field="priority">${options(store.lists.priorities, z.priority, { blank: '—' })}</select></div>`
        : `<div class="fact" title="Priority comes from SAP"><span class="fact-label">Priority · SAP</span><span class="fact-value">${esc(z.priority || '—')}</span></div>`}
      <div class="fact"><span class="fact-label">Linked Z3s · impact</span><span class="fact-value num">${f.allZ3.length} · ${f.impact}</span></div>
    </div>

    <nav class="z5tabs" aria-label="Z5 sections"><span class="z5tabs-id num">${z5Id(no)}</span>${TABS.map(([k, label, sub]) => `<a href="#/z5/${no}/${k}" ${k === tab ? 'aria-current="page"' : ''}><span class="z5tab-label">${label}${counts[k] !== undefined ? ` <span class="z5tab-count num">${counts[k]}</span>` : ''}</span><span class="z5tab-sub">${sub}</span></a>`).join('')}<span class="tabs-note muted small">${z.updates[0] ? `last update ${weekCode(z.updates[0].date)}` : 'no updates yet'} · due ${weekCode(z.followUpDate) || '—'}</span></nav>
    <div class="tab-body">${{ resolution, updates, z3s: linked, triage, children }[tab]?.(z, f) ?? ''}</div>`;

  // ---- header + facts ----
  el.querySelectorAll('[data-field]').forEach((inp) => inp.addEventListener('change', () =>
    patch({ [inp.dataset.field]: inp.value }, 'Saved')));

  el.addEventListener('click', async (e) => {
    const t = e.target.closest('button, a[data-act]');
    if (!t) return;
    if (t.dataset.status) {
      const s = t.dataset.status;
      if (s === 'Aborted' && !(await confirmDialog(`Abort ${z5Id(no)}?`, 'The Z5 stays in the register with status Aborted. Linked Z3s stay linked.', { confirm: 'Abort Z5' }))) return;
      return patch({ status: s }, `${z5Id(no)} → ${s}`);
    }
    const a = t.dataset.act;
    if (a === 'edit') return z5Dialog(z, { onSaved: refresh });
    if (a === 'close-ws') {
      const date = el.querySelector(`[data-close-date="${t.dataset.ws}"]`)?.value || todayIso();
      return act(() => api.closeWorkstream(no, t.dataset.ws, date), `${t.dataset.ws} closed`);
    }
    if (a === 'reopen-ws') return act(() => api.reopenWorkstream(no, t.dataset.ws), `${t.dataset.ws} reopened`);
    if (a === 'post') return postUpdate();
    if (a === 'unlink-z3') return act(() => api.link([Number(t.dataset.no)], null), `Z3-${t.dataset.no} back in the linking queue`);
    if (a === 'match') return matchDialog();
    if (a === 'unparent') return patch({ parent: null }, 'Unlinked from parent');
    if (a === 'unchild') return act(() => api.updateZ5(Number(t.dataset.no), { parent: null }), 'Duplicate unlinked');
    if (a === 'set-parent') return parentDialog();
    if (a === 'add-child') return childDialog();
    if (a === 'add-record') {
      const data = Object.fromEntries(new FormData(el.querySelector('#rec-form')));
      return act(() => api.addRecord(no, data), data.type === 'Update given' ? 'Update recorded — counts as an update' : 'Record added');
    }
    if (a === 'link-child') return act(() => api.updateZ5(Number(t.dataset.no), { parent: no }), `${z5Id(Number(t.dataset.no))} linked as child of ${z5Id(no)}`);
    if (a === 'delete') {
      if (!(await confirmDialog(`Delete ${z5Id(no)}?`, 'This removes the Z5 record. Its Z3s go back to the linking queue. Files stay in the upload folder.', { confirm: 'Delete Z5' }))) return;
      await api.deleteZ5(no); toast(`${z5Id(no)} deleted`); await store.load(); go('#/z5');
    }
  });

  // ---- resolution tab: workstream fields save on change ----
  el.querySelectorAll('[data-ws-field]').forEach((inp) => inp.addEventListener('change', () =>
    act(() => api.updateWorkstream(no, inp.dataset.ws, { [inp.dataset.wsField]: inp.value }), 'Saved')));

  // ---- child Z5s tab: live candidate search ----
  if (tab === 'children') {
    const box = el.querySelector('[data-cands]');
    const q = el.querySelector('[data-child-q]');
    const draw = () => { box.innerHTML = childCandidates(z, f, q.value); };
    q.addEventListener('input', draw);
    draw();
  }

  // ---- comments on working notes ----
  el.querySelectorAll('[data-comment]').forEach((form) => form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = new FormData(form).get('text');
    try { await api.addComment(no, form.dataset.comment, text); toast('Comment added'); await refresh(); }
    catch (x) { toast(x.message, 'error'); }
  }));

  // ---- updates tab ----
  if (tab === 'updates') {
    wireFiles(el, (id) => ({ kind: 'z5', no, update: id === 'general' ? null : id }), refresh);
    const pending = el.querySelector('[data-pending]');
    const input = el.querySelector('#upd-files');
    const drop = el.querySelector('.dropzone-inline');
    const showPending = () => {
      pending.innerHTML = [...input.files].map((fl) => `<span class="tag tag-accent">${esc(fl.name)} · ${fmtSize(fl.size)}</span>`).join(' ');
    };
    input.addEventListener('change', showPending);
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); input.files = e.dataTransfer.files; showPending(); });
  }

  async function postUpdate() {
    const form = el.querySelector('#upd-form');
    const data = Object.fromEntries(new FormData(form));
    const files = [...el.querySelector('#upd-files').files];
    try {
      const u = await api.postUpdate(no, data);
      for (const file of files) await api.upload('z5', no, file, { update: u.id });
      toast(`Update posted${files.length ? ` with ${files.length} file${files.length > 1 ? 's' : ''}` : ''}; follow-up ${weekCode(data.followUp)}`);
      await refresh();
    } catch (e) { toast(e.message, 'error'); }
  }

  function matchDialog() {
    const candidates = store.db.z5s.filter((c) => c.source === 'sap' && !c.projectLead && !c.updates.length)
      .sort((a, b) => (b.failureCode === z.failureCode) - (a.failureCode === z.failureCode) || b.no - a.no).slice(0, 12);
    dialog({
      title: `Match ${z5Id(no)} to its SAP Z5`, submit: 'Match',
      body: `<p class="small">Enter the Z5 number SAP gave this issue. If that Z5 is already imported, the work of ${z5Id(no)} is moved onto it; otherwise ${z5Id(no)} takes the number and the next SAP import fills in the name, failure code and priority.</p>
        <div class="field"><label>SAP Z5 number</label><input class="input" name="sap" inputmode="numeric" placeholder="e.g. 300012345" required></div>
        ${candidates.length ? `<p class="small muted" style="margin-top:12px">Imported SAP Z5s without app work yet:</p><div class="chips">${candidates.map((c) => `<button type="button" class="btn btn-secondary small" data-pick-sap="${c.no}" title="${esc(c.title)}">${z5Id(c.no)} · ${esc(c.title.slice(0, 32))}${c.failureCode === z.failureCode ? ' ✓' : ''}</button>`).join('')}</div>` : ''}`,
      onMount(form) { form.addEventListener('click', (e) => { const b = e.target.closest('[data-pick-sap]'); if (b) form.querySelector('[name=sap]').value = b.dataset.pickSap; }); },
      async onSubmit({ sap }) {
        const res = await api.matchZ5(no, sap);
        toast(`${z5Id(no)} is now ${z5Id(res.no)}`);
        await store.load();
        location.hash = `#/z5/${res.no}`;
      },
    });
  }

  function z5Picker(title, candidates, submit, onPick) {
    dialog({
      title, submit,
      body: `<div class="field"><label>Search Z5</label><input class="input" data-pick-q placeholder="Number or title"></div>
        <div class="pick-list" data-pick-list></div><input type="hidden" name="pick">`,
      onMount(form) {
        const list = form.querySelector('[data-pick-list]');
        const draw = (q = '') => {
          const hits = candidates.filter((c) => `${z5Id(c.no)} ${c.no} ${c.title}`.toLowerCase().includes(q.toLowerCase())).slice(0, 30);
          list.innerHTML = hits.map((c) => `<label class="pick"><input type="radio" name="pick" value="${c.no}"> <b class="num">${z5Id(c.no)}</b> ${esc(c.title)} <span class="muted small">${c.status}</span></label>`).join('') || '<p class="muted small">No candidates.</p>';
        };
        form.querySelector('[data-pick-q]').addEventListener('input', (e) => draw(e.target.value));
        draw();
      },
      async onSubmit(data) {
        if (!data.pick) throw new Error('Pick a Z5');
        await onPick(Number(data.pick));
      },
    });
  }

  function parentDialog() {
    const candidates = store.db.z5s.filter((c) => c.no !== no && !c.parent && isOpen(c));
    z5Picker(`Mark ${z5Id(no)} as duplicate of…`, candidates, 'Link to leading Z5', async (p) => {
      await api.updateZ5(no, { parent: p }); toast(`${z5Id(no)} nested under ${z5Id(p)}`); await refresh();
    });
  }
  function childDialog() {
    const candidates = store.db.z5s.filter((c) => c.no !== no && !c.parent && !(store.childrenOf.get(c.no) || []).length && isOpen(c));
    z5Picker(`Link a duplicate Z5 under ${z5Id(no)}`, candidates, 'Link as duplicate', async (c) => {
      await api.updateZ5(c, { parent: no }); toast(`${z5Id(c)} nested under ${z5Id(no)}`); await refresh();
    });
  }
}

// ---------- tab renderers ----------

function resolution(z, f) {
  const t = todayIso();
  const accepted = z.status === 'Ongoing' || z.status === 'Done';
  const stepper = z.workstreams.map((w, i) => {
    const state = w.closed ? 'closed' : i === f.currentIdx && accepted ? (f.wsOverdue.includes(w) ? 'late' : 'open') : 'blocked';
    const text = w.closed ? `closed ${weekCode(w.closed)}` : state === 'blocked' ? (accepted ? 'waiting' : 'not started') : w.planned ? `planned ${weekCode(w.planned)}` : 'in progress';
    return `<div class="step step-${state}"><span class="step-n">${i + 1}</span><span class="step-name">${w.key}</span><span class="step-state">${text}</span></div>`;
  }).join('');

  const rows = z.workstreams.map((w, i) => {
    const isCurrent = i === f.currentIdx;
    const lastClosed = w.closed && !(z.workstreams[i + 1]?.closed);
    const late = !w.closed && w.planned && w.planned < t && accepted;
    return `<tr class="${w.closed ? 'ws-closed' : isCurrent && accepted ? 'ws-current' : 'ws-blocked'}">
      <td class="nowrap"><span class="step-n sm">${i + 1}</span> <b>${w.key}</b></td>
      <td><textarea class="input" rows="2" data-ws="${w.key}" data-ws-field="entry" placeholder="${isCurrent ? 'Latest status of this workstream…' : ''}">${esc(w.entry)}</textarea></td>
      <td><input class="input" list="people" data-ws="${w.key}" data-ws-field="owner" value="${esc(w.owner)}" placeholder="owner"></td>
      <td><input class="input ${late ? 'late' : ''}" type="date" data-ws="${w.key}" data-ws-field="planned" value="${esc(w.planned)}"><div class="small muted num">${weekCode(w.planned)}</div></td>
      <td class="ws-close">
        ${w.closed ? `<span class="num">${weekCode(w.closed)}</span>${lastClosed ? ` <button class="btn btn-ghost small" data-act="reopen-ws" data-ws="${w.key}">Reopen</button>` : ''}`
          : isCurrent && z.status === 'Ongoing' ? `<input class="input" type="date" data-close-date="${w.key}" value="${t}"><button class="btn btn-primary small" data-act="close-ws" data-ws="${w.key}">Close ${w.key}</button>`
          : '<span class="muted">—</span>'}
      </td>
    </tr>`;
  }).join('');

  return `
    ${!accepted ? `<div class="notice">This Z5 is in triage (${z.status}). Accept it to work on before PCCSIM workstreams can be closed.</div>` : ''}
    <div class="stepper">${stepper}</div>
    <p class="muted small">Workstreams run in order: each can only close once the one before it is closed. Only the last closed workstream can be reopened.</p>
    <table class="table ws-table">
      <thead><tr><th>Workstream</th><th>Latest entry</th><th>Owner</th><th>Planned close</th><th>Actual close</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function updates(z, f) {
  const next = addDays(todayIso(), 7);
  const cur = f.current?.key || 'Monitor';
  const attsFor = (id) => z.attachments.filter((a) => a.update === id);
  const general = z.attachments.filter((a) => !a.update);
  return `
  <div class="grid-2 wide-left">
    <div class="stack">
      <form class="panel" id="upd-form" onsubmit="return false">
        <div class="panel-head"><h2>New update</h2><span class="muted small">Posting sets the next follow-up date</span></div>
        <div class="form-grid cols-3">
          <div class="field"><label>Workstream</label><select class="input" name="ws">${options(WORKSTREAMS, cur)}</select></div>
          <div class="field"><label>Update type</label><select class="input" name="type">${options(['Progress', 'Deep dive', 'Closure', 'Help needed'], 'Progress')}</select></div>
          <div class="field"><label>Next follow-up</label><input class="input" type="date" name="followUp" value="${next}"></div>
          <div class="field" style="grid-column:span 3"><label>Update</label><textarea class="input" name="text" rows="6" placeholder="Findings, measurements, what was ruled out, what happens next and who owns it. Blank lines start a new paragraph."></textarea></div>
          <div class="field" style="grid-column:span 3"><label>Attach to this update</label>
            <label class="dropzone dropzone-inline">${icon.clip}<span class="dz-text"><span>Drop files, or browse</span><span class="muted small" data-pending>Saved into the upload folder when you post</span></span><span class="btn btn-secondary dz-btn">Browse</span><input type="file" id="upd-files" multiple hidden></label>
          </div>
        </div>
        <div class="row-actions"><button class="btn btn-primary" data-act="post">Post update</button><span class="muted small">Posting as ${esc(store.me)}</span></div>
      </form>

      ${z.updates.map((u) => `
        <article class="panel update">
          <div class="update-meta"><span class="tag tag-accent">${esc(u.ws)}</span><span class="tag tag-outline">${esc(u.type)}</span><b>${esc(u.author)}</b><span class="muted num">${fmtStamp(u.at || u.date)}</span>${u.onTime === false ? `<span class="flag">late — due ${weekCode(u.dueWas)}</span>` : ''}</div>
          ${String(u.text).split(/\n\s*\n/).map((p) => `<p>${esc(p)}</p>`).join('')}
          ${attsFor(u.id).length ? attachmentList(attsFor(u.id), { kind: 'z5', no: z.no }) : ''}
          <div class="comments">
            ${(u.comments || []).map((c) => `<div class="comment"><div class="comment-meta"><b>${esc(c.author)}</b><span class="muted num">${fmtStamp(c.at)}</span></div><div>${esc(c.text)}</div></div>`).join('')}
            <form class="comment-form" data-comment="${u.id}"><input class="input" name="text" placeholder="${(u.comments || []).length ? 'Reply…' : 'Add a comment…'}" autocomplete="off"><button class="btn btn-secondary small">Comment</button></form>
          </div>
          <details class="add-files"><summary class="small">Add files to this update</summary>${dropZone(u.id)}</details>
        </article>`).join('') || '<p class="muted">No updates posted yet.</p>'}
    </div>

    <div class="stack">
      <div class="panel">
        <div class="panel-head"><h2>Z5 files</h2><button class="btn btn-ghost small" data-reveal="${z5Folder(z.no)}">${icon.folder} Open folder</button></div>
        <p class="muted small">Saved to <code>${esc(store.settings.uploadDirResolved)}/${z5Folder(z.no)}/</code></p>
        ${dropZone('general', { hint: 'Problem statements, sign-offs, reports' })}
        ${attachmentList(general, { kind: 'z5', no: z.no })}
      </div>
      <div class="panel">
        <div class="panel-head"><h2>All attachments</h2><span class="muted small num">${z.attachments.length}</span></div>
        ${attachmentList(z.attachments, { kind: 'z5', no: z.no, removable: false })}
      </div>
    </div>
  </div>`;
}

function z3Rows(list) {
  return list.map((x) => `
    <tr>
      <td class="nowrap"><a class="idlink" href="#/z3/${x.no}">Z3-${x.no}</a></td>
      <td><div class="clip">${esc(x.title)}</div><div class="small muted">${esc(x.product)} · ${esc(x.serial)}</div></td><td>${esc(x.failureCode)}</td>
      <td><div class="clip-2">${esc(x.operatorText)}</div></td>
      <td class="num right">${x.impact}</td><td>${esc(x.status)}</td><td>${dateCell(x.found)}</td>
      <td>${x.z5Source === 'sap' ? '<span class="src src-sap" title="Linked in SAP; change it in SAP">SAP link</span>' : `<button class="btn btn-ghost small" data-act="unlink-z3" data-no="${x.no}" title="Unlink and return to the queue">Unlink</button>`}</td>
    </tr>`).join('');
}

function linked(z, f) {
  // One fixed column layout for the direct table and every duplicate's table, so the columns line up.
  const head = `<colgroup><col style="width:104px"><col style="width:19%"><col style="width:140px"><col><col style="width:66px"><col style="width:104px"><col style="width:78px"><col style="width:92px"></colgroup>
    <thead><tr><th>Z3</th><th>Name · product · serial</th><th>Failure code</th><th>Long text</th><th class="right">Impact</th><th>Status</th><th>Found</th><th></th></tr></thead>`;
  return `
    <div class="row-actions">
      <a class="btn btn-primary" href="#/link?z5=${z.no}">Link Z3s from the queue</a>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>${z5Id(z.no)} · direct Z3s</h2><span class="muted small num">${f.z3s.length}</span></div>
      ${f.z3s.length ? `<div class="table-wrap"><table class="table dense z3-fixed">${head}<tbody>${z3Rows(f.z3s)}</tbody></table></div>` : '<p class="muted small">No Z3s linked directly.</p>'}
    </div>
    ${f.children.map((c) => {
      const cz = store.z3ByZ5.get(c.no) || [];
      return `<div class="panel nested">
        <div class="panel-head"><h2><span class="tree">└</span> <a href="#/z5/${c.no}">${z5Id(c.no)}</a> ${esc(c.title)} <span class="status s-${c.status.toLowerCase()}">${c.status}</span></h2>
        <span class="muted small">duplicate · ${cz.length} Z3s</span><button class="btn btn-ghost small" data-act="unchild" data-no="${c.no}">Unlink duplicate</button></div>
        ${cz.length ? `<div class="table-wrap"><table class="table dense z3-fixed">${head}<tbody>${z3Rows(cz)}</tbody></table></div>` : ''}
      </div>`;
    }).join('')}`;
}

const stepLabel = (text) => {
  const st = text.match(/→ (\w+)$/)?.[1];
  if (st) return { Ongoing: 'Accepted', Done: 'Done', Aborted: 'Aborted', New: 'Reopened' }[st] || st;
  if (/linked as duplicate/.test(text)) return 'Merged in';
  if (/Marked duplicate/.test(text)) return 'Linked to parent';
  if (/Unlinked/.test(text)) return 'Unlinked';
  return 'Raised';
};

// Triage record: how the Z5 got here, the outcome, and every minute recorded against it.
function triage(z, f) {
  const parent = z.parent ? store.z5.get(z.parent) : null;
  const flow = ['New', 'Investigate', 'Ongoing', 'Done'];
  const idx = flow.indexOf(z.status);
  const steps = [...(z.log || [])].reverse().filter((l) => /^(Z5 raised|Status |Marked duplicate|Z5-\d+ linked as duplicate|Unlinked from parent)/.test(l.text));
  const accepted = [...(z.log || [])].find((l) => /→ Ongoing/.test(l.text));
  const cur = f.current?.key || 'Monitor';

  const minutes = [
    ...z.updates.map((u) => ({ date: u.date, ws: u.ws, type: `Update given · ${u.type}`, author: u.author, text: u.text, tag: u.onTime === false ? `late — due ${weekCode(u.dueWas)}` : '', hot: u.onTime === false })),
    ...z.records.map((r) => ({ date: r.date, ws: r.ws, type: r.type, author: r.author, text: r.text, hot: r.type === 'DRB review' || r.type === 'Help request' })),
    ...(z.log || []).filter((l) => !/^Update posted/.test(l.text)).map((l) => ({ date: l.at.slice(0, 10), ws: '', type: 'Admin change', author: l.by, text: l.text, admin: true })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return `
  <div class="grid-2 even">
    <div class="panel">
      <div class="panel-head"><h2>Triage record</h2></div>
      <ul class="timeline">${steps.map((l) => `<li><span class="kpi-label">${esc(stepLabel(l.text))} · <span class="num">${weekCode(l.at)}</span></span><span>${esc(l.text)} <span class="muted small">— ${esc(l.by)}</span></span></li>`).join('')}</ul>
      <div class="flow">${flow.map((s, i) => `<span class="flow-step ${z.status === 'Aborted' ? '' : i < idx ? 'done' : i === idx ? 'cur' : ''}">${s === 'Ongoing' ? 'Accepted · ongoing' : s}</span>`).join('<span class="flow-arrow">→</span>')}</div>
      <p class="muted small">Triage: new → investigate → accepted to work on. A Z5 can be aborted from any open state. Done needs all six PCCSIM workstreams closed.</p>
    </div>
    <div class="stack">
      <div class="panel">
        <div class="panel-head"><h2>Triage outcome</h2></div>
        <dl class="kv wide">
          <dt>Route</dt><dd>${{ New: 'New — awaiting triage', Investigate: 'Under investigation', Ongoing: 'Accepted to work on', Done: 'Done', Aborted: 'Aborted' }[z.status]}</dd>
          <dt>Decided by</dt><dd>${accepted ? `${esc(accepted.by)} · <span class="num">${weekCode(accepted.at)}</span>` : '—'}</dd>
          <dt>Duplicate of</dt><dd>${parent ? `<a href="#/z5/${parent.no}">${z5Id(parent.no)}</a> · ${esc(parent.title)}` : 'No — leading Z5'}</dd>
          <dt>Children merged in</dt><dd>${f.children.map((c) => `<a href="#/z5/${c.no}">${z5Id(c.no)}</a>`).join(' · ') || '—'}</dd>
          <dt>Aborted</dt><dd>${z.status === 'Aborted' ? `Yes · <span class="num">${weekCode(z.closedAt)}</span>` : 'No'}</dd>
        </dl>
      </div>
      ${z.source === 'provisional' ? `<div class="panel danger-zone">
        <div class="panel-head"><h2>Delete</h2></div>
        <p class="muted small">Provisional Z5s can be deleted, for example when SAP will not raise them. SAP Z5s cannot: use Abort.</p>
        <button class="btn btn-secondary" data-act="delete">Delete ${z5Id(z.no)}</button>
      </div>` : ''}
    </div>
  </div>

  <div class="panel">
    <div class="panel-head"><h2>Minutes and admin log</h2><span class="muted small">everything recorded against this Z5, in session and out</span></div>
    <form id="rec-form" class="rec-form" onsubmit="return false">
      <div class="field"><label>Type</label><select class="input" name="type">${options(RECORD_TYPES, 'DRB review')}</select></div>
      <div class="field"><label>Date</label><input class="input" type="date" name="date" value="${todayIso()}"></div>
      <div class="field"><label>Workstream</label><select class="input" name="ws">${options(WORKSTREAMS, cur, { blank: '—' })}</select></div>
      <div class="field"><label>Set follow-up</label><input class="input" type="date" name="followUp"></div>
      <div class="field rec-text"><label>Record</label><textarea class="input" name="text" rows="2" placeholder="What was said, what changed, and what is due next…"></textarea></div>
      <button class="btn btn-primary" data-act="add-record">Add record</button>
    </form>
    <p class="muted small">A record of type <b>Update given</b> is what the KPI board and Teams count as an update and what the DRB reads as prepared.</p>
    <div class="minutes">${minutes.map((m) => `
      <div class="minute ${m.admin ? 'admin' : ''}">
        <div><b class="num ${m.hot ? 'accent' : ''}">${weekCode(m.date)}</b><span class="small muted">${esc(m.ws)}</span></div>
        <div><div class="minute-top"><span class="strong ${m.hot ? 'accent' : ''}">${esc(m.type)}</span><span class="small muted">${esc(m.author)}</span>${m.tag ? `<span class="tag tag-outline right warn">${esc(m.tag)}</span>` : ''}</div>
        <span class="small">${esc(m.text)}</span></div>
      </div>`).join('')}</div>
  </div>`;
}

// Child Z5s: redundant Z5s kept open under this one as the leading Z5.
function children(z, f) {
  const parent = z.parent ? store.z5.get(z.parent) : null;
  const merged = (c) => (c.log || []).find((l) => /Marked duplicate/.test(l.text))?.at;
  const childZ3 = f.children.flatMap((c) => store.z3ByZ5.get(c.no) || []);
  return `
  <div class="panel">
    <div class="panel-head"><h2>Child Z5s</h2><span class="muted small">${f.children.length ? `${f.children.length} linked as duplicates` : ''}</span></div>
    ${f.children.length ? `<div class="table-wrap"><table class="table dense"><thead><tr><th>Z5</th><th>Title</th><th>Products</th><th>Raised</th><th class="right">Impact</th><th>Merged</th><th></th></tr></thead><tbody>
      ${f.children.map((c) => { const cf = facts(c); return `<tr><td><a class="idlink" href="#/z5/${c.no}">${z5Id(c.no)}</a></td><td>${esc(c.title)}<div class="small muted">${esc(c.projectLead)} · ${c.status}</div></td><td>${esc(cf.products.join(', ') || '—')}</td><td>${dateCell(c.raised)}</td><td class="num right">${cf.impact}</td><td>${dateCell(merged(c)?.slice(0, 10))}</td><td class="right"><button class="btn btn-secondary small" data-act="unchild" data-no="${c.no}">Unlink</button></td></tr>`; }).join('')}
    </tbody></table></div>` : '<p class="muted">No redundant Z5s are linked to this one yet. Search below and link one as a child.</p>'}
    <p class="muted small">A duplicate Z5 keeps its own number and stays open so the team that raised it can follow progress. Work happens on the leading Z5.</p>
    ${parent ? '' : `
    <div class="subsection">
      <div class="panel-head"><h2>Link a redundant Z5 to this one</h2><span class="muted small">${z5Id(z.no)} becomes the leading Z5; the child stays open</span></div>
      <input class="input" data-child-q placeholder="Search Z5 by number, title, failure code or product…">
      <div class="cands" data-cands></div>
      <p class="muted small">Linking is a judgement call, not a match score. Candidates with the same failure code are listed first; nothing is merged automatically.</p>
    </div>`}
  </div>
  <div class="grid-2 even">
    <div class="panel"><div class="panel-head"><h2>Rolled up</h2></div>
      <dl class="kv wide">
        <dt>Z3s on children</dt><dd class="num">${childZ3.length}</dd>
        <dt>Z3s on this Z5</dt><dd class="num">${f.z3s.length}</dd>
        <dt>Total across family</dt><dd class="num">${f.allZ3.length}</dd>
        <dt>Products touched</dt><dd>${esc(f.products.join(', ') || '—')}</dd>
        <dt>Combined impact</dt><dd class="num">${f.impact}</dd>
      </dl></div>
    <div class="panel"><div class="panel-head"><h2>This Z5 as a child</h2></div>
      ${parent ? `<p>${z5Id(z.no)} is a duplicate of <a href="#/z5/${parent.no}">${z5Id(parent.no)} · ${esc(parent.title)}</a>.</p><button class="btn btn-secondary" data-act="unparent">Unlink from parent</button>`
        : f.children.length ? `<p>${z5Id(z.no)} is a leading Z5 with children, so it cannot itself be linked under a parent.</p>`
        : `<p>${z5Id(z.no)} is not linked under any parent. If it duplicates a larger structural issue, link it upward.</p><button class="btn btn-secondary" data-act="set-parent">Mark as duplicate of…</button>`}
    </div>
  </div>`;
}

function childCandidates(z, f, q) {
  const needle = q.trim().toLowerCase();
  const list = store.db.z5s
    .filter((c) => c.no !== z.no && !c.parent && isOpen(c) && !(store.childrenOf.get(c.no) || []).length)
    .map((c) => ({ c, cf: facts(c) }))
    .map((r) => ({ ...r, same: r.cf.codes.some((x) => f.codes.includes(x)) }))
    .filter(({ c, cf }) => !needle || `${z5Id(c.no)} ${c.no} ${c.title} ${cf.codes.join(' ')} ${cf.products.join(' ')}`.toLowerCase().includes(needle))
    .sort((a, b) => b.same - a.same || b.c.no - a.c.no)
    .slice(0, 12);
  return list.map(({ c, cf, same }, i) => `
    <div class="cand"><div class="cand-body"><div><a class="idlink" href="#/z5/${c.no}">${z5Id(c.no)}</a> <b>${esc(c.title)}</b></div>
      <div class="small muted">${c.status} · ${cf.allZ3.length} Z3s · ${esc(cf.products.join(', ') || 'no products')} · ${esc(cf.codes.join(', ') || 'no failure code')}</div>
      ${same ? '<div class="chips"><span class="tag tag-accent">same failure code</span></div>' : ''}</div>
      <button class="btn ${i === 0 ? 'btn-primary' : 'btn-secondary'} small" data-act="link-child" data-no="${c.no}">Link as child</button></div>`).join('') || '<p class="muted small">No Z5 matches that search.</p>';
}
