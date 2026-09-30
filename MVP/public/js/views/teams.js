// Teams — per project lead: are the committed Z5s updated on time, and what is due next.

import { api } from '../api.js';
import { store } from '../store.js';
import { esc, weekCode, dateCell, dialog, toast, confirmDialog, z5Id, daysFromToday } from '../util.js';
import { teamStats, z5Strip, pct, rateClass, ON_TIME_TARGET } from '../metrics.js';

const WS_SHORT = ['Prb', 'Cnt', 'Cse', 'Sol', 'Imp', 'Mon'];

// Also used on the KPI board.
export function glanceTable(stats) {
  const all = stats.reduce((a, s) => ({
    committed: a.committed + s.committed.length, closed: a.closed + s.closedZ5.length,
    due: a.due + s.due, onTime: a.onTime + s.onTime, ws: a.ws + s.wsClosed, wsOn: a.wsOn + s.wsOnTime,
    over: a.over + s.overdueNow.length, past: a.past + s.pastAvail.length,
  }), { committed: 0, closed: 0, due: 0, onTime: 0, ws: 0, wsOn: 0, over: 0, past: 0 });
  const allRate = all.due ? all.onTime / all.due : null;
  const allWs = all.ws ? all.wsOn / all.ws : null;
  const cnt = (n) => `<td class="num right ${n ? 'late' : ''}">${n}</td>`;
  return `<div class="table-wrap"><table class="table dense">
    <thead><tr><th>Project lead</th><th class="right">Committed</th><th class="right">Closed · 10 wks</th><th class="right">Updates on time</th><th class="right">Streams on time</th><th class="right">Overdue now</th><th class="right">Past avail.</th></tr></thead>
    <tbody>${stats.map((s, i) => `<tr data-href="#/teams/${i}">
      <td><a href="#/teams/${i}" class="strong">${esc(s.team.lead)}</a><div class="small muted">${esc(s.team.dept)} · ${s.team.members.length} resources</div></td>
      <td class="num right">${s.committed.length}</td><td class="num right">${s.closedZ5.length}</td>
      <td class="num right ${rateClass(s.rate)}">${pct(s.rate)}</td><td class="num right ${rateClass(s.wsRate)}">${pct(s.wsRate)}</td>
      ${cnt(s.overdueNow.length)}${cnt(s.pastAvail.length)}</tr>`).join('')}
      <tr class="total-row"><td class="muted">All teams</td><td class="num right">${all.committed}</td><td class="num right">${all.closed}</td>
      <td class="num right ${rateClass(allRate)}">${pct(allRate)}</td><td class="num right ${rateClass(allWs)}">${pct(allWs)}</td>${cnt(all.over)}${cnt(all.past)}</tr>
    </tbody></table></div>`;
}

function stageMatrix(stats) {
  const total = WS_SHORT.map((_, i) => stats.reduce((a, s) => a + s.byStage[i], 0));
  const cell = (n) => `<span class="mx-cell ${n ? 'on' : ''}">${n || '—'}</span>`;
  return `<div class="matrix">
    <div class="mx-row mx-head"><span>Project lead</span>${WS_SHORT.map((w) => `<span>${w}</span>`).join('')}</div>
    ${stats.map((s) => `<div class="mx-row"><span><b>${esc(s.team.lead)}</b> <span class="muted small">${s.committed.length} committed</span></span>${s.byStage.map(cell).join('')}</div>`).join('')}
    <div class="mx-row"><span class="muted">All teams</span>${total.map(cell).join('')}</div>
  </div>`;
}

function teamDialog(team, idx, refresh) {
  const t = team || { lead: '', dept: '', members: [] };
  dialog({
    title: team ? `Edit team ${team.lead}` : 'New team',
    submit: 'Save team',
    body: `<div class="form-grid cols-2">
      <div class="field"><label>Project lead</label><input class="input" name="lead" list="people" value="${esc(t.lead)}" required></div>
      <div class="field"><label>Department</label><input class="input" name="dept" value="${esc(t.dept)}"></div>
      <div class="field" style="grid-column:span 2"><label>Resources (one per line)</label><textarea class="input" name="members" rows="4">${esc(t.members.join('\n'))}</textarea></div>
    </div>`,
    async onSubmit(data) {
      if (!data.lead.trim()) throw new Error('Name the project lead');
      const teams = [...store.db.teams];
      const next = { lead: data.lead.trim(), dept: data.dept.trim(), members: data.members.split('\n').map((x) => x.trim()).filter(Boolean) };
      if (team) teams[idx] = next; else teams.push(next);
      await api.saveTeams(teams);
      toast('Team saved');
      location.hash = `#/teams/${team ? idx : teams.length - 1}`;
      await refresh();
    },
  });
}

