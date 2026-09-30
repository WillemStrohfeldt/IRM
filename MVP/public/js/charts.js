// Data behind the KPI board charts, computed from live Z3/Z5 records and the move-rate table.
// Every function takes the board config so the product / failure-code filters apply everywhere.

import { store, facts, isOpen, inTriage, WORKSTREAMS } from './store.js';
import { todayIso, addDays, weekCode } from './util.js';
import { weekStart } from './metrics.js';

export const board = () => store.db.settings.board;

// ---------- filters ----------

export function z3Included(z, cfg = board()) {
  return (!cfg.products.length || cfg.products.includes(z.product))
    && (!cfg.failureCodes.length || cfg.failureCodes.includes(z.failureCode));
}

// A Z5 is in scope when it has no Z3s yet, or at least one Z3 that passes the filters.
export function z5Rows(cfg = board(), { openOnly = true } = {}) {
  const filtered = cfg.products.length || cfg.failureCodes.length;
  return store.db.z5s
    .filter((z) => !openOnly || isOpen(z))
    .map((z) => ({ z, f: facts(z) }))
    .filter(({ f }) => !filtered || !f.allZ3.length || f.allZ3.some((x) => z3Included(x, cfg)));
}

export const filteredZ3s = (cfg = board()) => store.db.z3s.filter((z) => z3Included(z, cfg));

