// Thin client for the MVP server.

// Who is working is decided by the login: the server sets a session cookie that goes with every request.
// A 401 anywhere means the session is gone, and the app shows the login screen again.
async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.endsWith('/login')) window.dispatchEvent(new Event('irm:logged-out'));
  if (!res.ok) throw Object.assign(new Error(data.error || `${res.status} ${res.statusText}`), { status: res.status });
  return data;
}

export const api = {
  login: (username, password) => call('POST', '/api/login', { username, password }),
  logout: () => call('POST', '/api/logout', {}),
  me: () => call('GET', '/api/me'),
  db: () => call('GET', '/api/db'),
  settings: () => call('GET', '/api/settings'),
  saveSettings: (body) => call('PUT', '/api/settings', body),
  saveBoard: (board) => call('PUT', '/api/settings', { board }),
  saveMoveRate: (rows, replace = false) => call('PUT', '/api/moverate', { rows, replace }),

  updateZ3: (no, body) => call('PATCH', `/api/z3/${no}`, body),

  createZ5: (body) => call('POST', '/api/z5', body),
  updateZ5: (no, body) => call('PATCH', `/api/z5/${no}`, body),
  deleteZ5: (no) => call('DELETE', `/api/z5/${no}`),
  matchZ5: (no, sap) => call('POST', `/api/z5/${no}/match`, { sap }),

  importPreview: (body) => call('POST', '/api/import/preview', body),
  importApply: (body) => call('POST', '/api/import/apply', body),

  updateWorkstream: (no, key, body) => call('PATCH', `/api/z5/${no}/workstreams/${key}`, body),
  closeWorkstream: (no, key, date) => call('POST', `/api/z5/${no}/workstreams/${key}/close`, { date }),
  reopenWorkstream: (no, key) => call('POST', `/api/z5/${no}/workstreams/${key}/reopen`, {}),
  postUpdate: (no, body) => call('POST', `/api/z5/${no}/updates`, body),
  addComment: (no, update, text) => call('POST', `/api/z5/${no}/updates/${update}/comments`, { text }),
  addRecord: (no, body) => call('POST', `/api/z5/${no}/records`, body),

  saveTeams: (teams) => call('PUT', '/api/teams', { teams }),
  drbSettings: (body) => call('PUT', '/api/drb/settings', body),
  drbReview: (z5, note) => call('POST', '/api/drb/review', { z5, note }),
  drbCloseSession: () => call('POST', '/api/drb/close-session', {}),
  addGuidance: (body) => call('POST', '/api/drb/guidance', body),
  setGuidance: (id, done) => call('PATCH', `/api/drb/guidance/${id}`, { done }),
  addHelp: (body) => call('POST', '/api/drb/help', body),
  setHelp: (id, status) => call('PATCH', `/api/drb/help/${id}`, { status }),

  link: (z3s, z5) => call('POST', '/api/link', { z3s, z5 }),

  deleteAttachment: (kind, no, id) => call('DELETE', `/api/attachments/${kind}/${no}/${id}`),
  reveal: (path, where) => call('POST', '/api/reveal', { path, where }),
  reset: (mode) => call('POST', '/api/reset', { mode }),
  restore: (db) => call('POST', '/api/restore', db),

  // Streams the raw file to the server, which writes it into the upload folder.
  upload(kind, no, file, { update, onProgress } = {}) {
    return new Promise((resolve, reject) => {
      const q = new URLSearchParams({ kind, no: String(no) });
      if (update) q.set('update', update);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/upload?${q}`);
      xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
      if (file.type) xhr.setRequestHeader('Content-Type', file.type);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch {}
        xhr.status < 300 ? resolve(data) : reject(new Error(data.error || `Upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error('Upload failed — is the server running?'));
      xhr.send(file);
    });
  },
};
