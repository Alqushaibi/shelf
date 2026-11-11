// Renders the whole public site from the content saved by the admin. Nothing on the page is written here.
import { loadContent, loadStats } from './api.js';

export function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) { if (c == null || c === false) continue; e.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return e;
}
// Only ordinary links are allowed, whatever was typed into the admin page.
export const safeHref = (u) => {
  const v = (u || '').trim();
  // absolute web links, mail links, in-page anchors, or a plain relative path such as downloads/shelf-extension.zip
  return /^(https?:\/\/|mailto:|#)/i.test(v) || /^(?![a-z][a-z0-9+.-]*:)(?!\/\/)[\w.\/~-]+([?#].*)?$/i.test(v) ? v : '';
};
const hex = (c, fallback) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : fallback);

export const ICONS = {
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  download: '<path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 5a3.5 3.5 0 0 1 0 7M18 14.5a6 6 0 0 1 3.5 5.5"/>',
  sync: '<path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5zM3 13l9 5 9-5"/>',
  note: '<path d="M5 4h14v12l-4 4H5zM15 20v-4h4M8 9h8M8 13h5"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8 6.6 19.7l1.1-6.1L3.2 9.4l6.1-.8z"/>',
};
export function icon(name, size = 20) {
  const s = document.createElement('span'); s.className = 'ic';
  s.innerHTML = `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.layers}</svg>`;
  return s;
}
const btn = (b, cls) => (b && b.label && safeHref(b.href) ? h('a', { class: 'btn ' + cls, href: safeHref(b.href) }, b.label) : null);
const shown = (s) => s && s.show !== false;

// A drawing of the app, used in the hero when the admin has not set a picture.
function appSketch() {
  const row = (w) => h('div', { class: 'sk-row' }, h('i', {}), h('b', { style: `width:${w}%` }));
  const card = (rows) => h('div', { class: 'sk-card' }, h('div', { class: 'sk-title' }), rows.map(row));
  return h('div', { class: 'sketch', 'aria-hidden': 'true' },
    h('div', { class: 'sk-side' }, h('div', { class: 'sk-logo' }), [70, 55, 62, 48, 58].map((w) => h('div', { class: 'sk-nav', style: `width:${w}%` }))),
    h('div', { class: 'sk-main' }, h('div', { class: 'sk-head' }), h('div', { class: 'sk-grid' }, card([80, 64, 72]), card([58, 76]), card([70, 52, 66]), card([62, 78]))),
    h('div', { class: 'sk-tabs' }, [72, 60, 80, 54, 68].map(row)));
}

// Minimal formatting for long text: "## Heading", "- list item", blank line between paragraphs.
function richText(body) {
  const out = []; let list = null;
  for (const block of String(body || '').split(/\n{2,}/)) {
    for (const line of block.split('\n')) {
      const t = line.trim(); if (!t) continue;
      if (t.startsWith('## ')) { list = null; out.push(h('h2', {}, t.slice(3))); }
      else if (t.startsWith('- ')) { if (!list) { list = h('ul', {}); out.push(list); } list.append(h('li', {}, t.slice(2))); }
      else { list = null; out.push(h('p', {}, t)); }
    }
    list = null;
  }
  return out;
}

function header(c) {
  const nav = (c.nav || []).filter((n) => n.label && safeHref(n.href));
  return h('header', { class: 'top' }, h('div', { class: 'wrap bar' },
    h('a', { class: 'brand', href: 'index.html' }, c.brand?.logoUrl ? h('img', { src: c.brand.logoUrl, alt: '', width: 32, height: 32 }) : null, c.brand?.name || ''),
    h('nav', { 'aria-label': 'Main' }, nav.map((n) => h('a', { href: n.href.startsWith('#') ? 'index.html' + n.href : safeHref(n.href) }, n.label))),
    btn(c.navButton && { ...c.navButton, href: (c.navButton.href || '').startsWith('#') ? 'index.html' + c.navButton.href : c.navButton.href }, 'primary small')));
}
function footer(c) {
  const f = c.footer || {};
  return h('footer', { class: 'foot' }, h('div', { class: 'wrap' },
    h('div', { class: 'foot-grid' },
      h('div', {}, h('div', { class: 'brand on-dark' }, c.brand?.logoUrl ? h('img', { src: c.brand.logoUrl, alt: '', width: 28, height: 28 }) : null, c.brand?.name || '')),
      (f.groups || []).map((g) => h('div', {}, h('h3', {}, g.title), h('ul', {}, (g.links || []).filter((l) => l.label && safeHref(l.href)).map((l) => h('li', {}, h('a', { href: l.href.startsWith('#') ? 'index.html' + l.href : safeHref(l.href) }, l.label))))))),
    h('p', { class: 'copy' }, f.copyright || '')));
}

