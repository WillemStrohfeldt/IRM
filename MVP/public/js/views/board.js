// KPI board — the mockup's charts computed from live data. Every chart can be hidden, added back,
// reordered, resized and configured; product / failure-code filters apply to all of them.

import { api } from '../api.js';
import { store } from '../store.js';
import { esc, weekCode, todayIso, dateCell, daysFromToday, z5Id, dialog, toast } from '../util.js';
import { teamStats, ON_TIME_TARGET } from '../metrics.js';
import { glanceTable } from './teams.js';
import {
  board, z5Rows, z3Included, specState, trendSeries, latestMoveRate, stageCounts, failureBars, buildup,
  topNew, TOP_RANGES, digest,
} from '../charts.js';

let editing = false;

const seg = (path, value, opts) => `<span class="seg-ctl">${opts.map(([v, label]) =>
  `<button type="button" data-set="${path}" data-val="${v}" ${v === value ? 'aria-current="true"' : ''}>${label}</button>`).join('')}</span>`;
const sel = (name, value, opts) => `<select class="input" name="${name}">${opts.map(([v, l]) => `<option value="${v}" ${value === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;

// ---------- widgets ----------

const WIDGETS = {
  kpis: {
    title: 'KPI tiles', bare: true,
    render({ cfg, rows }) {
      const T = cfg.targets;
      const follow = rows.filter((r) => r.f.followOverdue).length;
      const avail = rows.filter((r) => r.f.availLate).length;
      const wsLate = rows.filter((r) => r.f.wsOverdue.length);
      const wsCount = wsLate.reduce((s, r) => s + r.f.wsOverdue.length, 0);
      const noEng = rows.filter((r) => r.f.noEng).length;
      const by = (s) => rows.filter((r) => r.z.status === s).length;
      const tile = (view, label, value, sub, target) => {
        const st = specState(value, target);
        return `<a class="kpi kpi-${st.cls}" href="#/z5?view=${view}">
          <span class="kpi-label">${label}</span><span class="kpi-value num">${value}</span><span class="kpi-sub">${sub}</span>
          ${st.word ? `<span class="spec"><b class="${st.cls}">${st.word}</b> <span class="muted">${target === 0 ? 'spec 0' : `target ≤ ${target}`}</span></span>` : ''}</a>`;
      };
      return `<div class="kpi-grid">
        ${tile('open', 'Open Z5s', rows.length, `new ${by('New')} · investigate ${by('Investigate')} · ongoing ${by('Ongoing')}`, T.open)}
        ${tile('follow', 'Follow-up overdue', follow, 'no update past due date', T.follow)}
        ${tile('avail', 'Past committed avail.', avail, 'date missed, not done', T.avail)}
        ${tile('noeng', 'No engineering owner', noEng, 'open Z5s without an owner', T.noeng)}
        ${tile('ws', 'Workstreams overdue', wsCount, `across ${wsLate.length} Z5s`, T.ws)}
      </div>`;
    },
    options: {
      body: (cfg) => `<p class="small muted">A tile is <b class="good">on spec</b> at or under its target, <b class="watch">watch</b> just above it, and <b class="late">off spec</b> beyond that. Leave a target empty to hide its label.</p>
        <div class="form-grid cols-3">${TARGETS.map(([k, l]) => `<div class="field"><label>${l} · target ≤</label><input class="input" type="number" min="0" name="${k}" value="${cfg.targets[k] ?? ''}"></div>`).join('')}</div>`,
      save: (d) => ({ targets: Object.fromEntries(TARGETS.map(([k]) => [k, d[k] === '' ? null : Number(d[k])])) }),
    },
  },

  stages: {
    title: 'Open Z5s by current workstream',
    render({ cfg, rows }) {
      const withTriage = cfg.stages?.triage !== false;
      const st = stageCounts(rows, { includeTriage: withTriage });
      const total = st.reduce((a, s) => a + s.n, 0) || 1;
      const colors = ['var(--color-accent-2)', 'var(--color-accent-900)', 'var(--color-accent-700)', 'var(--color-accent)', 'var(--color-accent-400)', 'var(--color-accent-300)', 'var(--color-accent-200)'];
      const col = (i) => colors[withTriage ? i : i + 1];
      let off = 0;
      const arcs = st.map((s, i) => {
        const len = (s.n / total) * 100;
        const arc = s.n ? `<circle cx="21" cy="21" r="15.9155" fill="none" stroke="${col(i)}" stroke-width="7" stroke-dasharray="${Math.max(0, len - 0.6).toFixed(3)} ${(100 - len + 0.6).toFixed(3)}" stroke-dashoffset="${(-off).toFixed(3)}" transform="rotate(-90 21 21)"><title>${s.key}: ${s.n}</title></circle>` : '';
        off += len;
        return arc;
      }).join('');
      const ws = st.filter((s) => s.key !== 'Triage');
      const lateTotal = ws.reduce((a, s) => a + s.late, 0);
      return `<p class="muted small head-note">PCCSIM is sequential — no skipping</p>
        <div class="donut-row">
          <div class="svg-donut"><svg viewBox="0 0 42 42"><circle cx="21" cy="21" r="15.9155" fill="none" stroke="var(--color-divider)" stroke-width="7"></circle>${arcs}</svg>
            <div><b class="num">${st.reduce((a, s) => a + s.n, 0)}</b><span>open Z5s</span></div></div>
          <div class="legend-list">${st.map((s, i) => `<a href="#/z5?view=${s.key === 'Triage' ? 'triage' : `open&stage=${s.key}`}"><i style="background:${col(i)}"></i>${s.key}<b class="num">${s.n}</b><span class="muted num">${Math.round((s.n / total) * 100)}%</span></a>`).join('')}</div>
        </div>
        <div class="subsection">
          <div class="panel-head"><span class="kpi-label">Overdue by workstream</span><span class="small accent right">${lateTotal} of ${ws.reduce((a, s) => a + s.n, 0)}</span></div>
          ${ws.map((s) => `<div class="mini-bar"><span>${s.key}</span><div><i style="width:${s.n ? Math.round((s.late / s.n) * 100) : 0}%"></i></div><span class="num ${s.late ? 'accent strong' : 'muted'}">${s.late} of ${s.n}</span></div>`).join('')}
        </div>`;
    },
    options: {
      body: (cfg) => `<label class="check"><input type="checkbox" name="triage" ${cfg.stages?.triage !== false ? 'checked' : ''}> Show Z5s in triage as their own slice</label>`,
      save: (d) => ({ stages: { triage: d.triage === 'on' } }),
    },
  },

  trend: {
    title: 'Trend',
    controls: (cfg) => seg('trend.gran', cfg.trend.gran, [['week', 'Week'], ['month', 'Month'], ['quarter', 'Quarter']]),
    render({ cfg }) {
      const { metric, norm } = cfg.trend;
      const { pts, word } = trendSeries(cfg);
      const vals = pts.map((p) => p.v);
      const known = vals.filter((v) => v != null);
      const dec = metric === 'sev' ? 2 : norm === 'rate' ? 1 : 0;
      const fmt = (v) => (v == null ? '—' : v.toFixed(dec));
      const hi = Math.max(1e-9, ...known);
      const pow = Math.pow(10, Math.floor(Math.log10(hi / 5)));
      const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * pow).find((s) => s * 5 >= hi) || hi / 5;
      const axMax = step * 5;
      const X = (i) => ((i / Math.max(1, pts.length - 1)) * 100).toFixed(2);
      const Y = (v) => (100 - (v / axMax) * 100).toFixed(2);
      const W = Math.max(1, cfg.trend.ma || 10);
      const ma = vals.map((_, i) => { const w = vals.slice(Math.max(0, i - W + 1), i + 1).filter((v) => v != null); return w.length ? w.reduce((a, b) => a + b, 0) / w.length : null; });
      // Break the line where a value is missing (no move rate for that interval).
      const lines = (arr) => arr.reduce((acc, v, i) => { if (v == null) acc.push([]); else acc[acc.length - 1].push(`${X(i)},${Y(v)}`); return acc; }, [[]]).filter((l) => l.length);
      const last = known[known.length - 1], prev = known[known.length - 2];
      const maKnown = ma.filter((v) => v != null);
      const rising = maKnown.length > W && maKnown[maKnown.length - 1] > maKnown[maKnown.length - 1 - W];
      const mr = latestMoveRate();
      const title = metric === 'sev' ? 'Impact per Z3 · rework mix' : `${metric === 'z3' ? 'Z3s raised' : 'Z3 impact raised'}${norm === 'rate' ? ', move rate normalized' : ''}`;
      const missing = norm === 'rate' && metric !== 'sev' ? vals.filter((v) => v == null).length : 0;
      return `
        <div class="trend-ctl">
          <span class="ctl-label">Measure</span>${seg('trend.metric', metric, [['impact', 'Impact'], ['z3', 'Z3 count'], ['sev', 'Impact per Z3']])}
          <span class="ctl-label">Basis</span>${seg('trend.norm', norm, [['abs', 'Absolute'], ['rate', 'Move rate normalized']])}
          <span class="muted small right">${mr ? `Move rate ${mr.parts.toLocaleString()} parts per week` : '<a href="#/data">No move rate data yet</a>'}</span>
        </div>
        <div class="trend-head"><span class="trend-title">${title}</span><span class="trend-value num">${fmt(last)}</span>
          ${prev != null ? `<span class="accent small">${last >= prev ? '+' : '−'}${fmt(Math.abs(last - prev))} on last ${word}</span>` : ''}
          ${maKnown.length ? `<span class="muted small">${W} ${word} MA ${fmt(maKnown[maKnown.length - 1])} and ${rising ? 'rising' : 'easing'}</span>` : ''}
          <span class="muted small right">${pts.length} ${word}s · ${pts[0].label} to ${pts[pts.length - 1].label}</span></div>
        <div class="trend-chart">
          <div class="yticks num">${[5, 4, 3, 2, 1, 0].map((k) => `<span>${fmt((axMax * k) / 5)}</span>`).join('')}</div>
          <div><svg viewBox="0 0 100 100" preserveAspectRatio="none" class="trend-svg">
            ${[0, 20, 40, 60, 80].map((y) => `<line x1="0" y1="${y}" x2="100" y2="${y}" stroke="var(--color-divider)" stroke-width="0.35"></line>`).join('')}
            ${lines(vals).map((l) => `<polygon points="${l[0].split(',')[0]},100 ${l.join(' ')} ${l[l.length - 1].split(',')[0]},100" fill="var(--color-accent-100)"></polygon><polyline points="${l.join(' ')}" fill="none" stroke="var(--color-accent)" stroke-width="1.1" vector-effect="non-scaling-stroke" stroke-linejoin="round"></polyline>`).join('')}
            ${lines(ma).map((l) => `<polyline points="${l.join(' ')}" fill="none" stroke="var(--color-accent-900)" stroke-width="1.8" stroke-dasharray="4 2.4" vector-effect="non-scaling-stroke"></polyline>`).join('')}
          </svg>
          <div class="xticks num">${pts.filter((_, i) => i % Math.ceil(pts.length / 6) === 0).map((p) => `<span>${p.label}</span>`).join('')}</div></div>
        </div>
        <div class="legend"><span><i class="line"></i>${metric === 'sev' ? 'Impact per Z3 raised' : metric === 'z3' ? (norm === 'rate' ? 'Z3s per 1k parts moved' : 'Z3s raised in interval') : (norm === 'rate' ? 'Impact per 1k parts moved' : 'Impact raised in interval')}</span>
          <span><i class="line dashed"></i>${W} interval moving average</span>
          <span class="right">${missing ? `<span class="warn">${missing} intervals without move rate data</span>` : norm === 'rate' ? 'Normalized on move rate, so volume swings do not read as quality swings' : 'Absolute counts, so volume swings show up as spikes'}</span></div>`;
    },
    options: {
      body: (cfg) => `<div class="form-grid cols-2">
        <div class="field"><label>Interval</label>${sel('gran', cfg.trend.gran, [['week', 'Week (52)'], ['month', 'Month (24 × 4 weeks)'], ['quarter', 'Quarter (12 × 13 weeks)']])}</div>
        <div class="field"><label>Moving average window</label><input class="input" type="number" min="1" max="26" name="ma" value="${cfg.trend.ma}"></div>
        <div class="field"><label>Measure</label>${sel('metric', cfg.trend.metric, [['impact', 'Impact'], ['z3', 'Z3 count'], ['sev', 'Impact per Z3']])}</div>
        <div class="field"><label>Basis</label>${sel('norm', cfg.trend.norm, [['abs', 'Absolute'], ['rate', 'Move rate normalized']])}</div>
      </div><p class="small muted">Move rate (parts moved per week) is kept under <a href="#/data">Data &amp; settings</a>.</p>`,
      save: (d) => ({ trend: { gran: d.gran, metric: d.metric, norm: d.norm, ma: Number(d.ma) || 10 } }),
    },
  },

  failure: {
    title: 'Impact by failure code',
    render({ cfg }) {
      const bars = failureBars(cfg);
      const max = Math.max(1, ...bars.map((b) => b.value));
      const unit = cfg.failure.scope === 'open' ? 'Z5' : 'Z3';
      const note = { open: 'summed impact of open Z5s, by their main failure code', '13w': 'Z3 impact raised in the last 13 weeks', '52w': 'Z3 impact raised in the last 52 weeks', all: 'all Z3 impact on record' }[cfg.failure.scope];
      return `<p class="muted small head-note">${note}</p>
        <div class="cols" style="grid-template-columns:repeat(${Math.max(bars.length, 1)},minmax(0,1fr))">${bars.map((b, i) => `
          <a class="col-bar" href="#/search?q=${encodeURIComponent(b.code === 'Other' ? '' : b.code)}">
            <span class="num strong ${i === 0 ? 'accent' : ''}">${b.value}</span>
            <div class="col-track"><div class="${i === 0 ? 'lead' : ''}" style="height:${Math.round((b.value / max) * 100)}%"></div></div>
            <span class="col-label">${esc(b.code)}</span><span class="muted tiny">${b.count} ${unit}s</span></a>`).join('') || '<p class="muted">No data in scope.</p>'}</div>`;
    },
    options: {
      body: (cfg) => `<div class="form-grid cols-2">
        <div class="field"><label>Scope</label>${sel('scope', cfg.failure.scope, [['open', 'Open Z5s'], ['13w', 'Z3s, last 13 weeks'], ['52w', 'Z3s, last 52 weeks'], ['all', 'All Z3s']])}</div>
        <div class="field"><label>Bars (rest grouped as Other)</label><input class="input" type="number" min="2" max="16" name="max" value="${cfg.failure.max}"></div></div>
        <p class="small muted">To leave failure codes out of this and every other chart, use <b>Filter charts</b> at the top of the board.</p>`,
      save: (d) => ({ failure: { scope: d.scope, max: Number(d.max) || 8 } }),
    },
  },

  buildup: {
    title: 'Open Z5s, built up',
    controls: (cfg) => seg('buildup.mode', cfg.buildup.mode, [['priority', 'Priority'], ['code', 'Failure code']]),
    render({ cfg, rows }) {
      const parts = buildup(rows, cfg.buildup.mode);
      const total = parts.reduce((a, p) => a + p.n, 0);
      const H = 150;
      const scale = H / Math.max(1, total);
      let acc = 0;
      const cols = parts.map((p) => {
        const col = `<div class="wf-col"><span class="num strong">${p.n}</span><div class="wf-track" style="height:${H}px"><div class="wf-bar" style="bottom:${acc * scale}px;height:${Math.max(p.n ? 2 : 0, p.n * scale)}px"></div><div class="wf-guide" style="bottom:${(acc + p.n) * scale}px"></div></div><span class="col-label">${esc(p.label)}</span><span class="muted tiny">${esc(p.sub)}</span></div>`;
        acc += p.n;
        return col;
      }).join('');
      return `<p class="muted small head-note">count of Z5s · ${total} open (duplicates counted under their parent)</p>
        <div class="wf" style="grid-template-columns:repeat(${parts.length + 1},minmax(0,1fr))">${cols}
          <div class="wf-col"><span class="num strong accent">${total}</span><div class="wf-track" style="height:${H}px"><div class="wf-bar total" style="bottom:0;height:${total * scale}px"></div></div><span class="col-label accent">Open now</span><span class="muted tiny">all open</span></div></div>`;
    },
  },

  attention: {
    title: 'Needs attention',
    controls: () => '<a href="#/z5?view=follow" class="small">All overdue →</a>',
    render({ rows }) {
      const list = rows.filter((r) => r.f.followOverdue || r.f.availLate || r.f.wsOverdue.length || r.f.noEng)
        .sort((a, b) => (a.z.followUpDate || '9999').localeCompare(b.z.followUpDate || '9999')).slice(0, 10);
      if (!list.length) return '<p class="muted">Nothing overdue. Every open Z5 is on track.</p>';
      return `<div class="table-wrap"><table class="table dense"><thead><tr><th>Z5</th><th>Title</th><th>Eng. owner</th><th>Follow-up</th><th>Flags</th></tr></thead>
        <tbody>${list.map(({ z, f }) => `<tr data-href="#/z5/${z.no}"><td><a href="#/z5/${z.no}" class="idlink">${z5Id(z.no)}</a></td><td class="clip">${esc(z.title)}</td>
          <td class="nowrap">${z.engOwner ? esc(z.engOwner) : '<span class="warn">unassigned</span>'}</td><td>${dateCell(z.followUpDate, f.followOverdue ? 'late' : '')}</td>
          <td class="flags">${[f.followOverdue && `<span class="flag">update ${-daysFromToday(z.followUpDate)}d late</span>`, f.availLate && '<span class="flag">past avail.</span>',
            f.wsOverdue.length && `<span class="flag">${f.wsOverdue.map((w) => w.key).join(', ')} late</span>`, f.noEng && '<span class="flag">no owner</span>'].filter(Boolean).join(' ')}</td></tr>`).join('')}</tbody></table></div>`;
    },
  },

  top: {
    title: 'Top Z5s by impact',
    controls: (cfg) => seg('top.range', cfg.top.range, Object.entries(TOP_RANGES).map(([k, [l]]) => [k, l])),
    render({ cfg, rows }) {
      const overall = rows.filter((r) => !r.z.parent).sort((a, b) => b.f.impact - a.f.impact).slice(0, cfg.top.n);
      const { from, rows: fresh } = topNew(cfg, cfg.top.range);
      const bar = (v, max, i) => `<div class="rank-bar"><i style="width:${Math.round((v / Math.max(1, max)) * 100)}%;background:${i === 0 ? 'var(--color-accent)' : 'var(--color-accent-300)'}"></i></div>`;
      const item = (i, no, title, meta, v, max) => `<div class="rank"><span class="rank-n num">${i + 1}</span><div><div><a class="idlink" href="#/z5/${no}">${z5Id(no)}</a> <span class="small">${esc(title)}</span></div>${bar(v, max, i)}<span class="tiny muted">${esc(meta)}</span></div><span class="rank-v num ${i === 0 ? 'accent' : ''}">${v}</span></div>`;
      return `<div class="grid-2 even flat">
        <div><div class="panel-head"><h3>Top ${cfg.top.n} overall</h3><span class="muted small right">by total impact, all open Z5s</span></div>
          ${overall.map(({ z, f }, i) => item(i, z.no, z.title, `${f.stage} · ${f.allZ3.length} Z3s · ${f.products.join(', ') || '—'}`, f.impact, overall[0].f.impact)).join('') || '<p class="muted small">No open Z5s.</p>'}
          <a href="#/z5" class="small">Open the full register</a></div>
        <div><div class="panel-head"><h3>Top ${cfg.top.n} by new impact</h3><span class="muted small right">impact added since ${weekCode(from)}</span></div>
          ${fresh.map((r, i) => item(i, r.no, store.z5.get(r.no)?.title || '', `${r.n} new Z3${r.n === 1 ? '' : 's'} · ${Object.entries(r.codes).sort((a, b) => b[1] - a[1])[0][0]}`, r.impact, fresh[0].impact)).join('') || '<p class="muted small">No new Z3s linked in this range.</p>'}</div>
      </div>`;
    },
    options: {
      body: (cfg) => `<div class="form-grid cols-2"><div class="field"><label>Rows per list</label><input class="input" type="number" min="1" max="20" name="n" value="${cfg.top.n}"></div>
        <div class="field"><label>New-impact range</label>${sel('range', cfg.top.range, Object.entries(TOP_RANGES).map(([k, [l]]) => [k, l]))}</div></div>`,
      save: (d) => ({ top: { n: Number(d.n) || 5, range: d.range } }),
    },
  },

  followups: {
    title: 'Follow-ups due in 7 days',
    render({ rows }) {
      const due = rows.filter((r) => r.z.followUpDate && !r.f.followOverdue && daysFromToday(r.z.followUpDate) <= 7).sort((a, b) => a.z.followUpDate.localeCompare(b.z.followUpDate));
      return due.length ? `<ul class="plain-list">${due.map(({ z }) => `<li><a href="#/z5/${z.no}" class="idlink">${z5Id(z.no)}</a> <span class="clip">${esc(z.title)}</span> <span class="num right">${weekCode(z.followUpDate)}</span></li>`).join('')}</ul>` : '<p class="muted small">None.</p>';
    },
  },

  linking: {
    title: 'Linking queue',
    render({ cfg }) {
      const n = store.db.z3s.filter((z) => z.z5 == null && z3Included(z, cfg)).length;
      return `<a class="queue-tile" href="#/link"><span class="kpi-value num">${n}</span><span class="muted small">Z3s not yet bucketed into a Z5. Pick one, search for a Z5, link it.</span></a>`;
    },
  },

  teams: {
    title: 'Teams at a glance',
    controls: () => `<span class="tag tag-outline">Spec: ${Math.round(ON_TIME_TARGET * 100)}% on time</span> <a href="#/teams" class="small">Teams →</a>`,
    render: () => glanceTable(store.db.teams.map(teamStats)),
  },

  digest: {
    title: 'Updates given in the last month',
    render({ cfg }) {
      const g = digest(cfg);
      const fig = (label, v, sub, hot) => `<div class="dfig"><span class="kpi-label ${hot ? 'accent' : ''}">${label}</span><span class="dfig-v num ${hot ? 'accent' : ''}">${v}</span><span class="small muted">${sub}</span></div>`;
      return `<p class="muted small head-note">${weekCode(g.from).slice(0, 4)} to ${weekCode(todayIso()).slice(0, 4)} · everything recorded against a Z5</p>
        <div class="dfigs">
          ${fig('Updates posted', g.updates, `on ${g.updatedZ5} of ${g.open} open Z5s`)}
          ${fig('Workstreams closed', g.wsClosed, 'across PCCSIM')}
          ${fig('Z5s closed', g.closed, `${g.retired} impact retired`)}
          ${fig('Z5s accepted', g.accepted, `${g.triage} still in triage`)}
          ${fig('No update this period', g.silent, `${g.silentCritical} of them critical`, true)}
        </div>
        <span class="small muted">Week by week</span>
        <table class="table dense"><thead><tr><th>Week</th><th class="right">Updates</th><th class="right">Streams closed</th><th class="right">Z5s closed</th><th class="right">Accepted</th></tr></thead>
          <tbody>${g.table.map((w) => `<tr><td class="num">${w.label}</td><td class="num right">${w.updates}</td><td class="num right">${w.streams}</td><td class="num right">${w.closed}</td><td class="num right">${w.accepted}</td></tr>`).join('')}</tbody></table>
        <span class="small muted">What moved · the updates management asked to see</span>
        <div class="moved">${g.moved.map((m) => `
          <div class="mv">
            <div class="mv-top"><a class="idlink" href="#/z5/${m.z.no}">${z5Id(m.z.no)}</a><span>${esc(m.z.title)}</span><span class="small muted num">moved ${weekCode(m.date)}</span><span class="tag ${m.flag ? 'tag-accent' : 'tag-outline'} right">${esc(m.tag)}</span></div>
            <div class="mv-row"><span class="kpi-label">Issue</span><span>${esc(m.z.description || m.z.title)}</span></div>
            <div class="mv-row"><span class="kpi-label">Impact 30d</span><span><b class="accent num">${m.impact}</b> <span class="muted">· Project lead</span> ${esc(m.z.projectLead)} <span class="muted">· Engineering owner</span> ${esc(m.z.engOwner || 'unassigned')}</span></div>
            <div class="mv-row"><span class="kpi-label">Workstream</span><span><b>${esc(m.ws)}</b> — ${esc(m.wsNote)}</span></div>
            <div class="mv-row"><span class="kpi-label">Latest triage</span><span>${esc(m.triage)}</span></div>
            <a class="small mv-link" href="#/z5/${m.z.no}/updates">Working notes</a>
          </div>`).join('') || '<p class="muted small">Nothing moved in this period.</p>'}</div>`;
    },
    options: {
      body: (cfg) => `<div class="form-grid cols-2"><div class="field"><label>Period (weeks)</label><input class="input" type="number" min="1" max="13" name="weeks" value="${cfg.digest.weeks}"></div>
        <div class="field"><label>“What moved” items</label><input class="input" type="number" min="0" max="20" name="moved" value="${cfg.digest.moved}"></div></div>`,
      save: (d) => ({ digest: { weeks: Number(d.weeks) || 4, moved: Number(d.moved) } }),
    },
  },
};

