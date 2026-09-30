// CSV reading/writing for SAP exports: comma, semicolon or tab separated, quoted fields,
// line breaks inside quotes, and an optional byte-order mark.

function detectDelimiter(firstLine) {
  const count = (ch) => {
    let n = 0, quoted = false;
    for (const c of firstLine) {
      if (c === '"') quoted = !quoted;
      else if (!quoted && c === ch) n++;
    }
    return n;
  };
  return [';', '\t', ','].map((d) => [d, count(d)]).sort((a, b) => b[1] - a[1])[0][0];
}

// Returns { headers: string[], rows: string[][] } with blank lines skipped.
function parse(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const sep = detectDelimiter(firstLine);
  const out = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) out.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) out.push(row);
  if (!out.length) return { headers: [], rows: [], delimiter: sep };
  return { headers: out[0].map((h) => h.trim()), rows: out.slice(1), delimiter: sep };
}

function stringify(rows, cols, sep = ';') {
  const q = (v) => {
    const s = String(v ?? '');
    return s.includes(sep) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(sep), ...rows.map((r) => cols.map((c) => q(r[c])).join(sep))].join('\r\n') + '\r\n';
}

module.exports = { parse, stringify, detectDelimiter };
