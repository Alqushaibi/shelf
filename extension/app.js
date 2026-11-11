import * as S from './store.js';
import * as I from './importers.js';
import * as C from './cloud.js';

const $ = (s) => document.querySelector(s);
const COLORS = ['#6E93FF', '#F2A25C', '#D9DEE6', '#7A8494', '#8FD3B6', '#E6A6C7'];
const DT = 'application/x-shelf';

let state, sessions = [], tabs = [], allTabs = [], selfTabId = null, selfWindowId = null;
const ui = { view: 'space', spaceId: null, folderId: null, open: new Set(), imp: null };
const cloud = { session: null, status: '', last: 0, members: [], devices: [], deviceId: null, error: '' };
let syncing = false, syncAgain = false, syncTimer = null;
let site = null; // public site settings from the admin (donation button)

/* ---------- tiny DOM helpers ---------- */
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k.startsWith('aria-') || k === 'role' || k === 'style' || k === 'for' || k === 'list') e.setAttribute(k, v);
    else if (k in e) { try { e[k] = v; } catch { e.setAttribute(k, v); } }
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}
const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  download: '<path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5zM3 13l9 5 9-5"/>',
  note: '<path d="M5 4h14v12l-4 4H5zM15 20v-4h4M8 9h8M8 13h5"/>',
  cmd: '<path d="m5 8 5 4-5 4M12 17h7"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 5a3.5 3.5 0 0 1 0 7M18 14.5a6 6 0 0 1 3.5 5.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  check: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
};
function ic(name, size = 16) {
  const s = document.createElement('span');
  s.className = 'ic';
  s.innerHTML = `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return s;
}
const ibtn = (name, label, onclick) => h('button', { class: 'ibtn', title: label, 'aria-label': label, onclick: (e) => { e.stopPropagation(); onclick(e); } }, ic(name));
const fav = (url) => h('img', { class: 'fav', alt: '', loading: 'lazy', src: chrome.runtime.getURL('/_favicon/') + '?pageUrl=' + encodeURIComponent(url) + '&size=32' });
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const isWeb = (u) => /^https?:/.test(u || '');
const when = (t) => new Date(t).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

/* ---------- dialogs ---------- */
function modal(title, content, okLabel = 'Save', getValue = () => true, danger = false) {
  return new Promise((res) => {
    const close = (v) => { ov.remove(); res(v); };
    const form = h('form', { class: 'modal', onsubmit: (e) => { e.preventDefault(); close(getValue()); } },
      h('h2', {}, title), content,
      h('div', { class: 'row end' },
        h('button', { type: 'button', class: 'btn', onclick: () => close(null) }, 'Cancel'),
        h('button', { type: 'submit', class: 'btn ' + (danger ? 'danger' : 'primary') }, okLabel)));
    const ov = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === ov) close(null); }, onkeydown: (e) => { if (e.key === 'Escape') close(null); } }, form);
    document.body.append(ov);
    const first = form.querySelector('input:not([type=checkbox]),select,textarea') || form.querySelector('button[type=submit]');
    first.focus(); if (first.select) first.select();
  });
}
const ask = (title, value = '', label = 'Name') => {
  const inp = h('input', { class: 'input', value, required: true, 'aria-label': label });
  return modal(title, inp, 'Save', () => inp.value.trim());
};
const sure = (title, text, okLabel = 'Delete') => modal(title, h('p', {}, text), okLabel, () => true, true);

/* ---------- state helpers ---------- */
const space = () => state.spaces.find((s) => s.id === ui.spaceId) || state.spaces[0];
const folder = (id) => state.folders.find((f) => f.id === id);
const subfolders = (spaceId, parentId) => state.folders.filter((f) => f.spaceId === spaceId && (f.parentId || null) === (parentId || null));
const colsIn = (spaceId, folderId) => state.collections.filter((c) => c.spaceId === spaceId && (c.folderId || null) === (folderId || null));
function descendants(fid) { const out = [fid]; for (const f of state.folders.filter((x) => x.parentId === fid)) out.push(...descendants(f.id)); return out; }
function folderCount(fid) { const ids = new Set(descendants(fid)); return state.collections.filter((c) => ids.has(c.folderId)).reduce((n, c) => n + c.items.length, 0); }
const spaceCount = (sid) => state.collections.filter((c) => c.spaceId === sid).reduce((n, c) => n + c.items.length, 0);
function path(fid) { const p = []; let f = folder(fid); while (f) { p.unshift(f); f = folder(f.parentId); } return p; }
const mkItem = (url, title, note = '') => ({ id: S.uid(), url, title: title || url, note });
function newCol(name, items = [], folderId = ui.folderId, spaceId = ui.spaceId) {
  const c = { id: S.uid(), spaceId, folderId: folderId || null, name, note: '', tasks: [], items, createdAt: Date.now() };
  state.collections.push(c); return c;
}
function newFolderRec(name, parentId = ui.folderId, spaceId = ui.spaceId) {
  const f = { id: S.uid(), spaceId, parentId: parentId || null, name, createdAt: Date.now() };
  state.folders.push(f); return f;
}
async function commit() { await S.save(state); render(); scheduleSync(); }
function go(spaceId, folderId = null) {
  ui.view = 'space'; ui.spaceId = spaceId; ui.folderId = folderId;
  path(folderId).forEach((f) => ui.open.add(f.id));
  render();
}

/* ---------- drag and drop ---------- */
const drag = (data) => ({ draggable: true, ondragstart: (e) => { e.dataTransfer.setData(DT, JSON.stringify(data)); e.dataTransfer.effectAllowed = 'move'; e.stopPropagation(); } });
function dropzone(el, onDrop) {
  el.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes(DT)) { e.preventDefault(); el.classList.add('over'); } });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', (e) => {
    el.classList.remove('over');
    const raw = e.dataTransfer.getData(DT); if (!raw) return;
    e.preventDefault(); e.stopPropagation(); onDrop(JSON.parse(raw));
  });
  return el;
}
function addTab(c, t) { if (isWeb(t.url) && !c.items.some((i) => i.url === t.url)) { c.items.push(mkItem(t.url, t.title)); return true; } return false; }
function dropOnCollection(c, d) {
  if (d.kind === 'tab') { const t = allTabs.find((x) => x.id === d.tabId); if (!t || !addTab(c, t)) return toast('That tab is already in this collection.'); }
  else if (d.kind === 'item') {
    const src = state.collections.find((x) => x.id === d.colId); if (!src || src === c) return;
    const i = src.items.findIndex((x) => x.id === d.itemId); if (i < 0) return;
    c.items.push(...src.items.splice(i, 1));
  } else return;
  commit();
}
function dropOnFolder(spaceId, folderId, d) {
  if (d.kind === 'col') { const c = state.collections.find((x) => x.id === d.colId); if (!c) return; c.spaceId = spaceId; c.folderId = folderId || null; }
  else if (d.kind === 'folder') {
    const f = folder(d.id); if (!f || f.id === folderId) return;
    const ids = descendants(f.id);
    if (folderId && ids.includes(folderId)) return toast('A folder cannot be moved inside itself.');
    f.parentId = folderId || null;
    for (const id of ids) { folder(id).spaceId = spaceId; state.collections.filter((c) => c.folderId === id).forEach((c) => { c.spaceId = spaceId; }); }
  } else if (d.kind === 'tab') {
    const t = allTabs.find((x) => x.id === d.tabId); if (!t || !isWeb(t.url)) return;
    newCol(t.title || host(t.url), [mkItem(t.url, t.title)], folderId, spaceId);
  } else return;
  commit();
}

/* ---------- tab actions ---------- */
async function loadTabs() {
  allTabs = await chrome.tabs.query({});
  const me = await chrome.tabs.getCurrent();
  selfTabId = me ? me.id : null; selfWindowId = me ? me.windowId : null;
  tabs = allTabs.filter((t) => (selfWindowId == null || t.windowId === selfWindowId) && t.id !== selfTabId);
}
function dupIds(list = tabs) {
  const seen = new Set(), dups = new Set();
  for (const t of [...list].sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0))) { if (!isWeb(t.url)) continue; if (seen.has(t.url)) dups.add(t.id); else seen.add(t.url); }
  return dups;
}
async function openUrl(url) {
  const t = allTabs.find((x) => x.url === url);
  if (t) { await chrome.tabs.update(t.id, { active: true }); await chrome.windows.update(t.windowId, { focused: true }); }
  else await chrome.tabs.create({ url, active: true });
}
async function sleepNow() {
  const n = await S.sleepIdle(0, selfWindowId ?? undefined);
  toast(n ? `${n} tab${n > 1 ? 's' : ''} put to sleep. They wake when you click them.` : 'No idle tabs to put to sleep.');
  await loadTabs(); render();
}
async function closeDuplicates() {
  const ids = [...dupIds()];
  if (!ids.length) return toast('No duplicate tabs in this window.');
  await chrome.tabs.remove(ids); toast(`Closed ${ids.length} duplicate tab${ids.length > 1 ? 's' : ''}.`);
}
async function saveSession() {
  const name = await ask('Save session', 'Session ' + new Date().toLocaleDateString(), 'Session name'); if (!name) return;
  const s = await S.snapshot(false, name);
  sessions = await S.getSessions(); toast(s ? 'Session saved.' : 'There are no web tabs to save.'); render();
}
function saveAllAsCollection() {
  const web = tabs.filter((t) => isWeb(t.url)); if (!web.length) return toast('There are no web tabs to save.');
  if (ui.view !== 'space') ui.view = 'space';
  const seen = new Set();
  newCol('Tabs from ' + when(Date.now()), web.filter((t) => !seen.has(t.url) && seen.add(t.url)).map((t) => mkItem(t.url, t.title)));
  commit();
}
async function saveTabTo(t) {
  if (!state.collections.length) { newCol('Saved tabs', [mkItem(t.url, t.title)]); return commit(); }
  const sel = h('select', { 'aria-label': 'Collection' }, state.collections.map((c) => h('option', { value: c.id }, [state.spaces.find((s) => s.id === c.spaceId)?.name, ...path(c.folderId).map((f) => f.name), c.name].join(' › '))));
  const id = await modal('Save tab to', sel, 'Save', () => sel.value); if (!id) return;
  const c = state.collections.find((x) => x.id === id);
  if (!addTab(c, t)) return toast('That tab is already in this collection.');
  commit();
}

/* ---------- sidebar ---------- */
function renderSide() {
  const navBtn = (label, icon, view) => h('button', { class: 'navitem' + (ui.view === view ? ' active' : ''), onclick: () => { ui.view = view; render(); } }, ic(icon), h('span', { class: 'grow' }, label));
  const folderRows = (spaceId, parentId, depth) => subfolders(spaceId, parentId).flatMap((f) => {
    const kids = subfolders(spaceId, f.id), isOpen = ui.open.has(f.id);
    const btn = dropzone(h('button', { class: 'navitem' + (ui.view === 'space' && ui.folderId === f.id ? ' active' : ''), onclick: () => go(spaceId, f.id), ...drag({ kind: 'folder', id: f.id }) },
      ic('folder'), h('span', { class: 'grow ellip' }, f.name), h('span', { class: 'count' }, folderCount(f.id))), (d) => dropOnFolder(spaceId, f.id, d));
    const row = h('div', { class: 'treerow', style: `padding-left:${depth * 14}px` },
      h('button', { class: 'chev' + (kids.length ? '' : ' blank'), 'aria-label': isOpen ? 'Collapse ' + f.name : 'Expand ' + f.name, 'aria-expanded': String(isOpen), onclick: () => { isOpen ? ui.open.delete(f.id) : ui.open.add(f.id); renderSide(); } }, ic(isOpen ? 'down' : 'right', 12)), btn);
    return [row, ...(isOpen ? folderRows(spaceId, f.id, depth + 1) : [])];
  });
  const spaceRows = state.spaces.flatMap((sp) => {
    const current = sp.id === ui.spaceId;
    const btn = dropzone(h('button', { class: 'navitem' + (ui.view === 'space' && current && !ui.folderId ? ' active' : ''), onclick: () => go(sp.id) },
      h('span', { class: 'dot', style: 'background:' + sp.color }), h('span', { class: 'grow ellip' }, sp.name), h('span', { class: 'count' }, spaceCount(sp.id))), (d) => dropOnFolder(sp.id, null, d));
    return [btn, ...(current ? folderRows(sp.id, null, 0) : [])];
  });
  const asleep = allTabs.filter((t) => t.discarded).length;
  $('#side').replaceChildren(
    h('div', { class: 'logo' }, h('img', { src: 'icons/128.png', alt: '', width: 28, height: 28 }), 'Shelf'),
    h('button', { class: 'search', onclick: openPalette }, ic('search'), h('span', { class: 'grow' }, 'Search or command'), h('kbd', {}, 'Ctrl K')),
    h('div', { class: 'nav' }, navBtn('Sessions', 'clock', 'sessions'), navBtn('Import bookmarks', 'download', 'import'), navBtn('Settings', 'gear', 'settings')),
    h('div', { class: 'nav' }, h('div', { class: 'label' }, 'Spaces'), spaceRows,
      h('button', { class: 'navitem dim', onclick: newSpace }, ic('plus'), 'New space')),
    h('div', { style: 'margin-top:auto' }),
    donation() ? h('button', { class: 'navitem', onclick: () => chrome.tabs.create({ url: donation().url }) }, ic('heart'), h('span', { class: 'grow' }, donation().buttonLabel || 'Donate')) : null,
    h('button', { class: 'navitem' + (ui.view === 'account' ? ' active' : ''), style: 'min-height:48px', onclick: () => { ui.view = 'account'; render(); } }, ic('user'),
      h('span', { class: 'grow', style: 'min-width:0' }, h('span', { class: 'ellip', style: 'display:block' }, cloud.session ? cloud.session.user.email : 'Sign in to sync'),
        h('span', { class: 'count', style: 'display:block' }, !cloud.session ? 'Stored in this browser only' : cloud.status === 'syncing' ? 'Syncing…' : cloud.status === 'error' ? 'Sync problem' : cloud.last ? 'Synced' : 'Signed in'))),
    h('div', { class: 'sidecard', style: 'margin-top:0' }, h('div', { class: 'row' }, ic('moon'), h('b', {}, `${asleep} tab${asleep === 1 ? '' : 's'} asleep`)),
      h('div', { class: 'small', style: 'color:var(--sidemute)' }, `${allTabs.length} open across all windows`)));
}
function donation() {
  const d = site && site.donation;
  return d && d.show && d.showInExtension !== false && /^https:\/\//i.test(d.url || '') ? d : null;
}
async function newSpace() {
  const name = await ask('New space'); if (!name) return;
  const sp = { id: S.uid(), name, color: COLORS[state.spaces.length % COLORS.length] };
  state.spaces.push(sp); ui.view = 'space'; ui.spaceId = sp.id; ui.folderId = null; commit();
}

/* ---------- space / folder view ---------- */
function suggestion() {
  const saved = new Set(state.collections.flatMap((c) => c.items.map((i) => i.url)));
  const loose = tabs.filter((t) => isWeb(t.url) && !saved.has(t.url));
  let best = null;
  for (const c of colsIn(ui.spaceId, ui.folderId)) {
    const hosts = {}; c.items.forEach((i) => { const k = host(i.url); hosts[k] = (hosts[k] || 0) + 1; });
    const m = loose.filter((t) => hosts[host(t.url)] >= 2);
    if (m.length >= 2 && (!best || m.length > best.m.length)) best = { c, m };
  }
  return best;
}
const isCollapsed = (c) => !!(state.settings.collapsed || {})[c.id];
function setCollapsed(cols, on) {
  const m = (state.settings.collapsed ||= {});
  for (const c of cols) { if (on) m[c.id] = 1; else delete m[c.id]; }
  commit();
}
function collectionCard(c) {
  const done = c.tasks.filter((t) => t.done).length;
  const items = c.items.map((it) => h('div', { class: 'item', ...drag({ kind: 'item', colId: c.id, itemId: it.id }) },
    fav(it.url),
    h('div', { class: 'grow' },
      h('button', { class: 't ellip', title: it.url, onclick: () => openUrl(it.url) }, it.title),
      it.note ? h('div', { class: 'n ellip' }, it.note) : null),
    h('span', { class: 'acts row' },
      ibtn('note', 'Edit title and note', async () => {
        const t = h('input', { class: 'input', value: it.title, 'aria-label': 'Title', required: true });
        const n = h('textarea', { 'aria-label': 'Note', placeholder: 'Note' }, it.note || '');
        if (await modal('Edit link', h('div', { class: 'stack' }, t, n))) { it.title = t.value.trim() || it.url; it.note = n.value.trim(); commit(); }
      }),
      ibtn('x', 'Remove from collection', () => { c.items = c.items.filter((x) => x !== it); commit(); }))));
  const addTask = h('input', { class: 'input', placeholder: 'Add a task and press Enter', 'aria-label': 'New task', onkeydown: (e) => {
    if (e.key === 'Enter' && e.target.value.trim()) { c.tasks.push({ id: S.uid(), text: e.target.value.trim(), done: false }); ui.openDetails = c.id; commit(); }
  } });
  const det = h('details', { open: ui.openDetails === c.id || undefined, ontoggle: (e) => { if (e.target.open) ui.openDetails = c.id; else if (ui.openDetails === c.id) ui.openDetails = null; } },
    h('summary', {}, 'Notes and tasks' + (c.tasks.length ? ` (${done}/${c.tasks.length})` : '')),
    h('div', { class: 'stack', style: 'padding:6px 4px' },
      c.tasks.map((t) => h('label', { class: 'task' + (t.done ? ' done' : '') },
        h('input', { type: 'checkbox', checked: t.done, onchange: (e) => { t.done = e.target.checked; commit(); } }),
        h('span', { class: 'grow' }, t.text),
        ibtn('x', 'Delete task', () => { c.tasks = c.tasks.filter((x) => x !== t); commit(); }))),
      addTask,
      h('textarea', { placeholder: 'Collection note', 'aria-label': 'Collection note', onchange: (e) => { c.note = e.target.value; S.save(state); } }, c.note || '')));
  const collapsed = isCollapsed(c);
  const card = h('section', { class: 'card' + (collapsed ? ' collapsed' : '') },
    h('header', { ...drag({ kind: 'col', colId: c.id }), title: 'Drag onto a folder to move' },
      h('button', { class: 'ibtn', 'aria-expanded': String(!collapsed), 'aria-label': (collapsed ? 'Expand ' : 'Collapse ') + c.name, title: collapsed ? 'Expand' : 'Collapse', onclick: () => setCollapsed([c], !collapsed) }, ic(collapsed ? 'right' : 'down')),
      h('h2', { class: 'grow ellip' }, c.name),
      h('span', { class: 'small muted' }, c.items.length + (c.items.length === 1 ? ' tab' : ' tabs')),
      c.tasks.length ? h('span', { class: 'pill' }, `${done}/${c.tasks.length}`) : null,
      h('span', { class: 'acts row' },
        ibtn('open', 'Open all', () => c.items.forEach((i) => chrome.tabs.create({ url: i.url, active: false }))),
        ibtn('edit', 'Rename collection', async () => { const n = await ask('Rename collection', c.name); if (n) { c.name = n; commit(); } }),
        ibtn('trash', 'Delete collection', async () => { if (await sure('Delete collection', `"${c.name}" and its ${c.items.length} saved tabs will be removed.`)) { state.collections = state.collections.filter((x) => x !== c); commit(); } }))),
    collapsed ? null : (items.length ? items : h('div', { class: 'empty' }, 'Drag open tabs here')),
    collapsed ? null : det);
  return dropzone(card, (d) => dropOnCollection(c, d));
}
function spaceView() {
  const sp = space(), f = ui.folderId ? folder(ui.folderId) : null;
  const folders = subfolders(sp.id, ui.folderId), cols = colsIn(sp.id, ui.folderId);
  const sug = suggestion();
  const crumbs = f ? h('div', { class: 'crumbs' }, h('button', { onclick: () => go(sp.id) }, sp.name),
    path(f.id).flatMap((p) => ['›', p.id === f.id ? h('span', {}, p.name) : h('button', { onclick: () => go(sp.id, p.id) }, p.name)])) : null;
  const renameCurrent = async () => { const t = f || sp; const n = await ask(f ? 'Rename folder' : 'Rename space', t.name); if (n) { t.name = n; commit(); } };
  const deleteCurrent = async () => {
    if (f) {
      if (!(await sure('Delete folder', `"${f.name}", its subfolders and ${folderCount(f.id)} saved tabs will be removed.`))) return;
      const ids = new Set(descendants(f.id));
      state.folders = state.folders.filter((x) => !ids.has(x.id)); state.collections = state.collections.filter((c) => !ids.has(c.folderId));
      ui.folderId = f.parentId || null;
    } else {
      if (state.spaces.length === 1) return toast('Keep at least one space.');
      const mine = myRole(sp) === 'owner';
      if (!(await sure(mine ? 'Delete space' : 'Leave shared space', mine ? `"${sp.name}" and everything in it (${spaceCount(sp.id)} saved tabs) will be removed${membersOf(sp).length ? ' for you and your collaborators' : ''}.` : `"${sp.name}" is removed from your account. It stays for its owner and other collaborators.`, mine ? 'Delete' : 'Leave'))) return;
      state.spaces = state.spaces.filter((x) => x !== sp); state.folders = state.folders.filter((x) => x.spaceId !== sp.id); state.collections = state.collections.filter((c) => c.spaceId !== sp.id);
      ui.spaceId = state.spaces[0].id; ui.folderId = null;
    }
    commit();
  };
  return [
    h('div', { class: 'head' },
      h('div', { class: 'grow stack', style: 'gap:4px' }, crumbs,
        h('div', { class: 'row' }, h('h1', {}, f ? f.name : sp.name), ibtn('edit', 'Rename', renameCurrent), ibtn('trash', myRole(sp) === 'owner' || f ? 'Delete' : 'Leave this shared space', deleteCurrent), f ? null : sharePill(sp)),
        h('div', { class: 'muted' }, `${folders.length} folder${folders.length === 1 ? '' : 's'} · ${cols.length} collection${cols.length === 1 ? '' : 's'} · ${f ? folderCount(f.id) : spaceCount(sp.id)} saved tabs`)),
      h('div', { class: 'row' },
        !f && myRole(sp) === 'owner' ? h('button', { class: 'btn', onclick: () => shareSpace(sp) }, ic('people'), 'Share') : null,
        cols.length ? h('button', { class: 'btn', onclick: () => setCollapsed(cols, !cols.every(isCollapsed)) }, ic(cols.every(isCollapsed) ? 'down' : 'right'), cols.every(isCollapsed) ? 'Expand all' : 'Collapse all') : null,
        h('button', { class: 'btn', onclick: smartGroup }, ic('layers'), 'Smart group'),
        h('button', { class: 'btn', onclick: async () => { const n = await ask('New folder'); if (n) { newFolderRec(n); if (ui.folderId) ui.open.add(ui.folderId); commit(); } } }, ic('folder'), 'New folder'),
        h('button', { class: 'btn primary', onclick: async () => { const n = await ask('New collection'); if (n) { newCol(n); commit(); } } }, ic('plus'), 'New collection'))),
    sug ? h('div', { class: 'banner' }, ic('layers', 18), h('div', { class: 'grow' }, h('b', {}, `${sug.m.length} open tabs look like they belong in "${sug.c.name}". `), h('span', { class: 'muted' }, 'Nothing moves until you confirm.')),
      h('button', { class: 'btn primary', onclick: () => { sug.m.forEach((t) => addTab(sug.c, t)); commit(); } }, 'Add them')) : null,
    folders.length ? h('div', { class: 'fgrid' }, folders.map((x) => dropzone(h('div', { class: 'fcard', onclick: () => go(sp.id, x.id), ...drag({ kind: 'folder', id: x.id }) },
      ic('folder', 22),
      h('div', { class: 'grow' }, h('button', { class: 'fname ellip' }, x.name),
        h('div', { class: 'small muted' }, `${subfolders(sp.id, x.id).length} subfolder${subfolders(sp.id, x.id).length === 1 ? '' : 's'} · ${folderCount(x.id)} tab${folderCount(x.id) === 1 ? '' : 's'}`)),
      h('span', { class: 'acts' }, ibtn('edit', 'Rename folder', async () => { const n = await ask('Rename folder', x.name); if (n) { x.name = n; commit(); } }))),
      (d) => dropOnFolder(sp.id, x.id, d)))) : null,
    cols.length ? h('div', { class: 'cgrid' }, cols.map(collectionCard))
      : h('div', { class: 'empty' }, folders.length ? 'No collections at this level yet. Create one, or open a folder.' : 'Nothing here yet. Create a collection and drag open tabs onto it, or import your bookmarks.'),
  ];
}
async function smartGroup() {
  const saved = new Set(state.collections.flatMap((c) => c.items.map((i) => i.url)));
  const groups = {}, seen = new Set();
  for (const t of tabs) { if (!isWeb(t.url) || saved.has(t.url) || seen.has(t.url)) continue; seen.add(t.url); (groups[host(t.url)] ||= []).push(t); }
  const list = Object.entries(groups).filter(([, v]) => v.length >= 2).map(([k, v]) => ({ name: k, tabs: v, on: true }));
  if (!list.length) return toast('No groups found. It needs at least two unsaved open tabs from the same site.');
  const body = h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'Each checked group becomes a collection here. No tabs are closed.'),
    list.map((g) => h('div', { class: 'grouprow' },
      h('input', { type: 'checkbox', checked: true, 'aria-label': 'Include ' + g.name, onchange: (e) => { g.on = e.target.checked; } }),
      h('input', { class: 'input', value: g.name, 'aria-label': 'Collection name', oninput: (e) => { g.name = e.target.value; } }),
      h('span', { class: 'muted small', style: 'white-space:nowrap' }, g.tabs.length + ' tabs'))));
  if (!(await modal('Smart group', body, 'Create collections'))) return;
  if (ui.view !== 'space') ui.view = 'space';
  list.filter((g) => g.on).forEach((g) => newCol(g.name.trim() || 'Group', g.tabs.map((t) => mkItem(t.url, t.title))));
  commit();
}

/* ---------- sessions view ---------- */
function sessionsView() {
  const st = state.settings;
  const set = (k, v) => { st[k] = v; commit(); };
  const count = (s) => s.windows.reduce((n, w) => n + w.tabs.length, 0);
  const restore = async (s) => { for (const w of s.windows) await chrome.windows.create({ url: w.tabs.map((t) => t.url) }); };
  const toCol = (s) => { const seen = new Set(); newCol(s.name || 'Session ' + when(s.createdAt), s.windows.flatMap((w) => w.tabs).filter((t) => isWeb(t.url) && !seen.has(t.url) && seen.add(t.url)).map((t) => mkItem(t.url, t.title))); ui.view = 'space'; commit(); };
  const del = async (s) => { sessions = sessions.filter((x) => x.id !== s.id); await S.setSessions(sessions); render(); };
  const num = (k, min) => h('input', { class: 'input num', type: 'number', min, value: st[k], 'aria-label': 'Minutes', onchange: (e) => set(k, Math.max(min, Number(e.target.value) || min)) });
  return [
    h('div', { class: 'head' },
      h('div', { class: 'grow stack', style: 'gap:4px' }, h('h1', {}, 'Sessions and memory'), h('div', { class: 'muted' }, 'Windows are saved automatically, so a crash or restart does not lose tabs.')),
      h('button', { class: 'btn primary', onclick: saveSession }, 'Save session now')),
    h('div', { class: 'stats' },
      h('div', { class: 'panel stat' }, h('span', { class: 'muted' }, 'Open tabs'), h('b', {}, allTabs.length), h('span', { class: 'small muted' }, `across ${new Set(allTabs.map((t) => t.windowId)).size} windows`)),
      h('div', { class: 'panel stat' }, h('span', { class: 'muted' }, 'Asleep'), h('b', {}, allTabs.filter((t) => t.discarded).length), h('button', { class: 'btn', onclick: sleepNow }, 'Sleep idle tabs now')),
      h('div', { class: 'panel stat' }, h('span', { class: 'muted' }, 'Duplicates in this window'), h('b', {}, dupIds().size), h('button', { class: 'btn', onclick: closeDuplicates }, 'Close duplicates'))),
    h('div', { class: 'cols' },
      h('section', { class: 'panel', style: 'flex-grow:2;gap:0' }, h('h2', { style: 'padding-bottom:10px' }, 'History'),
        sessions.length ? sessions.map((s) => h('div', { class: 'srow' },
          h('div', { class: 'grow', style: 'flex-basis:220px' }, h('b', {}, s.name || when(s.createdAt)), ' ', h('span', { class: 'pill' + (s.auto ? '' : ' warn') }, s.auto ? 'Auto-saved' : 'Saved by you'),
            h('div', { class: 'muted' }, `${s.name ? when(s.createdAt) + ' · ' : ''}${s.windows.length} window${s.windows.length > 1 ? 's' : ''} · ${count(s)} tabs`)),
          h('button', { class: 'btn', onclick: () => restore(s) }, 'Restore'),
          h('button', { class: 'btn', onclick: () => toCol(s) }, 'Save as collection'),
          ibtn('trash', 'Delete session', () => del(s))))
          : h('div', { class: 'empty' }, 'No sessions yet. The first automatic save happens within a minute or two.')),
      h('section', { class: 'panel' }, h('h2', {}, 'Rules'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.autoSave, onchange: (e) => set('autoSave', e.target.checked) }), h('span', { class: 'grow' }, 'Auto-save every'), num('autoSaveMinutes', 1), 'min'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.sleepEnabled, onchange: (e) => set('sleepEnabled', e.target.checked) }), h('span', { class: 'grow' }, 'Sleep tabs idle for'), num('sleepMinutes', 1), 'min'),
        h('p', { class: 'small muted' }, 'Pinned tabs, the active tab and tabs playing audio are never put to sleep. A sleeping tab stays in the tab strip and reloads when you click it. History keeps the latest 60 sessions on this device.'))),
  ];
}

/* ---------- import view ---------- */
function importView() {
  const imp = ui.imp ||= { tree: null, source: '', keep: true, skipDup: true, name: 'Imported bookmarks', label: '' };
  const setTree = (tree, source, label) => { imp.tree = tree; imp.source = source; imp.label = label; if (!I.countAll(tree)) toast('No links were found in that source.'); render(); };
  const fromBrowser = async () => setTree(I.fromChromeTree(await chrome.bookmarks.getTree()), 'browser', 'Bookmarks in this browser');
  const file = h('input', { type: 'file', accept: '.html,.htm,.json,.csv,.txt', hidden: true, onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { setTree(I.parseAny(await f.text(), f.name), 'file', f.name); } catch (err) { toast('That file could not be read: ' + err.message); }
  } });
  const paste = async () => {
    const ta = h('textarea', { style: 'min-height:180px', placeholder: 'https://example.com\nhttps://example.org | Optional title', 'aria-label': 'Links' });
    const text = await modal('Paste links', h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'One address per line. A blank line starts a new group.'), ta), 'Preview', () => ta.value);
    if (text) setTree(I.parseList(text), 'paste', 'Pasted links');
  };
  const setOn = (n, v) => { n.on = v; n.children.forEach((c) => setOn(c, v)); };
  const rows = (n, depth) => n.children.flatMap((c) => [
    h('label', { style: `padding-left:${depth * 24}px` },
      h('input', { type: 'checkbox', checked: c.on, onchange: (e) => { setOn(c, e.target.checked); render(); } }), ic('folder'),
      h('span', { class: 'grow ellip' }, c.name), h('span', { class: 'small muted' }, (c.children.length ? `${c.children.length} subfolder${c.children.length === 1 ? '' : 's'} · ` : '') + `${c.links.length} link${c.links.length === 1 ? '' : 's'}`)),
    ...rows(c, depth + 1)]);
  let preview = null;
  if (imp.tree) {
    const existing = new Set(state.collections.flatMap((c) => c.items.map((i) => i.url)));
    const chosen = I.selectedLinks(imp.tree);
    const seen = new Set(); let dups = 0;
    for (const l of chosen) { if (existing.has(l.url) || seen.has(l.url)) dups++; seen.add(l.url); }
    const n = imp.skipDup ? chosen.length - dups : chosen.length;
    preview = h('section', { class: 'panel' },
      h('div', { class: 'row' }, h('h2', { class: 'grow' }, '2 · Pick what to bring in'), h('span', { class: 'small muted' }, `${imp.label} · ${I.countAll(imp.tree)} links in ${I.countFolders(imp.tree)} folders`)),
      h('div', { class: 'tree' },
        imp.tree.links.length ? h('label', {}, ic('note'), h('span', { class: 'grow' }, 'Links outside any folder'), h('span', { class: 'small muted' }, imp.tree.links.length + ' links')) : null,
        rows(imp.tree, 0)),
      h('h2', { style: 'padding-top:8px' }, '3 · Options'),
      h('label', { class: 'stack', style: 'gap:4px' }, h('span', {}, `Import into "${space().name}${ui.folderId ? ' › ' + path(ui.folderId).map((f) => f.name).join(' › ') : ''}" as a new folder named`),
        h('input', { class: 'input', value: imp.name, onchange: (e) => { imp.name = e.target.value.trim() || 'Imported bookmarks'; } })),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: imp.keep, onchange: (e) => { imp.keep = e.target.checked; } }), 'Keep the folder structure as nested folders'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: imp.skipDup, onchange: (e) => { imp.skipDup = e.target.checked; render(); } }), h('span', { class: 'grow' }, 'Skip links already saved or repeated'), h('span', { class: 'pill warn' }, dups + ' found')),
      h('div', { class: 'row', style: 'border-top:1px solid var(--line2);padding-top:12px' },
        h('span', { class: 'grow muted' }, 'Nothing is removed from the source.'),
        h('button', { class: 'btn primary', disabled: !n, onclick: doImport }, `Import ${n} bookmark${n === 1 ? '' : 's'}`)));
  }
  const src = (label, sub, source, onclick) => h('button', { class: 'btn' + (imp.source === source ? ' sel' : ''), style: 'flex-direction:column;align-items:flex-start;gap:2px;padding:10px 14px;min-height:60px;flex:1 1 200px', onclick },
    h('b', {}, label), h('span', { class: 'small muted', style: 'font-weight:400' }, sub));
  return [
    h('div', { class: 'stack', style: 'gap:4px' }, h('h1', {}, 'Import bookmarks'), h('div', { class: 'muted' }, 'Bring in bookmarks from this browser, another tab manager or a file. Folders arrive as nested folders.')),
    h('section', { class: 'panel' }, h('h2', {}, '1 · Choose a source'), file,
      h('div', { class: 'row', style: 'align-items:stretch' },
        src('This browser', 'Read the bookmarks already here', 'browser', fromBrowser),
        src('A file', 'Bookmarks .html, or a JSON / CSV export', 'file', () => file.click()),
        src('Pasted list of links', 'One address per line', 'paste', paste))),
    preview,
  ];
}
function doImport() {
  const imp = ui.imp, spaceId = space().id;
  const seen = new Set(imp.skipDup ? state.collections.flatMap((c) => c.items.map((i) => i.url)) : []);
  const take = (links) => links.filter((l) => !imp.skipDup || (!seen.has(l.url) && seen.add(l.url))).map((l) => mkItem(l.url, l.title, l.note || ''));
  let total = 0;
  const addCol = (name, links, folderId) => { const items = take(links); if (items.length) { newCol(name, items, folderId, spaceId); total += items.length; } };
  const before = new Set(state.folders.map((f) => f.id));
  const dest = newFolderRec(imp.name, ui.folderId, spaceId);
  if (!imp.keep) addCol(imp.name, I.selectedLinks(imp.tree), dest.id);
  else {
    const create = (n, parentId) => {
      if (!n.on) return;
      const kids = n.children.filter((c) => c.on);
      if (!kids.length) return addCol(n.name, n.links, parentId);
      const f = newFolderRec(n.name, parentId, spaceId);
      addCol(n.name, n.links, f.id);
      kids.forEach((c) => create(c, f.id));
    };
    addCol(imp.name, imp.tree.links, dest.id);
    imp.tree.children.forEach((c) => create(c, dest.id));
  }
  // Drop folders that ended up empty (everything in them was a duplicate).
  const hasContent = (fid) => { const ids = new Set(descendants(fid)); return state.collections.some((c) => ids.has(c.folderId)); };
  state.folders = state.folders.filter((f) => before.has(f.id) || hasContent(f.id));
  ui.imp = null;
  if (!folder(dest.id)) { toast('Nothing new to import: every link was already saved.'); return commit(); }
  toast(`Imported ${total} bookmark${total === 1 ? '' : 's'}.`);
  ui.view = 'space'; ui.spaceId = spaceId; ui.folderId = dest.id; path(dest.id).forEach((f) => ui.open.add(f.id));
  commit();
}

/* ---------- open tabs panel ---------- */
function renderTabs() {
  const dups = dupIds();
  $('#tabs').replaceChildren(
    h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Open tabs'), h('span', { class: 'small muted' }, `This window · ${tabs.length}`)),
    h('div', { class: 'row' },
      h('button', { class: 'btn grow', onclick: saveAllAsCollection }, 'Save all'),
      h('button', { class: 'btn grow', onclick: saveSession }, 'Save session')),
    h('div', { class: 'row' },
      h('button', { class: 'btn grow', onclick: sleepNow }, 'Sleep idle'),
      h('button', { class: 'btn grow', onclick: closeDuplicates }, `Close duplicates${dups.size ? ' (' + dups.size + ')' : ''}`)),
    h('div', {}, tabs.length ? tabs.map((t) => h('div', { class: 'item' + (t.discarded ? ' asleep' : ''), ...(isWeb(t.url) ? drag({ kind: 'tab', tabId: t.id }) : {}) },
      isWeb(t.url) ? fav(t.url) : h('span', { class: 'fav' }),
      h('div', { class: 'grow' }, h('button', { class: 't ellip', title: t.url, onclick: () => chrome.tabs.update(t.id, { active: true }) }, t.title || t.url)),
      t.discarded ? h('span', { class: 'muted', title: 'Asleep' }, ic('moon', 14), h('span', { style: 'position:absolute;left:-9999px' }, 'Asleep')) : null,
      dups.has(t.id) ? h('span', { class: 'pill warn' }, 'Duplicate') : null,
      h('span', { class: 'acts row' },
        isWeb(t.url) ? ibtn('plus', 'Save to a collection', () => saveTabTo(t)) : null,
        ibtn('x', 'Close tab', () => chrome.tabs.remove(t.id)))))
      : h('div', { class: 'empty' }, 'No other tabs in this window.')),
    h('div', { class: 'small muted', style: 'margin-top:auto;padding:10px;border-radius:10px;background:var(--bg)' }, 'Drag a tab onto a collection to save it, or onto a folder to start a new collection there.'));
}

/* ---------- search and command palette ---------- */
function commands() {
  return [
    ['New collection', async () => { const n = await ask('New collection'); if (n) { ui.view = 'space'; newCol(n); commit(); } }],
    ['New folder', async () => { const n = await ask('New folder'); if (n) { ui.view = 'space'; newFolderRec(n); commit(); } }],
    ['Smart group open tabs', smartGroup],
    ['Save all open tabs as a collection', saveAllAsCollection],
    ['Save this session', saveSession],
    ['Sleep idle tabs', sleepNow],
    ['Close duplicate tabs', closeDuplicates],
    ['Import bookmarks', () => { ui.view = 'import'; render(); }],
    ['Go to sessions', () => { ui.view = 'sessions'; render(); }],
    ['Account and sync', () => { ui.view = 'account'; render(); }],
    ['Settings: home page and new tab', () => { ui.view = 'settings'; render(); }],
    ...(cloud.session ? [['Sync now', syncNow]] : []),
    ['New space', newSpace],
  ].map(([title, run]) => ({ group: 'Commands', title, sub: '', icon: ic('cmd'), run }));
}
function search(q) {
  const cmdOnly = q.startsWith('>');
  const term = q.replace(/^>/, '').trim().toLowerCase();
  const hit = (...s) => !term || s.some((x) => (x || '').toLowerCase().includes(term));
  const cmds = commands().filter((c) => hit(c.title));
  if (cmdOnly) return cmds;
  const where = (c) => [state.spaces.find((s) => s.id === c.spaceId)?.name, ...path(c.folderId).map((f) => f.name), c.name].join(' › ');
  const out = [];
  const push = (group, list, max) => out.push(...list.slice(0, max).map((x) => ({ group, ...x })));
  push('Open tabs', allTabs.filter((t) => t.id !== selfTabId && hit(t.title, t.url)).map((t) => ({ title: t.title || t.url, sub: host(t.url) + (t.discarded ? ' · asleep' : ''), icon: isWeb(t.url) ? fav(t.url) : ic('open'), run: async () => { await chrome.tabs.update(t.id, { active: true }); await chrome.windows.update(t.windowId, { focused: true }); } })), term ? 6 : 4);
  if (term) {
    push('Saved', state.collections.flatMap((c) => c.items.filter((i) => hit(i.title, i.url, i.note)).map((i) => ({ title: i.title, sub: where(c) + (i.note ? ' · ' + i.note : ''), icon: fav(i.url), run: () => openUrl(i.url) }))), 8);
    push('Collections and folders', [
      ...state.collections.filter((c) => hit(c.name, c.note)).map((c) => ({ title: c.name, sub: where(c), icon: ic('layers'), run: () => go(c.spaceId, c.folderId) })),
      ...state.folders.filter((f) => hit(f.name)).map((f) => ({ title: f.name, sub: 'Folder in ' + state.spaces.find((s) => s.id === f.spaceId)?.name, icon: ic('folder'), run: () => go(f.spaceId, f.id) })),
    ], 6);
    push('Tasks', state.collections.flatMap((c) => c.tasks.filter((t) => hit(t.text)).map((t) => ({ title: t.text, sub: (t.done ? 'Done · ' : 'To do · ') + where(c), icon: ic('check'), run: () => { ui.openDetails = c.id; go(c.spaceId, c.folderId); } }))), 5);
  }
  out.push(...cmds.slice(0, term ? 5 : 10));
  return out;
}
function openPalette() {
  if ($('.palette')) return;
  let results = [], sel = 0;
  const inp = h('input', { class: 'pinput', placeholder: 'Search tabs, saved links, notes and tasks, or type > for commands', 'aria-label': 'Search or command' });
  const list = h('div', { class: 'plist' });
  const close = () => ov.remove();
  const run = (r) => { close(); r.run(); };
  const draw = () => {
    const kids = []; let group = '';
    results.forEach((r, i) => {
      if (r.group !== group) { group = r.group; kids.push(h('div', { class: 'pgroup' }, group)); }
      kids.push(h('button', { class: 'pitem' + (i === sel ? ' sel' : ''), onclick: () => run(r), onmousemove: () => { if (sel !== i) { sel = i; draw(); } } },
        r.icon, h('div', { class: 'grow' }, h('div', { class: 'ellip', style: 'font-weight:500' }, r.title), r.sub ? h('div', { class: 'small muted ellip' }, r.sub) : null)));
    });
    list.replaceChildren(...(kids.length ? kids : [h('div', { class: 'empty', style: 'margin:8px' }, 'No matches.')]));
    list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  };
  const update = () => { results = search(inp.value); sel = 0; draw(); };
  inp.addEventListener('input', update);
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(results.length - 1, sel + 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (results[sel]) run(results[sel]); }
    else if (e.key === 'Escape') close();
  });
  const ov = h('div', { class: 'overlay top', onmousedown: (e) => { if (e.target === ov) close(); } },
    h('div', { class: 'palette', role: 'dialog', 'aria-label': 'Search and commands' },
      h('div', { class: 'prow' }, ic('search', 20), inp, h('kbd', { style: 'background:var(--line2);color:var(--ink2)' }, 'Esc')), list,
      h('div', { class: 'pfoot' }, h('span', {}, '↑ ↓ to move'), h('span', {}, 'Enter to open'), h('span', { style: 'margin-left:auto' }, 'Type > for commands only'))));
  document.body.append(ov); inp.focus(); update();
}

/* ---------- account, sync and sharing ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const idle = async () => { while (syncing) await sleep(100); };
function scheduleSync(ms = 1500) { if (!cloud.session) return; clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, ms); }
async function syncNow() {
  if (!cloud.session) return;
  if (syncing) { syncAgain = true; return; }
  syncing = true; cloud.status = 'syncing'; renderSide();
  try {
    const r = await C.sync(state);
    if (!r || r.signedOut) { syncing = false; await leaveAccount(r ? 'This browser was signed out from another device.' : 'Your sign-in ended. Sign in again to keep syncing.'); return; }
    Object.assign(cloud, { members: r.members, devices: r.devices, deviceId: r.deviceId, status: 'ok', last: Date.now(), error: '' });
    if (r.reverted) toast('That space is view only, so the change was undone.');
    softRender(r.changed);
  } catch (e) {
    if (e.status === 401 && !(await C.storedSession())) { syncing = false; await leaveAccount('Your sign-in ended. Sign in again to keep syncing.'); return; }
    cloud.status = 'error'; cloud.error = e.message; softRender(false);
  }
  finally { syncing = false; if (syncAgain) { syncAgain = false; scheduleSync(300); } }
}
function softRender(dataChanged) {
  const a = document.activeElement;
  const typing = a && $('#main').contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox';
  const busy = typing || document.querySelector('.overlay');
  if ((dataChanged || ui.view === 'account') && !busy) render();
  else { renderSide(); if (dataChanged) ui.stale = true; }
}
async function leaveAccount(msg) {
  clearTimeout(syncTimer);
  cloud.session = null;
  const keep = state.settings;
  await S.withLock(() => C.clearLocal());
  const fresh = await S.load(); fresh.settings = keep;
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, fresh); sessions = [];
  await S.withLock(() => S.saveRaw(state));
  Object.assign(cloud, { status: '', members: [], devices: [], error: '' });
  ui.spaceId = state.spaces[0].id; ui.folderId = null; ui.view = 'account'; ui.imp = null;
  render(); if (msg) toast(msg);
}
// Upload anything pending before signing out. Returns false if the user backs out.
async function lastUpload() {
  await idle();
  try { await C.sync(state); return true; }
  catch { return !Object.keys(state.dirty || {}).length || !!(await sure('Some changes are not uploaded', 'This browser could not reach the server, so recent changes made here would be lost.', 'Sign out anyway')); }
}
async function signOutHere() {
  if (!(await sure('Sign out of this browser', 'Your data stays in your account. It is removed from this browser and comes back when you sign in again.', 'Sign out'))) return;
  if (!(await lastUpload())) return;
  try { await C.signOutDevice(await C.deviceId()); } catch { /* offline */ }
  cloud.session = null; await C.signOut('local'); await leaveAccount('Signed out of this browser.');
}
async function signOutAll() {
  if (!(await sure('Sign out of all browsers', 'Every browser signed in to this account is signed out, including this one. Your data stays in your account.', 'Sign out everywhere'))) return;
  if (!(await lastUpload())) return;
  cloud.session = null; await C.signOutEverywhere(); await leaveAccount('Signed out of all browsers.');
}
const myRole = (sp) => {
  if (!cloud.session || !sp.owner || sp.owner === cloud.session.user.id) return 'owner';
  const me = cloud.session.user.email.toLowerCase();
  return cloud.members.find((m) => m.space_id === sp.id && m.email.toLowerCase() === me)?.role || 'viewer';
};
const membersOf = (sp) => cloud.members.filter((m) => m.space_id === sp.id);
function sharePill(sp) {
  if (!cloud.session) return null;
  const role = myRole(sp), n = membersOf(sp).length;
  if (role !== 'owner') return h('span', { class: 'pill warn' }, 'Shared with you · ' + (role === 'editor' ? 'can edit' : 'view only'));
  return h('span', { class: 'pill' + (n ? '' : ' grey') }, n ? `Shared · ${n}` : 'Private');
}
async function shareSpace(sp) {
  if (!cloud.session) { ui.view = 'account'; render(); return toast('Sign in first to share a space.'); }
  await idle(); await syncNow(); // the space must exist on the server before it can be shared
  if (cloud.status === 'error') return toast('Sharing needs a connection. ' + cloud.error);
  const err = h('p', { class: 'small', role: 'alert', style: 'color:var(--warn)' });
  const list = h('div', { class: 'stack' });
  const act = async (fn) => {
    err.textContent = '';
    try { await fn(); cloud.members = [...cloud.members.filter((m) => m.space_id !== sp.id), ...(await C.listMembers(sp.id))]; draw(); }
    catch (e) { err.textContent = e.message; }
  };
  const email = h('input', { class: 'input', type: 'email', placeholder: 'name@example.com', 'aria-label': 'Email to invite' });
  const role = h('select', { 'aria-label': 'Access', style: 'width:auto' }, h('option', { value: 'editor' }, 'Can edit'), h('option', { value: 'viewer' }, 'Can view'));
  const add = () => {
    const v = email.value.trim();
    if (!/^\S+@\S+\.\S+$/.test(v)) { err.textContent = 'Enter a valid email address.'; return; }
    act(async () => { await C.addMember(sp.id, v, role.value); email.value = ''; });
  };
  email.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  function draw() {
    const ms = membersOf(sp);
    list.replaceChildren(
      h('div', { class: 'row' }, h('span', { class: 'pill' + (ms.length ? '' : ' grey') }, ms.length ? 'Shared' : 'Private'),
        h('span', { class: 'grow muted small' }, ms.length ? 'Collaborators see this space after they sign in with the email below.' : 'Only you can see this space, in every browser you sign in to.'),
        ms.length ? h('button', { type: 'button', class: 'btn', onclick: () => act(() => C.makePrivate(sp.id)) }, 'Make private') : null),
      ...ms.map((m) => h('div', { class: 'row' }, h('span', { class: 'grow ellip' }, m.email),
        h('select', { 'aria-label': 'Access for ' + m.email, style: 'width:auto', onchange: (e) => act(() => C.setMemberRole(sp.id, m.email, e.target.value)) },
          h('option', { value: 'editor', selected: m.role === 'editor' }, 'Can edit'), h('option', { value: 'viewer', selected: m.role === 'viewer' }, 'Can view')),
        ibtn('x', 'Remove ' + m.email, () => act(() => C.removeMember(sp.id, m.email))))));
  }
  draw();
  await modal(`Share "${sp.name}"`, h('div', { class: 'stack' },
    h('div', { class: 'row', style: 'flex-wrap:nowrap' }, email, role, h('button', { type: 'button', class: 'btn', onclick: add }, 'Add')), err, list), 'Done');
  render();
}
function accountView() {
  if (!cloud.session) {
    const signup = ui.authMode === 'signup';
    const email = h('input', { class: 'input', id: 'auth-email', type: 'email', required: true, autocomplete: 'email' });
    const pw = h('input', { class: 'input', id: 'auth-pw', type: 'password', required: true, minLength: signup ? 8 : 1, autocomplete: signup ? 'new-password' : 'current-password' });
    const msg = h('p', { class: 'small', role: 'alert' });
    const run = async (fn) => { msg.style.color = 'var(--mute)'; msg.textContent = 'Working…'; try { await fn(); } catch (e) { msg.style.color = 'var(--warn)'; msg.textContent = e.message; } };
    const entered = async (s) => { cloud.session = s; ui.view = 'space'; render(); toast('Signed in. Syncing your data…'); await syncNow(); };
    const tab = (label, on, mode) => h('button', { type: 'button', class: 'btn grow' + (on ? ' sel' : ''), 'aria-pressed': String(on), onclick: () => { ui.authMode = mode; render(); } }, label);
    return [
      h('div', { class: 'stack', style: 'gap:4px' }, h('h1', {}, 'Account'), h('div', { class: 'muted' }, 'Sign in to see your spaces, folders and collections in every browser, and to share spaces with collaborators.')),
      h('form', { class: 'panel', style: 'max-width:440px', onsubmit: (e) => {
        e.preventDefault();
        run(async () => {
          if (!signup) return entered(await C.signIn(email.value.trim(), pw.value));
          const r = await C.signUp(email.value.trim(), pw.value);
          if (r.session) return entered(r.session);
          ui.authMode = 'signin'; render(); toast('Check your email and click the confirmation link, then sign in here.');
        });
      } },
        h('div', { class: 'row' }, tab('Sign in', !signup, 'signin'), tab('Create account', signup, 'signup')),
        h('button', { type: 'button', class: 'btn', style: 'justify-content:center', onclick: () => run(async () => entered(await C.signInGoogle())) }, 'Continue with Google'),
        h('div', { class: 'small muted', style: 'text-align:center' }, 'or use your email'),
        h('label', { for: 'auth-email' }, 'Email'), email,
        h('label', { for: 'auth-pw' }, 'Password'), pw,
        signup ? h('div', { class: 'small muted' }, 'At least 8 characters. You will get an email with a link to confirm the address.') : null,
        h('button', { type: 'submit', class: 'btn primary', style: 'justify-content:center' }, signup ? 'Create account' : 'Sign in'), msg),
      h('p', { class: 'muted small' }, 'Without an account Shelf keeps working, with data stored in this browser only. Anything already here is uploaded to your account when you sign in.'),
    ];
  }
  const others = cloud.devices.filter((d) => d.id !== cloud.deviceId);
  const statusText = cloud.status === 'syncing' ? 'Syncing…' : cloud.status === 'error' ? 'Sync problem: ' + cloud.error : cloud.last ? 'Everything is synced · last update ' + when(cloud.last) : 'Not synced yet';
  const shared = state.spaces.filter((sp) => membersOf(sp).length || myRole(sp) !== 'owner');
  const np = h('input', { class: 'input', type: 'password', minLength: 8, required: true, placeholder: 'New password', 'aria-label': 'New password', autocomplete: 'new-password' });
  return [
    h('div', { class: 'head' },
      h('div', { class: 'grow stack', style: 'gap:4px' }, h('h1', {}, 'Account and browsers'), h('div', { class: 'muted' }, `Signed in as ${cloud.session.user.email} · ${statusText}`)),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: syncNow }, 'Sync now'), h('button', { class: 'btn', onclick: signOutHere }, 'Sign out of this browser'))),
    h('div', { class: 'cols' },
      h('section', { class: 'panel', style: 'flex-grow:2;gap:0' },
        h('h2', {}, 'Signed-in browsers'), h('div', { class: 'muted', style: 'padding-bottom:10px' }, 'Your data is available in each of these.'),
        cloud.devices.map((d) => h('div', { class: 'srow' },
          h('div', { class: 'grow', style: 'flex-basis:200px' }, h('b', {}, d.name || 'Browser'), ' ', d.id === cloud.deviceId ? h('span', { class: 'pill' }, 'This browser') : null,
            h('div', { class: 'muted' }, 'Last active ' + when(d.last_seen))),
          d.id === cloud.deviceId ? null : h('button', { class: 'btn', onclick: async () => { try { await C.signOutDevice(d.id); toast('That browser is signed out the next time it opens Shelf.'); } catch (e) { toast(e.message); } syncNow(); } }, 'Sign out'))),
        h('div', { class: 'srow' },
          h('span', { class: 'grow muted', style: 'flex-basis:220px' }, 'Lost a device or used a shared computer? Signing out everywhere ends every session, including this one.'),
          others.length ? h('button', { class: 'btn', onclick: async () => { try { await C.signOutOthers(); toast('Other browsers signed out.'); } catch (e) { toast(e.message); } syncNow(); } }, `Sign out the other ${others.length}`) : null,
          h('button', { class: 'btn danger', onclick: signOutAll }, 'Sign out of all browsers'))),
      h('div', { class: 'stack', style: 'gap:16px' },
        h('section', { class: 'panel' }, h('h2', {}, 'Sharing'),
          shared.length ? shared.map((sp) => h('div', { class: 'row' }, h('button', { class: 'fname grow ellip', onclick: () => go(sp.id) }, sp.name), sharePill(sp)))
            : h('div', { class: 'muted' }, 'All your spaces are private. Open a space and use Share to add collaborators.')),
        h('form', { class: 'panel', onsubmit: async (e) => { e.preventDefault(); try { await C.changePassword(np.value); np.value = ''; toast('Password changed.'); } catch (err) { toast(err.message); } } },
          h('h2', {}, 'Change password'), np, h('button', { type: 'submit', class: 'btn', style: 'align-self:flex-start' }, 'Change password')))),
  ];
}

/* ---------- settings ---------- */
function settingsView() {
  const st = state.settings, url = chrome.runtime.getURL('app.html');
  const set = (k, v) => { st[k] = v; commit(); };
  const addr = h('input', { class: 'input', readOnly: true, value: url, 'aria-label': 'Shelf address', onfocus: (e) => e.target.select() });
  return [
    h('div', { class: 'stack', style: 'gap:4px' }, h('h1', {}, 'Settings'), h('div', { class: 'muted' }, 'These apply to this browser only.')),
    h('div', { class: 'cols' },
      h('section', { class: 'panel' }, h('h2', {}, 'Start-up and new tabs'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.onStartup, onchange: (e) => set('onStartup', e.target.checked) }), h('span', {}, 'Open Shelf when the browser starts')),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.newTab, onchange: (e) => set('newTab', e.target.checked) }), h('span', {}, 'Open Shelf in every new tab')),
        h('p', { class: 'small muted' }, 'Turn the second option off at any time to get the browser\'s own new tab page back. Shelf also opens from its toolbar icon or with Alt+Shift+S.')),
      h('section', { class: 'panel' }, h('h2', {}, 'Use Shelf as your home page'),
        h('p', { class: 'muted' }, 'The Home button is a browser setting, so it takes one paste:'),
        h('div', { class: 'row', style: 'flex-wrap:nowrap' }, addr, h('button', { class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(url); toast('Address copied.'); } catch { addr.focus(); toast('Press Ctrl+C to copy the address.'); } } }, 'Copy')),
        h('ol', { class: 'muted', style: 'margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px' },
          h('li', {}, 'Open the browser\'s Settings and go to Appearance.'),
          h('li', {}, 'Turn on "Show home button".'),
          h('li', {}, 'Choose the custom address option and paste the address above.')))),
  ];
}

/* ---------- render and boot ---------- */
function render() {
  if (!state.spaces.some((s) => s.id === ui.spaceId)) { ui.spaceId = state.spaces[0].id; ui.folderId = null; }
  if (ui.folderId && !folder(ui.folderId)) ui.folderId = null;
  renderSide();
  ui.stale = false;
  const view = ui.view === 'sessions' ? sessionsView() : ui.view === 'import' ? importView() : ui.view === 'account' ? accountView() : ui.view === 'settings' ? settingsView() : spaceView();
  $('#main').replaceChildren(...view.flat().filter(Boolean));
  renderTabs();
}
let refreshTimer;
function refreshSoon() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => { await loadTabs(); renderTabs(); renderSide(); }, 150);
}
async function boot() {
  state = await S.load();
  sessions = await S.getSessions();
  await loadTabs();
  ui.spaceId = state.spaces[0].id;
  cloud.session = await C.storedSession();
  site = (await chrome.storage.local.get('site')).site || null;
  render();
  C.siteContent().then((v) => { if (v) { site = v; chrome.storage.local.set({ site: v }); renderSide(); } }).catch(() => {});
  if (cloud.session) syncNow();
  setInterval(() => { if (cloud.session && document.visibilityState === 'visible') syncNow(); }, 30000);
  window.addEventListener('focus', () => scheduleSync(200));
  $('#main').addEventListener('focusout', () => { if (ui.stale) setTimeout(() => { if (ui.stale) render(); }, 50); });
  for (const ev of ['onCreated', 'onRemoved', 'onUpdated', 'onMoved', 'onActivated', 'onAttached', 'onDetached', 'onReplaced']) chrome.tabs[ev].addListener(refreshSoon);
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.sessions) { sessions = changes.sessions.newValue || []; if (ui.view === 'sessions') render(); }
    // Another Shelf tab saved: take its copy, so this tab never overwrites newer data with an old one.
    const nv = changes.state && changes.state.newValue;
    if (nv && nv.writer !== S.INSTANCE) { for (const k of Object.keys(state)) delete state[k]; Object.assign(state, nv); softRender(true); }
    if (changes.auth) {
      const was = !!cloud.session; cloud.session = changes.auth.newValue || null;
      if (!cloud.session) Object.assign(cloud, { status: '', members: [], devices: [], error: '' });
      if (was !== !!cloud.session) { softRender(true); if (cloud.session) scheduleSync(500); }
    }
  });
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); } });
}
boot();
