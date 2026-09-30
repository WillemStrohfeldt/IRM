// DRB — weekly review board. Builds the agenda from live Z5 data, records the review per Z5,
// and keeps the board's guidance (actions) and help requests.

import { api } from '../api.js';
import { store, facts, isOpen, inTriage } from '../store.js';
import { esc, weekCode, options, toast, confirmDialog, dialog, z5Id, daysFromToday, addDays, fmtStamp } from '../util.js';
import { weekStart } from '../metrics.js';

const HELP_TYPES = ['FTE', 'Tool time', 'Budget', 'External', 'Decision'];
const HELP_STATUS = ['Decision needed', 'Awaiting quote', 'Approved', 'Rejected', 'Closed'];

export default function drb(el, { refresh }) {
  const d = store.db.drb;
  const session = d.sessions.find((s) => !s.closed);
  const last = d.sessions.filter((s) => s.closed).sort((a, b) => b.date.localeCompare(a.date))[0];
  const wkStart = weekStart(session.date);
  const wkEnd = addDays(wkStart, 7);
  const nextEnd = addDays(wkEnd, 7);
  const rows = store.db.z5s.filter(isOpen).map((z) => ({ z, f: facts(z) }));

  const lastSeen = (z) => z.records.filter((r) => r.type === 'DRB review').sort((a, b) => b.date.localeCompare(a.date))[0]?.date;
  const prepared = (z) => z.updates.some((u) => !last || u.date >= last.date);

  const overdue = rows.filter((r) => r.f.followOverdue).sort((a, b) => a.z.followUpDate.localeCompare(b.z.followUpDate));
  const dueWeek = rows.filter((r) => !r.f.followOverdue && r.z.followUpDate >= wkStart && r.z.followUpDate < wkEnd);
  const triageNeeded = rows.filter((r) => inTriage(r.z) && !r.z.parent);
  const openHelp = d.help.filter((h) => ['Decision needed', 'Awaiting quote'].includes(h.status));
  const openGuidance = d.guidance.filter((g) => !g.done);

  // Agenda: overdue first, then triage decisions, then this week's follow-ups, then guidance falling due.
  const agenda = new Map();
  const add = (z, reason, urgent) => { if (!agenda.has(z.no)) agenda.set(z.no, { z, reasons: [], urgent: false }); const a = agenda.get(z.no); a.reasons.push(reason); a.urgent ||= urgent; };
  overdue.forEach(({ z, f }) => add(z, `${-daysFromToday(z.followUpDate)}d overdue${f.noEng ? ' · no engineering owner' : ''}. Escalation.`, true));
  triageNeeded.forEach(({ z }) => add(z, 'Triage decision needed: accept or abort.', true));
  dueWeek.forEach(({ z }) => add(z, `Update due ${weekCode(z.followUpDate)}.`, false));
  openGuidance.filter((g) => g.due && g.due < wkEnd).forEach((g) => { const z = store.z5.get(g.z5); if (z && isOpen(z)) add(z, `Guidance due ${weekCode(g.due)}: ${g.text}`, g.due < session.date); });
  openHelp.filter((h) => h.status === 'Decision needed').forEach((h) => { const z = store.z5.get(h.z5); if (z) add(z, `Help request (${h.type}) needs a decision.`, true); });
  const reviewed = new Map(session.items.map((i) => [i.z5, i]));

  const nextWeek = rows.filter((r) => r.z.followUpDate >= wkEnd && r.z.followUpDate < nextEnd)
    .map((r) => ({ z: r.z, why: r.z.parent ? `Child review under parent ${z5Id(r.z.parent)}.` : `Follow-up due ${weekCode(r.z.followUpDate)}.` }));

  const tile = (label, n, sub, hot) => `<div class="kpi ${hot && n ? 'kpi-alert' : ''}"><span class="kpi-label">${label}</span><span class="kpi-value num">${n}</span><span class="kpi-sub">${sub}</span></div>`;
  const ztable = (list, lastCol) => `<div class="table-wrap"><table class="table dense">
    <thead><tr><th>Z5</th><th>Title</th><th>Project lead</th><th>Eng. owner</th><th>Workstream</th><th>Update due</th><th>${lastCol[0]}</th></tr></thead>
    <tbody>${list.map(({ z, f }) => `<tr data-href="#/z5/${z.no}"><td><a class="idlink" href="#/z5/${z.no}">${z5Id(z.no)}</a></td><td class="clip">${esc(z.title)}</td>
      <td class="nowrap">${esc(z.projectLead)}</td><td class="nowrap">${z.engOwner ? esc(z.engOwner) : '<span class="warn">unassigned</span>'}</td>
      <td>${esc(inTriage(z) ? 'Triage' : f.current?.key || '—')}</td>
      <td class="nowrap ${f.followOverdue ? 'late' : ''}"><span class="num">${weekCode(z.followUpDate)}</span>${f.followOverdue ? ` · ${-daysFromToday(z.followUpDate)}d` : ''}</td>
      <td class="nowrap">${lastCol[1](z)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted empty-row">None.</td></tr>'}</tbody></table></div>`;

  el.innerHTML = `
    <div class="screen-head">
      <div><h1>DRB</h1><p class="muted">Weekly review of open Z5 updates with management and the project leads. Purpose: hold the committed timeframes and clear what is blocking them.</p></div>
      <div class="drb-session">
        <div class="field"><label>Next session · <span class="num">${weekCode(session.date)}</span></label><input class="input" type="date" data-drb="date" value="${esc(session.date)}"></div>
        <div class="field"><label>Chair</label><input class="input" list="people" data-drb="chair" value="${esc(d.chair)}"></div>
        <button class="btn btn-primary" data-act="close">Close session</button>
      </div>
    </div>

    <div class="kpi-grid cols-4">
      ${tile('Due this week', dueWeek.length, `follow-up falls in ${weekCode(wkStart).slice(0, 4)}`)}
      ${tile('Overdue for update', overdue.length, 'follow-up date passed', true)}
      ${tile('Open help requests', openHelp.length, `${openHelp.filter((h) => h.status === 'Decision needed').length} need a decision`, true)}
      ${tile('Reviewed last session', last ? last.items.length : 0, last ? `DRB ${weekCode(last.date)}` : 'no session closed yet')}
    </div>

    <div class="panel"><div class="panel-head"><h2>Overdue for an update</h2><span class="warn small">${overdue.length} Z5s · escalate at the session</span></div>
      ${ztable(overdue, ['Last seen', (z) => (lastSeen(z) ? `DRB ${weekCode(lastSeen(z))}` : '<span class="muted">not yet seen</span>')])}</div>
    <div class="panel"><div class="panel-head"><h2>Due for an update this week</h2><span class="muted small">follow-up falls in ${weekCode(wkStart).slice(0, 4)}</span></div>
      ${ztable(dueWeek, ['Prepared', (z) => (prepared(z) ? 'Note posted' : '<span class="muted">Pending</span>')])}</div>

    <div class="grid-3">
      <div class="panel">
        <div class="panel-head"><div><span class="kpi-label">Reviewed last session</span><h2>${last ? `DRB ${weekCode(last.date)} · ${last.items.length} Z5s` : '—'}</h2></div></div>
        ${last ? `<ul class="agenda">${last.items.map((i) => `<li><div><a class="idlink" href="#/z5/${i.z5}">${z5Id(i.z5)}</a> ${esc(store.z5.get(i.z5)?.title || '')}</div><span class="small muted">${esc(i.note)}</span></li>`).join('')}</ul>` : '<p class="muted small">No closed session yet.</p>'}
      </div>
      <div class="panel panel-accent">
        <div class="panel-head"><div><span class="kpi-label">Reviewing this week</span><h2>DRB ${weekCode(session.date)} · ${agenda.size} Z5s</h2></div><span class="muted small num">${reviewed.size}/${agenda.size} recorded</span></div>
        <ul class="agenda">${[...agenda.values()].map(({ z, reasons, urgent }) => {
          const r = reviewed.get(z.no);
          return `<li class="${r ? 'done' : ''}">
            <div><a class="idlink" href="#/z5/${z.no}">${z5Id(z.no)}</a> ${esc(z.title)}</div>
            <span class="small ${urgent ? 'warn' : 'muted'}">${reasons.map(esc).join(' ')}</span>
            ${r ? `<span class="small reviewed">✓ ${esc(r.note)} <button class="btn btn-ghost small" data-reedit="${z.no}">edit</button></span>`
              : `<div class="review-row"><input class="input" data-note="${z.no}" placeholder="Outcome / guidance for the minutes"><button class="btn btn-secondary small" data-review="${z.no}">Record</button></div>`}
          </li>`;
        }).join('') || '<li class="muted small">Nothing on the agenda.</li>'}</ul>
        ${[...reviewed.keys()].filter((no) => !agenda.has(no)).map((no) => `<p class="small">✓ <a href="#/z5/${no}">${z5Id(no)}</a> ${esc(reviewed.get(no).note)}</p>`).join('')}
        <div class="row-actions"><select class="input" data-extra>${'<option value="">Add another Z5 to the agenda…</option>' + rows.filter((r) => !agenda.has(r.z.no)).map((r) => `<option value="${r.z.no}">${z5Id(r.z.no)} · ${esc(r.z.title)}</option>`).join('')}</select></div>
      </div>
      <div class="panel">
        <div class="panel-head"><div><span class="kpi-label">Scheduled next week</span><h2>DRB ${weekCode(addDays(session.date, 7))} · ${nextWeek.length} planned</h2></div></div>
        <ul class="agenda">${nextWeek.map(({ z, why }) => `<li><div><a class="idlink" href="#/z5/${z.no}">${z5Id(z.no)}</a> ${esc(z.title)}</div><span class="small muted">${esc(why)}</span></li>`).join('') || '<li class="muted small">Nothing scheduled yet.</li>'}</ul>
      </div>
    </div>

    <div class="grid-2 even">
      <div class="panel">
        <div class="panel-head"><h2>Guidance recorded</h2><span class="muted small">actions owned by the DRB · ${openGuidance.length} open</span><button class="btn btn-secondary small" data-act="guidance">Record guidance</button></div>
        <ul class="gl">${d.guidance.map((g) => `<li class="${g.done ? 'done' : ''}">
          <label class="gl-check"><input type="checkbox" data-gdone="${g.id}" ${g.done ? 'checked' : ''}></label>
          <div><div class="gl-top"><a class="idlink" href="#/z5/${g.z5}">${z5Id(g.z5)}</a><span class="small muted right">${esc(g.owner || 'no owner')}${g.due ? ` · by <span class="num ${!g.done && g.due < session.date ? 'late' : ''}">${weekCode(g.due)}</span>` : ''}</span></div>
          <span>${esc(g.text)}</span></div></li>`).join('') || '<li class="muted small">No guidance yet.</li>'}</ul>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Help requests</h2><span class="warn small">${openHelp.length} open</span><button class="btn btn-primary small" data-act="help">Raise a help request</button></div>
        <ul class="gl">${d.help.map((h) => `<li>
          <div><div class="gl-top"><span class="tag ${h.type === 'FTE' ? 'tag-accent' : 'tag-neutral'}">${esc(h.type)}</span><a class="idlink" href="#/z5/${h.z5}">${z5Id(h.z5)}</a><span class="small muted">${esc(h.by)} · ${fmtStamp(h.at).slice(0, 6)}</span>
            <select class="input status-select right ${h.status === 'Decision needed' ? 'warn' : ''}" data-hstatus="${h.id}">${options(HELP_STATUS, h.status)}</select></div>
          <span>${esc(h.text)}</span></div></li>`).join('') || '<li class="muted small">No help requests.</li>'}</ul>
      </div>
    </div>`;

  const z5Select = (name, selected) => `<select class="input" name="${name}"><option value="">Select Z5</option>${rows.map((r) => `<option value="${r.z.no}" ${r.z.no === selected ? 'selected' : ''}>${z5Id(r.z.no)} · ${esc(r.z.title)}</option>`).join('')}</select>`;

  el.addEventListener('change', async (e) => {
    const t = e.target;
    try {
      if (t.dataset.drb === 'date') { await api.drbSettings({ date: t.value }); toast(`Session moved to ${weekCode(t.value)}`); return refresh(); }
      if (t.dataset.drb === 'chair') { await api.drbSettings({ chair: t.value }); toast('Chair saved'); return refresh(); }
      if (t.dataset.gdone) { await api.setGuidance(t.dataset.gdone, t.checked); toast(t.checked ? 'Guidance done' : 'Guidance reopened'); return refresh(); }
      if (t.dataset.hstatus) { await api.setHelp(t.dataset.hstatus, t.value); toast(`Help request → ${t.value}`); return refresh(); }
      if (t.dataset.extra !== undefined && t.value) {
        const no = Number(t.value);
        await api.drbReview(no, '');
        toast(`${z5Id(no)} recorded for this session`);
        return refresh();
      }
    } catch (x) { toast(x.message, 'error'); }
  });

  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.dataset.note) el.querySelector(`[data-review="${e.target.dataset.note}"]`).click();
  });

  el.addEventListener('click', async (e) => {
    const rv = e.target.closest('[data-review]');
    if (rv) {
      const no = Number(rv.dataset.review);
      try { await api.drbReview(no, el.querySelector(`[data-note="${no}"]`).value); toast(`${z5Id(no)} review recorded in its minutes`); await refresh(); }
      catch (x) { toast(x.message, 'error'); }
      return;
    }
    const re = e.target.closest('[data-reedit]');
    if (re) {
      const no = Number(re.dataset.reedit);
      const li = re.closest('li');
      li.querySelector('.reviewed').outerHTML = `<div class="review-row"><input class="input" data-note="${no}" value="${esc(reviewed.get(no).note)}"><button class="btn btn-secondary small" data-review="${no}">Record</button></div>`;
      return;
    }
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'close') {
      const missing = [...agenda.keys()].filter((no) => !reviewed.has(no)).length;
      if (!(await confirmDialog(`Close DRB ${weekCode(session.date)}?`, `${reviewed.size} Z5s recorded${missing ? `, ${missing} on the agenda without a record` : ''}. The next session is planned a week later.`, { confirm: 'Close session' }))) return;
      await api.drbCloseSession(); toast('Session closed'); return refresh();
    }
    if (a === 'guidance') {
      return dialog({
        title: 'Record guidance', submit: 'Record',
        body: `<div class="form-grid cols-2">
          <div class="field" style="grid-column:span 2"><label>Z5</label>${z5Select('z5')}</div>
          <div class="field"><label>Owner</label><input class="input" name="owner" list="people"></div>
          <div class="field"><label>Due</label><input class="input" type="date" name="due" value="${addDays(session.date, 7)}"></div>
          <div class="field" style="grid-column:span 2"><label>Guidance</label><textarea class="input" name="text" rows="3" placeholder="What the board asks, of whom, by when"></textarea></div></div>`,
        async onSubmit(data) {
          if (!data.z5) throw new Error('Pick the Z5');
          await api.addGuidance({ ...data, z5: Number(data.z5) }); toast('Guidance recorded'); await refresh();
        },
      });
    }
    if (a === 'help') {
      return dialog({
        title: 'Raise a help request', submit: 'Raise request',
        body: `<div class="form-grid cols-2">
          <div class="field" style="grid-column:span 2"><label>Z5</label>${z5Select('z5')}</div>
          <div class="field"><label>Type</label><select class="input" name="type">${options(HELP_TYPES, 'FTE')}</select></div>
          <div class="field" style="grid-column:span 2"><label>What is needed</label><textarea class="input" name="text" rows="3" placeholder="e.g. 1 FTE metrology engineer for six weeks"></textarea></div></div>`,
        async onSubmit(data) {
          if (!data.z5) throw new Error('Pick the Z5');
          await api.addHelp({ ...data, z5: Number(data.z5) }); toast('Help request raised'); await refresh();
        },
      });
    }
    const tr = e.target.closest('tr[data-href]');
    if (tr && !e.target.closest('a')) location.hash = tr.dataset.href;
  });
}
