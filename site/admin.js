// Admin page: sign in, then edit every piece of site content in a form built from the content itself.
import * as api from './api.js';
import { h, ICONS } from './site.js';

const root = document.getElementById('admin');
let content = null, dirty = false;

/* What a new list item looks like, by list. Shapes only, no wording. */
const TEMPLATES = {
  'nav': { label: '', href: '' },
  'highlights.items': '',
  'features.items': { icon: 'layers', title: '', text: '' },
  'platforms.items': { label: '', note: '', href: '' },
  'testimonials.items': { quote: '', name: '', role: '' },
  'faq.items': { q: '', a: '' },
  'footer.groups': { title: '', links: [] },
  'footer.groups.links': { label: '', href: '' },
};
const LABELS = { q: 'Question', a: 'Answer', href: 'Link', url: 'Link', show: 'Show this section', showInExtension: 'Also show the button inside the Shelf extension', imageUrl: 'Picture address (optional)', logoUrl: 'Logo address', navButton: 'Header button', callToAction: 'Closing banner', faq: 'Questions', nav: 'Header links', pages: 'Privacy and terms pages', pageTitle: 'Browser tab title', description: 'Search engine description' };
const HINTS = {
  'donation.url': 'Your donation page, for example a PayPal.me, Ko-fi or Buy Me a Coffee link. Must start with https://',
  'donation.show': 'The donation block and button appear only when this is on and a link is set.',
  'hero.imageUrl': 'Leave empty to show the built-in drawing of the app. Must start with https://',
  'platforms.items.href': 'Leave empty until the store page exists; the tile then shows as not yet available.',
  'pages.privacy.body': 'Start a line with "## " for a heading and "- " for a list item. Leave an empty line between paragraphs.',
  'pages.terms.body': 'Start a line with "## " for a heading and "- " for a list item. Leave an empty line between paragraphs.',
  'testimonials.show': 'Only add quotes from real people who agreed to be quoted.',
  'stats.show': 'The numbers are live totals from the database.',
};
const LONG = new Set(['text', 'a', 'quote', 'description', 'copyright']);
const pretty = (k) => LABELS[k] || k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
const keyOf = (path) => path.filter((p) => typeof p === 'string').join('.');
const touch = () => { dirty = true; const m = document.querySelector('.a-bar .msg'); if (m) m.textContent = 'Unsaved changes'; };
let uid = 0;