export default function teams(el, { params, refresh }) {
  // Admins see all teams; a user only the team they are assigned to (always shown as its own page).
  const admin = store.isAdmin;
  const list = store.visibleTeams;
  const stats = list.map(teamStats);
  const sel = !admin ? 0 : params[0] === undefined ? 'all' : Number(params[0]);
  const s = sel === 'all' ? null : stats[sel];

  el.innerHTML = `
    <div class="screen-head">
      <div><h1>Teams</h1><p class="muted">Per project lead: are the committed Z5s being updated on time, and what is due next. Target ${Math.round(ON_TIME_TARGET * 100)}% on time.</p></div>
      <div class="head-actions">${!admin ? '<span class="small muted">Your team</span>' : `${s ? '<button class="btn btn-secondary" data-act="edit">Edit team</button><button class="btn btn-ghost" data-act="remove">Remove team</button>' : ''}<button class="btn btn-secondary" data-act="add">+ Add team</button>`}</div>
    </div>
    <div class="tabs">
      ${admin ? `<a href="#/teams" ${sel === 'all' ? 'aria-current="true"' : ''}>All teams</a>` : ''}
      ${stats.map((x, i) => `<a href="#/teams/${i}" ${sel === i ? 'aria-current="true"' : ''}>${esc(x.team.lead)} <span class="num">${x.committed.length} Z5s</span></a>`).join('')}
    </div>
    ${s ? teamPage(s) : `
      <div class="panel"><div class="panel-head"><h2>Teams at a glance</h2><span class="tag tag-outline">Spec: ${Math.round(ON_TIME_TARGET * 100)}% on time</span></div>${glanceTable(stats)}
        <p class="muted small">Rates cover the last 10 weeks. An update is on time when it is posted on or before the follow-up date that was due. Committed Z5s are the accepted (ongoing) Z5s a lead owns.</p></div>
      <div class="panel"><div class="panel-head"><h2>Committed Z5s by workstream</h2><span class="muted small">PCCSIM is sequential — a Z5 sits in exactly one workstream</span></div>${stageMatrix(stats)}</div>`}`;

  el.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'add') return teamDialog(null, null, refresh);
    if (a === 'edit') return teamDialog(list[sel], sel, refresh);
    if (a === 'remove') {
      if (!(await confirmDialog(`Remove team ${list[sel].lead}?`, 'Only the team definition is removed. Z5s keep their project lead.', { confirm: 'Remove team' }))) return;
      await api.saveTeams(list.filter((_, i) => i !== sel)); toast('Team removed'); location.hash = '#/teams'; return refresh();
    }
    const tr = e.target.closest('tr[data-href]');
    if (tr && !e.target.closest('a')) location.hash = tr.dataset.href;
  });
}

