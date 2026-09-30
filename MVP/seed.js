// Demo data for the IRM MVP. Dates are relative to "today" so the KPI board
// always has something overdue, due soon and on track when the demo starts.

// Provisional Z5s (started in the app, not yet in SAP) are numbered from here, far above any SAP number.
const PROVISIONAL = 9e14;

const WORKSTREAMS = ['Problem', 'Containment', 'Cause', 'Solution', 'Implement', 'Monitor'];

const LISTS = {
  failureCodes: [
    'Overlay out of spec', 'Field position error', 'Alignment mark unreadable', 'Particle contamination',
    'CD out of spec', 'Chamber pressure excursion', 'Stage vibration', 'Edge defect', 'Focus error', 'Other',
  ],
  products: ['DRY 1.0', 'DRY 0.9', 'DRY 0.8', 'DRY 0.7', 'WET 1.0', 'WET 0.8', 'WET 2.4', 'WET 6.7'],
  productionSteps: ['Litho A', 'Litho B', 'Etch 1', 'Etch 2', 'Deposition', 'Metrology', 'Clean', 'Final test'],
  milestones: ['M0 Kit build', 'M1 Module integration', 'M2 System test', 'M3 Qualification', 'M4 Ship'],
  people: ['M. Devries', 'K. Baars', 'P. Sandu', 'A. Roth', 'J. Meijer', 'S. Oyelaran', 'J. Willems'],
  priorities: ['Low', 'Medium', 'High', 'Critical'],
};

// Demo accounts for the fake login. The admin sees everything; a user sees everything except the KPI board,
// and only the Teams page of the team they are assigned to. Passwords are demo-only and stored in plain text.
const USERS = [
  { username: 'admin', password: 'admin', name: 'R. Aalders', role: 'admin', team: '' },
  { username: 'user', password: 'user', name: 'S. Oyelaran', role: 'user', team: 'K. Baars' },
];

const TEAMS = [
  { lead: 'M. Devries', dept: 'Yield & Reliability', members: ['A. Roth', 'J. Willems'] },
  { lead: 'K. Baars', dept: 'Process Integration', members: ['S. Oyelaran', 'J. Meijer'] },
  { lead: 'P. Sandu', dept: 'Equipment & Tooling', members: ['S. Oyelaran', 'A. Roth', 'J. Meijer'] },
];

