// In-memory copy of the database plus the derived facts every screen needs
// (current workstream, overdue flags, linked Z3s, duplicates).

import { api } from './api.js';
import { todayIso, z5Id } from './util.js';

export const WORKSTREAMS = ['Problem', 'Containment', 'Cause', 'Solution', 'Implement', 'Monitor'];
export const Z5_STATUS = ['New', 'Investigate', 'Ongoing', 'Done', 'Aborted'];
export const Z3_STATUS = ['New', 'Worked upon', 'Closed'];

export const store = {
  user: null, // the logged-in account: { username, name, role, team }
  db: null,
  settings: null,
  z5: new Map(),
  z3: new Map(),
  z3ByZ5: new Map(),
  childrenOf: new Map(),

  async load() {
    const [db, settings] = await Promise.all([api.db(), api.settings()]);
    this.db = db;
    this.settings = settings;
    this.index();
  },

  index() {
    this.z5 = new Map(this.db.z5s.map((z) => [z.no, z]));
    this.z3 = new Map(this.db.z3s.map((z) => [z.no, z]));
    this.z3ByZ5 = new Map();
    for (const z of this.db.z3s) {
      if (z.z5 == null) continue;
      if (!this.z3ByZ5.has(z.z5)) this.z3ByZ5.set(z.z5, []);
      this.z3ByZ5.get(z.z5).push(z);
    }
    this.childrenOf = new Map();
    for (const z of this.db.z5s) {
      if (!z.parent) continue;
      if (!this.childrenOf.has(z.parent)) this.childrenOf.set(z.parent, []);
      this.childrenOf.get(z.parent).push(z);
    }
  },

  get lists() { return this.db.settings.lists; },
  get me() { return this.user?.name || ''; },
  get isAdmin() { return this.user?.role === 'admin'; },
  // Admins see every team; a user only the team they are assigned to.
  get visibleTeams() { return this.isAdmin ? this.db.teams : this.db.teams.filter((t) => t.lead === this.user?.team); },
  canSee(nav) {
    if (nav === 'board') return this.isAdmin;
    if (nav === 'teams') return this.visibleTeams.length > 0;
    return true;
  },
};

export const isOpen = (z5) => z5.status !== 'Done' && z5.status !== 'Aborted';
export const inTriage = (z5) => z5.status === 'New' || z5.status === 'Investigate';

// Everything a list row or KPI needs about one Z5, computed once per render.
export function facts(z5) {
  const t = todayIso();
  const open = isOpen(z5);
  const z3s = store.z3ByZ5.get(z5.no) || [];
  const children = store.childrenOf.get(z5.no) || [];
  const allZ3 = [...z3s, ...children.flatMap((c) => store.z3ByZ5.get(c.no) || [])];
  const currentIdx = z5.workstreams.findIndex((w) => !w.closed);
  const current = currentIdx >= 0 ? z5.workstreams[currentIdx] : null;
  const wsOverdue = open && z5.status === 'Ongoing'
    ? z5.workstreams.filter((w) => !w.closed && w.planned && w.planned < t) : [];
  const closedCount = z5.workstreams.filter((w) => w.closed).length;
  return {
    open,
    z3s,
    children,
    allZ3,
    current,
    currentIdx,
    closedCount,
    pct: Math.round((closedCount / 6) * 100),
    wsOverdue,
    followOverdue: open && !!z5.followUpDate && z5.followUpDate < t,
    availLate: open && !!z5.committedDate && z5.committedDate < t,
    noEng: open && !z5.engOwner,
    products: [...new Set(allZ3.map((z) => z.product).filter(Boolean))].sort(),
    codes: [...new Set([z5.failureCode, ...allZ3.map((z) => z.failureCode)].filter(Boolean))],
    impact: allZ3.reduce((s, z) => s + (Number(z.impact) || 0), 0),
    stage: z5.status === 'Done' ? 'Closed'
      : z5.status === 'Aborted' ? 'Aborted'
      : z5.parent ? `Duplicate → ${z5Id(z5.parent)}`
      : inTriage(z5) ? `Triage · ${z5.status.toLowerCase()}`
      : current ? current.key : 'All closed',
  };
}

// Saved views on the Z5 overview; the first five mirror the KPI tiles.
export const VIEWS = [
  { id: 'open', name: 'All open', test: (z, f) => f.open },
  { id: 'follow', name: 'Follow-up overdue', test: (z, f) => f.followOverdue },
  { id: 'avail', name: 'Past committed avail.', test: (z, f) => f.availLate },
  { id: 'ws', name: 'Workstream overdue', test: (z, f) => f.wsOverdue.length > 0 },
  { id: 'noeng', name: 'No eng. owner', test: (z, f) => f.noEng },
  { id: 'triage', name: 'Triage queue', test: (z) => inTriage(z) && !z.parent },
  { id: 'prov', name: 'Provisional', test: (z) => z.source === 'provisional' },
  { id: 'mine', name: 'My Z5s', test: (z, f) => f.open && (z.projectLead === store.me || z.engOwner === store.me) },
  { id: 'all', name: 'Everything', test: () => true },
];