function teamPage(s) {
  const t = s.team;
  const max = Math.max(2, ...s.weeks.map((w) => w.onTime + w.late + w.pending));
  const bar = (n, cls) => (n ? `<div class="wb ${cls}" style="height:${(n / max) * 100}%" title="${n}"></div>` : '');
  const dueSoon = s.committed.filter((r) => r.z.followUpDate).sort((a, b) => a.z.followUpDate.localeCompare(b.z.followUpDate)).slice(0, 6);
  const lastUpdate = (z) => z.updates[0]?.date || '';
  const stageSummary = s.byStage.map((n, i) => (n ? `${n} in ${['Problem', 'Containment', 'Cause', 'Solution', 'Implement', 'Monitor'][i]}` : '')).filter(Boolean).join(', ');
  const metric = (label, value, sub, cls = '') => `<div class="tmetric"><span class="kpi-label">${label}</span><span class="tm-value num ${cls}">${value}</span><span class="small muted">${sub}</span></div>`;
  const deg = s.wsRate == null ? 0 : Math.round(s.wsRate * 360);

  return `
    <div class="team-head">
      <div><h2>${esc(t.lead)}</h2><div class="small muted">${esc(t.dept)} · project lead</div><div class="small">${esc(t.members.join(' · ') || 'no resources named')}</div></div>
      <div class="tmetrics">
        ${metric('Committed Z5s', s.committed.length, stageSummary || '—')}
        ${metric(`On-time updates / ${Math.round(ON_TIME_TARGET * 100)}%`, pct(s.rate), `${s.onTime} of ${s.due} due`, rateClass(s.rate))}
        ${metric('Overdue now', s.overdueNow.length, s.overdueNow.map((r) => `${z5Id(r.z.no)}, ${-daysFromToday(r.z.followUpDate)}d`).join(' · ') || '—', s.overdueNow.length ? 'late' : '')}
        ${metric('Past availability', s.pastAvail.length, s.pastAvail.map((r) => z5Id(r.z.no)).join(' · ') || '—', s.pastAvail.length ? 'late' : '')}
        ${metric('Z5s closed, 10 wks', s.closedZ5.length, s.closedZ5.length ? `last ${weekCode(s.closedZ5.map((z) => z.closedAt).sort().pop())}` : '—')}
      </div>
    </div>

    <div class="team-grid">
      <div class="panel">
        <div class="panel-head"><h2>Updates given, last 10 weeks</h2><span class="muted small">${s.due} due · ${s.due - s.onTime} late · ${s.overdueNow.length} open</span></div>
        <div class="wchart">${s.weeks.map((w) => `<div class="wcol" title="week ${weekCode(w.start).slice(0, 4)}">${bar(w.pending, 'pending')}${bar(w.late, 'late')}${bar(w.onTime, 'ok')}</div>`).join('')}</div>
        <div class="wlabels">${s.weeks.map((w) => `<span>${weekCode(w.start).slice(2, 4)}</span>`).join('')}</div>
        <div class="legend"><span><i class="ok"></i>On time</span><span><i class="late"></i>Late or missed</span><span><i class="pending"></i>Due, not yet given</span></div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Workstreams closed</h2></div>
        <div class="donut" style="background:${s.wsClosed ? `conic-gradient(var(--color-good) 0 ${deg}deg, var(--color-late) ${deg}deg 360deg)` : 'var(--color-surface)'}"><div><b class="num">${pct(s.wsRate)}</b><span>on time</span></div></div>
        <div class="legend col"><span><i class="good"></i>On time <b class="num right">${s.wsOnTime}</b></span><span><i class="late"></i>Closed late <b class="num right">${s.wsClosed - s.wsOnTime}</b></span></div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Updates due soon</h2></div>
        ${dueSoon.length ? `<ul class="plain-list">${dueSoon.map(({ z, f }) => `<li><a class="idlink" href="#/z5/${z.no}">${z5Id(z.no)}</a><span class="clip">${esc(z.title)}<br><span class="small muted">${esc(z.engOwner || 'unassigned')} · ${esc(f.current?.key || '')}</span></span><span class="num right ${f.followOverdue ? 'late' : ''}">${weekCode(z.followUpDate)}</span></li>`).join('')}</ul>` : '<p class="muted small">Nothing committed.</p>'}
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Committed worklist</h2><span class="muted small">last 8 weeks per Z5</span></div>
      <div class="table-wrap"><table class="table dense">
        <thead><tr><th>Z5</th><th>Title</th><th>Eng. owner</th><th>Workstream</th><th>Last update</th><th>Follow-up</th><th>Availability</th><th>8 weeks</th></tr></thead>
        <tbody>${s.committed.map(({ z, f }) => `<tr data-href="#/z5/${z.no}">
          <td><a class="idlink" href="#/z5/${z.no}">${z5Id(z.no)}</a></td><td class="clip">${esc(z.title)}</td>
          <td class="nowrap">${z.engOwner ? esc(z.engOwner) : '<span class="warn">unassigned</span>'}</td>
          <td>${esc(f.current?.key || '—')}${f.wsOverdue.length ? ' <span class="late small">late</span>' : ''}</td>
          <td>${dateCell(lastUpdate(z))}</td><td>${dateCell(z.followUpDate, f.followOverdue ? 'late' : '')}</td><td>${dateCell(z.committedDate, f.availLate ? 'late' : '')}</td>
          <td class="strip">${z5Strip(z).map((w) => `<span class="sq ${w.missed ? 'missed' : w.closed ? 'closed' : w.update ? 'upd' : w.due ? 'due' : ''}" title="week ${weekCode(w.start).slice(0, 4)}: ${[w.update && 'update given', w.closed && 'workstream closed', w.missed && 'follow-up missed', w.due && 'due this week'].filter(Boolean).join(', ') || 'nothing'}"></span>`).join('')}</td>
        </tr>`).join('') || '<tr><td colspan="8" class="muted empty-row">No committed Z5s for this lead.</td></tr>'}</tbody>
      </table></div>
      <div class="legend"><span><i class="upd"></i>Update given</span><span><i class="closed"></i>Workstream closed</span><span><i class="missed"></i>Follow-up missed</span><span><i class="due"></i>Due this week</span></div>
    </div>`;
}
