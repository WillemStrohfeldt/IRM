// App shell: hash router, left nav, header search and "new" buttons.

import { store } from './store.js';
import { esc, toast, dialog } from './util.js';
import { z5Dialog } from './forms.js';
import { api } from './api.js';
import board from './views/board.js';
import overview from './views/overview.js';
import detail from './views/detail.js';
import z3list from './views/z3list.js';
import z3detail from './views/z3detail.js';
import linking from './views/linking.js';
import search from './views/search.js';
import data from './views/data.js';
import drb from './views/drb.js';
import teams from './views/teams.js';

const routes = [
  { re: /^board$/, view: board, nav: 'board' },
  { re: /^drb$/, view: drb, nav: 'drb' },
  { re: /^teams(?:\/(\d+))?$/, view: teams, nav: 'teams' },
  { re: /^z5$/, view: overview, nav: 'z5' },
  { re: /^z5\/(\d+)(?:\/(\w+))?$/, view: detail, nav: 'z5' },
  { re: /^link$/, view: linking, nav: 'link' },
  { re: /^z3$/, view: z3list, nav: 'z3' },
  { re: /^z3\/(\d+)$/, view: z3detail, nav: 'z3' },
  { re: /^search$/, view: search, nav: 'search' },
  { re: /^data$/, view: data, nav: 'data' },
];

const main = document.getElementById('main');

export function go(hash) { location.hash = hash; }

const home = () => (store.isAdmin ? 'board' : 'z5');

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '') || home();
  const [path, qs = ''] = raw.split('?');
  return { path, query: new URLSearchParams(qs) };
}

export async function render() {
  if (!store.user || !store.db) return; // not logged in yet, or data still loading
  const { path, query } = parseHash();
  const route = routes.find((r) => r.re.test(path)) || routes.find((r) => r.nav === home());
  const params = path.match(route.re)?.slice(1) || [];
  // Screens this account may not see send it to its home screen.
  if (!store.canSee(route.nav)) { history.replaceState(null, '', `#/${home()}`); return render(); }
  document.querySelectorAll('#nav a').forEach((a) => {
    a.hidden = !store.canSee(a.dataset.nav);
    a.toggleAttribute('aria-current', a.dataset.nav === route.nav);
  });
  const unlinked = store.db.z3s.filter((z) => z.z5 == null).length;
  document.getElementById('nav-unlinked').textContent = unlinked || '';
  document.getElementById('whoami').innerHTML = `${esc(store.me)} <span class="role">${store.isAdmin ? 'admin' : 'user'}</span>`;
  document.getElementById('people').innerHTML = store.lists.people.map((p) => `<option value="${esc(p)}">`).join('');

  const el = document.createElement('section');
  el.className = 'screen';
  const prev = main.dataset.path || '';
  const sameZ5Tabs = /^z5\/\d+/.test(path) && prev.split('/').slice(0, 2).join('/') === path.split('/').slice(0, 2).join('/');
  const scrollY = prev === path || sameZ5Tabs ? window.scrollY : 0;
  try {
    await route.view(el, { params, query, refresh, go });
  } catch (e) {
    console.error(e);
    el.innerHTML = `<div class="empty"><h2>Something went wrong</h2><p>${esc(e.message)}</p></div>`;
  }
  main.replaceChildren(el);
  main.dataset.path = path;
  // Switching tabs on a Z5 keeps the tab bar where it was instead of jumping to the top of the page.
  const tabs = sameZ5Tabs && prev !== path ? el.querySelector('.z5tabs') : null;
  if (tabs) {
    const pinned = tabs.getBoundingClientRect().top + window.scrollY - document.querySelector('.topbar').offsetHeight;
    window.scrollTo(0, Math.min(scrollY, pinned));
  } else window.scrollTo(0, scrollY);
}

// Reload data from the server, then redraw the current screen.
export async function refresh() {
  await store.load();
  await render();
}

