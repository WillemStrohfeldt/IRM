// SAP import. SAP is master for Z3s and for the Z5 number/name/failure code/priority; the app owns all
// work-package data. An import therefore only ever writes SAP-owned fields, never app-owned ones.
//
// SAP exports cover a period (typically the last month), so every import is appended to the database:
// new numbers are added, numbers already known get SAP's latest values, and nothing is ever removed.
// Re-importing the same file, or overlapping periods, is harmless.
//
// Flow: analyse() → preview (nothing written) → apply(). Column mapping is detected from header names,
// can be adjusted in the UI, and is remembered per kind in settings.importMappings.

const crypto = require('crypto');
const csv = require('./csv');

const FIELDS = {
  z5: [
    { key: 'no', label: 'Z5 number', required: true, type: 'number', aliases: ['z5 number', 'z5 no', 'z5nr', 'z5', 'number', 'notification', 'notification number', 'notif', 'qmnum', 'meldung'] },
    { key: 'title', label: 'Z5 name', required: true, aliases: ['z5 name', 'name', 'title', 'short text', 'description', 'qmtxt', 'kurztext'] },
    { key: 'failureCode', label: 'Failure code', aliases: ['failure code', 'code', 'coding', 'category', 'failure', 'code group', 'fecod', 'qmcod'] },
    { key: 'priority', label: 'Priority', aliases: ['priority', 'prio', 'priok', 'prioritaet'] },
  ],
  // Dates before texts, so "Resolution date" is not taken for the resolution text.
  z3: [
    { key: 'no', label: 'Z3 number', required: true, type: 'number', aliases: ['z3 number', 'z3 no', 'z3nr', 'z3', 'number', 'notification', 'notification number', 'qmnum', 'meldung'] },
    { key: 'title', label: 'Z3 name', aliases: ['z3 name', 'name', 'title', 'short text', 'description', 'qmtxt', 'kurztext'] },
    { key: 'failureCode', label: 'Failure code', aliases: ['failure code', 'code', 'coding', 'category', 'failure', 'fecod', 'qmcod'] },
    { key: 'product', label: 'Product type', aliases: ['product type', 'product', 'material', 'type', 'matnr'] },
    { key: 'serial', label: 'Product serial number', aliases: ['product serial number', 'serial number', 'serial', 'serial no', 'sernr', 'machine'] },
    { key: 'impact', label: 'Impact', type: 'decimal', aliases: ['impact', 'impact score', 'hours', 'rework', 'rework hours'] },
    { key: 'found', label: 'Created on', type: 'date', aliases: ['created on', 'creation date', 'created', 'notification date', 'erdat', 'qmdat'] },
    { key: 'resolved', label: 'Resolved on', type: 'date', aliases: ['resolved on', 'resolution date', 'resolved', 'completed on', 'completion date', 'closed on', 'qmdab'] },
    { key: 'productionStep', label: 'Production step', aliases: ['production step', 'step', 'operation', 'process step', 'work center', 'arbpl'] },
    { key: 'milestone', label: 'Milestone', aliases: ['milestone', 'phase', 'build phase'] },
    { key: 'operatorText', label: 'Long text', aliases: ['long text', 'longtext', 'operator text', 'text', 'details', 'ltxt'] },
    { key: 'resolutionText', label: 'Resolution text', aliases: ['resolution text', 'resolution', 'solution', 'corrective action', 'action taken'] },
    { key: 'z5', label: 'Z5 number', type: 'number', aliases: ['z5 number', 'z5 no', 'z5', 'parent', 'parent notification', 'reference', 'z5 reference'] },
  ],
};

// Fields SAP owns — the only ones an import may change, and the ones the app shows read-only.
const SAP_OWNED = {
  z5: ['title', 'failureCode', 'priority'],
  z3: ['title', 'failureCode', 'product', 'serial', 'impact', 'found', 'resolved', 'productionStep', 'milestone', 'operatorText', 'resolutionText'],
};