const TARGETS = [['open', 'Open Z5s'], ['follow', 'Follow-up overdue'], ['avail', 'Past committed avail.'], ['noeng', 'No engineering owner'], ['ws', 'Workstreams overdue']];

export const WIDGET_TITLES = Object.fromEntries(Object.entries(WIDGETS).map(([k, w]) => [k, w.title]));
export const WIDGET_HAS_OPTIONS = Object.fromEntries(Object.entries(WIDGETS).map(([k, w]) => [k, !!w.options]));
export { TARGETS };

export const DEFAULT_LAYOUT = [
  ['kpis', 'full'], ['stages', 'half'], ['trend', 'half'], ['failure', 'full'], ['buildup', 'half'], ['attention', 'half'],
  ['top', 'full'], ['followups', 'half'], ['linking', 'half'], ['teams', 'full'], ['digest', 'full'],
].map(([id, size]) => ({ id, show: true, size }));

// ---------- saving ----------

// Merges one level deep, so { trend: { gran } } keeps the other trend options.
export async function saveBoard(patch, refresh) {
  const cfg = board();
  const next = { ...cfg };
  for (const [k, v] of Object.entries(patch)) next[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...cfg[k], ...v } : v;
  try { await api.saveBoard(next); await refresh(); } catch (e) { toast(e.message, 'error'); }
}