// Account menu: who is logged in, what they may see, and log out.
function accountMenu() {
  const u = store.user;
  dialog({
    title: u.name, submit: 'Log out',
    body: `<dl class="kv"><dt>User name</dt><dd>${esc(u.username)}</dd><dt>Role</dt><dd>${u.role === 'admin' ? 'Admin — sees everything' : 'User'}</dd>
      <dt>Team</dt><dd>${esc(u.team ? `${u.team}'s team` : '—')}</dd></dl>
      ${u.role === 'admin' ? '' : '<p class="small muted">Users do not see the KPI board, and see Teams only for their own team. Settings and SAP imports are for admins.</p>'}
      <p class="small muted">Everything you post, comment, upload or change is recorded under your name.</p>`,
    async onSubmit() { await api.logout(); showLogin(); },
  });
}
document.getElementById('whoami').addEventListener('click', accountMenu);

// Start (or restart after a login) without reloading the page, so the requested screen is kept.
async function boot() {
  store.user = await api.me();
  document.body.classList.toggle('is-admin', store.user.role === 'admin');
  await store.load();
  document.getElementById('login')?.remove();
  document.body.classList.remove('logged-out');
  delete main.dataset.path;
  await render();
}

function showLogin(message = '') {
  store.user = null;
  store.db = null;
  main.replaceChildren();
  loginScreen(message);
}

// Demo login. The accounts are in the users table of the data folder.
function loginScreen(message = '') {
  document.body.classList.add('logged-out');
  let box = document.getElementById('login');
  if (!box) { box = document.createElement('div'); box.id = 'login'; document.body.append(box); }
  box.innerHTML = `
    <form class="login-card" novalidate>
      <div class="login-brand"><span class="brand-name">IRM Cockpit</span><span class="brand-sub">Issue resolution · MVP</span></div>
      <div class="login-body">
        <h1>Log in</h1>
        <div class="field"><label>User name</label><input class="input" name="username" autocomplete="username" autofocus></div>
        <div class="field"><label>Password</label><input class="input" name="password" type="password" autocomplete="current-password"></div>
        <p class="login-err warn small" ${message ? '' : 'hidden'}>${esc(message)}</p>
        <button class="btn btn-primary btn-block">Log in</button>
        <div class="login-demo small">
          <b>Demo accounts</b>
          <span><code>admin</code> / <code>admin</code> — R. Aalders, sees everything</span>
          <span><code>user</code> / <code>user</code> — S. Oyelaran, K. Baars' team: no KPI board, only their own team</span>
        </div>
      </div>
    </form>`;
  const form = box.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { username, password } = Object.fromEntries(new FormData(form));
    try {
      await api.login(username, password);
      await boot();
    } catch (x) {
      const err = form.querySelector('.login-err');
      err.textContent = x.message; err.hidden = false;
    }
  });
  form.querySelector('[name=username]').focus();
}
window.addEventListener('irm:logged-out', () => { if (store.user) showLogin('Your session ended. Please log in again.'); });

document.getElementById('new-z5').addEventListener('click', () =>
  z5Dialog(null, { onSaved: async (z) => { await store.load(); go(`#/z5/${z.no}`); } }));

const q = document.getElementById('global-q');
q.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') go(`#/search?q=${encodeURIComponent(q.value.trim())}`);
});
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !e.target.closest('input,textarea,select')) { e.preventDefault(); q.focus(); q.select(); }
});

window.addEventListener('hashchange', render);

// Sticky elements (left navigation, Z5 tab bar) sit just below the top bar, whatever its height.
const setTopHeight = () => document.documentElement.style.setProperty('--top-h', `${document.querySelector('.topbar').offsetHeight}px`);
setTopHeight();
window.addEventListener('resize', setTopHeight);

boot().catch((e) => {
  if (e.status === 401) return loginScreen();
  main.innerHTML = `<div class="empty"><h2>Cannot reach the IRM server</h2><p>${esc(e.message)}</p><p>Start it with <code>npm start</code> in the MVP folder.</p></div>`;
  toast(e.message, 'error');
});
