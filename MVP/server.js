// IRM MVP server — zero dependencies, Node 18+.
// Serves the app from ./public, keeps the data as readable tables in the data folder (lib/storage.js),
// imports SAP exports (lib/importer.js) and writes uploaded files into the upload folder.
//
// Ownership: SAP is master for Z3s and for the Z5 number, name, failure code and priority.
// Everything else about a Z5 (owners, dates, PCCSIM, updates, DRB …) is managed here.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const { seedDemo, emptyDb, migrate, nextThursday, WORKSTREAMS, PROVISIONAL } = require('./seed');
const { TableStore, split, TABLES } = require('./lib/storage');
const importer = require('./lib/importer');
const csv = require('./lib/csv');

const ROOT = __dirname;
const CONFIG_FILE = path.join(ROOT, 'config.json');
const PUBLIC = path.join(ROOT, 'public');
const IMPORTS = path.join(ROOT, 'imports');
const MAX_UPLOAD = 500 * 1024 * 1024;

// ---------- config ----------

function loadConfig() {
  const defaults = { port: 4310, host: '127.0.0.1', dataDir: 'data', uploadDir: 'storage' };
  let cfg = defaults;
  if (fs.existsSync(CONFIG_FILE)) cfg = { ...defaults, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
  if (process.env.PORT) cfg.port = Number(process.env.PORT);
  if (process.env.IRM_HOST) cfg.host = process.env.IRM_HOST;
  if (process.env.IRM_DATA_DIR) cfg.dataDir = process.env.IRM_DATA_DIR;
  if (process.env.IRM_UPLOAD_DIR) cfg.uploadDir = process.env.IRM_UPLOAD_DIR;
  return cfg;
}
let config = loadConfig();
const abs = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
const uploadRoot = () => abs(config.uploadDir);
const dataDir = () => abs(config.dataDir);
// The single-file store of earlier MVP versions, converted to tables on first start.
const legacyFile = () => abs(config.dataFile || path.join(config.dataDir, 'irm.json'));

// Only the upload folder is changed from the app; env overrides (PORT etc.) are never written back.
function saveUploadDir(dir) {
  const onDisk = fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) : {};
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...onDisk, uploadDir: dir }, null, 2) + '\n');
}

// ---------- store ----------

let db;
let store;
function loadDb() {
  store = new TableStore(dataDir());
  store.acquireLock({ force: process.env.IRM_FORCE === '1' });
  if (store.exists()) {
    db = migrate(store.load());
  } else if (fs.existsSync(legacyFile())) {
    db = migrate(JSON.parse(fs.readFileSync(legacyFile(), 'utf8')));
    store.save(db);
    const moved = `${legacyFile()}.converted-${today()}`;
    fs.renameSync(legacyFile(), moved);
    console.log(`  converted ${path.basename(legacyFile())} to tables (original kept as ${path.basename(moved)})`);
  } else {
    db = seedDemo();
  }
  persist();
  const b = store.backup();
  if (b) console.log(`  daily backup  ${b}`);
}
const persist = () => store.save(db);

const today = () => new Date().toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString();
const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}
const fail = (status, msg) => { throw new HttpError(status, msg); };

// Provisional Z5s read "P-001"; SAP Z5s read "Z5-118".
const isProv = (no) => Number(no) >= PROVISIONAL;
const zid = (no) => (isProv(no) ? `P-${String(Number(no) - PROVISIONAL).padStart(3, '0')}` : `Z5-${no}`);

const findZ3 = (no) => db.z3s.find((z) => z.no === Number(no)) || fail(404, `Z3-${no} not found`);
const findZ5 = (no) => db.z5s.find((z) => z.no === Number(no)) || fail(404, `${zid(no)} not found`);

// ---------- login (demo) ----------
// A signed cookie names the logged-in account; the account's name is recorded on everything it does.
// Accounts live in the users table (plain-text demo passwords — not for production).
const COOKIE = 'irm_session';
const sign = (username) => crypto.createHmac('sha256', db.meta.secret).update(username).digest('hex').slice(0, 32);
const publicUser = ({ password, ...u }) => u;