export function filterDialog(refresh) {
  const cfg = board();
  const box = (name, list, chosen) => list.map((v) => `<label class="check"><input type="checkbox" name="${name}" value="${esc(v)}" ${!chosen.length || chosen.includes(v) ? 'checked' : ''}> ${esc(v)}</label>`).join('');
  dialog({
    title: 'Filter the charts', submit: 'Apply', wide: true,
    body: `<p class="small muted">Untick a product or failure code to leave it out of every chart and KPI on the board. The registers are not affected.</p>
      <div class="grid-2 even flat">
        <div><div class="panel-head"><h3>Products</h3><button type="button" class="btn btn-ghost small" data-all="products">All</button><button type="button" class="btn btn-ghost small" data-none="products">None</button></div><div class="checks">${box('products', store.lists.products, cfg.products)}</div></div>
        <div><div class="panel-head"><h3>Failure codes</h3><button type="button" class="btn btn-ghost small" data-all="failureCodes">All</button><button type="button" class="btn btn-ghost small" data-none="failureCodes">None</button></div><div class="checks">${box('failureCodes', store.lists.failureCodes, cfg.failureCodes)}</div></div>
      </div>`,
    onMount(form) {
      form.addEventListener('click', (e) => {
        const a = e.target.closest('[data-all],[data-none]');
        if (!a) return;
        const name = a.dataset.all || a.dataset.none;
        form.querySelectorAll(`input[name=${name}]`).forEach((c) => { c.checked = !!a.dataset.all; });
      });
    },
    async onSubmit(_, form) {
      const pick = (name, all) => {
        const v = [...form.querySelectorAll(`input[name=${name}]:checked`)].map((c) => c.value);
        if (!v.length) throw new Error(`Keep at least one ${name === 'products' ? 'product' : 'failure code'}`);
        return v.length === all.length ? [] : v;
      };
      await saveBoard({ products: pick('products', store.lists.products), failureCodes: pick('failureCodes', store.lists.failureCodes) }, refresh);
      toast('Chart filter applied');
    },
  });
}

