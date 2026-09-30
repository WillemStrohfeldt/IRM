// Shared helpers: escaping, YYWW.D dates, toasts, dialogs, CSV.

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const todayIso = () => new Date().toISOString().slice(0, 10);

// YYWW.D — two-digit ISO year, ISO week, ISO weekday (Mon = 1).
export function weekCode(iso) {
  if (!iso) return '';
  const d = new Date(iso.slice(0, 10) + 'T12:00:00Z');
  if (isNaN(d)) return iso;
  const day = d.getUTCDay() || 7;
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);
  return `${String(thursday.getUTCFullYear()).slice(2)}${String(week).padStart(2, '0')}.${day}`;
}

export const dateCell = (iso, cls = '') => iso ? `<span class="num ${cls}" title="${esc(iso)}">${weekCode(iso)}</span>` : '<span class="muted">—</span>';

export function daysFromToday(iso) {
  if (!iso) return null;
  return Math.round((new Date(iso.slice(0, 10) + 'T12:00:00Z') - new Date(todayIso() + 'T12:00:00Z')) / 86400000);
}

export function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const z3Id = (no) => `Z3-${no}`;
// Provisional Z5s (started in the app, not yet in SAP) are numbered from 9e14 and read "P-001".
export const PROVISIONAL = 9e14;
export const isProvisional = (no) => Number(no) >= PROVISIONAL;
export const z5Id = (no) => (isProvisional(no) ? `P-${String(Number(no) - PROVISIONAL).padStart(3, '0')}` : `Z5-${String(no).padStart(3, '0')}`);
// Upload sub-folder of a Z5, as the server names it.
export const z5Folder = (no) => (isProvisional(no) ? `Z5-${z5Id(no)}` : `Z5-${no}`);

export function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function fmtStamp(iso) {
  if (!iso) return '';
  return `${weekCode(iso)} ${iso.slice(11, 16)}`;
}

export const options = (list, selected, { blank } = {}) =>
  (blank !== undefined ? `<option value="">${esc(blank)}</option>` : '') +
  list.map((v) => `<option ${v === selected ? 'selected' : ''}>${esc(v)}</option>`).join('');

// ---------- toasts ----------

export function toast(msg, kind = 'ok') {
  let host = document.getElementById('toasts');
  if (!host) { host = document.createElement('div'); host.id = 'toasts'; document.body.append(host); }
  const t = document.createElement('div');
  t.className = `toast toast-${kind}`;
  t.textContent = msg;
  host.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 6000 : 3200);
}

// ---------- dialog ----------

export function dialog({ title, body, submit = 'Save', wide = false, onSubmit, onMount, onClose }) {
  const back = document.createElement('div');
  back.className = 'dialog-backdrop';
  back.innerHTML = `
    <form class="dialog blueprint ${wide ? 'dialog-wide' : ''}" novalidate>
      <div class="dialog-title"><h2>${esc(title)}</h2><button type="button" class="btn btn-ghost btn-icon" data-close aria-label="Close">×</button></div>
      <div class="dialog-body">${body}</div>
      <div class="dialog-err" hidden></div>
      <div class="dialog-actions">
        <button type="button" class="btn btn-secondary" data-close>Cancel</button>
        ${submit ? `<button class="btn btn-primary">${esc(submit)}</button>` : ''}
      </div>
    </form>`;
  const form = back.querySelector('form');
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  back.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = form.querySelector('.dialog-err');
    err.hidden = true;
    const data = Object.fromEntries(new FormData(form));
    const btn = form.querySelector('.btn-primary');
    if (btn) btn.disabled = true;
    try {
      const keepOpen = await onSubmit(data, form);
      if (!keepOpen) close();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      if (btn) btn.disabled = false;
    }
  });
  document.body.append(back);
  onMount?.(form, close);
  form.querySelector('input:not([type=hidden]),select,textarea')?.focus();
  return close;
}

export function confirmDialog(title, text, { confirm = 'Confirm' } = {}) {
  return new Promise((resolve) => {
    let ok = false;
    dialog({ title, submit: confirm, body: `<p>${esc(text)}</p>`, onSubmit: () => { ok = true; }, onClose: () => resolve(ok) });
  });
}

// ---------- CSV ----------

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const sep = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

export function toCsv(rows, cols) {
  const q = (v) => { const s = String(v ?? ''); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => q(r[c])).join(','))].join('\n');
}

export function download(name, text, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const icon = {
  clip: '<svg viewBox="0 0 24 24" class="ic"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57a4 4 0 0 1 5.66 5.66l-8.58 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>',
  file: '<svg viewBox="0 0 24 24" class="ic"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h6"/></svg>',
  img: '<svg viewBox="0 0 24 24" class="ic"><rect x="3" y="3" width="18" height="18" rx="1"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4.5-4.5L9 18"/></svg>',
  search: '<svg viewBox="0 0 24 24" class="ic"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
  folder: '<svg viewBox="0 0 24 24" class="ic"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" class="ic"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  link: '<svg viewBox="0 0 24 24" class="ic"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
};