// Vocabulary lists that grow with the values SAP brings.
const VOCAB = { failureCode: 'failureCodes', product: 'products', priority: 'priorities', productionStep: 'productionSteps', milestone: 'milestones' };

const PROVISIONAL = 9e14;

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// Same content = same hash, whatever the line endings or trailing blank lines.
const fileHash = (text) => crypto.createHash('sha256').update(String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trimEnd()).digest('hex').slice(0, 16);

function detectMapping(kind, headers, saved = {}) {
  const map = {};
  const used = new Set();
  for (const f of FIELDS[kind]) {
    if (saved[f.key] && headers.includes(saved[f.key])) { map[f.key] = saved[f.key]; used.add(saved[f.key]); }
  }
  for (const f of FIELDS[kind]) {
    if (map[f.key]) continue;
    const want = f.aliases.map(norm);
    const hit = want.map((a) => headers.find((h) => !used.has(h) && norm(h) === a)).find(Boolean);
    if (hit) { map[f.key] = hit; used.add(hit); }
  }
  // Second pass: a header that contains an alias ("Z3 creation date (ERDAT)"), once exact matches are taken.
  for (const f of FIELDS[kind]) {
    if (map[f.key]) continue;
    const want = f.aliases.map(norm).filter((a) => a.length > 3);
    const hit = headers.find((h) => !used.has(h) && want.some((a) => norm(h).includes(a)));
    if (hit) { map[f.key] = hit; used.add(hit); }
  }
  return map;
}

