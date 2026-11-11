// Every importer returns the same tree: { name, children: [tree], links: [{url,title,note}] }
const node = (name) => ({ name: name || 'Untitled', children: [], links: [], on: true });
const ok = (u) => /^https?:\/\//i.test(u || '');

export function fromChromeTree(roots) {
  const conv = (n) => {
    const out = node(n.title);
    for (const c of n.children || []) {
      if (c.url) { if (ok(c.url)) out.links.push({ url: c.url, title: c.title || c.url }); }
      else out.children.push(conv(c));
    }
    return out;
  };
  const root = node('Browser bookmarks');
  for (const r of roots) root.children.push(...conv(r).children);
  return prune(root);
}

// Netscape bookmark file: the export format of Chrome, Edge, Firefox, Safari and most bookmark tools.
export function parseHtml(text) {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const used = new Set();
  const walk = (dl, name) => {
    const out = node(name);
    const kids = [];
    (function collect(el) { for (const c of el.children) { if (c.tagName === 'P') collect(c); else kids.push(c); } })(dl);
    for (const k of kids) {
      if (used.has(k)) continue;
      if (k.tagName === 'DL') { const sub = walk(k, ''); out.children.push(...sub.children); out.links.push(...sub.links); continue; }
      if (k.tagName !== 'DT') continue;
      const h3 = k.querySelector(':scope > h3');
      const a = k.querySelector(':scope > a');
      if (h3) {
        let sub = k.querySelector(':scope > dl');
        if (!sub && k.nextElementSibling && k.nextElementSibling.tagName === 'DL') { sub = k.nextElementSibling; used.add(sub); }
        out.children.push(sub ? walk(sub, h3.textContent.trim()) : node(h3.textContent.trim()));
      } else if (a && ok(a.getAttribute('href'))) {
        out.links.push({ url: a.getAttribute('href'), title: a.textContent.trim() || a.getAttribute('href') });
      }
    }
    return out;
  };
  const dl = doc.querySelector('dl');
  if (dl) return prune(walk(dl, 'Bookmarks file'));
  const flat = node('Bookmarks file');
  for (const a of doc.querySelectorAll('a[href]')) if (ok(a.getAttribute('href'))) flat.links.push({ url: a.getAttribute('href'), title: a.textContent.trim() || a.getAttribute('href') });
  return flat;
}

// JSON exports from tab managers. Handles { lists: [{ title, cards: [{ title, url }] }] }
// and, more generally, any nesting of objects that hold arrays of things with a url.
const KEYS = ['lists', 'cards', 'children', 'links', 'items', 'tabs', 'bookmarks', 'collections', 'folders', 'groups', 'spaces'];
export function parseJson(text) {
  const conv = (v, name) => {
    const out = node(name);
    for (const x of Array.isArray(v) ? v : [v]) {
      if (typeof x === 'string') { if (ok(x)) out.links.push({ url: x, title: x }); continue; }
      if (!x || typeof x !== 'object') continue;
      if (typeof x.url === 'string') {
        if (ok(x.url)) out.links.push({ url: x.url, title: x.customTitle || x.title || x.name || x.url, note: x.customDescription || x.description || x.note || '' });
        continue;
      }
      const keys = KEYS.filter((k) => Array.isArray(x[k]));
      if (!keys.length) continue;
      const child = node(x.title || x.name || '');
      for (const k of keys) { const sub = conv(x[k], ''); child.children.push(...sub.children); child.links.push(...sub.links); }
      out.children.push(child);
    }
    return out;
  };
  let root = conv(JSON.parse(text), 'Imported file');
  while (root.children.length === 1 && !root.links.length && root.children[0].name === 'Untitled') root = { ...root.children[0], name: 'Imported file' };
  return prune(root);
}

function csvRows(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((c) => c !== '')) rows.push(row); row = []; }
    else cell += ch;
  }
  row.push(cell); if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

// CSV with a header row. Recognised columns: url/link, title/name, folder/collection/path, note/description.
export function parseCsv(text) {
  const rows = csvRows(text);
  const root = node('Imported file');
  if (!rows.length) return root;
  const head = rows[0].map((c) => c.trim().toLowerCase());
  const col = (...names) => head.findIndex((c) => names.includes(c));
  let iu = col('url', 'link', 'href', 'address'), it = col('title', 'name'), ifo = col('folder', 'collection', 'path', 'list', 'category'), ino = col('note', 'notes', 'description', 'excerpt');
  let body = rows.slice(1);
  if (iu < 0) { iu = rows[0].findIndex((c) => ok(c.trim())); body = rows; it = ifo = ino = -1; }
  if (iu < 0) return root;
  for (const r of body) {
    const url = (r[iu] || '').trim(); if (!ok(url)) continue;
    let at = root;
    const p = ifo >= 0 ? (r[ifo] || '').split(/\s*(?:\/|>|›)\s*/).filter(Boolean) : [];
    for (const part of p) { let n = at.children.find((c) => c.name === part); if (!n) { n = node(part); at.children.push(n); } at = n; }
    at.links.push({ url, title: (it >= 0 && r[it].trim()) || url, note: ino >= 0 ? (r[ino] || '').trim() : '' });
  }
  return root;
}

// One address per line. Also accepts "url | title" lines, with blank lines starting a new group.
export function parseList(text) {
  const root = node('Pasted links');
  let group = null, n = 0;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/(https?:\/\/[^\s|]+)(?:\s*\|\s*(.*))?/i);
    if (!m) { if (!line.trim()) group = null; continue; }
    if (!group) { group = node('Group ' + ++n); root.children.push(group); }
    group.links.push({ url: m[1], title: (m[2] || '').trim() || m[1] });
  }
  if (root.children.length === 1) { root.links = root.children[0].links; root.children = []; }
  return root;
}

export function parseAny(text, fileName = '') {
  const t = text.trimStart();
  if (t[0] === '{' || t[0] === '[') return parseJson(text);
  if (/<dl|<a\s/i.test(t.slice(0, 20000))) return parseHtml(text);
  if (/\.csv$/i.test(fileName) || /^[^\n]*\b(url|link|href)\b[^\n]*,|,[^\n]*\b(url|link|href)\b/i.test(t.split('\n')[0])) return parseCsv(text);
  return parseList(text);
}

function prune(n) {
  n.children = n.children.map(prune).filter((c) => c.children.length || c.links.length);
  return n;
}

export const countAll = (n) => n.links.length + n.children.reduce((s, c) => s + countAll(c), 0);
export const countFolders = (n) => n.children.reduce((s, c) => s + 1 + countFolders(c), 0);
export function selectedLinks(n) {
  if (!n.on) return [];
  return [...n.links, ...n.children.flatMap(selectedLinks)];
}
