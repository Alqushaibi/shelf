// Account, sync and sharing, talking to Supabase over its REST APIs (no SDK needed).
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { withLock, saveRaw, uid as newId } from './store.js';

const getK = async (k) => (await chrome.storage.local.get(k))[k];
const setK = (k, v) => chrome.storage.local.set({ [k]: v });

export class CloudError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}

async function raw(path, { method = 'GET', body, token, headers = {} } = {}) {
  let res;
  try {
    res = await fetch(SUPABASE_URL + path, {
      method,
      headers: { apikey: SUPABASE_KEY, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch { throw new CloudError('Could not reach the server. Check your connection.'); }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new CloudError((data && (data.msg || data.message || data.error_description || data.error)) || `Request failed (${res.status})`, res.status);
  return data;
}

/* ---------- session ---------- */
const toSession = (d, user = d.user) => ({
  access_token: d.access_token, refresh_token: d.refresh_token,
  expires_at: Date.now() + Number(d.expires_in || 3600) * 1000,
  user: { id: user.id, email: user.email || '' },
});
let refreshing = null;
export async function getSession(force = false) {
  const s = await getK('auth');
  if (!s) return null;
  if (!force && s.expires_at - Date.now() > 60000) return s;
  refreshing ||= (async () => {
    try {
      const fresh = toSession(await raw('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh_token } }));
      await setK('auth', fresh);
      return fresh;
    } catch (e) {
      if (e.status >= 400 && e.status < 500) { await chrome.storage.local.remove('auth'); return null; } // revoked or expired
      throw e;
    } finally { refreshing = null; }
  })();
  return refreshing;
}
export const storedSession = () => getK('auth');

export async function signUp(email, password) {
  const d = await raw('/auth/v1/signup', { method: 'POST', body: { email, password } });
  if (d && d.access_token) { const s = toSession(d); await setK('auth', s); return { session: s }; }
  return { confirm: true }; // email confirmation is required before the first sign-in
}
export async function signIn(email, password) {
  const s = toSession(await raw('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } }));
  await setK('auth', s);
  return s;
}
export const googleRedirectUrl = () => `https://${chrome.runtime.id}.chromiumapp.org/`;
// Opens Google sign-in in a small window and watches for the address Supabase sends the browser back to.
// That address carries the session. It is read here whether Supabase returns to the extension's own
// address (when it is on the Redirect URLs list) or falls back to the project's Site URL.
export async function signInGoogle() {
  const url = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(googleRedirectUrl())}`;
  const authHost = new URL(SUPABASE_URL).host;
  const win = await chrome.windows.create({ url, type: 'popup', width: 520, height: 700 });
  const tabId = win.tabs[0].id;
  const back = await new Promise((resolve, reject) => {
    const stop = () => { chrome.tabs.onUpdated.removeListener(onUpdated); chrome.windows.onRemoved.removeListener(onRemoved); };
    const onUpdated = (id, info, tab) => {
      if (id !== tabId) return;
      const u = info.url || tab.url || '';
      let host = ''; try { host = new URL(u).host; } catch { return; }
      if (host === authHost || /(^|\.)google\.[a-z.]+$|(^|\.)gstatic\.com$/.test(host)) return; // still signing in
      if (!/[#?&](access_token|error|error_description)=/.test(u)) return;
      stop(); chrome.windows.remove(win.id).catch(() => {}); resolve(u);
    };
    const onRemoved = (id) => { if (id === win.id) { stop(); reject(new CloudError('Google sign-in was closed before it finished.')); } };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.windows.onRemoved.addListener(onRemoved);
  });
  const u = new URL(back), p = new URLSearchParams(u.hash.slice(1));
  if (!p.get('access_token')) throw new CloudError(p.get('error_description') || u.searchParams.get('error_description') || 'Google sign-in did not complete.');
  const token = p.get('access_token');
  const user = await raw('/auth/v1/user', { token });
  const sess = toSession({ access_token: token, refresh_token: p.get('refresh_token'), expires_in: p.get('expires_in') }, user);
  await setK('auth', sess);
  return sess;
}
export async function changePassword(password) {
  const s = await getSession(); if (!s) throw new CloudError('Not signed in.');
  await raw('/auth/v1/user', { method: 'PUT', token: s.access_token, body: { password } });
}
// scope: 'local' (this browser), 'others', or 'global' (every browser)
export async function signOut(scope = 'local') {
  try { const s = await getSession(); if (s) await raw('/auth/v1/logout?scope=' + scope, { method: 'POST', token: s.access_token }); } catch { /* best effort */ }
  if (scope !== 'others') await chrome.storage.local.remove('auth');
}
// Remove everything Shelf keeps in this browser (used after signing out).
export async function clearLocal() {
  await chrome.storage.local.remove(['auth', 'state', 'sessions', 'cloudMeta', 'meta']);
}

export async function rest(method, path, body, headers = {}) {
  let s = await getSession();
  if (!s) throw new CloudError('Not signed in.', 401);
  try { return await raw('/rest/v1/' + path, { method, body, token: s.access_token, headers }); }
  catch (e) {
    if (e.status !== 401) throw e;
    s = await getSession(true); // the token was rejected: try a fresh one, once
    if (!s) throw new CloudError('Not signed in.', 401);
    return raw('/rest/v1/' + path, { method, body, token: s.access_token, headers });
  }
}
async function fetchAll(table, order = 'id') {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const rows = await rest('GET', `${table}?select=*&order=${order}&limit=1000&offset=${offset}`);
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}
const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// Public site settings (donation button and so on), editable by the site admin. Works signed out.
export async function siteContent() {
  const rows = await raw('/rest/v1/site_content?select=value&key=eq.site');
  return rows && rows[0] ? rows[0].value : null;
}

/* ---------- devices (signed-in browsers) ---------- */
export async function deviceId() {
  let id = await getK('deviceId');
  if (!id) { id = newId(); await setK('deviceId', id); }
  return id;
}
function deviceName() {
  const ua = navigator.userAgent;
  const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : navigator.brave ? 'Brave' : 'Chrome';
  const o = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /CrOS/.test(ua) ? 'ChromeOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'this device';
  return `${b} on ${o}`;
}
export const signOutDevice = (id) => rest('DELETE', `devices?id=eq.${id}`);
export async function signOutOthers() { await rest('DELETE', `devices?id=neq.${await deviceId()}`); await signOut('others'); }
export async function signOutEverywhere() {
  const s = await getSession();
  if (s) { try { await rest('DELETE', `devices?user_id=eq.${s.user.id}`); } catch { /* still sign out */ } }
  await signOut('global');
}

/* ---------- sharing ---------- */
const enc = encodeURIComponent;
export const listMembers = (spaceId) => rest('GET', `space_members?select=*&space_id=eq.${spaceId}&order=email`);
export const addMember = (spaceId, email, role) => rest('POST', 'space_members?on_conflict=space_id,email', [{ space_id: spaceId, email: email.trim().toLowerCase(), role }], { Prefer: 'resolution=merge-duplicates,return=minimal' });
export const setMemberRole = (spaceId, email, role) => rest('PATCH', `space_members?space_id=eq.${spaceId}&email=eq.${enc(email)}`, { role });
export const removeMember = (spaceId, email) => rest('DELETE', `space_members?space_id=eq.${spaceId}&email=eq.${enc(email)}`);
export const makePrivate = (spaceId) => rest('DELETE', `space_members?space_id=eq.${spaceId}`);

/* ---------- sync ---------- */
// Each record syncs on its own; the newest change (by updatedAt) wins.
const T = {
  spaces: {
    space: (r) => r.id,
    toRemote: (r, uid) => ({ id: r.id, owner: r.owner || uid, name: r.name, color: r.color || null }),
    toLocal: (x) => ({ id: x.id, owner: x.owner, name: x.name, color: x.color || '#6E93FF' }),
  },
  folders: {
    space: (r) => r.spaceId,
    toRemote: (r) => ({ id: r.id, space_id: r.spaceId, parent_id: r.parentId || null, name: r.name }),
    toLocal: (x) => ({ id: x.id, spaceId: x.space_id, parentId: x.parent_id || null, name: x.name }),
  },
  collections: {
    space: (r) => r.spaceId,
    toRemote: (r) => ({ id: r.id, space_id: r.spaceId, folder_id: r.folderId || null, name: r.name, note: r.note || '', tasks: r.tasks || [], items: r.items || [] }),
    toLocal: (x) => ({ id: x.id, spaceId: x.space_id, folderId: x.folder_id || null, name: x.name, note: x.note || '', tasks: x.tasks || [], items: x.items || [] }),
  },
};
const TABLES = ['spaces', 'folders', 'collections'];
const replace = (target, src) => { for (const k of Object.keys(target)) delete target[k]; Object.assign(target, src); };

export async function sync(state) {
  const sess = await getSession();
  if (!sess) return null;
  const uid = sess.user.id, email = (sess.user.email || '').toLowerCase();
  const myDevice = await deviceId();
  const meta = (await getK('cloudMeta')) || {};

  // 1. Is this browser still signed in? Another browser can remove our device row.
  let devices = await rest('GET', 'devices?select=*&order=last_seen.desc');
  if (meta.registered === uid && !devices.some((d) => d.id === myDevice)) return { signedOut: true };
  const mine = { id: myDevice, user_id: uid, name: deviceName(), last_seen: new Date().toISOString() };
  await rest('POST', 'devices?on_conflict=id', [mine], { Prefer: 'resolution=merge-duplicates,return=minimal' });
  devices = [mine, ...devices.filter((d) => d.id !== myDevice)];
  meta.registered = uid;

  // 2. Pull everything this account can see.
  const [rs, rf, rc, members] = await Promise.all([fetchAll('spaces'), fetchAll('folders'), fetchAll('collections'), fetchAll('space_members', 'space_id,email')]);
  const remote = { spaces: rs, folders: rf, collections: rc };
  const remoteSpace = new Map(rs.map((r) => [r.id, r]));
  const memberRole = new Map(members.filter((m) => m.email.toLowerCase() === email).map((m) => [m.space_id, m.role]));

  let changed = false, reverted = false;
  const plan = { upserts: {}, tombs: [], leave: [] };

  // 3. Merge and decide what to push (no network inside the lock).
  await withLock(async () => {
    state.dirty ||= {}; state.tombs ||= {};
    if (meta.attached !== uid) {
      // First sync of this account in this browser.
      if (state.pristine && rs.some((r) => !r.deleted)) { state.spaces = []; state.folders = []; state.collections = []; state.dirty = {}; state.tombs = {}; changed = true; }
      else for (const t of TABLES) for (const r of state[t]) { state.dirty[`${t}:${r.id}`] = 1; r.updatedAt ||= Date.now(); if (t === 'spaces') delete r.owner; }
      state.pristine = false;
      meta.attached = uid;
    }
    for (const t of TABLES) {
      const local = state[t], byId = new Map(local.map((r) => [r.id, r])), seen = new Set();
      const drop = (l) => { local.splice(local.indexOf(l), 1); delete state.dirty[`${t}:${l.id}`]; changed = true; };
      for (const row of remote[t]) {
        seen.add(row.id);
        const key = `${t}:${row.id}`, l = byId.get(row.id), tomb = state.tombs[key];
        if (row.deleted) {
          if (l) { if ((l.updatedAt || 0) <= row.updated_at) drop(l); else state.dirty[key] = 1; }
          delete state.tombs[key];
        } else if (!l) {
          if (tomb && tomb.ts >= row.updated_at) continue; // we deleted it more recently
          delete state.tombs[key];
          local.push({ ...T[t].toLocal(row), updatedAt: row.updated_at }); changed = true;
        } else if (row.updated_at > (l.updatedAt || 0)) {
          replace(l, { ...T[t].toLocal(row), updatedAt: row.updated_at }); delete state.dirty[key]; changed = true;
        } else if (row.updated_at < (l.updatedAt || 0)) state.dirty[key] = 1;
      }
      // Gone from the server and not waiting to be uploaded: deleted for good, or access was removed.
      for (const l of [...local]) if (!seen.has(l.id) && !state.dirty[`${t}:${l.id}`]) drop(l);
      for (const key of Object.keys(state.tombs)) if (key.startsWith(t + ':') && !seen.has(key.slice(t.length + 1))) delete state.tombs[key];
    }
    // Children of spaces that no longer exist locally cannot be shown; drop them.
    const spaceIds = new Set(state.spaces.map((s) => s.id));
    for (const t of ['folders', 'collections']) for (const l of [...state[t]]) if (!spaceIds.has(l.spaceId)) { state[t].splice(state[t].indexOf(l), 1); delete state.dirty[`${t}:${l.id}`]; changed = true; }

    const roleOf = (sid) => {
      const r = remoteSpace.get(sid);
      if (!r) return spaceIds.has(sid) ? 'owner' : null; // a space created here, not uploaded yet
      return r.owner === uid ? 'owner' : memberRole.get(sid) || null;
    };
    const canEdit = (sid) => ['owner', 'editor'].includes(roleOf(sid));

    for (const t of TABLES) {
      plan.upserts[t] = [];
      for (const l of [...state[t]]) {
        const key = `${t}:${l.id}`;
        if (!state.dirty[key]) continue;
        if (!canEdit(T[t].space(l))) { // view-only: undo the local change
          const row = remote[t].find((r) => r.id === l.id && !r.deleted);
          if (row) replace(l, { ...T[t].toLocal(row), updatedAt: row.updated_at }); else state[t].splice(state[t].indexOf(l), 1);
          delete state.dirty[key]; changed = reverted = true; continue;
        }
        l.updatedAt ||= Date.now();
        if (t === 'spaces') l.owner ||= uid;
        plan.upserts[t].push({ key, ts: l.updatedAt, row: { ...T[t].toRemote(l, uid), updated_at: l.updatedAt, deleted: false } });
      }
    }
    // Deleting a space you do not own means leaving it: its contents must stay for everyone else.
    const leaving = new Set(Object.keys(state.tombs).filter((k) => k.startsWith('spaces:')).map((k) => k.slice(7)).filter((id) => remoteSpace.has(id) && remoteSpace.get(id).owner !== uid));
    for (const [key, tomb] of Object.entries(state.tombs)) {
      const [t, id] = key.split(':');
      const row = remote[t].find((r) => r.id === id);
      if (!row || (t !== 'spaces' && leaving.has(tomb.spaceId))) { delete state.tombs[key]; continue; }
      if (t === 'spaces' && row.owner !== uid) { plan.leave.push({ key, id }); continue; } // deleting a shared space = leaving it
      if (!canEdit(tomb.spaceId)) { // view-only: bring it back
        state[t].push({ ...T[t].toLocal(row), updatedAt: row.updated_at }); delete state.tombs[key]; changed = reverted = true; continue;
      }
      plan.tombs.push({ key, t, id, ts: tomb.ts });
    }
    if (!state.spaces.length) { // never leave the app without a space
      const sp = { id: newId(), name: 'My space', color: '#6E93FF', owner: uid, updatedAt: Date.now() };
      state.spaces.push(sp); state.dirty['spaces:' + sp.id] = 1; changed = true;
      plan.upserts.spaces.push({ key: 'spaces:' + sp.id, ts: sp.updatedAt, row: { ...T.spaces.toRemote(sp, uid), updated_at: sp.updatedAt, deleted: false } });
    }
    await saveRaw(state);
    await setK('cloudMeta', meta);
  });

  // 4. Push.
  const up = { Prefer: 'resolution=merge-duplicates,return=minimal' };
  for (const l of plan.leave) await rest('DELETE', `space_members?space_id=eq.${l.id}&email=eq.${enc(email)}`);
  for (const t of TABLES) for (const part of chunks(plan.upserts[t], 200)) await rest('POST', `${t}?on_conflict=id`, part.map((p) => p.row), up);
  for (const t of TABLES) for (const part of chunks(plan.tombs.filter((x) => x.t === t), 80)) await rest('PATCH', `${t}?id=in.(${part.map((p) => p.id).join(',')})`, { deleted: true, updated_at: Date.now() });

  // 5. Mark as uploaded, unless the record changed again while we were pushing.
  await withLock(async () => {
    for (const t of TABLES) for (const p of plan.upserts[t]) { const id = p.key.slice(t.length + 1), l = state[t].find((r) => r.id === id); if (!l || l.updatedAt === p.ts) delete state.dirty[p.key]; }
    for (const p of [...plan.tombs, ...plan.leave]) delete state.tombs[p.key];
    await saveRaw(state);
  });
  return { changed, reverted, members, devices, deviceId: myDevice, uid, email };
}