function accountFrom(req) {
  const cookies = Object.fromEntries(String(req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
  const [username, sig] = String(cookies[COOKIE] || '').split('.');
  if (!username || !sig) return null;
  const expected = sign(username);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const u = db.users.find((x) => x.username === username);
  return u ? publicUser(u) : null;
}

const als = new AsyncLocalStorage();
const account = () => als.getStore()?.account || null;
const user = () => account()?.name || 'Unknown user';
const requireAdmin = () => { if (account()?.role !== 'admin') fail(403, 'Only an admin can do this'); };

function log(z5, text) {
  z5.log = z5.log || [];
  z5.log.unshift({ at: nowIso(), by: user(), text });
}

// Everything on a Z3 comes from SAP except its status in the IRM workflow.
const Z3_APP_FIELDS = ['status'];
const Z3_STATUS = ['New', 'Worked upon', 'Closed'];
const Z5_APP_FIELDS = ['description', 'projectLead', 'engOwner', 'committedDate', 'followUpDate', 'raised'];
const Z5_SAP_FIELDS = importer.SAP_OWNED.z5; // title, failureCode, priority
const Z5_STATUS = ['New', 'Investigate', 'Ongoing', 'Done', 'Aborted'];

function pick(src, fields) {
  const out = {};
  for (const f of fields) if (src[f] !== undefined) out[f] = src[f];
  return out;
}

// A Z5 started in the app before SAP has a number for it.
function newProvisionalZ5(input) {
  const z = {
    no: PROVISIONAL + db.meta.nextProvisional++, source: 'provisional', sapStatus: '', created: nowIso(), raised: today(),
    status: 'New', parent: null, title: '', failureCode: '', priority: '', description: '', projectLead: '', engOwner: '',
    committedDate: '', followUpDate: '', closedAt: '', attachments: [], updates: [], records: [], log: [],
    workstreams: WORKSTREAMS.map((k) => ({ key: k, owner: '', entry: '', planned: '', closed: '' })),
    ...pick(input, [...Z5_APP_FIELDS, ...Z5_SAP_FIELDS]),
  };
  if (!String(z.title).trim()) fail(400, 'A Z5 needs a name');
  log(z, 'Provisional Z5 started in the app');
  db.z5s.push(z);
  return z;
}

function setZ5Status(z5, status) {
  if (!Z5_STATUS.includes(status)) fail(400, `Unknown Z5 status "${status}"`);
  if (status === z5.status) return;
  if (status === 'Done' && !z5.workstreams.every((w) => w.closed))
    fail(409, 'All six PCCSIM workstreams must be closed before the Z5 can be set to Done');
  log(z5, `Status ${z5.status} → ${status}`);
  z5.status = status;
  z5.closedAt = status === 'Done' || status === 'Aborted' ? today() : '';
}

// An update counts as on time when it is posted on or before the follow-up date that was due.
function addUpdate(z5, { ws, type, text, followUp, date }) {
  if (!String(text || '').trim()) fail(400, 'Write the update before posting');
  const posted = date || today();
  const u = {
    id: uid('u'), date: posted, at: nowIso(), author: user(), ws: ws || '', type: type || 'Progress', text: String(text),
    dueWas: z5.followUpDate || '', onTime: !z5.followUpDate || posted <= z5.followUpDate, comments: [],
  };
  z5.updates.unshift(u);
  if (followUp) z5.followUpDate = followUp;
  log(z5, `Update posted${followUp ? `; next follow-up ${followUp}` : ''}`);
  return u;
}

function addRecord(z5, { date, type, ws, text }) {
  if (!String(text || '').trim()) fail(400, 'Write what was recorded');
  const r = { id: uid('r'), date: date || today(), type: type || 'Note', ws: ws || '', author: user(), text: String(text) };
  z5.records.unshift(r);
  return r;
}

function mondayOf(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  if (isNaN(d)) return null;
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() || 7) - 1));
  return d.toISOString().slice(0, 10);
}

const currentSession = () => db.drb.sessions.find((x) => !x.closed);

function setParent(z5, parentNo) {
  if (!parentNo) { if (z5.parent) log(z5, `Unlinked from parent ${zid(z5.parent)}`); z5.parent = null; return; }
  const parent = findZ5(parentNo);
  if (parent.no === z5.no) fail(400, 'A Z5 cannot be its own parent');
  if (parent.parent) fail(400, `${zid(parent.no)} is itself a duplicate of ${zid(parent.parent)}; link to the leading Z5 instead`);
  if (db.z5s.some((c) => c.parent === z5.no)) fail(400, `${zid(z5.no)} already leads other duplicates; it cannot become a child`);
  z5.parent = parent.no;
  log(z5, `Marked duplicate of ${zid(parent.no)}`);
  log(parent, `${zid(z5.no)} linked as duplicate`);
}

// PCCSIM is sequential: a workstream can only close once every earlier one is closed,
// and only the last closed workstream can be reopened.
function closeWorkstream(z5, key, date) {
  if (z5.status !== 'Ongoing') fail(409, 'Accept the Z5 (status Ongoing) before closing workstreams');
  const i = z5.workstreams.findIndex((w) => w.key === key);
  if (i < 0) fail(404, 'Unknown workstream');
  if (z5.workstreams[i].closed) fail(409, `${key} is already closed`);
  const open = z5.workstreams.findIndex((w) => !w.closed);
  if (open !== i) fail(409, `Close ${z5.workstreams[open].key} first — PCCSIM workstreams run in order`);
  z5.workstreams[i].closed = date || today();
  log(z5, `${key} closed`);
}
function reopenWorkstream(z5, key) {
  const i = z5.workstreams.findIndex((w) => w.key === key);
  if (i < 0) fail(404, 'Unknown workstream');
  const next = z5.workstreams[i + 1];
  if (next && next.closed) fail(409, `Reopen ${next.key} first`);
  z5.workstreams[i].closed = '';
  if (z5.status === 'Done') { z5.status = 'Ongoing'; log(z5, 'Status Done → Ongoing'); }
  log(z5, `${key} reopened`);
}