function home(c) {
  const main = h('main', {});
  const add = (id, cls, ...kids) => main.append(h('section', { id, class: cls }, h('div', { class: 'wrap' }, kids)));
  const hero = c.hero || {};
  add('top', 'hero',
    h('div', { class: 'hero-text' }, h('h1', {}, hero.title), hero.subtitle ? h('p', { class: 'kicker' }, hero.subtitle) : null, hero.text ? h('p', { class: 'lead' }, hero.text) : null,
      h('div', { class: 'row' }, btn(hero.primaryButton, 'primary'), btn(hero.secondaryButton, 'ghost'))),
    h('div', { class: 'hero-art' }, /^https:\/\//.test(hero.imageUrl || '') ? h('img', { src: hero.imageUrl, alt: '' }) : appSketch()));

  if (shown(c.highlights) && c.highlights.items?.length) add('highlights', 'band',
    h('h2', {}, c.highlights.title), h('ul', { class: 'ticks' }, c.highlights.items.filter(Boolean).map((t) => h('li', {}, icon('check', 18), h('span', {}, t)))));

  if (shown(c.features) && c.features.items?.length) add('features', 'features',
    h('h2', {}, c.features.title), c.features.items.map((f) => h('article', { class: 'feature' }, h('div', { class: 'feature-art' }, icon(f.icon, 56)), h('div', {}, h('h3', {}, f.title), h('p', {}, f.text)))));

  if (shown(c.platforms) && c.platforms.items?.length) add('platforms', 'band',
    h('h2', {}, c.platforms.title), c.platforms.text ? h('p', { class: 'lead center' }, c.platforms.text) : null,
    h('div', { class: 'tiles' }, c.platforms.items.map((p) => { const href = safeHref(p.href); return h(href ? 'a' : 'div', { class: 'tile' + (href ? '' : ' off'), href: href || null, download: /\.zip([?#].*)?$/i.test(href) || null }, icon('download', 26), h('b', {}, p.label), p.note ? h('span', {}, p.note) : null); })));

  if (shown(c.testimonials) && c.testimonials.items?.length) add('testimonials', 'quotes',
    h('h2', {}, c.testimonials.title), h('div', { class: 'cards' }, c.testimonials.items.map((t) => h('figure', { class: 'quote' }, h('blockquote', {}, t.quote), h('figcaption', {}, h('b', {}, t.name), t.role ? h('span', {}, t.role) : null)))));

  if (shown(c.stats)) {
    const s = c.stats, cells = [['members', s.membersLabel], ['spaces', s.spacesLabel], ['collections', s.collectionsLabel], ['links', s.linksLabel]].filter(([, l]) => l);
    const nums = {};
    add('stats', 'stats', h('h2', {}, s.title), h('div', { class: 'statgrid' }, cells.map(([k, l]) => h('div', {}, (nums[k] = h('b', {}, '–')), h('span', {}, l)))));
    loadStats().then((d) => { for (const k of Object.keys(nums)) if (d && d[k] != null) nums[k].textContent = Number(d[k]).toLocaleString(); }).catch(() => {});
  }

  const d = c.donation;
  if (shown(d) && d.show && /^https:\/\//i.test(d.url || '')) add('donate', 'donate',
    h('div', { class: 'donate-box' }, icon('heart', 34), h('div', { class: 'grow' }, h('h2', {}, d.title), h('p', {}, d.text)), h('a', { class: 'btn primary', href: d.url, target: '_blank', rel: 'noopener' }, d.buttonLabel || 'Donate')));

  if (shown(c.faq) && c.faq.items?.length) add('faq', 'faq',
    h('h2', {}, c.faq.title), h('div', { class: 'faq-list' }, c.faq.items.map((q) => h('details', {}, h('summary', {}, q.q), h('p', {}, q.a)))));

  const cta = c.callToAction;
  if (shown(cta)) add('join', 'cta', h('h2', {}, cta.title), cta.text ? h('p', {}, cta.text) : null, btn(cta.button, 'light'));
  return main;
}
function page(c, slug) {
  const p = (c.pages || {})[slug];
  return h('main', {}, h('section', { class: 'doc' }, h('div', { class: 'wrap narrow' }, p ? [h('h1', {}, p.title), richText(p.body)] : h('h1', {}, 'Page not found'))));
}

async function start() {
  // Email confirmation and password reset links come back to the site's address. Hand them to the account page.
  if (/(^|[#&])(access_token|error_code|error_description)=/.test(location.hash)) { location.replace('auth.html' + location.hash); return; }
  const root = document.getElementById('site');
  const slug = document.body.dataset.page || '';
  let c;
  try { c = await loadContent(); } catch (e) { root.replaceChildren(h('p', { class: 'notice' }, 'This page could not be loaded. Please try again shortly.')); return; }
  if (!c) { root.replaceChildren(h('p', { class: 'notice' }, 'This site has no content yet.')); return; }
  const t = c.theme || {}, st = document.documentElement.style;
  st.setProperty('--accent', hex(t.accent, '#2456E6')); st.setProperty('--dark', hex(t.dark, '#14181F')); st.setProperty('--bg', hex(t.background, '#F4F5F7'));
  const title = slug && c.pages?.[slug] ? `${c.pages[slug].title} – ${c.brand?.name || ''}` : c.brand?.pageTitle || c.brand?.name || '';
  document.title = title;
  document.querySelector('meta[name=description]')?.setAttribute('content', c.brand?.description || '');
  root.replaceChildren(h('a', { class: 'skip', href: '#main' }, 'Skip to content'), header(c), Object.assign(slug ? page(c, slug) : home(c), { id: 'main' }), footer(c));
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}
if (document.getElementById('site')) start();
