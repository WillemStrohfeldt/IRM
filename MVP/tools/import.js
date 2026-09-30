#!/usr/bin/env node
// Command-line SAP import, for scheduled jobs. Same rules as the Import screen: preview by default,
// write only with --apply. Refuses to run while the server holds the data folder (stop it, or use the UI).
//
//   node tools/import.js z5 exports/z5.csv            preview
//   node tools/import.js z3 exports/z3.csv --apply    import
//   options: --user "Name"  recorded as the importer (default: SAP import job)
// Exports cover a period (e.g. last month) and are appended: new numbers added, known numbers updated.

const fs = require('fs');
const path = require('path');
const { TableStore } = require('../lib/storage');
const importer = require('../lib/importer');
const { migrate, WORKSTREAMS } = require('../seed');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const [kind, file] = args.filter((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--user');
const flag = (f) => args.includes(f);
const who = args.includes('--user') ? args[args.indexOf('--user') + 1] : 'SAP import job';
if (!['z5', 'z3'].includes(kind) || !file) {
  console.log('Usage: node tools/import.js <z5|z3> <file.csv> [--apply] [--user "Name"]');
  process.exit(1);
}

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const dir = path.isAbsolute(cfg.dataDir || 'data') ? cfg.dataDir : path.join(ROOT, cfg.dataDir || 'data');
const store = new TableStore(dir);
try { store.acquireLock(); } catch (e) { console.error(e.message); process.exit(2); }

const db = migrate(store.load());
const text = fs.readFileSync(file, 'utf8');
const { result, plan } = importer.analyse(db, { kind, text, file: path.basename(file) });

console.log(`${kind.toUpperCase()} export ${path.basename(file)}: ${result.total} rows`);
console.log('  mapping   ', Object.entries(result.mapping).map(([k, h]) => `${k}←"${h}"`).join(', '));
if (!plan) { console.error(`  missing required columns: ${result.missingRequired.join(', ')}`); process.exit(3); }
if (result.period) console.log(`  created between ${result.period.from} and ${result.period.to}`);
if (result.alreadyImported) console.log(`  note: this exact file was already imported on ${result.alreadyImported.at.slice(0, 10)} by ${result.alreadyImported.by}`);
console.log(`  new ${result.created.length} · changed ${result.changed.length} · unchanged ${result.unchanged} · rejected ${result.rejected.length}${kind === 'z3' ? ` · link changes ${result.links.length}` : ''}`);
result.rejected.slice(0, 20).forEach((r) => console.log(`  rejected line ${r.line}: ${r.reason}`));

if (!flag('--apply')) { console.log('Preview only. Add --apply to write.'); process.exit(0); }
const now = new Date().toISOString();
const counts = importer.apply(db, plan, { today: now.slice(0, 10), now, user: who, WORKSTREAMS });
const out = path.join(ROOT, 'imports', 'processed', now.slice(0, 10));
fs.mkdirSync(out, { recursive: true });
const base = `${now.slice(11, 19).replace(/:/g, '')}-${kind}-${path.basename(file, '.csv')}`;
fs.copyFileSync(file, path.join(out, `${base}.csv`));
fs.writeFileSync(path.join(out, `${base}.report.json`), JSON.stringify({ at: now, by: who, kind, file, period: result.period, counts, rejected: result.rejected, links: result.links }, null, 2));
db.imports.unshift({
  id: `i${Date.now().toString(36)}`, at: now, by: who, kind, file: path.basename(file), period: result.period ? `${result.period.from} – ${result.period.to}` : '',
  created: counts.created, updated: counts.updated, rejected: result.rejected.length, hash: result.hash, archived: path.relative(ROOT, path.join(out, `${base}.csv`)),
});
store.save(db);
console.log(`Imported: ${counts.created} new, ${counts.updated} changed${counts.stubs ? `, ${counts.stubs} Z5s created from links` : ''}.`);
