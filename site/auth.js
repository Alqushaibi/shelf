// Landing page for the links in Shelf's account emails: confirming an email address and choosing a new password.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { h } from './site.js';

const box = document.getElementById('auth');
const params = new URLSearchParams(location.hash.slice(1));
for (const [k, v] of new URLSearchParams(location.search)) if (!params.has(k)) params.set(k, v);
// The link carries a one-time session. Take it out of the address bar and browser history straight away.
history.replaceState(null, '', location.pathname);
// If another email link is opened in this same tab, start again with it.
addEventListener('hashchange', () => { if (location.hash.length > 1) location.reload(); });

async function call(path, method, token, body) {
  const res = await fetch(SUPABASE_URL + path, { method, headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error((data && (data.msg || data.message || data.error_description)) || `Request failed (${res.status})`);
  return data;
}
const endSession = (token) => call('/auth/v1/logout?scope=local', 'POST', token).catch(() => {});
const logo = () => h('img', { src: 'assets/logo.svg', alt: '' });
const show = (title, ...body) => box.replaceChildren(logo(), h('h1', {}, title), ...body);
const back = () => h('p', {}, 'You can close this page and go back to Shelf.');

const token = params.get('access_token'), type = params.get('type');
if (params.get('error_code') || params.get('error_description') || params.get('error')) {
  const expired = /expired|invalid/i.test((params.get('error_code') || '') + ' ' + (params.get('error_description') || ''));
  show(expired ? 'This link has expired' : 'This link did not work',
    h('p', {}, expired ? 'Email links work once and only for a limited time.' : (params.get('error_description') || 'Something went wrong with this link.')),
    h('p', {}, 'Open Shelf and ask for a new one: use "Forgot password?" for a password link, or "Send again" for a confirmation link.'));
} else if (token && type === 'recovery') {
  const p1 = h('input', { type: 'password', id: 'p1', required: true, minlength: 8, autocomplete: 'new-password' });
  const p2 = h('input', { type: 'password', id: 'p2', required: true, minlength: 8, autocomplete: 'new-password' });
  const msg = h('p', { class: 'err', role: 'alert' });
  const btn = h('button', { type: 'submit', class: 'btn primary' }, 'Save new password');
  show('Choose a new password', h('form', { style: 'display:flex;flex-direction:column;gap:10px', onsubmit: async (e) => {
    e.preventDefault(); msg.textContent = '';
    if (p1.value.length < 8) { msg.textContent = 'Use at least 8 characters.'; return; }
    if (p1.value !== p2.value) { msg.textContent = 'The two passwords do not match.'; return; }
    btn.disabled = true;
    try { await call('/auth/v1/user', 'PUT', token, { password: p1.value }); await endSession(token); show('Password changed', h('p', {}, 'Sign in to Shelf with your new password.'), back()); }
    catch (x) { msg.textContent = x.message; btn.disabled = false; }
  } }, h('label', { for: 'p1' }, 'New password'), p1, h('label', { for: 'p2' }, 'Repeat new password'), p2, h('p', { style: 'font-size:14px' }, 'At least 8 characters.'), btn, msg));
  p1.focus();
} else if (token) {
  if (type) endSession(token); // a confirmation link signs this page in; that session is not needed here
  show(type === 'signup' || type === 'email' || type === 'invite' ? 'Email confirmed' : type === 'email_change' ? 'Email address updated' : 'You are signed in',
    h('p', {}, type ? 'Your email address is confirmed. Sign in to Shelf with your email and password.' : 'Sign-in finished.'), back());
} else {
  show('Shelf account', h('p', {}, 'This page opens from the links in Shelf\'s account emails. There is nothing to do here right now.'), h('a', { class: 'btn ghost', href: 'index.html' }, 'Go to the Shelf site'));
}