// SAP numbers: "000300012345", "Z5-118" or "300.012.345" all become a plain number.
function parseNo(v) {
  const digits = String(v ?? '').replace(/^\s*z[35]\s*[-:]?\s*/i, '').replace(/[^\d]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// SAP dates: 30.09.2026, 30-09-2026, 30/09/2026, 2026-09-30 or 20260930 → ISO.
function parseDate(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

// "1.234,5" and "1,234.5" and "12,5" → number.
function parseDecimal(v) {
  let s = String(v ?? '').trim().replace(/\s/g, '');
  if (!s) return null;
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function analyse(db, { kind, text, mapping, file = '' }) {
  if (!FIELDS[kind]) throw new Error('Import kind must be z5 or z3');
  const { headers, rows, delimiter } = csv.parse(text);
  if (!headers.length) throw new Error('The file is empty or has no header row');
  const saved = (db.settings.importMappings || {})[kind] || {};
  const map = mapping && Object.keys(mapping).length ? mapping : detectMapping(kind, headers, saved);
  const col = Object.fromEntries(Object.entries(map).filter(([, h]) => h).map(([k, h]) => [k, headers.indexOf(h)]));
  const missingRequired = FIELDS[kind].filter((f) => f.required && !(col[f.key] >= 0)).map((f) => f.label);
  const hash = fileHash(text);
  const before = (db.imports || []).find((i) => i.hash === hash && i.kind === kind);

  const result = {
    kind, file, hash, headers, delimiter, mapping: map, fields: FIELDS[kind].map(({ key, label, required }) => ({ key, label, required })),
    missingRequired, total: rows.length, alreadyImported: before ? { at: before.at, by: before.by, file: before.file } : null,
    created: [], changed: [], unchanged: 0, rejected: [], warnings: [], links: [], stubs: [], period: null,
    vocab: {}, sample: [],
  };
  if (missingRequired.length) return { result, plan: null };

  const existing = new Map((kind === 'z5' ? db.z5s : db.z3s).map((r) => [r.no, r]));
  const z5s = new Map(db.z5s.map((z) => [z.no, z]));
  const seen = new Set();
  const plan = { kind, creates: [], updates: [], stubs: new Map() };
  const lists = db.settings.lists;
  const newVocab = Object.fromEntries(Object.values(VOCAB).map((k) => [k, new Set()]));
  const dates = [];

  rows.forEach((r, i) => {
    const line = i + 2;
    const get = (k) => (col[k] >= 0 ? String(r[col[k]] ?? '').trim() : undefined);
    const no = parseNo(get('no'));
    if (!no) { result.rejected.push({ line, reason: `No valid ${kind.toUpperCase()} number ("${get('no') || ''}")` }); return; }
    if (seen.has(no)) { result.rejected.push({ line, reason: `${kind.toUpperCase()}-${no} appears more than once; the first row is used` }); return; }
    seen.add(no);

    const rec = {};
    for (const f of FIELDS[kind]) {
      if (f.key === 'no' || !(col[f.key] >= 0)) continue;
      const raw = get(f.key);
      if (f.type === 'decimal') {
        const n = parseDecimal(raw);
        if (raw && n === null) result.warnings.push({ line, reason: `${f.label} "${raw}" is not a number; kept empty` });
        rec[f.key] = n ?? 0;
      } else if (f.type === 'date') {
        const d = parseDate(raw);
        if (raw && !d) result.warnings.push({ line, reason: `${f.label} "${raw}" is not a date; ignored` });
        if (d) rec[f.key] = d;
        else if (!raw && f.key === 'resolved') rec[f.key] = ''; // an empty resolution date clears it (the Z3 was reopened)
      } else if (f.type === 'number') {
        rec[f.key] = raw ? parseNo(raw) : null;
        if (raw && !rec[f.key]) result.warnings.push({ line, reason: `${f.label} "${raw}" is not a number; ignored` });
      } else rec[f.key] = raw;
    }
    if (rec.found) dates.push(rec.found);
    for (const [field, listKey] of Object.entries(VOCAB)) {
      if (rec[field] && !(lists[listKey] || []).includes(rec[field])) newVocab[listKey].add(rec[field]);
    }
    if (result.sample.length < 5) result.sample.push({ no, ...rec });

    if (kind === 'z3' && rec.z5 && !z5s.has(rec.z5) && !plan.stubs.has(rec.z5)) {
      plan.stubs.set(rec.z5, rec.failureCode || '');
      result.stubs.push(rec.z5);
    }
    const cur = existing.get(no);
    if (!cur) {
      plan.creates.push({ no, rec });
      result.created.push({ no, title: rec.title || '', z5: rec.z5 || null });
      return;
    }
    const diff = {};
    for (const k of SAP_OWNED[kind]) {
      if (rec[k] === undefined) continue;
      const a = cur[k] ?? '', b = rec[k] ?? '';
      if (String(a) !== String(b)) diff[k] = [a, b];
    }
    let link = null;
    if (kind === 'z3' && col.z5 >= 0) {
      if (rec.z5 && rec.z5 !== cur.z5) link = { from: cur.z5, to: rec.z5 };
      else if (!rec.z5 && cur.z5 && cur.z5Source === 'sap') link = { from: cur.z5, to: null };
      if (link) result.links.push({ no, ...link, fromProvisional: cur.z5 >= PROVISIONAL });
    }
    const changed = Object.keys(diff).length > 0 || !!link;
    plan.updates.push({ no, rec, diff, link, touchOnly: !changed });
    if (Object.keys(diff).length) result.changed.push({ no, title: rec.title ?? cur.title, diff });
    if (!changed) result.unchanged++;
  });

  if (dates.length) { dates.sort(); result.period = { from: dates[0], to: dates[dates.length - 1] }; }
  result.vocab = Object.fromEntries(Object.entries(newVocab).map(([k, v]) => [k, [...v]]));
  plan.vocab = result.vocab;
  return { result, plan };
}

function newZ5FromSap(no, rec, ctx, note) {
  return {
    no, source: 'sap', sapStatus: 'current', lastSeen: ctx.today, title: rec.title || `Z5-${no}`, failureCode: rec.failureCode || '', priority: rec.priority || '',
    status: 'New', parent: null, projectLead: '', engOwner: '', raised: ctx.today, committedDate: '', followUpDate: '', closedAt: '',
    description: '', created: ctx.now,
    workstreams: ctx.WORKSTREAMS.map((k) => ({ key: k, owner: '', entry: '', planned: '', closed: '' })),
    updates: [], records: [], attachments: [], log: [{ at: ctx.now, by: ctx.user, text: note }],
  };
}

const LABEL = { title: 'name', failureCode: 'failure code', priority: 'priority' };

function apply(db, plan, ctx) {
  const { kind } = plan;
  const counts = { created: 0, updated: 0, stubs: 0 };
  const z5ByNo = new Map(db.z5s.map((z) => [z.no, z]));
  const logZ5 = (no, text) => { const z = z5ByNo.get(no); if (z) z.log.unshift({ at: ctx.now, by: ctx.user, text }); };

  const lists = db.settings.lists;
  for (const [k, vals] of Object.entries(plan.vocab)) lists[k] = [...new Set([...(lists[k] || []), ...vals])];

  if (kind === 'z3') {
    for (const [no, code] of plan.stubs) {
      const z = newZ5FromSap(no, { title: `Z5-${no} (not yet in a Z5 export)`, failureCode: code }, ctx, 'Created from a Z3 export; the name follows with the next Z5 import');
      db.z5s.push(z); z5ByNo.set(no, z); counts.stubs++;
    }
  }

  if (kind === 'z5') {
    for (const { no, rec } of plan.creates) {
      const z = newZ5FromSap(no, rec, ctx, 'Imported from SAP');
      db.z5s.push(z); z5ByNo.set(no, z); counts.created++;
    }
    for (const u of plan.updates) {
      const z = z5ByNo.get(u.no);
      z.lastSeen = ctx.today;
      z.sapStatus = 'current';
      if (u.touchOnly) continue;
      for (const [k, [a, b]] of Object.entries(u.diff)) {
        z[k] = b;
        z.log.unshift({ at: ctx.now, by: ctx.user, text: `SAP ${LABEL[k] || k}: "${a}" → "${b}"` });
      }
      counts.updated++;
    }
  } else {
    const byNo = new Map(db.z3s.map((z) => [z.no, z]));
    for (const { no, rec } of plan.creates) {
      db.z3s.push({
        no, sapStatus: 'current', lastSeen: ctx.today, title: rec.title || '', failureCode: rec.failureCode || '', product: rec.product || '',
        serial: rec.serial || '', impact: rec.impact ?? 0, z5: rec.z5 || null, z5Source: rec.z5 ? 'sap' : null,
        status: rec.resolved ? 'Closed' : 'New', productionStep: rec.productionStep || '', milestone: rec.milestone || '',
        found: rec.found || ctx.today, resolved: rec.resolved || '', reporter: 'SAP import', created: ctx.now,
        operatorText: rec.operatorText || '', resolutionText: rec.resolutionText || '', attachments: [],
      });
      if (rec.z5) logZ5(rec.z5, `Z3-${no} linked (SAP)`);
      counts.created++;
    }
    for (const u of plan.updates) {
      const z = byNo.get(u.no);
      z.lastSeen = ctx.today;
      z.sapStatus = 'current';
      for (const [k, [, b]] of Object.entries(u.diff)) z[k] = b;
      // A resolution date from SAP closes the Z3.
      if (u.diff.resolved && u.diff.resolved[1] && z.status !== 'Closed') z.status = 'Closed';
      if (u.link) {
        if (u.link.from) logZ5(u.link.from, `Z3-${u.no} ${u.link.to ? `moved to Z5-${u.link.to}` : 'unlinked'} by SAP`);
        if (u.link.to) logZ5(u.link.to, `Z3-${u.no} linked (SAP)`);
        z.z5 = u.link.to;
        z.z5Source = u.link.to ? 'sap' : null;
      } else if (u.rec.z5 && z.z5 === u.rec.z5) z.z5Source = 'sap';
      if (!u.touchOnly) counts.updated++;
    }
  }
  return counts;
}

module.exports = { FIELDS, SAP_OWNED, PROVISIONAL, detectMapping, analyse, apply, parseNo, parseDecimal, parseDate, fileHash };
