// Table storage: the data folder holds one readable JSON file per table, one row per line,
// with a fixed column order. The server works on a nested in-memory model; this module splits
// it into tables on save and joins the tables back on load. See docs/data-model.md.
//
// Guard rails for a shared/network folder:
//   - one server at a time: `.lock` names the host and process that owns the folder
//   - atomic writes: write to a temp file, then rename
//   - only changed tables are rewritten
//   - a dated copy of every table in `_backup/` once a day (last 14 kept)

const fs = require('fs');
const os = require('os');
const path = require('path');

const WORKSTREAMS = ['Problem', 'Containment', 'Cause', 'Solution', 'Implement', 'Monitor'];

// Column order per table. Unknown extra fields are kept, after these.
const TABLES = {
  'z5s': ['no', 'source', 'sapStatus', 'lastSeen', 'title', 'failureCode', 'priority', 'status', 'parent', 'projectLead', 'engOwner',
    'raised', 'committedDate', 'followUpDate', 'closedAt', 'description', 'created', 'matchedFrom'],
  'z5-workstreams': ['z5', 'step', 'key', 'owner', 'planned', 'closed', 'entry'],
  'z5-updates': ['id', 'z5', 'date', 'ws', 'type', 'author', 'dueWas', 'onTime', 'at', 'text'],
  'z5-comments': ['id', 'z5', 'update', 'author', 'at', 'text'],
  'z5-records': ['id', 'z5', 'date', 'type', 'ws', 'author', 'text'],
  'z5-log': ['z5', 'at', 'by', 'text'],
  'z3s': ['no', 'sapStatus', 'lastSeen', 'title', 'failureCode', 'product', 'serial', 'impact', 'z5', 'z5Source',
    'productionStep', 'milestone', 'found', 'resolved', 'status', 'reporter', 'created', 'operatorText', 'resolutionText'],
  'attachments': ['id', 'entity', 'no', 'update', 'name', 'size', 'type', 'path', 'uploaded', 'by'],
  'drb-sessions': ['id', 'date', 'closed', 'closedAt'],
  'drb-reviews': ['session', 'z5', 'note', 'by', 'at'],
  'drb-guidance': ['id', 'z5', 'owner', 'due', 'done', 'doneAt', 'text', 'by', 'at'],
  'drb-help': ['id', 'z5', 'type', 'status', 'decided', 'text', 'by', 'at'],
  'teams': ['lead', 'dept', 'members'],
  'move-rate': ['week', 'parts'],
  'users': ['username', 'name', 'role', 'team', 'password'],
  'imports': ['id', 'at', 'by', 'kind', 'file', 'period', 'created', 'updated', 'rejected', 'hash', 'archived'],
};
// Small documents, stored pretty-printed.
const DOCS = ['meta', 'settings', 'lists'];

const ordered = (row, cols) => {
  const o = {};
  for (const c of cols) if (row[c] !== undefined) o[c] = row[c];
  for (const k of Object.keys(row)) if (!(k in o) && row[k] !== undefined) o[k] = row[k];
  return o;
};

function serializeTable(rows, cols) {
  if (!rows.length) return '[]\n';
  return `[\n${rows.map((r) => '  ' + JSON.stringify(ordered(r, cols))).join(',\n')}\n]\n`;
}

// ---------- split / join ----------

function split(db) {
  const t = {};
  t.meta = db.meta;
  const { lists, ...settings } = db.settings;
  t.settings = { ...settings, drbChair: db.drb.chair };
  t.lists = lists;
  t.teams = db.teams;
  t['move-rate'] = db.moveRate;
  t.imports = db.imports || [];
  t.users = db.users || [];

  t.z5s = []; t['z5-workstreams'] = []; t['z5-updates'] = []; t['z5-comments'] = []; t['z5-records'] = []; t['z5-log'] = []; t.attachments = [];
  for (const z of db.z5s) {
    const { workstreams, updates, records, log, attachments, ...row } = z;
    t.z5s.push(row);
    (workstreams || []).forEach((w, i) => t['z5-workstreams'].push({ z5: z.no, step: i + 1, ...w }));
    (updates || []).forEach(({ comments, ...u }) => {
      t['z5-updates'].push({ ...u, z5: z.no });
      (comments || []).forEach((c) => t['z5-comments'].push({ ...c, z5: z.no, update: u.id }));
    });
    (records || []).forEach((r) => t['z5-records'].push({ ...r, z5: z.no }));
    (log || []).forEach((l) => t['z5-log'].push({ z5: z.no, ...l }));
    (attachments || []).forEach((a) => t.attachments.push({ ...a, entity: 'z5', no: z.no }));
  }
  t.z3s = [];
  for (const z of db.z3s) {
    const { attachments, ...row } = z;
    t.z3s.push(row);
    (attachments || []).forEach((a) => t.attachments.push({ ...a, entity: 'z3', no: z.no }));
  }
  t['drb-sessions'] = []; t['drb-reviews'] = [];
  for (const s of db.drb.sessions) {
    const { items, ...row } = s;
    t['drb-sessions'].push(row);
    (items || []).forEach((i) => t['drb-reviews'].push({ session: s.id, ...i }));
  }
  t['drb-guidance'] = db.drb.guidance;
  t['drb-help'] = db.drb.help;
  return t;
}

