// Team and week-based metrics shared by the Teams screen, the DRB and the KPI board.

import { store, facts } from './store.js';
import { todayIso, addDays } from './util.js';

export const ON_TIME_TARGET = 0.8;

// Monday of the ISO week containing `iso`.
export function weekStart(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() || 7) - 1));
  return d.toISOString().slice(0, 10);
}

// The last n ISO weeks, oldest first, as { start, end } (end exclusive).
export function lastWeeks(n) {
  const cur = weekStart(todayIso());
  return Array.from({ length: n }, (_, i) => {
    const start = addDays(cur, -7 * (n - 1 - i));
    return { start, end: addDays(start, 7), current: i === n - 1 };
  });
}

const inRange = (iso, a, b) => !!iso && iso >= a && iso < b;

export function teamStats(team) {
  const t = todayIso();
  const from = addDays(t, -70);
  const led = store.db.z5s.filter((z) => z.projectLead === team.lead && !z.parent);
  const committed = led.filter((z) => z.status === 'Ongoing').map((z) => ({ z, f: facts(z) }));
  const updates = led.flatMap((z) => z.updates.filter((u) => u.date >= from).map((u) => ({ ...u, z5: z.no })));
  const overdueNow = committed.filter((r) => r.f.followOverdue);
  const due = updates.length + overdueNow.length;
  const onTime = updates.filter((u) => u.onTime !== false).length;
  const wsClosed = led.flatMap((z) => z.workstreams.filter((w) => w.closed && w.closed >= from));
  const wsOnTime = wsClosed.filter((w) => !w.planned || w.closed <= w.planned).length;
  const weeks = lastWeeks(10).map((w) => ({
    ...w,
    onTime: updates.filter((u) => inRange(u.date, w.start, w.end) && u.onTime !== false).length,
    late: updates.filter((u) => inRange(u.date, w.start, w.end) && u.onTime === false).length
      + (w.current ? overdueNow.length : 0),
    pending: w.current ? committed.filter((r) => !r.f.followOverdue && inRange(r.z.followUpDate, t, w.end)).length : 0,
  }));
  const closedZ5 = led.filter((z) => z.status === 'Done' && z.closedAt >= from);
  return {
    team, led, committed, updates, overdueNow, due, onTime,
    rate: due ? onTime / due : null,
    wsClosed: wsClosed.length, wsOnTime, wsRate: wsClosed.length ? wsOnTime / wsClosed.length : null,
    pastAvail: committed.filter((r) => r.f.availLate),
    closedZ5,
    weeks,
    byStage: ['Problem', 'Containment', 'Cause', 'Solution', 'Implement', 'Monitor'].map((k) => committed.filter((r) => r.f.current?.key === k).length),
  };
}

// Eight-week strip for one Z5: what happened in each week.
export function z5Strip(z) {
  const t = todayIso();
  return lastWeeks(8).map((w) => {
    const ups = z.updates.filter((u) => inRange(u.date, w.start, w.end));
    const missed = z.updates.some((u) => u.onTime === false && inRange(u.dueWas, w.start, w.end))
      || (w.current && z.followUpDate && z.followUpDate < t);
    return {
      ...w,
      update: ups.length > 0,
      closed: z.workstreams.some((ws) => inRange(ws.closed, w.start, w.end)),
      missed,
      due: w.current && !missed && inRange(z.followUpDate, w.start, w.end),
    };
  });
}

export const pct = (r) => (r == null ? '—' : `${Math.round(r * 100)}%`);
export const rateClass = (r) => (r == null ? '' : r >= ON_TIME_TARGET ? 'good' : 'late');