function field(value, path, set) {
  const key = path[path.length - 1], pk = keyOf(path), id = 'f' + ++uid;
  const hint = HINTS[pk] ? h('div', { class: 'a-hint' }, HINTS[pk]) : null;
  if (typeof value === 'boolean') {
    const box = h('input', { type: 'checkbox', id, onchange: (e) => { set(e.target.checked); touch(); } }); box.checked = value;
    return h('div', { class: 'a-field' }, h('label', { class: 'a-check', for: id }, box, pretty(key)), hint);
  }
  if (typeof value === 'string' || value == null) {
    const v = value || '';
    let input;
    if (path[0] === 'theme') {
      const text = h('input', { type: 'text', id, value: v, oninput: (e) => { set(e.target.value); if (/^#[0-9a-f]{6}$/i.test(e.target.value)) pick.value = e.target.value; touch(); } });
      const pick = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(v) ? v : '#000000', 'aria-label': pretty(key) + ' picker', oninput: (e) => { text.value = e.target.value; set(e.target.value); touch(); } });
      input = h('div', { class: 'a-color' }, pick, text);
    } else if (key === 'icon') {
      input = h('select', { id, onchange: (e) => { set(e.target.value); touch(); } }, Object.keys(ICONS).map((n) => h('option', { value: n, selected: n === v }, n)));
    } else if (key === 'body' || LONG.has(key)) {
      input = h('textarea', { id, class: key === 'body' ? 'tall' : '', oninput: (e) => { set(e.target.value); touch(); } }); input.value = v;
    } else input = h('input', { type: 'text', id, value: v, oninput: (e) => { set(e.target.value); touch(); } });
    return h('div', { class: 'a-field' }, typeof key === 'number' ? null : h('label', { for: id }, pretty(key)), input, hint);
  }
  if (Array.isArray(value)) return list(value, path);
  return h('fieldset', { class: 'a-obj' }, h('legend', {}, pretty(key)), Object.keys(value).map((k) => field(value[k], [...path, k], (nv) => { value[k] = nv; })));
}
function list(arr, path) {
  const tpl = TEMPLATES[keyOf(path)];
  const box = h('fieldset', { class: 'a-list' });
  const draw = (openIndex = -1) => {
    const move = (i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; touch(); draw(j); };
    const controls = (i) => [
      h('button', { type: 'button', class: 'a-mini', 'aria-label': 'Move up', onclick: (e) => { e.preventDefault(); move(i, -1); } }, '↑'),
      h('button', { type: 'button', class: 'a-mini', 'aria-label': 'Move down', onclick: (e) => { e.preventDefault(); move(i, 1); } }, '↓'),
      h('button', { type: 'button', class: 'a-mini', 'aria-label': 'Remove', onclick: (e) => { e.preventDefault(); arr.splice(i, 1); touch(); draw(); } }, '✕')];
    box.replaceChildren(h('legend', {}, pretty(path[path.length - 1])),
      ...arr.map((item, i) => {
        if (typeof item === 'string') {
          const inp = h('input', { type: 'text', value: item, 'aria-label': `Item ${i + 1}`, oninput: (e) => { arr[i] = e.target.value; touch(); } });
          return h('div', { class: 'a-line' }, inp, controls(i));
        }
        const name = () => item.title || item.label || item.q || item.name || `Item ${i + 1}`;
        const label = h('span', {}, name());
        const d = h('details', { class: 'a-item', open: i === openIndex }, h('summary', {}, label, controls(i)),
          h('div', { class: 'a-body' }, Object.keys(item).map((k) => field(item[k], [...path, i, k], (nv) => { item[k] = nv; label.textContent = name(); }))));
        return d;
      }),
      tpl !== undefined ? h('button', { type: 'button', class: 'btn ghost small', style: 'align-self:flex-start', onclick: () => { arr.push(structuredClone(tpl)); touch(); draw(arr.length - 1); } }, 'Add') : null);
    if (openIndex >= 0) box.querySelectorAll('.a-item')[openIndex]?.querySelector('input,textarea,select')?.focus();
  };
  draw();
  return box;
}

function editor(email) {
  const msg = h('span', { class: 'msg', role: 'status' }, 'All changes saved');
  const save = h('button', { type: 'button', class: 'btn primary small', onclick: async () => {
    msg.textContent = 'Saving…'; save.disabled = true;
    try { await api.saveContent(content); dirty = false; msg.textContent = 'Saved. The site and the extension show the changes right away.'; }
    catch (e) { msg.textContent = 'Not saved: ' + e.message; }
    save.disabled = false;
  } }, 'Save changes');
  root.replaceChildren(
    h('div', { class: 'a-head' }, h('h1', { class: 'grow' }, 'Site admin'), h('span', { class: 'a-hint' }, email),
      h('a', { class: 'btn ghost small', href: 'index.html', target: '_blank', rel: 'noopener' }, 'View site'),
      h('button', { type: 'button', class: 'btn ghost small', onclick: async () => { if (dirty && !confirm('Leave without saving your changes?')) return; await api.signOut(); location.reload(); } }, 'Sign out')),
    ...Object.keys(content).map((k) => {
      const v = content[k];
      const body = Array.isArray(v) ? list(v, [k]) : typeof v === 'object' && v ? Object.keys(v).map((kk) => field(v[kk], [k, kk], (nv) => { v[kk] = nv; })) : field(v, [k], (nv) => { content[k] = nv; });
      return h('details', { class: 'a-panel' }, h('summary', {}, pretty(k)), h('div', { class: 'a-body' }, body));
    }),
    h('div', { class: 'a-bar' }, msg, save));
}

function login(message = '') {
  const email = h('input', { type: 'email', id: 'em', required: true, autocomplete: 'email' });
  const pw = h('input', { type: 'password', id: 'pw', required: true, autocomplete: 'current-password' });
  const err = h('p', { class: 'err', role: 'alert' }, message);
  root.replaceChildren(h('form', { class: 'a-login', onsubmit: async (e) => { e.preventDefault(); err.textContent = ''; try { await api.signIn(email.value.trim(), pw.value); start(); } catch (x) { err.textContent = x.message; } } },
    h('h1', {}, 'Site admin'), h('p', { class: 'a-hint' }, 'Sign in with an account that is on the admin list.'),
    h('button', { type: 'button', class: 'btn ghost', onclick: () => api.signInWithGoogle() }, 'Continue with Google'),
    h('label', { for: 'em' }, 'Email'), email, h('label', { for: 'pw' }, 'Password'), pw,
    h('button', { type: 'submit', class: 'btn primary' }, 'Sign in'), err));
}

async function start() {
  try { await api.finishRedirect(); } catch (e) { return login(e.message); }
  const s = await api.session();
  if (!s) return login();
  let admin = false;
  try { admin = await api.isAdmin(); } catch (e) { return login('Could not check admin access: ' + e.message); }
  if (!admin) { await api.signOut(); return login(`${s.email} is not on the admin list.`); }
  try { content = await api.loadContent(); } catch (e) { return login('Could not load the content: ' + e.message); }
  if (!content) return login('No content found. Run site.sql in Supabase first.');
  editor(s.email);
}
window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });
start();
