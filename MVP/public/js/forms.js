// Create/edit dialogs for Z3s and Z5s, and the attachment panel with upload.

import { api } from './api.js';
import { store, Z3_STATUS } from './store.js';
import { esc, options, dialog, toast, todayIso, fmtSize, weekCode, icon, z5Id } from './util.js';

const L = () => store.lists;

function field(label, control, { span = 1, hint = '' } = {}) {
  return `<div class="field" style="grid-column:span ${span}"><label>${esc(label)}</label>${control}${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</div>`;
}
const sel = (name, list, value, blank) => `<select class="input" name="${name}">${options(list, value, { blank })}</select>`;
const txt = (name, value = '', attrs = '') => `<input class="input" name="${name}" value="${esc(value)}" ${attrs}>`;
const date = (name, value = '') => `<input class="input" type="date" name="${name}" value="${esc(value)}">`;
const area = (name, value = '', rows = 4, ph = '') => `<textarea class="input" name="${name}" rows="${rows}" placeholder="${esc(ph)}">${esc(value)}</textarea>`;

// SAP-owned values, shown read-only.
export function sapBlock(pairs) {
  return `<dl class="readonly-grid">${pairs.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value ?? '') || '<span class="muted">—</span>'}</dd></div>`).join('')}</dl>`;
}

export const sourceBadge = (z5) => z5.source === 'provisional' ? '<span class="src src-prov" title="Started in the app; not yet in SAP">provisional</span>'
  : z5.sapStatus === 'pending' ? '<span class="src src-sap" title="Matched to a SAP number; SAP fields follow with the next import">SAP · pending</span>'
  : '<span class="src src-sap" title="Number, name, failure code and priority come from SAP">SAP</span>';

// New Z5s start provisional (P-001 …) and are matched to their SAP number later.
// For a SAP Z5 the name, failure code and priority are read-only.
export function z5Dialog(existing, { onSaved, linkZ3s = [], seed = {} } = {}) {
  const z = existing || { priority: '', projectLead: store.me, raised: todayIso(), source: 'provisional', ...seed };
  const sap = z.source !== 'provisional';
  dialog({
    title: existing ? `Edit ${z5Id(z.no)}` : 'New provisional Z5',
    submit: existing ? 'Save Z5' : 'Create provisional Z5',
    wide: true,
    body: `${existing ? '' : '<p class="small muted">Use this when a structural issue needs work before SAP has a Z5 number. It gets a provisional number (P-001 …); once SAP has the Z5, match it from the Z5 page and all work moves onto the SAP number.</p>'}
      ${sap ? `<p class="small muted">Number, name, failure code and priority come from SAP.</p>${sapBlock([['Z5 number', z5Id(z.no)], ['Name', z.title], ['Failure code', z.failureCode], ['Priority', z.priority]])}` : ''}
      <div class="form-grid" style="margin-top:12px">
      ${sap ? '' : `${field('Name', txt('title', z.title, 'placeholder="Short name for the structural issue" required'), { span: 2 })}
        ${field('Failure code', sel('failureCode', L().failureCodes, z.failureCode, 'Select failure code'))}
        ${field('Priority', sel('priority', L().priorities, z.priority, '—'))}`}
      ${field('Description', area('description', z.description, 3, 'What is the structural issue? Scope, signature, affected products.'), { span: 4 })}
      ${field('Project lead', `<input class="input" name="projectLead" list="people" value="${esc(z.projectLead)}">`)}
      ${field('Engineering owner', `<input class="input" name="engOwner" list="people" value="${esc(z.engOwner)}" placeholder="unassigned">`)}
      ${field('Committed availability', date('committedDate', z.committedDate))}
      ${field('Next follow-up', date('followUpDate', z.followUpDate))}
      ${field('Raised', date('raised', z.raised))}
      ${linkZ3s.length ? `<div class="field" style="grid-column:span 3"><label>Z3s to link</label><div class="chips">${linkZ3s.map((n) => `<span class="tag tag-accent">Z3-${n}</span>`).join(' ')}</div></div>` : ''}
    </div>`,
    async onSubmit(data) {
      if (!sap && !String(data.title || '').trim()) throw new Error('Give the Z5 a name');
      const saved = existing ? await api.updateZ5(z.no, data) : await api.createZ5({ ...data, linkZ3s });
      toast(existing ? `${z5Id(saved.no)} saved` : `${z5Id(saved.no)} created — match it to the SAP number once SAP has it`);
      await onSaved?.(saved);
    },
  });
}

// ---------- attachments ----------

const isImg = (a) => /^image\//.test(a.type) || /\.(png|jpe?g|gif|webp|svg)$/i.test(a.name);

export function attachmentList(list, { kind, no, removable = true } = {}) {
  if (!list.length) return '<p class="muted small">No files yet.</p>';
  return `<ul class="att-list">${list.map((a) => `
    <li>
      ${isImg(a) ? icon.img : icon.file}
      <a href="/files/${encodeURI(a.path)}" target="_blank" rel="noopener" title="${esc(a.path)}">${esc(a.name)}</a>
      <span class="muted num">${fmtSize(a.size)} · ${weekCode(a.uploaded)} · ${esc(a.by)}</span>
      <span class="att-actions">
        <button type="button" class="btn btn-ghost btn-icon" title="Show in folder" data-reveal="${esc(a.path)}">${icon.folder}</button>
        <a class="btn btn-ghost btn-icon" title="Download" href="/files/${encodeURI(a.path)}?download">↓</a>
        ${removable ? `<button type="button" class="btn btn-ghost btn-icon" title="Delete file" data-del-att="${esc(a.id)}" data-kind="${kind}" data-no="${no}">${icon.trash}</button>` : ''}
      </span>
    </li>`).join('')}</ul>`;
}

export function dropZone(id, { hint = 'Metrology exports, DOE sheets, images, reports' } = {}) {
  return `<label class="dropzone" data-drop="${id}">
    ${icon.clip}
    <span class="dz-text"><span>Drop files here, or browse</span><span class="muted small">${esc(hint)}</span></span>
    <span class="btn btn-secondary dz-btn">Browse</span>
    <input type="file" multiple hidden data-file="${id}">
    <span class="dz-progress" hidden></span>
  </label>`;
}

// Wires every dropzone and attachment action inside `root`.
// getTarget(id) → { kind, no, update? } decides where the files go.
export function wireFiles(root, getTarget, onDone) {
  const uploadAll = async (zone, files) => {
    const target = getTarget(zone.dataset.drop);
    if (!target) return;
    const prog = zone.querySelector('.dz-progress');
    prog.hidden = false;
    let last;
    try {
      for (const [i, file] of [...files].entries()) {
        last = await api.upload(target.kind, target.no, file, {
          update: target.update,
          onProgress: (p) => { prog.textContent = `Uploading ${i + 1}/${files.length} · ${Math.round(p * 100)}%`; },
        });
      }
      toast(files.length === 1 ? `Saved to ${last.savedTo}` : `${files.length} files saved to ${last.savedTo.replace(/[\\/][^\\/]+$/, '')}`);
    } catch (e) {
      toast(e.message, 'error');
    }
    prog.hidden = true;
    await onDone?.();
  };

  root.querySelectorAll('[data-drop]').forEach((zone) => {
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('over');
      if (e.dataTransfer.files.length) uploadAll(zone, e.dataTransfer.files);
    });
    zone.querySelector('input[type=file]').addEventListener('change', (e) => {
      if (e.target.files.length) uploadAll(zone, e.target.files);
    });
  });

  root.addEventListener('click', async (e) => {
    const rev = e.target.closest('[data-reveal]');
    if (rev) { e.preventDefault(); api.reveal(rev.dataset.reveal).catch((x) => toast(x.message, 'error')); return; }
    const del = e.target.closest('[data-del-att]');
    if (del) {
      e.preventDefault();
      try {
        await api.deleteAttachment(del.dataset.kind, del.dataset.no, del.dataset.delAtt);
        toast('File deleted');
        await onDone?.();
      } catch (x) { toast(x.message, 'error'); }
    }
  });
}