// The Z5's own (SAP) failure code, else the most common one on its Z3s.
export function dominantCode(f, z) {
  if (z?.failureCode) return z.failureCode;
  const c = {};
  for (const z of f.allZ3) c[z.failureCode] = (c[z.failureCode] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || 'No Z3s yet';
}

// ---------- KPI targets ----------

export function specState(value, target) {
  if (target == null || target === '') return { word: '', cls: '' };
  if (value <= target) return { word: 'On spec', cls: 'good' };
  if (value <= target + Math.max(1, Math.ceil(target * 0.25))) return { word: 'Watch', cls: 'watch' };
  return { word: 'Off spec', cls: 'late' };
}

// ---------- trend ----------

const GRAN = { week: { size: 1, count: 52, word: 'week' }, month: { size: 4, count: 24, word: 'month' }, quarter: { size: 13, count: 12, word: 'quarter' } };

export function trendSeries(cfg = board(), { gran = cfg.trend.gran, metric = cfg.trend.metric, norm = cfg.trend.norm } = {}) {
  const g = GRAN[gran] || GRAN.week;
  const byWeek = new Map();
  for (const z of filteredZ3s(cfg)) {
    const wk = weekStart(z.found || z.created.slice(0, 10));
    const b = byWeek.get(wk) || { n: 0, impact: 0 };
    b.n++; b.impact += Number(z.impact) || 0;
    byWeek.set(wk, b);
  }
  const parts = new Map(store.db.moveRate.map((r) => [r.week, r.parts]));
  const cur = weekStart(todayIso());
  const pts = [];
  for (let i = g.count - 1; i >= 0; i--) {
    let n = 0, impact = 0, p = 0, havePart = false;
    for (let k = 0; k < g.size; k++) {
      const wk = addDays(cur, -7 * (i * g.size + k));
      const b = byWeek.get(wk);
      if (b) { n += b.n; impact += b.impact; }
      if (parts.has(wk)) { p += parts.get(wk); havePart = true; }
    }
    const raw = metric === 'z3' ? n : metric === 'sev' ? (n ? impact / n : 0) : impact;
    const v = metric === 'sev' || norm !== 'rate' ? raw : havePart && p ? (raw / p) * 1000 : null;
    pts.push({ v, label: weekCode(addDays(cur, -7 * i * g.size)).slice(0, 4), parts: havePart ? p : null });
  }
  return { pts, word: g.word };
}

export function latestMoveRate() {
  return store.db.moveRate[store.db.moveRate.length - 1] || null;
}

// ---------- stages ----------

export function stageCounts(rows, { includeTriage = true } = {}) {
  const t = todayIso();
  const out = WORKSTREAMS.map((w) => ({ key: w, n: 0, late: 0 }));
  let triage = 0;
  for (const { z, f } of rows) {
    if (z.parent) continue;
    if (inTriage(z)) { triage++; continue; }
    if (z.status !== 'Ongoing' || !f.current) continue;
    const s = out[f.currentIdx];
    s.n++;
    if (f.current.planned && f.current.planned < t) s.late++;
  }
  return includeTriage ? [{ key: 'Triage', n: triage, late: 0 }, ...out] : out;
}

// ---------- failure code ----------

export function failureBars(cfg = board()) {
  const scope = cfg.failure.scope;
  const m = new Map();
  if (scope === 'open') {
    for (const { z, f } of z5Rows(cfg)) {
      const code = dominantCode(f, z);
      const e = m.get(code) || { code, value: 0, count: 0 };
      e.value += f.allZ3.filter((x) => z3Included(x, cfg)).reduce((a, x) => a + (Number(x.impact) || 0), 0);
      e.count++;
      m.set(code, e);
    }
  } else {
    const from = scope === '13w' ? addDays(todayIso(), -91) : scope === '52w' ? addDays(todayIso(), -364) : '';
    for (const z of filteredZ3s(cfg)) {
      if (from && (z.found || '') < from) continue;
      const e = m.get(z.failureCode) || { code: z.failureCode, value: 0, count: 0 };
      e.value += Number(z.impact) || 0;
      e.count++;
      m.set(z.failureCode, e);
    }
  }
  const all = [...m.values()].sort((a, b) => b.value - a.value);
  const max = Math.max(1, cfg.failure.max);
  if (all.length <= max) return all;
  const rest = all.slice(max - 1);
  return [...all.slice(0, max - 1), { code: 'Other', value: rest.reduce((a, e) => a + e.value, 0), count: rest.reduce((a, e) => a + e.count, 0) }];
}

// ---------- build-up ----------

export function buildup(rows, mode) {
  const top = rows.filter(({ z }) => !z.parent);
  if (mode === 'code') {
    const m = new Map();
    for (const { z, f } of top) { const c = dominantCode(f, z); m.set(c, (m.get(c) || 0) + 1); }
    const all = [...m.entries()].sort((a, b) => b[1] - a[1]);
    const cut = all.length > 6 ? [...all.slice(0, 5), ['Other', all.slice(5).reduce((a, e) => a + e[1], 0)]] : all;
    return cut.map(([label, n]) => ({ label, sub: '', n }));
  }
  const prios = store.lists.priorities.slice().reverse(); // Critical first
  return prios.map((p, i) => ({ label: `P${i + 1}`, sub: p.toLowerCase(), n: top.filter(({ z }) => z.priority === p).length }))
    .concat(top.some(({ z }) => !prios.includes(z.priority)) ? [{ label: 'P?', sub: 'no priority', n: top.filter(({ z }) => !prios.includes(z.priority)).length }] : []);
}

// ---------- top 5 ----------

export const TOP_RANGES = { w: ['Week', 7], m: ['Month', 28], q: ['Quarter', 91], y: ['Year', 364] };

export function topNew(cfg, range) {
  const days = TOP_RANGES[range]?.[1] || 28;
  const from = addDays(todayIso(), -days);
  const m = new Map();
  for (const z of filteredZ3s(cfg)) {
    if (z.z5 == null || (z.found || '') < from) continue;
    const lead = store.z5.get(z.z5)?.parent || z.z5;
    const e = m.get(lead) || { no: lead, impact: 0, n: 0, codes: {} };
    e.impact += Number(z.impact) || 0; e.n++; e.codes[z.failureCode] = (e.codes[z.failureCode] || 0) + 1;
    m.set(lead, e);
  }
  return { from, rows: [...m.values()].sort((a, b) => b.impact - a.impact).slice(0, cfg.top.n) };
}

// ---------- digest ----------

export function digest(cfg) {
  const weeks = cfg.digest.weeks;
  const cur = weekStart(todayIso());
  const from = addDays(cur, -7 * (weeks - 1));
  const all = z5Rows(cfg, { openOnly: false });
  const open = all.filter((r) => r.f.open);
  const inWin = (iso) => !!iso && iso.slice(0, 10) >= from;
  const acceptedAt = (z) => (z.log || []).find((l) => /→ Ongoing/.test(l.text))?.at;

  const updates = all.flatMap(({ z }) => z.updates.filter((u) => inWin(u.date)).map((u) => ({ ...u, z })));
  const wsClosed = all.flatMap(({ z }) => z.workstreams.filter((w) => inWin(w.closed)).map((w) => ({ ...w, z })));
  const closed = all.filter(({ z }) => z.status === 'Done' && inWin(z.closedAt));
  const accepted = all.filter(({ z }) => inWin(acceptedAt(z)));
  const silent = open.filter(({ z }) => z.status === 'Ongoing' && !z.updates.some((u) => inWin(u.date)));

  const table = Array.from({ length: weeks }, (_, i) => {
    const s = addDays(cur, -7 * (weeks - 1 - i));
    const e = addDays(s, 7);
    const within = (iso) => !!iso && iso.slice(0, 10) >= s && iso.slice(0, 10) < e;
    return {
      label: weekCode(s).slice(0, 4),
      updates: updates.filter((u) => within(u.date)).length,
      streams: wsClosed.filter((w) => within(w.closed)).length,
      closed: closed.filter(({ z }) => within(z.closedAt)).length,
      accepted: accepted.filter(({ z }) => within(acceptedAt(z))).length,
    };
  });

  // What moved: the latest event per Z5 in the window.
  const events = [];
  for (const { z, f } of all) {
    const ev = [
      ...z.workstreams.filter((w) => inWin(w.closed)).map((w) => ({ date: w.closed, tag: `${w.key} closed` })),
      ...(z.status === 'Done' && inWin(z.closedAt) ? [{ date: z.closedAt, tag: 'Z5 closed' }] : []),
      ...(inWin(acceptedAt(z)) ? [{ date: acceptedAt(z).slice(0, 10), tag: 'Accepted' }] : []),
    ].sort((a, b) => b.date.localeCompare(a.date));
    if (!ev.length) continue;
    const d30 = addDays(todayIso(), -30);
    const newImpact = f.allZ3.filter((x) => (x.found || '') >= d30).reduce((a, x) => a + (Number(x.impact) || 0), 0);
    const rec = [...z.records].sort((a, b) => b.date.localeCompare(a.date))[0];
    events.push({
      z, f, date: ev[0].date, tag: ev[0].tag, flag: ev[0].tag === 'Z5 closed' || ev[0].tag === 'Accepted',
      impact: z.status === 'Done' ? `−${f.impact}` : `+${newImpact}`,
      ws: z.status === 'Done' ? 'Closed' : f.current?.key || '—',
      wsNote: z.status === 'Done' ? 'All six workstreams closed; Z5 signed off as done.' : f.current?.entry || 'No entry yet.',
      triage: rec ? `${weekCode(rec.date)} · ${rec.text}` : '—',
    });
  }
  events.sort((a, b) => b.date.localeCompare(a.date));

  return {
    from, weeks, table,
    updates: updates.length, updatedZ5: new Set(updates.map((u) => u.z.no)).size, open: open.length,
    wsClosed: wsClosed.length,
    closed: closed.length, retired: closed.reduce((a, r) => a + r.f.impact, 0),
    accepted: accepted.length, triage: open.filter(({ z }) => inTriage(z) && !z.parent).length,
    silent: silent.length, silentCritical: silent.filter(({ z }) => z.priority === 'Critical').length,
    moved: events.slice(0, cfg.digest.moved),
  };
}