// ---------- matching a provisional Z5 to its SAP number ----------

const blankWs = (w) => !w.owner && !w.entry && !w.planned && !w.closed;

function matchProvisional(prov, sapInput) {
  if (prov.source !== 'provisional') fail(409, `${zid(prov.no)} already has a SAP number`);
  const sapNo = importer.parseNo(sapInput);
  if (!sapNo || isProv(sapNo)) fail(400, 'Enter the SAP Z5 number');
  const target = db.z5s.find((z) => z.no === sapNo);
  if (target && target.source === 'provisional') fail(409, `${zid(sapNo)} is itself provisional`);
  const from = prov.no;
  const label = zid(from);

  let result;
  if (target) {
    // SAP Z5 already imported: move the app work onto it. SAP fields stay as SAP has them.
    for (const k of ['projectLead', 'engOwner', 'committedDate', 'followUpDate', 'description', 'parent']) if (!target[k] && prov[k]) target[k] = prov[k];
    if (target.status === 'New' && prov.status !== 'New') { target.status = prov.status; target.closedAt = prov.closedAt; }
    if (prov.raised && (!target.raised || prov.raised < target.raised)) target.raised = prov.raised;
    target.workstreams = target.workstreams.map((w, i) => (blankWs(w) ? prov.workstreams[i] : w));
    target.updates = [...prov.updates, ...target.updates].sort((a, b) => b.date.localeCompare(a.date));
    target.records = [...prov.records, ...target.records];
    target.attachments = [...target.attachments, ...prov.attachments];
    target.log = [...target.log, ...prov.log].sort((a, b) => b.at.localeCompare(a.at));
    target.matchedFrom = label;
    db.z5s = db.z5s.filter((z) => z !== prov);
    result = target;
  } else {
    // Not imported yet: the provisional record takes the SAP number; the next Z5 import fills in the SAP fields.
    prov.no = sapNo;
    prov.source = 'sap';
    prov.sapStatus = 'pending';
    prov.matchedFrom = label;
    result = prov;
  }
  // Point every reference at the SAP number.
  for (const z of db.z3s) if (z.z5 === from) z.z5 = sapNo;
  for (const z of db.z5s) if (z.parent === from) z.parent = sapNo;
  for (const s of db.drb.sessions) for (const i of s.items) if (i.z5 === from) i.z5 = sapNo;
  for (const g of [...db.drb.guidance, ...db.drb.help]) if (g.z5 === from) g.z5 = sapNo;
  moveFiles(result, `Z5-${label}`, `Z5-${sapNo}`);
  log(result, `Provisional ${label} matched to SAP ${zid(sapNo)}`);
  return result;
}

function moveFiles(rec, fromFolder, toFolder) {
  const src = path.join(uploadRoot(), fromFolder);
  const dst = path.join(uploadRoot(), toFolder);
  for (const a of rec.attachments) {
    if (!a.path.startsWith(fromFolder + '/')) continue;
    const name = a.path.slice(fromFolder.length + 1);
    if (fs.existsSync(path.join(src, name))) {
      fs.mkdirSync(dst, { recursive: true });
      const target = uniquePath(dst, name);
      fs.renameSync(path.join(src, name), path.join(dst, target));
      a.name = target;
      a.path = `${toFolder}/${target}`;
    }
  }
  try { if (fs.existsSync(src) && !fs.readdirSync(src).length) fs.rmdirSync(src); } catch {}
}

// ---------- uploads ----------

function safeName(name) {
  const base = path.basename(String(name || 'file')).replace(/[^\w.\- ()]+/g, '_').trim();
  return base || 'file';
}

function uniquePath(dir, name) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let n = 2; fs.existsSync(path.join(dir, candidate)); n++) candidate = `${stem} (${n})${ext}`;
  return candidate;
}

function recordFor(kind, no) {
  if (kind === 'z3') return { rec: findZ3(no), folder: `Z3-${no}` };
  if (kind === 'z5') { const rec = findZ5(no); return { rec, folder: isProv(rec.no) ? `Z5-${zid(rec.no)}` : `Z5-${rec.no}` }; }
  fail(400, 'Uploads target z3 or z5');
}

