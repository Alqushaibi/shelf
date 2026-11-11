// Shelf for phones and tablets: the same account and data as the browser extension, in any mobile browser.
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';

const $ = (s) => document.querySelector(s);
const root = $('#app');
const SESSION = 'shelf-app-session', CACHE = 'shelf-app-data', DEVICE = 'shelf-app-device';
const uuid = () => crypto.randomUUID();
const ls = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

let session = ls.get(SESSION);
let data = ls.get(CACHE) || { spaces: [], folders: [], collections: [], members: [] };
let site = null;
const ui = { spaceId: null, folderId: null, q: '', searching: false, open: new Set(), share: null, authMode: 'signin', online: true };

/* ---------- small helpers ---------- */
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k in e && !k.startsWith('aria-') && k !== 'role' && k !== 'style' && k !== 'for' && k !== 'list') { try { e[k] = v; } catch { e.setAttribute(k, v); } }
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) { if (c == null || c === false) continue; e.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return e;
}
const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.500-3.500"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  down: '<path d="m6 9 6 6 6-6"/>', right: '<path d="m9 6 6 6-6 6"/>',
  more: '<circle cx="5" cy="12" r="1.600"/><circle cx="12" cy="12" r="1.600"/><circle cx="19" cy="12" r="1.600"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  refresh: '<path d="M4 12a8 8 0 0 1 14-5.300L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.300L4 15M4 20v-5h5"/>',
  heart: '<path d="M12 20s-7-4.400-7-10a4 4 0 0 1 7-2.600A4 4 0 0 1 19 10c0 5.600-7 10-7 10z"/>',
};
function ic(name, size = 22) {
  const s = document.createElement('span'); s.className = 'ic';
  s.innerHTML = `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return s;
}
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const isWeb = (u) => /^https?:\/\//i.test(u || '');
let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200); }

/* ---------- server ---------- */
class ApiError extends Error { constructor(m, status = 0) { super(m); this.status = status; } }
async function raw(path, { method = 'GET', body, token, headers = {} } = {}) {
  let res;
  try {
    res = await fetch(SUPABASE_URL + path, { method, headers: { apikey: SUPABASE_KEY, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch { throw new ApiError('No connection. Showing what was saved on this device.'); }
  const text = await res.text();
  let out = null; try { out = text ? JSON.parse(text) : null; } catch { out = text; }
  if (!res.ok) throw new ApiError((out && (out.msg || out.message || out.error_description || out.error)) || `Request failed (${res.status})`, res.status);
  return out;
}
const toSession = (d, user = d.user) => ({ access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Date.now() + Number(d.expires_in || 3600) * 1000, user: { id: user.id, email: user.email || '' } });
const setSession = (s) => { session = s; ls.set(SESSION, s); };
let refreshing = null;
async function token(force = false) {
  if (!session) throw new ApiError('Not signed in.', 401);
  if (!force && session.expires_at - Date.now() > 60000) return session.access_token;
  refreshing ||= (async () => {
    try { setSession(toSession(await raw('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token } }))); }
    catch (e) { if (e.status >= 400 && e.status < 500) { setSession(null); throw new ApiError('Signed out.', 401); } throw e; }
    finally { refreshing = null; }
  })();
  await refreshing;
  return session.access_token;
}
async function rest(method, path, body, headers = {}) {
  try { return await raw('/rest/v1/' + path, { method, body, token: await token(), headers }); }
  catch (e) { if (e.status !== 401 || !session) throw e; return raw('/rest/v1/' + path, { method, body, token: await token(true), headers }); }
}
async function fetchAll(table, order = 'id') {
  const out = [];
  for (let offset = 0; ; offset += 1000) { const rows = await rest('GET', `${table}?select=*&order=${order}&limit=1000&offset=${offset}`); out.push(...rows); if (rows.length < 1000) return out; }
}
const UP = { Prefer: 'resolution=merge-duplicates,return=minimal' };
const upsert = (table, row) => rest('POST', `${table}?on_conflict=id`, [{ ...row, updated_at: Date.now(), deleted: false }], UP);
const softDelete = (table, ids) => (ids.length ? rest('PATCH', `${table}?id=in.(${ids.join(',')})`, { deleted: true, updated_at: Date.now() }) : null);

function deviceName() {
  const ua = navigator.userAgent;
  const b = /Firefox\//.test(ua) ? 'Firefox' : /EdgA?\//.test(ua) ? 'Edge' : /SamsungBrowser\//.test(ua) ? 'Samsung Internet' : /OPR\//.test(ua) ? 'Opera' : 'Chrome';
  const o = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : 'this device';
  return `${b} on ${o} (web app)`;
}
// Registers this browser in the account's list, and notices when another browser has signed it out.
async function heartbeat() {
  let dev = ls.get(DEVICE) || { id: uuid(), registered: null };
  const rows = await rest('GET', `devices?select=id&id=eq.${dev.id}`);
  if (dev.registered === session.user.id && !rows.length) return false;
  await rest('POST', 'devices?on_conflict=id', [{ id: dev.id, user_id: session.user.id, name: deviceName(), last_seen: new Date().toISOString() }], UP);
  dev.registered = session.user.id; ls.set(DEVICE, dev);
  return true;
}

async function load() {
  if (!session) return;
  try {
    if (!(await heartbeat())) return leave('This browser was signed out from another device.');
    const [spaces, folders, collections, members] = await Promise.all([fetchAll('spaces'), fetchAll('folders'), fetchAll('collections'), fetchAll('space_members', 'space_id,email')]);
    data = { spaces: spaces.filter((r) => !r.deleted), folders: folders.filter((r) => !r.deleted), collections: collections.filter((r) => !r.deleted), members };
    if (!data.spaces.length) { // a brand-new account gets one space to start with
      const sp = { id: uuid(), owner: session.user.id, name: 'My space', color: '#6E93FF' };
      await upsert('spaces', sp); data.spaces.push(sp);
    }
    ls.set(CACHE, data); ui.online = true;
    softRender();
  } catch (e) {
    if (e.status === 401 && !session) return leave('Your sign-in ended. Sign in again.');
    ui.online = false; softRender(); toast(e.message);
  }
}
// Do not redraw under someone who is typing or has a dialog open.
function softRender() {
  const a = document.activeElement;
  if (document.querySelector('dialog[open]') || (a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.type !== 'checkbox' && !a.closest('.searchbar'))) { ui.stale = true; return; }
  render();
}
function leave(msg) { setSession(null); data = { spaces: [], folders: [], collections: [], members: [] }; ls.set(CACHE, null); const d = ls.get(DEVICE); if (d) ls.set(DEVICE, { id: d.id, registered: null }); render(); if (msg) toast(msg); }
// Apply a change on screen first, then save it; if saving fails, reload the real state.
async function save(fn) {
  ls.set(CACHE, data); render();
  try { await fn(); } catch (e) { toast('Not saved: ' + e.message); await load(); }
}

/* ---------- data helpers ---------- */
const space = () => data.spaces.find((s) => s.id === ui.spaceId) || data.spaces[0];
const folder = (id) => data.folders.find((f) => f.id === id);
const subfolders = (sid, pid) => data.folders.filter((f) => f.space_id === sid && (f.parent_id || null) === (pid || null)).sort((a, b) => a.name.localeCompare(b.name));
const colsIn = (sid, fid) => data.collections.filter((c) => c.space_id === sid && (c.folder_id || null) === (fid || null));
function descendants(fid) { const out = [fid]; for (const f of data.folders.filter((x) => x.parent_id === fid)) out.push(...descendants(f.id)); return out; }
function path(fid) { const p = []; let f = folder(fid); while (f) { p.unshift(f); f = folder(f.parent_id); } return p; }
function role(sp) {
  if (!sp || sp.owner === session.user.id) return 'owner';
  const me = session.user.email.toLowerCase();
  return data.members.find((m) => m.space_id === sp.id && m.email.toLowerCase() === me)?.role || 'viewer';
}
const canEdit = (sp) => role(sp) !== 'viewer';
const where = (c) => [data.spaces.find((s) => s.id === c.space_id)?.name, ...path(c.folder_id).map((f) => f.name), c.name].filter(Boolean).join(' › ');
const colRow = (c) => ({ id: c.id, space_id: c.space_id, folder_id: c.folder_id || null, name: c.name, note: c.note || '', tasks: c.tasks || [], items: c.items || [] });
const saveCol = (c) => save(() => upsert('collections', colRow(c)));

/* ---------- dialogs ---------- */
function dialog(title, body, actions) {
  return new Promise((res) => {
    const d = h('dialog', { 'aria-label': title, onclose: () => { d.remove(); res(d.returnValue ? JSON.parse(d.returnValue) : null); if (ui.stale) { ui.stale = false; render(); } } });
    const close = (v) => d.close(v == null ? '' : JSON.stringify(v));
    d.append(h('h2', {}, title), body(close) || '', actions ? h('div', { class: 'row', style: 'margin-top:14px;justify-content:flex-end' }, actions(close)) : '');
    d.addEventListener('click', (e) => { if (e.target === d) close(null); });
    document.body.append(d); d.showModal();
  });
}
function ask(title, value = '', label = 'Name', okLabel = 'Save') {
  const inp = h('input', { class: 'input', value, 'aria-label': label, enterKeyHint: 'done' });
  return dialog(title, (close) => h('form', { onsubmit: (e) => { e.preventDefault(); if (inp.value.trim()) close(inp.value.trim()); } }, inp),
    (close) => [h('button', { class: 'btn', onclick: () => close(null) }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => inp.value.trim() && close(inp.value.trim()) }, okLabel)]);
}
const sure = (title, text, okLabel = 'Delete') => dialog(title, () => h('p', { class: 'muted' }, text),
  (close) => [h('button', { class: 'btn', onclick: () => close(null) }, 'Cancel'), h('button', { class: 'btn danger', onclick: () => close(true) }, okLabel)]);
const menu = (title, items) => dialog(title, (close) => h('div', { class: 'menu' }, items.filter(Boolean).map(([label, key, cls]) => h('button', { class: 'btn block ' + (cls || ''), onclick: () => close(key) }, label)),
  h('button', { class: 'btn block', onclick: () => close(null) }, 'Cancel')));

/* ---------- actions ---------- */
async function newSpace() {
  const name = await ask('New space'); if (!name) return;
  const sp = { id: uuid(), owner: session.user.id, name, color: ['#6E93FF', '#F2A25C', '#8FD3B6', '#E6A6C7'][data.spaces.length % 4] };
  data.spaces.push(sp); ui.spaceId = sp.id; ui.folderId = null;
  save(() => upsert('spaces', sp));
}
async function newFolder() {
  const name = await ask('New folder'); if (!name) return;
  const f = { id: uuid(), space_id: space().id, parent_id: ui.folderId || null, name };
  data.folders.push(f); save(() => upsert('folders', f));
}
async function newCollection(items = []) {
  const name = await ask('New collection'); if (!name) return null;
  const c = { id: uuid(), space_id: space().id, folder_id: ui.folderId || null, name, note: '', tasks: [], items };
  data.collections.push(c); ui.open.add(c.id); saveCol(c); return c;
}
async function addLink(c, preset = {}) {
  const url = h('input', { class: 'input', type: 'url', inputMode: 'url', placeholder: 'https://', value: preset.url || '', 'aria-label': 'Address' });
  const title = h('input', { class: 'input', placeholder: 'Title (optional)', value: preset.title || '', 'aria-label': 'Title' });
  const err = h('p', { class: 'err small', role: 'alert' });
  const ok = await dialog('Add a link to ' + c.name, () => h('div', { class: 'stack' }, url, title, err), (close) => [h('button', { class: 'btn', onclick: () => close(null) }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: () => { let v = url.value.trim(); if (v && !/^[a-z]+:\/\//i.test(v)) v = 'https://' + v; if (!isWeb(v) || !host(v).includes('.')) { err.textContent = 'Enter a web address.'; return; } url.value = v; close(true); } }, 'Add')]);
  if (!ok) return false;
  if ((c.items || []).some((i) => i.url === url.value)) { toast('That link is already in this collection.'); return false; }
  c.items = [...(c.items || []), { id: uuid(), url: url.value, title: title.value.trim() || host(url.value), note: '' }];
  ui.open.add(c.id); saveCol(c); return true;
}
async function linkMenu(c, it, editable) {
  const pick = await menu(it.title, [['Open', 'open', 'primary'], ['Copy address', 'copy'], editable && ['Edit title and note', 'edit'], editable && ['Remove from collection', 'remove', 'danger']]);
  if (pick === 'open') window.open(it.url, '_blank', 'noopener');
  if (pick === 'copy') { try { await navigator.clipboard.writeText(it.url); toast('Address copied.'); } catch { toast(it.url); } }
  if (pick === 'remove') { c.items = c.items.filter((x) => x !== it); saveCol(c); }
  if (pick === 'edit') {
    const t = h('input', { class: 'input', value: it.title, 'aria-label': 'Title' }), n = h('textarea', { placeholder: 'Note', 'aria-label': 'Note' }, it.note || '');
    const ok = await dialog('Edit link', () => h('div', { class: 'stack' }, t, n), (close) => [h('button', { class: 'btn', onclick: () => close(null) }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => close(true) }, 'Save')]);
    if (ok) { it.title = t.value.trim() || host(it.url); it.note = n.value.trim(); saveCol(c); }
  }
}
async function collectionMenu(c) {
  const pick = await menu(c.name, [['Open all links', 'all'], ['Rename', 'rename'], ['Delete collection', 'delete', 'danger']]);
  if (pick === 'all') (c.items || []).forEach((i) => window.open(i.url, '_blank', 'noopener'));
  if (pick === 'rename') { const n = await ask('Rename collection', c.name); if (n) { c.name = n; saveCol(c); } }
  if (pick === 'delete' && await sure('Delete collection', `"${c.name}" and its ${(c.items || []).length} links will be removed from every device.`)) {
    data.collections = data.collections.filter((x) => x !== c); save(() => softDelete('collections', [c.id]));
  }
}
async function placeMenu() {
  const sp = space(), f = ui.folderId ? folder(ui.folderId) : null, mine = role(sp) === 'owner';
  const pick = await menu(f ? f.name : sp.name, [['Rename', 'rename'], [f ? 'Delete folder' : mine ? 'Delete space' : 'Leave shared space', 'delete', 'danger']]);
  if (pick === 'rename') {
    const n = await ask(f ? 'Rename folder' : 'Rename space', (f || sp).name); if (!n) return;
    (f || sp).name = n;
    save(() => (f ? upsert('folders', { id: f.id, space_id: f.space_id, parent_id: f.parent_id || null, name: n }) : upsert('spaces', { id: sp.id, owner: sp.owner, name: n, color: sp.color || null })));
  }
  if (pick !== 'delete') return;
  if (f) {
    const ids = descendants(f.id), cols = data.collections.filter((c) => ids.includes(c.folder_id));
    if (!(await sure('Delete folder', `"${f.name}", its subfolders and ${cols.length} collections will be removed from every device.`))) return;
    data.folders = data.folders.filter((x) => !ids.includes(x.id)); data.collections = data.collections.filter((c) => !cols.includes(c)); ui.folderId = f.parent_id || null;
    return save(async () => { await softDelete('collections', cols.map((c) => c.id)); await softDelete('folders', ids); });
  }
  if (data.spaces.length === 1) return toast('Keep at least one space.');
  if (!(await sure(mine ? 'Delete space' : 'Leave shared space', mine ? `"${sp.name}" and everything in it will be removed from every device.` : `"${sp.name}" is removed from your account. It stays for its owner.`, mine ? 'Delete' : 'Leave'))) return;
  const fids = data.folders.filter((x) => x.space_id === sp.id).map((x) => x.id), cids = data.collections.filter((c) => c.space_id === sp.id).map((c) => c.id);
  data.spaces = data.spaces.filter((x) => x !== sp); data.folders = data.folders.filter((x) => x.space_id !== sp.id); data.collections = data.collections.filter((c) => c.space_id !== sp.id);
  ui.spaceId = data.spaces[0].id; ui.folderId = null;
  save(async () => {
    if (!mine) return rest('DELETE', `space_members?space_id=eq.${sp.id}&email=eq.${encodeURIComponent(session.user.email.toLowerCase())}`);
    await softDelete('collections', cids); await softDelete('folders', fids); await softDelete('spaces', [sp.id]);
  });
}
async function addMenu() {
  const sp = space();
  if (!canEdit(sp)) return toast('This space is view only.');
  const pick = await menu('Add to ' + (ui.folderId ? folder(ui.folderId).name : sp.name), [['New collection', 'col', 'primary'], ['New folder', 'folder'], ['New space', 'space']]);
  if (pick === 'col') newCollection(); if (pick === 'folder') newFolder(); if (pick === 'space') newSpace();
}
async function accountMenu() {
  const d = site && site.donation, donate = d && d.show && /^https:\/\//i.test(d.url || '');
  const pick = await menu(session.user.email, [['Refresh now', 'refresh'], donate && [d.buttonLabel || 'Donate', 'donate'], ['Sign out of this browser', 'out'], ['Sign out of all browsers', 'all', 'danger']]);
  if (pick === 'refresh') { await load(); if (ui.online) toast('Up to date.'); }
  if (pick === 'donate') window.open(d.url, '_blank', 'noopener');
  if (pick === 'out') { try { const dev = ls.get(DEVICE); if (dev) await rest('DELETE', `devices?id=eq.${dev.id}`); await raw('/auth/v1/logout?scope=local', { method: 'POST', token: await token() }); } catch { /* offline */ } leave('Signed out.'); }
  if (pick === 'all' && await sure('Sign out of all browsers', 'Every browser and device signed in to this account is signed out, including this one.', 'Sign out everywhere')) {
    try { await rest('DELETE', `devices?user_id=eq.${session.user.id}`); await raw('/auth/v1/logout?scope=global', { method: 'POST', token: await token() }); } catch { /* offline */ }
    leave('Signed out of all browsers.');
  }
}
// A page shared to Shelf from another app (Android's Share menu) lands here.
async function saveShared(c) {
  const s = ui.share; if (!s) return;
  if ((c.items || []).some((i) => i.url === s.url)) toast('Already in ' + c.name + '.');
  else { c.items = [...(c.items || []), { id: uuid(), url: s.url, title: s.title || host(s.url), note: '' }]; ui.open.add(c.id); ui.spaceId = c.space_id; ui.folderId = c.folder_id || null; toast('Saved to ' + c.name + '.'); }
  ui.share = null; saveCol(c);
}

/* ---------- views ---------- */
function loginView() {
  const signup = ui.authMode === 'signup';
  const email = h('input', { class: 'input', id: 'em', type: 'email', required: true, autocomplete: 'email', inputMode: 'email' });
  const pw = h('input', { class: 'input', id: 'pw', type: 'password', required: true, minLength: signup ? 8 : 1, autocomplete: signup ? 'new-password' : 'current-password' });
  const msg = h('p', { class: 'small', role: 'alert' });
  const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
  const run = async (fn) => {
    msg.className = 'small muted'; msg.textContent = 'Working…';
    try { await fn(); }
    catch (e) {
      if (/not confirmed/i.test(e.message)) { ui.pendingEmail = email.value.trim(); return render(); }
      msg.className = 'small err'; msg.textContent = e.message;
    }
  };
  const forgot = async () => {
    const addr = await ask('Reset your password', email.value.trim(), 'Account email', 'Send link');
    if (!addr) return;
    if (!validEmail(addr)) return toast('Enter a valid email address.');
    try { await raw('/auth/v1/recover', { method: 'POST', body: { email: addr } }); toast('If that address has an account, a reset link is on its way.'); } catch (e) { toast(e.message); }
  };
  const pending = ui.pendingEmail ? h('div', { class: 'banner', role: 'status' }, h('b', {}, 'Confirm your email'), h('span', {}, `We sent a link to ${ui.pendingEmail}. Open it to confirm the address, then sign in here.`),
    h('button', { type: 'button', class: 'btn', onclick: async () => { try { await raw('/auth/v1/resend', { method: 'POST', body: { type: 'signup', email: ui.pendingEmail } }); toast('Confirmation email sent again.'); } catch (e) { toast(e.message); } } }, 'Send again')) : null;
  const entered = async (d) => { setSession(toSession(d)); render(); await load(); };
  const tab = (label, mode) => h('button', { type: 'button', 'aria-pressed': String(ui.authMode === mode), onclick: () => { ui.authMode = mode; render(); } }, label);
  return h('form', { class: 'login', onsubmit: (e) => {
    e.preventDefault();
    run(async () => {
      const addr = email.value.trim();
      if (!validEmail(addr)) throw new Error('Enter a valid email address.');
      if (!signup) { const s = await raw('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: addr, password: pw.value } }); ui.pendingEmail = null; return entered(s); }
      const d = await raw('/auth/v1/signup', { method: 'POST', body: { email: addr, password: pw.value } });
      if (d && d.access_token) return entered(d);
      ui.authMode = 'signin';
      if (Array.isArray(d && d.identities) && d.identities.length === 0) { ui.pendingEmail = null; render(); return toast('That email already has an account. Sign in, or use "Forgot password?".'); }
      ui.pendingEmail = addr; render();
    });
  } },
    h('img', { src: 'icons/icon-192.png', alt: '' }), h('h1', {}, 'Shelf'), h('p', { class: 'muted' }, ui.share ? 'Sign in to save the page you shared.' : 'Your saved tabs, folders and collections on this device.'),
    pending,
    h('div', { class: 'seg' }, tab('Sign in', 'signin'), tab('Create account', 'signup')),
    h('button', { type: 'button', class: 'btn block', onclick: () => { if (ui.share) ls.set('shelf-app-share', ui.share); location.href = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(location.origin + location.pathname)}`; } }, 'Continue with Google'),
    h('p', { class: 'small muted', style: 'text-align:center' }, 'or use your email'),
    h('label', { for: 'em' }, 'Email'), email, h('label', { for: 'pw' }, 'Password'), pw,
    signup ? h('p', { class: 'small muted' }, 'At least 8 characters. We email you a link to confirm the address before you can sign in.') : null,
    h('button', { type: 'submit', class: 'btn primary block' }, signup ? 'Create account' : 'Sign in'),
    signup ? null : h('button', { type: 'button', class: 'btn block', style: 'border:0;background:transparent;color:var(--blue)', onclick: forgot }, 'Forgot password?'), msg);
}
function collectionCard(c, editable) {
  const open = ui.open.has(c.id), items = c.items || [], tasks = c.tasks || [], done = tasks.filter((t) => t.done).length;
  const head = h('div', { class: 'chead' },
    h('button', { class: 'toggle', 'aria-expanded': String(open), onclick: () => { open ? ui.open.delete(c.id) : ui.open.add(c.id); render(); } }, ic(open ? 'down' : 'right', 18),
      h('span', { class: 'grow' }, h('h2', { class: 'ellip' }, c.name), h('span', { class: 'small muted' }, `${items.length} link${items.length === 1 ? '' : 's'}${tasks.length ? ` · ${done}/${tasks.length} tasks` : ''}`))),
    ui.share ? h('button', { class: 'btn primary', onclick: () => saveShared(c) }, 'Save here') : editable ? h('button', { class: 'ibtn', 'aria-label': 'More for ' + c.name, onclick: () => collectionMenu(c) }, ic('more')) : null);
  if (!open) return h('section', { class: 'card' }, head);
  const newTask = h('input', { class: 'input', placeholder: 'Add a task', 'aria-label': 'New task', enterKeyHint: 'done', onkeydown: (e) => { if (e.key === 'Enter' && e.target.value.trim()) { c.tasks = [...tasks, { id: uuid(), text: e.target.value.trim(), done: false }]; saveCol(c); } } });
  return h('section', { class: 'card' }, head, h('div', { class: 'cbody' },
    items.map((it) => h('div', { class: 'link' }, h('span', { class: 'fav', 'aria-hidden': 'true' }, (host(it.url)[0] || '•').toUpperCase()),
      h('a', { href: isWeb(it.url) ? it.url : '#', target: '_blank', rel: 'noopener' }, h('b', { class: 'ellip' }, it.title), h('span', { class: 'ellip' }, it.note || host(it.url))),
      h('button', { class: 'ibtn', 'aria-label': 'More for ' + it.title, onclick: () => linkMenu(c, it, editable) }, ic('more')))),
    items.length ? null : h('p', { class: 'muted small', style: 'padding:6px 0' }, 'No links yet.'),
    editable ? h('button', { class: 'btn', onclick: () => addLink(c) }, ic('plus', 18), 'Add a link') : null,
    tasks.length || editable ? h('div', { class: 'sub' }, 'Tasks') : null,
    tasks.map((t) => h('label', { class: 'task' + (t.done ? ' done' : '') }, h('input', { type: 'checkbox', checked: t.done, disabled: !editable, onchange: (e) => { t.done = e.target.checked; saveCol(c); } }), h('span', { class: 'grow' }, t.text),
      editable ? h('button', { class: 'ibtn', 'aria-label': 'Delete task', onclick: (e) => { e.preventDefault(); c.tasks = tasks.filter((x) => x !== t); saveCol(c); } }, ic('x', 18)) : null)),
    editable ? newTask : null,
    c.note || editable ? h('div', { class: 'sub' }, 'Note') : null,
    editable ? h('textarea', { placeholder: 'Collection note', 'aria-label': 'Collection note', onchange: (e) => { c.note = e.target.value; ls.set(CACHE, data); upsert('collections', colRow(c)).catch((x) => toast('Not saved: ' + x.message)); } }, c.note || '') : c.note ? h('p', {}, c.note) : null));
}
function searchResults() {
  const t = ui.q.trim().toLowerCase();
  if (!t) return [h('p', { class: 'muted' }, 'Search your saved links, notes, tasks, collections and folders.')];
  const hit = (...s) => s.some((x) => (x || '').toLowerCase().includes(t));
  const out = [];
  for (const c of data.collections) {
    for (const it of c.items || []) if (hit(it.title, it.url, it.note)) out.push(h('div', { class: 'card' }, h('div', { class: 'cbody', style: 'padding-top:0' }, h('div', { class: 'link', style: 'border:0' },
      h('a', { href: it.url, target: '_blank', rel: 'noopener' }, h('b', { class: 'ellip' }, it.title), h('span', { class: 'ellip' }, where(c)))))));
    if (hit(c.name, c.note) || (c.tasks || []).some((k) => hit(k.text))) out.push(h('button', { class: 'frow', onclick: () => { ui.spaceId = c.space_id; ui.folderId = c.folder_id || null; ui.open.add(c.id); ui.searching = false; ui.q = ''; render(); } },
      ic('right', 18), h('span', { class: 'grow' }, h('b', { class: 'ellip', style: 'display:block' }, c.name), h('span', { class: 'small muted' }, 'Collection · ' + where(c)))));
  }
  for (const f of data.folders) if (hit(f.name)) out.push(h('button', { class: 'frow', onclick: () => { ui.spaceId = f.space_id; ui.folderId = f.id; ui.searching = false; ui.q = ''; render(); } }, ic('folder'), h('span', { class: 'grow' }, h('b', {}, f.name), h('span', { class: 'small muted', style: 'display:block' }, 'Folder'))));
  return out.length ? out.slice(0, 80) : [h('div', { class: 'empty' }, 'No matches.')];
}
function mainView() {
  if (!data.spaces.some((s) => s.id === ui.spaceId)) { ui.spaceId = data.spaces[0]?.id || null; ui.folderId = null; }
  if (ui.folderId && !folder(ui.folderId)) ui.folderId = null;
  const sp = space();
  if (!sp) return [h('header', { class: 'top' }, h('img', { src: 'icons/icon-192.png', alt: '' }), h('span', { class: 'grow' }, 'Shelf')), h('p', { class: 'notice' }, ui.online ? 'Loading your spaces…' : 'No connection, and nothing saved on this device yet.')];
  const f = ui.folderId ? folder(ui.folderId) : null, editable = canEdit(sp), r = role(sp);
  const folders = subfolders(sp.id, ui.folderId), cols = colsIn(sp.id, ui.folderId);
  const go = (sid, fid = null) => { ui.spaceId = sid; ui.folderId = fid; ui.searching = false; window.scrollTo(0, 0); render(); };
  const tree = (sid, pid, depth) => subfolders(sid, pid).flatMap((x) => [h('button', { class: 'nav' + (ui.folderId === x.id ? ' on' : ''), style: `padding-left:${22 + depth * 16}px`, onclick: () => go(sid, x.id) }, ic('folder', 18), h('span', { class: 'grow ellip' }, x.name)), ...tree(sid, x.id, depth + 1)]);
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search everything', value: ui.q, 'aria-label': 'Search', oninput: (e) => { ui.q = e.target.value; $('#results')?.replaceChildren(...searchResults()); } });
  const top = h('header', { class: 'top' }, h('img', { src: 'icons/icon-192.png', alt: '' }), h('span', { class: 'title' }, 'Shelf'),
    h('select', { 'aria-label': 'Space', onchange: (e) => go(e.target.value) }, data.spaces.map((s) => h('option', { value: s.id, selected: s.id === sp.id }, s.name))),
    h('button', { class: 'tbtn', 'aria-label': 'Search', 'aria-pressed': String(ui.searching), onclick: () => { ui.searching = !ui.searching; if (!ui.searching) ui.q = ''; render(); if (ui.searching) $('.searchbar input')?.focus(); } }, ic('search')),
    h('button', { class: 'tbtn', 'aria-label': 'Account', onclick: accountMenu }, ic('user')));
  const side = h('nav', { class: 'side', 'aria-label': 'Spaces and folders' }, data.spaces.flatMap((s) => [h('button', { class: 'nav' + (s.id === sp.id && !ui.folderId ? ' on' : ''), onclick: () => go(s.id) }, h('span', { class: 'dot', style: 'background:' + (s.color || '#6E93FF') }), h('span', { class: 'grow ellip' }, s.name)), ...(s.id === sp.id ? tree(s.id, null, 0) : [])]));
  const body = ui.searching ? [h('div', { id: 'results', class: 'stack' }, searchResults())] : [
    ui.share ? h('div', { class: 'banner' }, h('b', {}, 'Save this page'), h('span', { class: 'small ellip' }, ui.share.title || ui.share.url), h('span', { class: 'small muted' }, 'Tap "Save here" on a collection, or make a new one.'),
      h('div', { class: 'row' }, editable ? h('button', { class: 'btn primary grow', onclick: async () => { const c = await newCollection([{ id: uuid(), url: ui.share.url, title: ui.share.title || host(ui.share.url), note: '' }]); if (c) { ui.share = null; render(); toast('Saved to ' + c.name + '.'); } } }, 'New collection') : null, h('button', { class: 'btn', onclick: () => { ui.share = null; render(); } }, 'Cancel'))) : null,
    ui.online ? null : h('div', { class: 'banner' }, 'No connection. Showing what was saved on this device; changes will not be kept.'),
    f ? h('div', { class: 'crumbs' }, h('button', { onclick: () => go(sp.id) }, sp.name), path(f.id).flatMap((p) => ['›', p.id === f.id ? h('span', {}, p.name) : h('button', { onclick: () => go(sp.id, p.id) }, p.name)])) : null,
    h('div', { class: 'row' }, h('h1', { class: 'grow ellip' }, f ? f.name : sp.name),
      r !== 'owner' ? h('span', { class: 'pill warn' }, r === 'editor' ? 'Shared · can edit' : 'View only') : data.members.some((m) => m.space_id === sp.id) ? h('span', { class: 'pill' }, 'Shared') : h('span', { class: 'pill grey' }, 'Private'),
      editable || (!f && r !== 'owner') ? h('button', { class: 'ibtn', 'aria-label': 'More for this ' + (f ? 'folder' : 'space'), onclick: placeMenu }, ic('more')) : null),
    folders.map((x) => h('button', { class: 'frow', onclick: () => go(sp.id, x.id) }, ic('folder'), h('span', { class: 'grow' }, h('b', { class: 'ellip', style: 'display:block' }, x.name),
      h('span', { class: 'small muted' }, `${subfolders(sp.id, x.id).length} subfolders · ${data.collections.filter((c) => descendants(x.id).includes(c.folder_id)).length} collections`)), ic('right', 18))),
    cols.length ? h('div', { class: 'grid' }, cols.map((c) => collectionCard(c, editable))) : h('div', { class: 'empty' }, folders.length ? 'No collections at this level.' : editable ? 'Nothing here yet. Tap + to add a collection.' : 'Nothing here yet.'),
  ];
  return [top, ui.searching ? h('div', { class: 'searchbar' }, search) : null, h('div', { class: 'layout' }, side, h('main', {}, body)),
    editable && !ui.searching ? h('button', { class: 'fab', 'aria-label': 'Add', onclick: addMenu }, ic('plus', 28)) : null];
}
function render() {
  ui.stale = false;
  const keep = document.activeElement?.closest?.('.searchbar') ? true : false;
  root.replaceChildren(...(session ? mainView().flat().filter(Boolean) : [loginView()]));
  if (keep) { const i = $('.searchbar input'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
}

/* ---------- start ---------- */
async function start() {
  // Returning from Google sign-in: the session is in the address.
  const hp = new URLSearchParams(location.hash.slice(1));
  if (hp.get('access_token')) {
    history.replaceState(null, '', location.pathname);
    try { const user = await raw('/auth/v1/user', { token: hp.get('access_token') }); setSession(toSession({ access_token: hp.get('access_token'), refresh_token: hp.get('refresh_token'), expires_in: hp.get('expires_in') }, user)); }
    catch (e) { toast(e.message); }
    ui.share = ls.get('shelf-app-share'); ls.set('shelf-app-share', null);
  } else if (hp.get('error_description')) { history.replaceState(null, '', location.pathname); setTimeout(() => toast(hp.get('error_description')), 300); }
  // Opened from Android's Share menu.
  const qp = new URLSearchParams(location.search);
  const shared = [qp.get('url'), qp.get('text')].map((v) => (v || '').match(/https?:\/\/\S+/)?.[0]).find(Boolean);
  if (shared) { ui.share = { url: shared, title: (qp.get('title') || '').trim() }; history.replaceState(null, '', location.pathname); }
  render();
  if (session) load();
  raw('/rest/v1/site_content?select=value&key=eq.site').then((r) => { site = r && r[0] ? r[0].value : null; }).catch(() => {});
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && session) load(); });
  setInterval(() => { if (document.visibilityState === 'visible' && session) load(); }, 60000);
  document.addEventListener('focusout', () => { if (ui.stale) setTimeout(() => { if (ui.stale && !document.querySelector('dialog[open]')) render(); }, 80); });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
start();