export function optionsDialog(id, refresh) {
  const w = WIDGETS[id];
  dialog({
    title: `${w.title} · options`, submit: 'Save',
    body: w.options.body(board()),
    async onSubmit(data) { await saveBoard(w.options.save(data, board()), refresh); toast('Chart options saved'); },
  });
}

// ---------- view ----------

export default function boardView(el, { refresh }) {
  const cfg = board();
  const rows = z5Rows(cfg);
  const ctx = { cfg, rows };
  const shown = cfg.widgets.filter((w) => w.show && WIDGETS[w.id]);
  const hidden = cfg.widgets.filter((w) => !w.show && WIDGETS[w.id]);
  const filtered = cfg.products.length || cfg.failureCodes.length;

  const frame = (w, i) => {
    const def = WIDGETS[w.id];
    const tools = `${def.options ? `<button class="btn btn-ghost btn-icon" data-opts="${w.id}" title="Chart options">⚙</button>` : ''}
      ${editing ? `<button class="btn btn-ghost btn-icon" data-move="${i}" data-dir="-1" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="btn btn-ghost btn-icon" data-move="${i}" data-dir="1" title="Move down" ${i === shown.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="btn btn-ghost btn-icon" data-size="${w.id}" title="${w.size === 'full' ? 'Make half width' : 'Make full width'}">${w.size === 'full' ? '½' : '⇔'}</button>
        <button class="btn btn-ghost btn-icon" data-hide="${w.id}" title="Remove from board">×</button>` : ''}`;
    let body;
    try { body = def.render(ctx); } catch (e) { console.error(e); body = `<p class="warn small">Could not draw this chart: ${esc(e.message)}</p>`; }
    if (def.bare && !editing) return `<div class="widget widget-${w.size} bare" data-w="${w.id}">${body}</div>`;
    return `<section class="panel widget widget-${w.size} ${editing ? 'editing' : ''}" data-w="${w.id}">
      <div class="panel-head"><h2>${esc(def.title)}</h2>${def.controls ? `<span class="w-ctl">${def.controls(cfg)}</span>` : ''}<span class="w-tools">${tools}</span></div>
      ${body}</section>`;
  };

  el.innerHTML = `
    <div class="screen-head">
      <div><h1>IRM board</h1><p class="muted">Are Z5 updates happening on time? Every figure opens the overview, filtered to it. Today is <span class="num">${weekCode(todayIso())}</span>.</p></div>
      <div class="head-actions">
        ${filtered ? `<span class="tag tag-accent">Filtered: ${cfg.products.length ? `${cfg.products.length} products` : 'all products'} · ${cfg.failureCodes.length ? `${cfg.failureCodes.length} codes` : 'all codes'}</span><button class="btn btn-ghost small" data-act="clear-filter">Clear</button>` : ''}
        <button class="btn btn-secondary" data-act="filter">Filter charts</button>
        <button class="btn ${editing ? 'btn-primary' : 'btn-secondary'}" data-act="edit">${editing ? 'Done customizing' : 'Customize board'}</button>
      </div>
    </div>
    ${editing ? `<div class="notice board-edit">
      <span><b>Customizing.</b> ↑ ↓ reorder · ½ / ⇔ switch width · × remove a chart · ⚙ chart options. Changes save immediately.</span>
      ${hidden.length ? `<div class="chips"><span class="small">Add a chart:</span>${hidden.map((w) => `<button class="btn btn-secondary small" data-show="${w.id}">+ ${esc(WIDGETS[w.id].title)}</button>`).join('')}</div>` : '<span class="small muted">All charts are on the board.</span>'}
      <button class="btn btn-ghost small" data-act="reset-layout">Reset layout</button>
    </div>` : ''}
    <div class="board-grid">${shown.map(frame).join('') || '<div class="empty"><p>No charts on the board. Click <b>Customize board</b> to add some.</p></div>'}</div>`;

  el.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    const tr = e.target.closest('tr[data-href]');
    if (!t) { if (tr && !e.target.closest('a')) location.hash = tr.dataset.href; return; }
    const list = cfg.widgets.map((w) => ({ ...w }));
    if (t.dataset.set) {
      const [k, f] = t.dataset.set.split('.');
      return saveBoard({ [k]: { [f]: t.dataset.val } }, refresh);
    }
    if (t.dataset.opts) return optionsDialog(t.dataset.opts, refresh);
    if (t.dataset.hide) { list.find((w) => w.id === t.dataset.hide).show = false; return saveBoard({ widgets: list }, refresh); }
    if (t.dataset.show) { list.find((w) => w.id === t.dataset.show).show = true; return saveBoard({ widgets: list }, refresh); }
    if (t.dataset.size) { const w = list.find((x) => x.id === t.dataset.size); w.size = w.size === 'full' ? 'half' : 'full'; return saveBoard({ widgets: list }, refresh); }
    if (t.dataset.move) {
      const a = shown[Number(t.dataset.move)].id;
      const b = shown[Number(t.dataset.move) + Number(t.dataset.dir)]?.id;
      if (!b) return;
      const ia = list.findIndex((w) => w.id === a), ib = list.findIndex((w) => w.id === b);
      [list[ia], list[ib]] = [list[ib], list[ia]];
      return saveBoard({ widgets: list }, refresh);
    }
    const act = t.dataset.act;
    if (act === 'edit') { editing = !editing; return refresh(); }
    if (act === 'filter') return filterDialog(refresh);
    if (act === 'clear-filter') return saveBoard({ products: [], failureCodes: [] }, refresh);
    if (act === 'reset-layout') return saveBoard({ widgets: DEFAULT_LAYOUT.map((w) => ({ ...w })) }, refresh);
  });
}