function handleUpload(req, res, q) {
  const { rec, folder } = recordFor(q.get('kind'), q.get('no'));
  const who = user();
  const updateId = q.get('update') || null;
  if (updateId && !(rec.updates || []).some((u) => u.id === updateId)) fail(404, 'Update not found');
  const length = Number(req.headers['content-length'] || 0);
  if (length > MAX_UPLOAD) fail(413, 'File is larger than 500 MB');
  const original = safeName(decodeURIComponent(req.headers['x-file-name'] || 'file'));
  const dir = path.join(uploadRoot(), folder);
  fs.mkdirSync(dir, { recursive: true });
  const name = uniquePath(dir, original);
  const target = path.join(dir, name);
  const out = fs.createWriteStream(target);
  let size = 0;
  req.on('data', (c) => { size += c.length; });
  req.pipe(out);
  out.on('error', (e) => send(res, 500, { error: e.message }));
  out.on('finish', () => {
    const att = {
      id: uid('a'), name, size, type: req.headers['content-type'] || '', path: `${folder}/${name}`,
      uploaded: nowIso(), by: who, update: updateId,
    };
    rec.attachments = rec.attachments || [];
    rec.attachments.push(att);
    if (rec.log) rec.log.unshift({ at: nowIso(), by: who, text: `Attached ${name}` });
    persist();
    send(res, 201, { attachment: att, savedTo: target });
  });
}

function removeAttachment(kind, no, attId) {
  const { rec } = recordFor(kind, no);
  const i = (rec.attachments || []).findIndex((a) => a.id === attId);
  if (i < 0) fail(404, 'Attachment not found');
  const [att] = rec.attachments.splice(i, 1);
  const file = path.join(uploadRoot(), att.path);
  if (file.startsWith(uploadRoot()) && fs.existsSync(file)) fs.unlinkSync(file);
  if (rec.log) log(rec, `Removed attachment ${att.name}`);
}

// ---------- SAP import ----------

function importCtx() {
  return { today: today(), now: nowIso(), user: user(), WORKSTREAMS };
}

// Keeps the raw file and a short report under imports/processed/ for the audit trail.
function archiveImport(kind, file, text, result, counts) {
  const dir = path.join(IMPORTS, 'processed', today());
  fs.mkdirSync(dir, { recursive: true });
  const stamp = nowIso().slice(11, 19).replace(/:/g, '');
  const base = `${stamp}-${kind}-${safeName(file || 'upload.csv').replace(/\.csv$/i, '')}`;
  fs.writeFileSync(path.join(dir, `${base}.csv`), text);
  const report = { at: nowIso(), by: user(), kind, file, period: result.period, mapping: result.mapping, counts, rejected: result.rejected, warnings: result.warnings, links: result.links };
  fs.writeFileSync(path.join(dir, `${base}.report.json`), JSON.stringify(report, null, 2));
  return path.relative(ROOT, path.join(dir, `${base}.csv`));
}

// Demo exports built from the current data, with one new and one renamed Z5, so the importer can be tried.
function sampleExport(kind) {
  const sapZ5 = db.z5s.filter((z) => z.source === 'sap');
  const newZ5 = Math.max(170, ...sapZ5.map((z) => z.no)) + 1;
  if (kind === 'z5') {
    const rows = sapZ5.map((z) => ({ 'Z5 number': z.no, 'Z5 name': z.title, 'Failure code': z.failureCode, Priority: z.priority }));
    if (rows[0]) rows[0]['Z5 name'] += ' (renamed in SAP)';
    rows.push({ 'Z5 number': newZ5, 'Z5 name': 'Backside scratches after clean', 'Failure code': 'Particle contamination', Priority: 'High' });
    return csv.stringify(rows, ['Z5 number', 'Z5 name', 'Failure code', 'Priority']);
  }
  const de = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');
  const rows = db.z3s.slice(-40).map((z) => ({
    'Z3 number': z.no, 'Z3 name': z.title, 'Failure code': z.failureCode, 'Product type': z.product, 'Product serial number': z.serial,
    Impact: String(z.impact).replace('.', ','), 'Created on': de(z.found), 'Resolved on': de(z.resolved), 'Production step': z.productionStep, Milestone: z.milestone,
    'Long text': z.operatorText, 'Resolution text': z.resolutionText, 'Z5 number': z.z5Source === 'sap' ? z.z5 : '',
  }));
  // One Z3 resolved in SAP since the last import, so the sample shows a change.
  const open = rows.find((r) => !r['Resolved on']);
  if (open) { open['Resolved on'] = de(today()); open['Resolution text'] = 'Reworked at Litho B, lot released.'; }
  const next = Math.max(...db.z3s.map((z) => z.no)) + 1;
  rows.push({ 'Z3 number': next, 'Z3 name': 'Scratch on backside', 'Failure code': 'Particle contamination', 'Product type': 'WET 1.0', 'Product serial number': 'WET10-1777', Impact: '6,5',
    'Created on': de(today()), 'Resolved on': '', 'Production step': 'Clean', Milestone: 'M2 System test', 'Long text': 'Backside scratch found after clean.\nLot held.', 'Resolution text': '', 'Z5 number': newZ5 });
  return csv.stringify(rows, ['Z3 number', 'Z3 name', 'Failure code', 'Product type', 'Product serial number', 'Impact', 'Created on', 'Resolved on', 'Production step', 'Milestone', 'Long text', 'Resolution text', 'Z5 number']);
}