// Next Thursday (or today when it is Thursday) — the default DRB session day.
function nextThursday(from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() + ((4 - d.getDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
}

// Default KPI board layout. Every chart can be hidden, reordered and resized, and has its own options.
const BOARD = {
  widgets: [
    { id: 'kpis', show: true, size: 'full' },
    { id: 'stages', show: true, size: 'half' },
    { id: 'trend', show: true, size: 'half' },
    { id: 'failure', show: true, size: 'full' },
    { id: 'buildup', show: true, size: 'half' },
    { id: 'attention', show: true, size: 'half' },
    { id: 'top', show: true, size: 'full' },
    { id: 'followups', show: true, size: 'half' },
    { id: 'linking', show: true, size: 'half' },
    { id: 'teams', show: true, size: 'full' },
    { id: 'digest', show: true, size: 'full' },
  ],
  // Empty list = everything included.
  products: [],
  failureCodes: [],
  targets: { open: 40, follow: 0, avail: 0, noeng: 5, ws: 4 },
  trend: { gran: 'week', metric: 'impact', norm: 'abs', ma: 10 },
  failure: { scope: 'open', max: 8 },
  buildup: { mode: 'priority' },
  top: { n: 5, range: 'm' },
  digest: { weeks: 4, moved: 5 },
};

function emptyDb() {
  return {
    meta: { version: 3, nextProvisional: 1 },
    settings: { currentUser: 'M. Devries', lists: JSON.parse(JSON.stringify(LISTS)), board: JSON.parse(JSON.stringify(BOARD)), importMappings: {} },
    moveRate: [],
    imports: [],
    users: JSON.parse(JSON.stringify(USERS)),
    teams: JSON.parse(JSON.stringify(TEAMS)),
    drb: { chair: 'R. Aalders', sessions: [{ id: 's-' + nextThursday(), date: nextThursday(), closed: false, items: [] }], guidance: [], help: [] },
    z3s: [],
    z5s: [],
  };
}

// Brings databases written by an earlier MVP version up to the current shape.
function migrate(db) {
  const blank = emptyDb();
  db.teams = db.teams || blank.teams;
  db.moveRate = db.moveRate || [];
  const b = db.settings.board || {};
  db.settings.board = { ...blank.settings.board, ...b, targets: { ...BOARD.targets, ...b.targets }, trend: { ...BOARD.trend, ...b.trend },
    failure: { ...BOARD.failure, ...b.failure }, buildup: { ...BOARD.buildup, ...b.buildup }, top: { ...BOARD.top, ...b.top }, digest: { ...BOARD.digest, ...b.digest } };
  // New charts added in later versions show up at the end of an existing layout.
  const have = new Set(db.settings.board.widgets.map((w) => w.id));
  BOARD.widgets.filter((w) => !have.has(w.id)).forEach((w) => db.settings.board.widgets.push({ ...w }));
  db.settings.board.widgets = db.settings.board.widgets.filter((w) => BOARD.widgets.some((x) => x.id === w.id));
  db.drb = db.drb || blank.drb;
  for (const k of ['guidance', 'help', 'sessions']) db.drb[k] = db.drb[k] || [];
  if (!db.drb.sessions.some((s) => !s.closed)) db.drb.sessions.push(blank.drb.sessions[0]);
  for (const z of db.z5s) { z.records = z.records || []; z.updates = z.updates || []; z.log = z.log || []; z.attachments = z.attachments || []; }

  // v3: SAP ownership. Z3s and the Z5 number/name/failure code/priority come from SAP;
  // Z5s created in the app are provisional until matched to a SAP number.
  db.meta.nextProvisional = db.meta.nextProvisional || 1;
  db.settings.importMappings = db.settings.importMappings || {};
  db.imports = db.imports || [];
  db.users = db.users && db.users.length ? db.users : JSON.parse(JSON.stringify(USERS));
  // Signs the login cookie; created once per database.
  db.meta.secret = db.meta.secret || require('crypto').randomBytes(24).toString('hex');
  const codesByZ5 = new Map();
  for (const z of db.z3s) {
    z.title = z.title || [z.failureCode, z.product].filter(Boolean).join(' on ');
    z.serial = z.serial ?? '';
    z.resolved = z.resolved ?? '';
    z.z5Source = z.z5Source !== undefined ? z.z5Source : z.z5 != null ? 'sap' : null;
    z.sapStatus = z.sapStatus || 'current';
    z.attachments = z.attachments || [];
    if (z.z5 != null && z.failureCode) {
      const c = codesByZ5.get(z.z5) || {};
      c[z.failureCode] = (c[z.failureCode] || 0) + 1;
      codesByZ5.set(z.z5, c);
    }
  }
  for (const z of db.z5s) {
    z.source = z.source || (z.no >= PROVISIONAL ? 'provisional' : 'sap');
    z.sapStatus = z.sapStatus || (z.source === 'sap' ? 'current' : '');
    if (z.failureCode === undefined) z.failureCode = Object.entries(codesByZ5.get(z.no) || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  }
  delete db.meta.nextZ3; delete db.meta.nextZ5;
  db.meta.version = 3;
  return db;
}

function seedDemo() {
  const base = new Date();
  const d = (days) => { const x = new Date(base); x.setDate(x.getDate() + days); return x.toISOString().slice(0, 10); };
  const at = (days) => d(days) + 'T09:00:00.000Z';

  const db = emptyDb();

  // Admin log that walks each demo Z5 through the lifecycle up to its current status.
  const lifecycleLog = (o) => {
    const steps = [{ day: o.raised, text: 'Z5 raised', by: o.lead }];
    const path = { Investigate: ['Investigate'], Ongoing: ['Investigate', 'Ongoing'], Done: ['Investigate', 'Ongoing', 'Done'] }[o.status] || [];
    let prev = 'New';
    path.forEach((st, i) => {
      const day = st === 'Done' ? (o.closedAt?.[5] ?? -40) : o.raised + 2 + i * 3;
      steps.push({ day, text: `Status ${prev} → ${st}`, by: st === 'Ongoing' ? 'Review board' : o.lead });
      prev = st;
    });
    if (o.parent) steps.push({ day: o.raised + 1, text: `Marked duplicate of Z5-${o.parent}`, by: o.lead });
    return steps.sort((a, b) => b.day - a.day).map((x) => ({ at: at(Math.min(x.day, 0)), by: x.by, text: x.text }));
  };
  db.meta = { version: 3, nextProvisional: 1 };

  // closedUpTo: how many workstreams are closed; planned offsets per workstream (days from today)
  const z5 = (no, o) => {
    const ws = WORKSTREAMS.map((key, i) => ({
      key,
      owner: o.wsOwners?.[i] || '',
      entry: o.entries?.[i] || '',
      planned: o.planned?.[i] != null ? d(o.planned[i]) : '',
      closed: i < (o.closedUpTo || 0) ? d(o.closedAt?.[i] ?? -60 + i * 7) : '',
    }));
    return {
      no, created: at(o.raised), raised: d(o.raised), status: o.status, parent: o.parent || null,
      title: o.title, description: o.description || '', priority: o.priority || 'Medium',
      projectLead: o.lead, engOwner: o.eng || '',
      committedDate: o.avail != null ? d(o.avail) : '', followUpDate: o.follow != null ? d(o.follow) : '',
      workstreams: ws, updates: (o.updates || []).map(({ day, ...u }, i) => ({ id: `seed-${no}-${i}`, date: d(day), at: at(day), ...u })),
      attachments: [], records: [], log: lifecycleLog(o),
      closedAt: o.status === 'Done' ? d(o.closedAt?.[5] ?? -40) : '',
    };
  };

  db.z5s = [
    z5(118, {
      title: 'Overlay drift, litho cell B', status: 'Ongoing', priority: 'High', lead: 'M. Devries', eng: '',
      raised: -38, avail: 55, follow: -3, closedUpTo: 2, closedAt: [-35, -25], planned: [-35, -26, -4, 25, 50, 80],
      wsOwners: ['M. Devries', 'A. Roth', '', '', '', ''],
      description: 'Overlay X-drift beyond 3 nm at the same field position, across dry and wet products, one production step (Litho B).',
      entries: [
        '14 Z3s bucketed on failure code Overlay out of spec; overlay X-drift beyond 3 nm at the same field position.',
        'Cell B held for DRY 0.7. 100% overlay metrology on affected lots; rework path agreed with production.',
        'DOE running on the cell B reticle stage. Working hypothesis is reticle heating.',
      ],
      updates: [
        { day: -10, ws: 'Cause', type: 'Deep dive', author: 'A. Roth', text: 'DOE on the cell B reticle stage completed for the first two legs. Overlay X-drift tracks reticle dwell time almost linearly above 40 seconds, consistent with reticle heating rather than a stage calibration fault.\n\nRuled out: stage calibration drift, chuck flatness, and the reticle swap itself.\n\nNext: leg three with the compensation model enabled, on DRY 0.7 first. Blocking issue: no engineering owner assigned.' },
        { day: -25, ws: 'Containment', type: 'Closure', author: 'A. Roth', text: 'Containment closed. Cell B held for DRY 0.7, 100% overlay metrology in place on affected lots, rework path signed off with production.' },
      ],
    }),
    z5(104, {
      title: 'Edge-die particle cluster', status: 'Ongoing', priority: 'Critical', lead: 'K. Baars', eng: 'J. Meijer',
      raised: -70, avail: -4, follow: -1, closedUpTo: 3, closedAt: [-66, -55, -30], planned: [-66, -56, -32, -4, 20, 50],
      wsOwners: ['K. Baars', 'J. Meijer', 'J. Meijer', 'J. Meijer', 'S. Oyelaran', 'K. Baars'],
      description: 'Particle clusters on the outer ring of dies after the clean step on the wet family. Yield hit concentrated on WET 1.0 and WET 0.8.',
      entries: [
        '9 Z3s on Particle contamination, all after Clean, all on the outer 8 mm of the wafer. Problem statement signed off by the review board.',
        'Affected lots get an extra edge inspection before release; WET 0.8 lots rerouted to clean tool 2. Scrap rate back to baseline.',
        'Root cause: worn edge-bead nozzle on clean tool 1 sprays back onto the wafer edge. Confirmed by nozzle swap test on 12 lots.',
        'Nozzle replacement plus a 500-wafer PM interval proposed. Waiting for the supplier to confirm lead time for the new nozzle type.',
      ],
    }),
    z5(131, {
      title: 'CD loss after recipe change', status: 'Ongoing', priority: 'High', lead: 'M. Devries', eng: 'A. Roth',
      raised: -20, avail: 70, follow: -2, closedUpTo: 1, closedAt: [-16], planned: [-16, -2, 20, 40, 60, 90],
      wsOwners: ['M. Devries', 'A. Roth', 'A. Roth', '', '', ''],
      description: 'Critical dimension 4–6 nm below target on DRY 0.7 since the etch recipe update of week 36.',
      entries: [
        'CD loss on 5 lots, all etched with recipe v4.2 on Etch 1. Earlier recipe v4.1 lots are clean.',
        'Recipe rolled back to v4.1 on Etch 1; v4.2 lots on hold pending measurement. Two lots released after re-measurement, three still held.',
        'Comparing endpoint traces of v4.1 and v4.2; the over-etch step changed from 8 s to 12 s.',
      ],
    }),
    z5(126, {
      title: 'Stage vibration, cell B', status: 'Ongoing', lead: 'K. Baars', eng: 'S. Oyelaran',
      raised: -30, avail: 80, follow: 5, closedUpTo: 2, closedAt: [-27, -18], planned: [-27, -18, 12, 35, 60, 90],
      wsOwners: ['K. Baars', 'S. Oyelaran', 'S. Oyelaran', 'J. Meijer', '', ''],
      description: 'Vibration alarms on litho cell B during exposure, amplitude up to 7 nm peak. Correlates with the new chiller installed next to the cell.',
      entries: [
        '6 Z3s with stage vibration alarms on cell B, all during day shift. Amplitude 5–7 nm peak, spec is 3 nm.',
        'Exposure on cell B paused during chiller start-up; production planning moved critical layers to cell A.',
        'Accelerometers mounted on the stage frame and the chiller base. First data shows a 43 Hz peak that matches the chiller compressor.',
      ],
    }),
    z5(145, { title: 'Chamber pressure excursion', status: 'Investigate', lead: 'K. Baars', eng: '', raised: -6, follow: 4, priority: 'Low',
      description: 'Pressure spikes of 8–12 % above setpoint for about 40 s during Etch 2 on WET 0.8.', wsOwners: ['K. Baars'],
      entries: ['2 Z3s so far. Checking whether this is one structural issue or two separate tool events before accepting.'],
      updates: [{ day: -3, ws: 'Problem', type: 'Progress', author: 'K. Baars', text: 'Pulled the chamber logs for both events. Both spikes happen right after a chamber clean, so this looks structural. Proposing to accept at the next DRB.' }] }),
    z5(151, { title: 'Overlay drift, cell B (second team)', status: 'New', lead: 'M. Devries', eng: '', raised: -4, parent: 118, follow: 7 }),
    z5(158, { title: 'Field-position overlay error, wet', status: 'New', lead: 'P. Sandu', eng: '', raised: -2, parent: 118, follow: 9 }),
    z5(160, { title: 'Litho B field-position defect', status: 'Investigate', lead: 'P. Sandu', eng: 'S. Oyelaran', raised: -9, follow: 2,
      description: 'Field position offset in Y near the wafer edge on WET 1.0, Litho B.', wsOwners: ['S. Oyelaran'],
      entries: ['Checking overlap with Z5-118 (overlay drift, same cell). Different signature so far: Y instead of X, edge instead of field 14.'],
      updates: [{ day: -5, ws: 'Problem', type: 'Progress', author: 'S. Oyelaran', text: 'Compared the two signatures with M. Devries. Offset direction and location differ from Z5-118, so we keep this separate for now.\n\nNext: overlay maps of the next three WET 1.0 lots to confirm.' }] }),
    z5(163, { title: 'Overlay error after reticle swap', status: 'New', lead: 'M. Devries', eng: '', raised: -1, follow: 6,
      description: 'Overlay error on DRY 0.7 right after the reticle swap on cell B.' }),
    z5(97, {
      title: 'Wafer-edge defect recurrence', status: 'Ongoing', lead: 'P. Sandu', eng: 'P. Sandu', raised: -120,
      avail: -20, follow: 10, closedUpTo: 5, closedAt: [-115, -100, -80, -50, -22], planned: [-115, -100, -80, -50, -22, 30],
      priority: 'Medium', wsOwners: ['P. Sandu', 'P. Sandu', 'J. Meijer', 'J. Meijer', 'A. Roth', 'P. Sandu'],
      description: 'Edge defects on DRY 1.0 at the same radius, recurring after each chuck exchange.',
      entries: [
        '21 Z3s since the start of the quarter, same radius (147 mm), always within two weeks of a chuck exchange.',
        'Edge exclusion widened by 1 mm on DRY 1.0 as a temporary measure; yield loss accepted by product management.',
        'Chuck exchange procedure leaves a burr on the chuck edge pin. Confirmed on three exchanged chucks.',
        'New deburring step added to the chuck exchange procedure; torque spec on the edge pins tightened.',
        'Procedure rolled out on all DRY 1.0 cells; technicians trained. Last exchange done with the new procedure.',
        'Four clean weeks required before closure. Two clean weeks so far, next chuck exchange planned in week 43.',
      ],
    }),
    z5(88, {
      title: 'Reticle stage calibration', status: 'Done', lead: 'A. Roth', eng: 'A. Roth', raised: -160,
      avail: -40, follow: null, closedUpTo: 6, closedAt: [-155, -140, -110, -80, -60, -40], planned: [-155, -140, -110, -80, -60, -40],
      wsOwners: ['A. Roth', 'A. Roth', 'A. Roth', 'A. Roth', 'J. Willems', 'A. Roth'],
      description: 'Reticle stage calibration drifted between services, throwing overlay on DRY 1.0 and WET 6.7.',
      entries: [
        'Alignment marks unreadable on 5 lots across two products, all shortly before a planned service.',
        'Calibration check added to every shift start until the cause is known.',
        'Calibration file overwritten by an old backup during the service tool restore.',
        'Service procedure changed: calibration file is versioned and verified after every restore.',
        'Procedure change released and applied on all litho cells.',
        'Four services done with the new procedure, no drift. Signed off as done by the review board.',
      ],
    }),
  ];

  for (const c of db.z5s.filter((z) => z.parent)) {
    const p = db.z5s.find((z) => z.no === c.parent);
    p.log.unshift({ at: c.log.find((l) => /Marked duplicate/.test(l.text)).at, by: c.projectLead, text: `Z5-${c.no} linked as duplicate` });
    p.log.sort((a, b) => b.at.localeCompare(a.at));
  }

  const texts = {
    'Overlay out of spec': 'Overlay X measured {v} nm at field 14 on lot {lot}, beyond the 3 nm limit. Repeat measurement confirmed. Lot put on hold at Litho B.',
    'Field position error': 'Field position error flagged by metrology on lot {lot}; offset {v} nm in Y concentrated near the wafer edge.',
    'Particle contamination': 'Particle cluster on edge dies, {v} counts above baseline on lot {lot}. Inspection images attached to the lot record.',
    'CD out of spec': 'Critical dimension {v} nm below target after the recipe change on lot {lot}.',
    'Chamber pressure excursion': 'Chamber pressure spiked {v}% above setpoint for 40 s during the etch step on lot {lot}.',
    'Stage vibration': 'Stage vibration alarm on cell B, amplitude {v} nm peak, during exposure of lot {lot}.',
    'Edge defect': 'Recurring edge defect on lot {lot}; {v} affected dies per wafer.',
    'Alignment mark unreadable': 'Alignment mark unreadable on {v} wafers of lot {lot}; manual alignment needed.',
  };
  const resolutions = [
    'Lot reworked and re-exposed; overlay back in spec after rework.',
    'Wafers scrapped, root cause handed over to the linked Z5.',
    'Recipe rolled back on the tool; next lot measured in spec.',
    '',
  ];
  const plan = [
    [118, 'Overlay out of spec', ['DRY 1.0', 'DRY 0.7', 'WET 1.0'], 'Litho B', 11],
    [104, 'Particle contamination', ['WET 1.0', 'WET 0.8'], 'Clean', 9],
    [131, 'CD out of spec', ['DRY 0.7'], 'Etch 1', 5],
    [126, 'Stage vibration', ['DRY 0.7'], 'Litho B', 6],
    [145, 'Chamber pressure excursion', ['WET 0.8'], 'Etch 2', 2],
    [151, 'Overlay out of spec', ['DRY 1.0'], 'Litho B', 2],
    [158, 'Field position error', ['WET 1.0'], 'Litho B', 1],
    [160, 'Field position error', ['WET 1.0'], 'Litho B', 2],
    [163, 'Overlay out of spec', ['DRY 0.7'], 'Litho B', 3],
    [97, 'Edge defect', ['DRY 1.0'], 'Final test', 7],
    [88, 'Alignment mark unreadable', ['DRY 1.0', 'WET 6.7'], 'Litho A', 5],
    [null, 'Overlay out of spec', ['DRY 0.7', 'DRY 0.8'], 'Litho B', 4],
    [null, 'Field position error', ['WET 1.0', 'WET 2.4'], 'Litho B', 3],
    [null, 'Particle contamination', ['WET 0.8'], 'Clean', 3],
    [null, 'Focus error', ['DRY 0.9'], 'Litho A', 2],
    [null, 'Chamber pressure excursion', ['WET 2.4'], 'Etch 2', 2],
  ];
  let no = 24400;
  let seq = 0;
  for (const [z5no, code, products, step, count] of plan) {
    for (let i = 0; i < count; i++) {
      seq++;
      const product = products[i % products.length];
      const z5rec = db.z5s.find((z) => z.no === z5no);
      const closed = z5rec && (z5rec.status === 'Done' || i % 3 === 0);
      const found = -(((seq * 17) % 41) + 1); // spread evenly over the last six weeks
      const tmpl = texts[code] || 'Issue observed on lot {lot}, value {v}.';
      db.z3s.push({
        no: no++, created: at(found), found: d(found), product, failureCode: code,
        impact: ((seq * 7) % 13) + 1,
        productionStep: step,
        milestone: LISTS.milestones[seq % LISTS.milestones.length],
        operatorText: tmpl.replace('{v}', String(3 + (seq % 5) + 0.4)).replace('{lot}', String(24500 + seq * 3)),
        resolutionText: closed ? resolutions[seq % 3] : (i % 2 ? resolutions[3] : 'Lot on hold pending engineering disposition.'),
        status: closed ? 'Closed' : i % 2 ? 'New' : 'Worked upon',
        z5: z5no, reporter: LISTS.people[(seq + 3) % LISTS.people.length], attachments: [],
      });
    }
  }
  // Update history: a weekly rhythm per accepted Z5 over the last 10 weeks, some late, so the
  // Teams on-time rates and the 10-week charts have something to show.
  const authors = { 118: 'M. Devries', 104: 'J. Meijer', 131: 'A. Roth', 126: 'S. Oyelaran', 97: 'P. Sandu', 88: 'A. Roth' };
  // What each Z5's weekly notes say, per workstream; cycled through in order.
  const STORY = {
    118: {
      Problem: ['Bucketed the first 8 Z3s on overlay out of spec. Common signature: X-drift at field 14, Litho B only.'],
      Containment: ['100% overlay metrology started on all Litho B lots. Rework rate 6 %, about 4 hours per lot.', 'Cell B released for DRY 1.0 again; DRY 0.7 stays on hold until the cause is known.'],
      Cause: ['DOE plan agreed: dwell time as main factor, field position as blocking factor. Slot on cell B booked.', 'Leg one done. Drift grows with reticle dwell time above 40 s.', 'Still waiting on the metrology engineer for leg three. No engineering owner yet, which is now the bottleneck.'],
    },
    104: {
      Problem: ['Nine Z3s bucketed; all outer ring, all after Clean. Problem statement drafted.'],
      Containment: ['Extra edge inspection live on all wet lots. First week: 2 lots caught, 0 escapes.', 'WET 0.8 rerouted to clean tool 2; capacity impact acceptable for four weeks.'],
      Cause: ['Nozzle inspection on clean tool 1 shows wear on the edge-bead nozzle.', 'Swap test on 12 lots: new nozzle, no particles. Cause confirmed.'],
      Solution: ['Supplier quoted six weeks for the new nozzle type. Asked for an expedite.', 'Expedite refused; looking at a second supplier. Solution close will slip past the committed date.', 'Second supplier can deliver in three weeks. Committed availability needs to move; will raise at DRB.'],
    },
    131: {
      Problem: ['CD loss confirmed on five lots, all recipe v4.2. Problem statement agreed with process integration.'],
      Containment: ['Recipe v4.1 back on Etch 1. Three v4.2 lots still on hold for re-measurement.', 'Two lots released after re-measurement. Last held lot waits for the SEM slot.'],
    },
    126: {
      Problem: ['Six vibration alarms, all day shift. Amplitude 5–7 nm peak against a 3 nm spec.'],
      Containment: ['Critical layers moved to cell A; cell B only runs non-critical layers during chiller start-up.'],
      Cause: ['Accelerometers installed on the stage frame and the chiller base.', 'First week of data: 43 Hz peak that matches the chiller compressor. Facilities asked for damping mounts.'],
    },
    97: {
      Problem: ['21 Z3s bucketed; same radius, always shortly after a chuck exchange.'],
      Containment: ['Edge exclusion widened by 1 mm on DRY 1.0. Yield loss about 0.8 %, accepted.'],
      Cause: ['Burr found on the chuck edge pin after exchange. Seen on three chucks.'],
      Solution: ['Deburring step and tighter torque spec written into the exchange procedure.'],
      Implement: ['Procedure rolled out; 14 technicians trained. First exchange with the new procedure done.'],
      Monitor: ['Week one of four: no edge defects after the last exchange.', 'Week two of four: still clean. Next exchange planned for week 43 will be the real test.'],
    },
    88: {
      Cause: ['Found the root cause: the calibration file was overwritten by an old backup during the service restore.'],
      Solution: ['Calibration file now versioned; verification step added after every restore.'],
      Implement: ['Procedure change applied on all litho cells.'],
      Monitor: ['Monitoring: services one to four done with the new procedure, no drift.'],
    },
  };
  const COMMENTERS = { 118: ['K. Baars', 'P. Sandu', 'R. Aalders'], 104: ['K. Baars', 'S. Oyelaran', 'R. Aalders'], 131: ['M. Devries', 'J. Willems'], 126: ['K. Baars', 'J. Meijer'], 97: ['P. Sandu', 'R. Aalders'], 88: ['R. Aalders'] };
  const REPLIES = [
    'Thanks, clear. Can you add the measurement file to the note?',
    'Production can live with this until the end of the month, not longer.',
    'Please bring this to the next DRB so we can decide on the capacity.',
    'Same signature seen on WET 1.0 last quarter; worth checking the old Z5.',
    'Agreed. I will update the committed date once the supplier confirms.',
  ];
  const QUIET = ['No change since the last update; {ws} work continues as planned.', 'Measurements still running; nothing new on {ws} this week.', 'Waiting on data; {ws} plan unchanged.'];
  const lateEvery = { 118: 2, 104: 3, 131: 4, 126: 5, 97: 3, 88: 6 };
  for (const z of db.z5s) {
    if (!authors[z.no]) continue;
    const start = Math.max(-70, daysAgo(z.raised, base) + 3);
    const end = z.status === 'Done' ? -40 : -4;
    let k = 0;
    for (let due = start; due <= end; due += 7, k++) {
      if (z.updates.some((u) => Math.abs(daysAgo(u.date, base) - due) < 3)) continue;
      const late = k % lateEvery[z.no] === lateEvery[z.no] - 1;
      const posted = late ? due + 3 : due - 1;
      const w = z.workstreams.find((x) => !x.closed || x.closed >= d(posted));
      const ws = w?.key || 'Monitor';
      const u = {
        id: `seed-${z.no}-h${k}`, date: d(posted), at: at(posted), ws, author: authors[z.no],
        type: 'Progress', text: '',
        dueWas: d(due), onTime: !late, comments: [],
      };
      // Some notes get a reaction from the team or the review board.
      if ((k + z.no) % 3 === 0) {
        const who = COMMENTERS[z.no];
        u.comments.push({ id: `c-${z.no}-${k}-1`, author: who[k % who.length], at: `${d(posted + 1)}T10:15:00.000Z`, text: REPLIES[(k + z.no) % REPLIES.length] });
        if (k % 2 === 0) u.comments.push({ id: `c-${z.no}-${k}-2`, author: authors[z.no], at: `${d(posted + 1)}T14:40:00.000Z`, text: 'Will do — added to the next update.' });
      }
      z.updates.push(u);
    }
    // Tell each workstream's story in order: the newest notes get the last lines of the story,
    // older weeks without news get a short "no change" note.
    const byWs = {};
    z.updates.filter((u) => u.text === '').sort((a, b) => a.date.localeCompare(b.date)).forEach((u) => (byWs[u.ws] = byWs[u.ws] || []).push(u));
    for (const [ws, list] of Object.entries(byWs)) {
      const lines = STORY[z.no]?.[ws] || [`Work on ${ws.toLowerCase()} continues to plan.`];
      const offset = list.length - lines.length;
      // The last note of a closed workstream is its closure, unless the seed already has one.
      const closed = z.workstreams.find((x) => x.key === ws)?.closed;
      const hasClosure = z.updates.some((u) => u.ws === ws && u.type === 'Closure' && u.text);
      list.forEach((u, i) => {
        const closing = closed && !hasClosure && i === list.length - 1;
        const line = i >= offset ? lines[i - offset] : QUIET[(i + z.no) % QUIET.length].replace('{ws}', ws.toLowerCase());
        u.text = line + (closing ? `\n\n${ws} closed.` : '');
        u.type = closing ? 'Closure' : i >= offset && line.length > 90 ? 'Deep dive' : 'Progress';
      });
    }
    z.updates.forEach((u) => { if (u.onTime === undefined) { u.dueWas = u.date; u.onTime = true; } u.comments = u.comments || []; });
    z.updates.sort((a, b) => b.date.localeCompare(a.date));
  }

  // Minutes recorded against Z5s, outside the working notes.
  const rec = (no, day, type, ws, author, text) => db.z5s.find((z) => z.no === no).records.push({ id: `r-${no}-${day}`, date: d(day), type, ws, author, text });
  rec(118, -36, 'Triage decision', 'Problem', 'Review board', 'Accepted to work on. M. Devries named project lead; engineering owner left open pending capacity.');
  rec(118, -21, 'DRB review', 'Cause', 'R. Aalders', 'Seen at DRB, no update given. Leg three waiting on the FTE request.');
  rec(118, -14, 'Help request', 'Cause', 'M. Devries', '1 FTE metrology engineer for six weeks to run DOE legs three and four.');
  rec(104, -7, 'DRB review', 'Solution', 'R. Aalders', 'Guidance: split containment per product. Update still outstanding.');
  rec(131, -7, 'DRB review', 'Containment', 'R. Aalders', 'Accepted etch recipe rollback.');
  rec(145, -6, 'Triage decision', 'Problem', 'K. Baars', 'Opened as new; checked against Z5-104, distinct mechanism.');

  // DRB: last week's closed session, this week's open one, guidance and help requests.
  const thisSession = nextThursday(base);
  const lastSession = d(daysAgo(thisSession, base) - 7);
  db.drb.sessions = [
    { id: 's-' + lastSession, date: lastSession, closed: true, items: [
      { z5: 104, note: 'Guidance: split containment per product. Update still outstanding.', by: 'R. Aalders', at: lastSession + 'T10:00:00.000Z' },
      { z5: 131, note: 'Accepted etch recipe rollback. Closed containment.', by: 'R. Aalders', at: lastSession + 'T10:10:00.000Z' },
      { z5: 97, note: 'Monitor extended by 4 weeks.', by: 'R. Aalders', at: lastSession + 'T10:20:00.000Z' },
      { z5: 126, note: 'Asked for a DOE plan by the next session.', by: 'R. Aalders', at: lastSession + 'T10:30:00.000Z' },
    ] },
    { id: 's-' + thisSession, date: thisSession, closed: false, items: [] },
  ];
  db.drb.guidance = [
    { id: 'g1', z5: 118, owner: 'M. Devries', due: d(2), text: 'Assign an engineering owner before the next session; project lead carries DOE leg three in the meantime.', done: false, at: at(-7) },
    { id: 'g2', z5: 145, owner: 'K. Baars', due: thisSession, text: 'Triage to conclude this session. If accepted, commit an availability date at the same time.', done: false, at: at(-7) },
    { id: 'g3', z5: 104, owner: 'J. Meijer', due: d(6), text: 'Split containment per product so the wet family is not held by the dry investigation.', done: false, at: at(-7) },
    { id: 'g4', z5: 126, owner: 'S. Oyelaran', due: thisSession, text: 'Bring a written DOE plan with slot booking, not a verbal update.', done: false, at: at(-7) },
  ];
  db.drb.help = [
    { id: 'h1', z5: 118, type: 'FTE', text: '1 FTE metrology engineer for six weeks to run DOE legs three and four.', status: 'Decision needed', by: 'M. Devries', at: at(-14) },
    { id: 'h2', z5: 104, type: 'FTE', text: '0.5 FTE for wet-family containment so the dry investigation is not blocking.', status: 'Decision needed', by: 'K. Baars', at: at(-9) },
    { id: 'h3', z5: 126, type: 'Tool time', text: 'Two cell B slots per week for vibration measurement.', status: 'Approved', by: 'K. Baars', at: at(-12), decided: d(-7) },
    { id: 'h4', z5: 160, type: 'External', text: 'Supplier analysis of the reticle batch.', status: 'Awaiting quote', by: 'P. Sandu', at: at(-5) },
  ];
  addHistory(db, base, d, at);
  migrate(db);

  // SAP-style fields on the demo Z3s: a short name and a serial number per machine.
  for (const z of db.z3s) {
    // Closed Z3s carry the SAP resolution date, a few days after they were created.
    if (z.status === 'Closed' && !z.resolved) {
      const r = new Date(z.found + 'T12:00:00Z'); r.setUTCDate(r.getUTCDate() + 2 + (z.no % 9));
      z.resolved = r.toISOString().slice(0, 10) > d(0) ? d(0) : r.toISOString().slice(0, 10);
    }
    z.title = `${z.failureCode}${z.productionStep ? `, ${z.productionStep}` : ''}`;
    z.serial = `${z.product.replace(/\s|\./g, '')}-${String(1000 + ((z.no * 37) % 900))}`;
  }
  // One provisional Z5, started in the app before SAP has a number for it, with two Z3s linked in the app.
  const prov = {
    no: PROVISIONAL + 1, source: 'provisional', sapStatus: '', title: 'Chuck scratches after clean', failureCode: 'Particle contamination', priority: 'High',
    status: 'Investigate', parent: null, projectLead: 'K. Baars', engOwner: 'J. Meijer', raised: d(-3), committedDate: '', followUpDate: d(4), closedAt: '',
    description: 'Scratch marks on the backside after the clean step; raised in the app while the SAP Z5 is being created.', created: at(-3),
    workstreams: WORKSTREAMS.map((k, i) => ({ key: k, owner: i === 0 ? 'J. Meijer' : '', entry: i === 0 ? 'Scratches on 2 lots so far, backside only, all after the clean step on tool 1.' : '', planned: i === 0 ? d(5) : '', closed: '' })),
    updates: [{
      id: 'seed-prov-1', date: d(-1), at: at(-1), ws: 'Problem', type: 'Progress', author: 'J. Meijer', dueWas: d(4), onTime: true,
      text: 'Started as provisional so we can work on it while SAP creates the Z5. Backside inspection added for the next five lots on clean tool 1.',
      comments: [{ id: 'c-prov-1', author: 'K. Baars', at: `${d(-1)}T15:20:00.000Z`, text: 'SAP number requested; I will match it as soon as it comes in.' }],
    }],
    records: [], attachments: [],
    log: [{ at: at(-2), by: 'K. Baars', text: 'Status New → Investigate' }, { at: at(-3), by: 'K. Baars', text: 'Provisional Z5 started in the app' }],
  };
  db.z5s.push(prov);
  db.meta.nextProvisional = 2;
  db.z3s.filter((z) => z.z5 == null && z.failureCode === 'Particle contamination').slice(0, 2).forEach((z) => { z.z5 = prov.no; z.z5Source = 'app'; });
  return db;
}

// Two years of weekly history for the trend charts: parts moved per week (move rate) and closed Z3s
// bucketed into closed historical Z5s. Volume swings hard; the defect rate drifts slowly upward.
function addHistory(db, base, d, at) {
  const monday = (iso) => { const x = new Date(iso + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() || 7) - 1)); return x.toISOString().slice(0, 10); };
  const thisWeek = monday(d(0));
  const weekOf = (k) => { const x = new Date(thisWeek + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - 7 * k); return x.toISOString().slice(0, 10); };
  const WEEKS = 104;
  db.moveRate = [];
  for (let k = WEEKS - 1; k >= 0; k--) {
    const i = WEEKS - 1 - k;
    const parts = Math.max(340, Math.round(2000 + Math.sin(i * 0.42) * 560 + Math.sin(i * 0.13) * 340 + Math.sin(i * 1.9) * 210 + (i % 13 === 0 ? -650 : 0)));
    db.moveRate.push({ week: weekOf(k), parts });
  }

  const codes = LISTS.failureCodes.slice(0, 9);
  const hist = codes.map((code, i) => ({
    no: 40 + i * 5, code, product: LISTS.products[i % LISTS.products.length], step: LISTS.productionSteps[i % LISTS.productionSteps.length],
  }));
  const people = LISTS.people;
  for (const h of hist) {
    const raised = -700 + (h.no % 7) * 20;
    const done = -90 - (h.no % 11) * 12;
    db.z5s.push({
      no: h.no, created: at(raised), raised: d(raised), status: 'Done', parent: null,
      title: `${h.code}, ${h.step} (historical)`, description: `Closed structural issue on ${h.code.toLowerCase()} at ${h.step}.`,
      priority: ['Medium', 'High', 'Low'][h.no % 3], projectLead: people[h.no % 3], engOwner: people[3 + (h.no % 3)],
      committedDate: d(done + 10), followUpDate: '', closedAt: d(done),
      workstreams: WORKSTREAMS.map((key, i) => ({ key, owner: '', entry: '', planned: d(raised + 30 + i * 90), closed: d(Math.min(done, raised + 30 + i * 90)) })),
      updates: [], records: [], attachments: [],
      log: [{ at: at(done), by: people[h.no % 3], text: 'Status Ongoing → Done' }, { at: at(raised + 4), by: 'Review board', text: 'Status Investigate → Ongoing' }, { at: at(raised), by: people[h.no % 3], text: 'Z5 raised' }],
    });
  }

  // Z3s: about 0.5% of parts moved raise a Z3 (scaled down for the demo); impact is rework time and varies.
  let no = 23000;
  let seq = 0;
  for (let k = WEEKS - 1; k >= 7; k--) {
    const i = WEEKS - 1 - k;
    const t = i / WEEKS;
    const parts = db.moveRate[i].parts;
    const count = Math.max(1, Math.round(parts * (0.0042 + t * 0.0018)));
    for (let n = 0; n < count; n++) {
      seq++;
      const h = hist[(seq * 7 + (seq % 5)) % hist.length];
      const heavy = seq % 17 === 0 ? 6 : 0;
      const found = -(k * 7) + (n % 5);
      db.z3s.push({
        no: no++, created: at(found), found: d(found), product: LISTS.products[(seq + h.no) % LISTS.products.length], failureCode: h.code,
        impact: Math.max(1, Math.round(4 + t * 3 + Math.sin(seq * 0.7) * 3 + heavy)),
        productionStep: h.step, milestone: LISTS.milestones[seq % LISTS.milestones.length],
        operatorText: `${h.code} observed on lot ${20000 + seq}.`, resolutionText: 'Reworked and released.',
        status: 'Closed', z5: h.no, reporter: people[seq % people.length], attachments: [],
      });
    }
  }
  db.z3s.sort((a, b) => a.no - b.no);
}

function daysAgo(iso, base) {
  return Math.round((new Date(iso + 'T12:00:00Z') - new Date(base.toISOString().slice(0, 10) + 'T12:00:00Z')) / 86400000);
}

module.exports = { seedDemo, emptyDb, migrate, nextThursday, WORKSTREAMS, LISTS, BOARD, PROVISIONAL, USERS };
