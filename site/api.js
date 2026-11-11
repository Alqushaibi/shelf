// Small Supabase REST helper shared by the public site and the admin page.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const KEY = 'shelf-admin-session';
async function raw(path, { method = 'GET', body, token, headers = {} } = {}) {
  const res = await fetch(SUPABASE_URL + path, {
    method,
    headers: { apikey: SUPABASE_KEY, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) { const e = new Error((data && (data.msg || data.message || data.error_description || data.error)) || `Request failed (${res.status})`); e.status = res.status; throw e; }
  return data;
}

/* ---------- public reads ---------- */
export async function loadContent() {
  const rows = await raw('/rest/v1/site_content?select=value&key=eq.site');
  return rows && rows[0] ? rows[0].value : null;
}
export const loadStats = () => raw('/rest/v1/rpc/shelf_stats', { method: 'POST', body: {} });

/* ---------- admin session ---------- */
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
const write = (s) => { try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* storage blocked */ } };
const toSession = (d, user = d.user) => ({ access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Date.now() + Number(d.expires_in || 3600) * 1000, email: user.email || '' });

export async function session() {
  let s = read();
  if (!s) return null;
  if (s.expires_at - Date.now() > 60000) return s;
  try { s = toSession(await raw('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh_token } })); write(s); return s; }
  catch { write(null); return null; }
}
export async function signIn(email, password) {
  const s = toSession(await raw('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } }));
  write(s); return s;
}
export function signInWithGoogle() {
  const back = location.origin + location.pathname;
  location.href = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(back)}`;
}
// After Google sends the browser back here, the session is in the address. Take it and clean the address.
export async function finishRedirect() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (!p.get('access_token')) { if (p.get('error_description')) throw new Error(p.get('error_description')); return null; }
  history.replaceState(null, '', location.pathname);
  const user = await raw('/auth/v1/user', { token: p.get('access_token') });
  const s = toSession({ access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_in: p.get('expires_in') }, user);
  write(s); return s;
}
export async function signOut() {
  const s = read();
  if (s) { try { await raw('/auth/v1/logout?scope=local', { method: 'POST', token: s.access_token }); } catch { /* best effort */ } }
  write(null);
}
export async function isAdmin() {
  const s = await session(); if (!s) return false;
  return (await raw('/rest/v1/rpc/shelf_is_admin', { method: 'POST', body: {}, token: s.access_token })) === true;
}
export async function saveContent(value) {
  const s = await session(); if (!s) throw new Error('Your sign-in ended. Sign in again.');
  await raw('/rest/v1/site_content?on_conflict=key', { method: 'POST', token: s.access_token, body: [{ key: 'site', value, updated_at: new Date().toISOString() }], headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
}