function join(t) {
  const group = (rows, key) => {
    const m = new Map();
    for (const r of rows || []) { if (!m.has(r[key])) m.set(r[key], []); m.get(r[key]).push(r); }
    return m;
  };
  const strip = (r, ...keys) => { const o = { ...r }; keys.forEach((k) => delete o[k]); return o; };
  const ws = group(t['z5-workstreams'], 'z5');
  const ups = group(t['z5-updates'], 'z5');
  const comments = group(t['z5-comments'], 'update');
  const recs = group(t['z5-records'], 'z5');
  const logs = group(t['z5-log'], 'z5');
  const att = group(t.attachments, 'entity');
  const attZ5 = group(att.get('z5'), 'no');
  const attZ3 = group(att.get('z3'), 'no');
  const reviews = group(t['drb-reviews'], 'session');

  const z5s = (t.z5s || []).map((row) => {
    const list = (ws.get(row.no) || []).sort((a, b) => a.step - b.step).map((w) => strip(w, 'z5', 'step'));
    return {
      ...row,
      workstreams: list.length === 6 ? list : WORKSTREAMS.map((k) => list.find((w) => w.key === k) || { key: k, owner: '', entry: '', planned: '', closed: '' }),
      updates: (ups.get(row.no) || []).map((u) => ({ ...strip(u, 'z5'), comments: (comments.get(u.id) || []).map((c) => strip(c, 'z5', 'update')) })),
      records: (recs.get(row.no) || []).map((r) => strip(r, 'z5')),
      log: (logs.get(row.no) || []).map((l) => strip(l, 'z5')),
      attachments: (attZ5.get(row.no) || []).map((a) => strip(a, 'entity', 'no')),
    };
  });
  const z3s = (t.z3s || []).map((row) => ({ ...row, attachments: (attZ3.get(row.no) || []).map((a) => strip(a, 'entity', 'no')) }));
  const { drbChair, ...settings } = t.settings || {};
  return {
    meta: t.meta || {},
    settings: { ...settings, lists: t.lists || {} },
    teams: t.teams || [],
    moveRate: t['move-rate'] || [],
    imports: t.imports || [],
    users: t.users || [],
    drb: {
      chair: drbChair || '',
      sessions: (t['drb-sessions'] || []).map((s) => ({ ...s, items: (reviews.get(s.id) || []).map((r) => strip(r, 'session')) })),
      guidance: t['drb-guidance'] || [],
      help: t['drb-help'] || [],
    },
    z5s,
    z3s,
  };
}

// ---------- the store ----------

class TableStore {
  constructor(dir) {
    this.dir = dir;
    this.written = new Map(); // table → last serialized text
    this.lockFile = path.join(dir, '.lock');
  }

  file(name) { return path.join(this.dir, `${name}.json`); }

  exists() { return fs.existsSync(this.file('meta')); }

  acquireLock({ force = false } = {}) {
    fs.mkdirSync(this.dir, { recursive: true });
    if (fs.existsSync(this.lockFile) && !force) {
      let owner = {};
      try { owner = JSON.parse(fs.readFileSync(this.lockFile, 'utf8')); } catch {}
      // macOS reports a network-dependent suffix (.local, .fritz.box, …) — compare the machine name only
      const shortHost = (h) => String(h || '').split('.')[0].toLowerCase();
      const sameHost = shortHost(owner.host) === shortHost(os.hostname());
      let alive = false;
      if (sameHost && owner.pid) { try { process.kill(owner.pid, 0); alive = true; } catch {} }
      if (!sameHost || alive) {
        throw new Error(`The data folder is in use by ${owner.host || 'another machine'} (process ${owner.pid || '?'}, since ${owner.since || '?'}).\n`
          + `Only one IRM server may use a data folder. If that server is really gone, start with IRM_FORCE=1.`);
      }
    }
    fs.writeFileSync(this.lockFile, JSON.stringify({ host: os.hostname(), pid: process.pid, since: new Date().toISOString() }, null, 2));
    const release = () => { try { const o = JSON.parse(fs.readFileSync(this.lockFile, 'utf8')); if (o.pid === process.pid) fs.unlinkSync(this.lockFile); } catch {} };
    process.on('exit', release);
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { release(); process.exit(0); });
  }

  load() {
    const t = {};
    for (const name of [...DOCS, ...Object.keys(TABLES)]) {
      const f = this.file(name);
      if (!fs.existsSync(f)) continue;
      const text = fs.readFileSync(f, 'utf8');
      try { t[name] = JSON.parse(text); } catch (e) { throw new Error(`${f} is not valid JSON: ${e.message}`); }
      this.written.set(name, text);
    }
    return join(t);
  }

  save(db) {
    fs.mkdirSync(this.dir, { recursive: true });
    const t = split(db);
    for (const [name, value] of Object.entries(t)) {
      const text = TABLES[name] ? serializeTable(value || [], TABLES[name]) : JSON.stringify(value ?? {}, null, 2) + '\n';
      if (this.written.get(name) === text) continue;
      const f = this.file(name);
      fs.writeFileSync(f + '.tmp', text);
      fs.renameSync(f + '.tmp', f);
      this.written.set(name, text);
    }
  }

  // One dated copy of every table per day, keeping the newest 14.
  backup(keep = 14) {
    if (!this.exists()) return null;
    const root = path.join(this.dir, '_backup');
    const target = path.join(root, new Date().toISOString().slice(0, 10));
    if (fs.existsSync(target)) return null;
    fs.mkdirSync(target, { recursive: true });
    for (const f of fs.readdirSync(this.dir)) if (f.endsWith('.json')) fs.copyFileSync(path.join(this.dir, f), path.join(target, f));
    const days = fs.readdirSync(root).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    for (const old of days.slice(0, Math.max(0, days.length - keep))) fs.rmSync(path.join(root, old), { recursive: true, force: true });
    return target;
  }

  counts(db) {
    const t = split(db);
    return Object.fromEntries(Object.keys(TABLES).map((k) => [k, (t[k] || []).length]));
  }
}

module.exports = { TableStore, TABLES, DOCS, split, join };