// ---------- http plumbing ----------

function send(res, status, body) {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { raw += c; if (raw.length > 200 * 1024 * 1024) reject(new HttpError(413, 'Body too large')); });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.webp': 'image/webp', '.ico': 'image/x-icon',
};

function serveFile(res, file, { download = false } = {}) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, { error: 'Not found' });
    const headers = { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size };
    if (download) headers['Content-Disposition'] = `attachment; filename="${encodeURIComponent(path.basename(file))}"`;
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });
}

function sendDownload(res, name, type, body) {
  res.writeHead(200, { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${name}"` });
  res.end(body);
}

function within(root, rel) {
  const p = path.normalize(path.join(root, rel));
  return p.startsWith(path.normalize(root + path.sep)) ? p : null;
}

// Opens a folder in Finder/Explorer, or reveals a file inside its folder.
function reveal(target) {
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
  const isDir = fs.statSync(target).isDirectory();
  const cmd = process.platform === 'darwin' ? ['open', isDir ? [target] : ['-R', target]]
    : process.platform === 'win32' ? ['explorer', [isDir ? target : `/select,${target}`]]
    : ['xdg-open', [isDir ? target : path.dirname(target)]];
  execFile(cmd[0], cmd[1], () => {});
}

function settingsView() {
  return {
    ...db.settings, uploadDir: config.uploadDir, uploadDirResolved: uploadRoot(),
    dataDir: dataDir(), tables: store.counts(db), provisionalBase: PROVISIONAL,
  };
}

// ---------- routes ----------

async function api(req, res, url) {
  const m = req.method;
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"
  const [a, b, c, d, e] = parts;

  if (a === 'login' && m === 'POST') {
    const { username, password } = await readJson(req);
    const u = db.users.find((x) => x.username === String(username || '').trim().toLowerCase());
    if (!u || u.password !== String(password || '')) fail(401, 'Wrong user name or password');
    res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(`${u.username}.${sign(u.username)}`)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`);
    return send(res, 200, publicUser(u));
  }
  if (a === 'logout' && m === 'POST') {
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    return send(res, 200, { ok: true });
  }
  if (!account()) fail(401, 'Please log in');
  if (a === 'me' && m === 'GET') return send(res, 200, account());

  // Everything the screens need — without passwords or the signing secret.
  if (m === 'GET' && a === 'db') {
    const { secret, ...meta } = db.meta;
    return send(res, 200, { ...db, meta, users: db.users.map(publicUser) });
  }

  if (a === 'settings') {
    if (m === 'GET') return send(res, 200, settingsView());
    if (m === 'PUT') {
      requireAdmin();
      const body = await readJson(req);
      if (body.uploadDir !== undefined) {
        const dir = String(body.uploadDir).trim();
        if (!dir) fail(400, 'Upload folder cannot be empty');
        try { fs.mkdirSync(abs(dir), { recursive: true }); fs.accessSync(abs(dir), fs.constants.W_OK); }
        catch (err) { fail(400, `Cannot write to ${abs(dir)}: ${err.message}`); }
        config.uploadDir = dir;
        saveUploadDir(dir);
      }
      if (body.lists) db.settings.lists = { ...db.settings.lists, ...body.lists };
      if (body.board) db.settings.board = { ...db.settings.board, ...body.board };
      persist();
      return send(res, 200, settingsView());
    }
  }

  // Z3s come from SAP: only the status can be changed here.
  if (a === 'z3' && m === 'PATCH' && b) {
    const z = findZ3(b);
    const body = await readJson(req);
    const changes = pick(body, Z3_APP_FIELDS);
    if (changes.status && !Z3_STATUS.includes(changes.status)) fail(400, `Unknown Z3 status "${changes.status}"`);
    Object.assign(z, changes);
    persist(); return send(res, 200, z);
  }

  // Manual linking is for Z3s SAP has not linked. A SAP link can only be changed in SAP.
  if (a === 'link' && m === 'POST') {
    const { z3s = [], z5 } = await readJson(req);
    const target = z5 ? findZ5(z5) : null;
    const list = z3s.map(findZ3);
    const locked = list.filter((z) => z.z5Source === 'sap' && z.z5 !== (target && target.no));
    if (locked.length) fail(409, `${locked.map((z) => `Z3-${z.no}`).join(', ')} ${locked.length === 1 ? 'is' : 'are'} linked in SAP; change the link in SAP and re-import`);
    for (const z of list) {
      if (target && z.z5 !== target.no) log(target, `Linked Z3-${z.no}`);
      if (!target && z.z5) { const prev = db.z5s.find((x) => x.no === z.z5); if (prev) log(prev, `Unlinked Z3-${z.no}`); }
      z.z5 = target ? target.no : null;
      z.z5Source = target ? 'app' : null;
    }
    persist(); return send(res, 200, { ok: true });
  }

  if (a === 'z5') {
    if (m === 'POST' && !b) {
      const body = await readJson(req);
      const z = newProvisionalZ5(body);
      for (const no of body.linkZ3s || []) {
        const z3 = findZ3(no);
        if (z3.z5Source === 'sap') continue;
        z3.z5 = z.no; z3.z5Source = 'app'; log(z, `Linked Z3-${no}`);
      }
      persist(); return send(res, 201, z);
    }
    const z5 = b ? findZ5(b) : null;
    if (m === 'PATCH' && z5 && !c) {
      const body = await readJson(req);
      const allowed = z5.source === 'provisional' ? [...Z5_APP_FIELDS, ...Z5_SAP_FIELDS] : Z5_APP_FIELDS;
      const blocked = Z5_SAP_FIELDS.filter((k) => body[k] !== undefined && body[k] !== z5[k] && !allowed.includes(k));
      const label = { title: 'The name', failureCode: 'The failure code', priority: 'The priority' };
      if (blocked.length) fail(409, `${blocked.map((k) => label[k]).join(', ')} ${blocked.length > 1 ? 'come' : 'comes'} from SAP and cannot be changed here`);
      const changes = pick(body, allowed);
      for (const [k, v] of Object.entries(changes)) {
        if (z5[k] !== v && ['projectLead', 'engOwner', 'committedDate', 'followUpDate', 'priority', 'title'].includes(k))
          log(z5, `${k.replace(/([A-Z])/g, ' $1').toLowerCase()} → ${v || '—'}`);
      }
      Object.assign(z5, changes);
      if (body.status !== undefined) setZ5Status(z5, body.status);
      if ('parent' in body) setParent(z5, body.parent);
      persist(); return send(res, 200, z5);
    }
    if (m === 'POST' && z5 && c === 'match') {
      const { sap } = await readJson(req);
      const z = matchProvisional(z5, sap);
      persist(); return send(res, 200, z);
    }
    if (m === 'DELETE' && z5 && !c) {
      if (z5.source !== 'provisional') fail(409, `${zid(z5.no)} comes from SAP; abort it instead of deleting`);
      db.z3s.forEach((z) => { if (z.z5 === z5.no) { z.z5 = null; z.z5Source = null; } });
      db.z5s.forEach((z) => { if (z.parent === z5.no) z.parent = null; });
      db.z5s = db.z5s.filter((x) => x !== z5);
      persist(); return send(res, 200, { ok: true });
    }
    if (z5 && c === 'workstreams' && d) {
      const w = z5.workstreams.find((x) => x.key === d) || fail(404, 'Unknown workstream');
      if (m === 'PATCH' && !e) {
        const body = await readJson(req);
        for (const f of ['owner', 'entry', 'planned']) if (body[f] !== undefined) w[f] = body[f];
        persist(); return send(res, 200, z5);
      }
      if (m === 'POST' && e === 'close') { const body = await readJson(req); closeWorkstream(z5, d, body.date); persist(); return send(res, 200, z5); }
      if (m === 'POST' && e === 'reopen') { reopenWorkstream(z5, d); persist(); return send(res, 200, z5); }
    }
    // Comments under a working note, by anyone logged in.
    if (z5 && c === 'updates' && d && e === 'comments' && m === 'POST') {
      const u = z5.updates.find((x) => x.id === d) || fail(404, 'Update not found');
      const { text } = await readJson(req);
      if (!String(text || '').trim()) fail(400, 'Write a comment first');
      const cm = { id: uid('c'), author: user(), at: nowIso(), text: String(text).trim() };
      u.comments = u.comments || [];
      u.comments.push(cm);
      persist(); return send(res, 201, cm);
    }
    if (z5 && c === 'updates' && !d && m === 'POST') {
      const u = addUpdate(z5, await readJson(req));
      persist(); return send(res, 201, u);
    }
    // Triage-record minutes. "Update given" is a real update, so it counts for the KPIs and shows in the notes.
    if (z5 && c === 'records' && m === 'POST') {
      const body = await readJson(req);
      const out = body.type === 'Update given' ? addUpdate(z5, { ...body, type: 'Progress' }) : addRecord(z5, body);
      if (body.type !== 'Update given' && body.followUp) { z5.followUpDate = body.followUp; log(z5, `Follow-up set to ${body.followUp}`); }
      persist(); return send(res, 201, out);
    }
  }

  // SAP import: preview writes nothing; apply re-runs the same analysis and writes SAP-owned fields only.
  if (a === 'import') {
    requireAdmin();
    if (m === 'GET' && b === 'sample' && (c === 'z5' || c === 'z3')) return sendDownload(res, `sap-${c}-sample.csv`, 'text/csv; charset=utf-8', sampleExport(c));
    if (m === 'POST' && (b === 'preview' || b === 'apply')) {
      const body = await readJson(req);
      let analysed;
      try { analysed = importer.analyse(db, body); } catch (err) { fail(400, err.message); }
      const { result, plan } = analysed;
      if (b === 'preview') return send(res, 200, result);
      if (!plan) fail(400, `Map the required columns first: ${result.missingRequired.join(', ')}`);
      const counts = importer.apply(db, plan, importCtx());
      if (body.saveMapping !== false) db.settings.importMappings = { ...db.settings.importMappings, [body.kind]: result.mapping };
      const archived = archiveImport(body.kind, body.file, body.text, result, counts);
      db.imports.unshift({
        id: uid('i'), at: nowIso(), by: user(), kind: body.kind, file: body.file || '',
        period: result.period ? `${result.period.from} – ${result.period.to}` : '',
        created: counts.created, updated: counts.updated, rejected: result.rejected.length, hash: result.hash, archived,
      });
      persist();
      return send(res, 200, { ...counts, rejected: result.rejected.length, archived });
    }
  }

  // Move rate: parts moved per ISO week (keyed by the Monday), used to normalize the trend chart.
  if (a === 'moverate' && m === 'PUT') {
    requireAdmin();
    const { rows = [], replace = false } = await readJson(req);
    const byWeek = new Map(replace ? [] : db.moveRate.map((r) => [r.week, r]));
    for (const r of rows) {
      const wk = mondayOf(String(r.week || '').slice(0, 10));
      if (!wk) fail(400, `Not a date: "${r.week}"`);
      if (r.parts === null || r.parts === '') { byWeek.delete(wk); continue; }
      const parts = Number(r.parts);
      if (!Number.isFinite(parts) || parts < 0) fail(400, `Parts for ${wk} must be a positive number`);
      byWeek.set(wk, { week: wk, parts: Math.round(parts) });
    }
    db.moveRate = [...byWeek.values()].sort((x, y) => x.week.localeCompare(y.week));
    persist(); return send(res, 200, db.moveRate);
  }

  if (a === 'teams' && m === 'PUT') {
    requireAdmin();
    const { teams } = await readJson(req);
    if (!Array.isArray(teams)) fail(400, 'teams must be a list');
    db.teams = teams.filter((t) => t.lead).map((t) => ({ lead: String(t.lead), dept: String(t.dept || ''), members: (t.members || []).map(String).filter(Boolean) }));
    persist(); return send(res, 200, db.teams);
  }

  if (a === 'drb') {
    const body = m === 'GET' ? {} : await readJson(req);
    if (b === 'settings' && m === 'PUT') {
      if (body.chair !== undefined) db.drb.chair = String(body.chair);
      if (body.date) currentSession().date = body.date;
      persist(); return send(res, 200, db.drb);
    }
    if (b === 'review' && m === 'POST') {
      const z5 = findZ5(body.z5);
      const s = currentSession();
      const note = String(body.note || '').trim() || 'Reviewed.';
      s.items = s.items.filter((i) => i.z5 !== z5.no);
      s.items.push({ z5: z5.no, note, by: user(), at: nowIso() });
      const f = z5.workstreams.find((w) => !w.closed);
      addRecord(z5, { date: s.date, type: 'DRB review', ws: f ? f.key : '', text: note });
      persist(); return send(res, 200, s);
    }
    if (b === 'close-session' && m === 'POST') {
      const s = currentSession();
      s.closed = true;
      s.closedAt = nowIso();
      const next = new Date(s.date + 'T12:00:00Z'); next.setUTCDate(next.getUTCDate() + 7);
      const nd = next.toISOString().slice(0, 10) > today() ? next.toISOString().slice(0, 10) : nextThursday();
      db.drb.sessions.push({ id: uid('s'), date: nd, closed: false, items: [] });
      persist(); return send(res, 200, db.drb);
    }
    if (b === 'guidance' && m === 'POST') {
      const z5 = findZ5(body.z5);
      if (!String(body.text || '').trim()) fail(400, 'Write the guidance');
      const g = { id: uid('g'), z5: z5.no, owner: body.owner || '', due: body.due || '', text: String(body.text), done: false, at: nowIso(), by: user() };
      db.drb.guidance.unshift(g);
      addRecord(z5, { date: currentSession().date, type: 'Guidance', text: `${g.text}${g.owner ? ` Owner ${g.owner}` : ''}${g.due ? `, due ${g.due}` : ''}.` });
      persist(); return send(res, 201, g);
    }
    if (b === 'guidance' && m === 'PATCH' && c) {
      const g = db.drb.guidance.find((x) => x.id === c) || fail(404, 'Guidance not found');
      g.done = !!body.done;
      g.doneAt = g.done ? today() : '';
      persist(); return send(res, 200, g);
    }
    if (b === 'help' && m === 'POST') {
      const z5 = findZ5(body.z5);
      if (!String(body.text || '').trim()) fail(400, 'Describe what help is needed');
      const h = { id: uid('h'), z5: z5.no, type: body.type || 'FTE', text: String(body.text), status: 'Decision needed', by: user(), at: nowIso() };
      db.drb.help.unshift(h);
      addRecord(z5, { type: 'Help request', text: `${h.type}: ${h.text}` });
      persist(); return send(res, 201, h);
    }
    if (b === 'help' && m === 'PATCH' && c) {
      const h = db.drb.help.find((x) => x.id === c) || fail(404, 'Help request not found');
      const allowed = ['Decision needed', 'Approved', 'Rejected', 'Awaiting quote', 'Closed'];
      if (!allowed.includes(body.status)) fail(400, 'Unknown status');
      h.status = body.status;
      h.decided = today();
      const z5 = db.z5s.find((z) => z.no === h.z5);
      if (z5) addRecord(z5, { type: 'Help request', text: `${h.type} request ${h.status.toLowerCase()}: ${h.text}` });
      persist(); return send(res, 200, h);
    }
  }

  if (a === 'upload' && m === 'POST') return handleUpload(req, res, url.searchParams);

  if (a === 'attachments' && m === 'DELETE' && b && c && d) {
    removeAttachment(b, c, d); persist(); return send(res, 200, { ok: true });
  }

  if (a === 'reveal' && m === 'POST') {
    requireAdmin();
    const { path: rel, where } = await readJson(req);
    if (where === 'data') { reveal(dataDir()); return send(res, 200, { ok: true, path: dataDir() }); }
    const target = rel ? within(uploadRoot(), rel) : uploadRoot();
    if (!target) fail(400, 'Path outside the upload folder');
    reveal(target);
    return send(res, 200, { ok: true, path: target });
  }

  if (a === 'reset' && m === 'POST') {
    requireAdmin();
    const { mode } = await readJson(req);
    const keep = db.settings;
    const keepTeams = db.teams;
    const keepMove = db.moveRate;
    const keepUsers = db.users;
    const keepSecret = db.meta.secret;
    db = mode === 'demo' ? seedDemo() : migrate(emptyDb());
    // Accounts and the login secret survive a reset, so nobody is logged out.
    db.users = keepUsers;
    db.meta.secret = keepSecret;
    if (mode !== 'demo') {
      db.settings = { ...db.settings, lists: keep.lists, board: keep.board, importMappings: keep.importMappings };
      db.teams = keepTeams; db.moveRate = keepMove;
    }
    persist(); return send(res, 200, { ok: true });
  }

  // One table as CSV, for reading in Excel.
  if (a === 'export') requireAdmin();
  if (a === 'export' && b === 'table' && c && m === 'GET') {
    const name = c.replace(/\.csv$/, '');
    if (!TABLES[name]) fail(404, `No table "${name}"`);
    const rows = split(db)[name] || [];
    const cols = [...new Set([...TABLES[name], ...rows.flatMap((r) => Object.keys(r))])];
    return sendDownload(res, `${name}-${today()}.csv`, 'text/csv; charset=utf-8', '﻿' + csv.stringify(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Array.isArray(v) ? v.join(' | ') : v]))), cols));
  }

  if (a === 'export' && m === 'GET') {
    return sendDownload(res, `irm-backup-${today()}.json`, 'application/json', JSON.stringify(db, null, 2));
  }

  if (a === 'restore' && m === 'POST') {
    requireAdmin();
    const body = await readJson(req);
    if (!Array.isArray(body.z3s) || !Array.isArray(body.z5s) || !body.meta) fail(400, 'Not an IRM backup file');
    const keepUsers = db.users, keepSecret = db.meta.secret;
    db = migrate(body);
    if (!db.users.some((u) => u.password)) db.users = keepUsers;
    db.meta.secret = db.meta.secret || keepSecret;
    persist(); return send(res, 200, { ok: true });
  }

  fail(404, `No route for ${m} ${url.pathname}`);
}

const server = http.createServer((req, res) => {
  als.run({ account: accountFrom(req) }, async () => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (url.pathname.startsWith('/files/')) {
        if (!account()) return send(res, 401, { error: 'Please log in' });
        const file = within(uploadRoot(), decodeURIComponent(url.pathname.slice('/files/'.length)));
        if (!file) return send(res, 400, { error: 'Bad path' });
        return serveFile(res, file, { download: url.searchParams.has('download') });
      }
      const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const file = within(PUBLIC, rel);
      if (!file) return send(res, 400, { error: 'Bad path' });
      return serveFile(res, file);
    } catch (err) {
      if (!(err instanceof HttpError)) console.error(err);
      send(res, err.status || 500, { error: err.message });
    }
  });
});

try {
  loadDb();
} catch (e) {
  console.error(`\nCannot start: ${e.message}\n`);
  process.exit(1);
}
fs.mkdirSync(uploadRoot(), { recursive: true });
server.listen(config.port, config.host, () => {
  console.log(`IRM MVP running at http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
  console.log(`  data folder   ${dataDir()}`);
  console.log(`  upload folder ${uploadRoot()}`);
});
