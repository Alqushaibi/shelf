// Data layer. Everything lives in chrome.storage.local for now.
// Records carry uuid ids and timestamps so they can sync to a server later.
export const uid = () => crypto.randomUUID();
export const DEFAULT_SETTINGS = { autoSave: true, autoSaveMinutes: 10, sleepEnabled: false, sleepMinutes: 30, onStartup: false, newTab: false };
// Identifies this page, so other open Shelf tabs can tell whose save they are seeing.
export const INSTANCE = uid();
const MAX_SESSIONS = 60;

export async function load() {
  const { state } = await chrome.storage.local.get('state');
  if (state) {
    state.settings = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
    return state;
  }
  const fresh = {
    spaces: [{ id: uid(), name: 'My space', color: '#6E93FF' }],
    folders: [],
    collections: [],
    settings: { ...DEFAULT_SETTINGS },
    dirty: {}, tombs: {}, pristine: true,
    updatedAt: Date.now(),
  };
  await chrome.storage.local.set({ state: fresh });
  return fresh;
}

// All writes to the saved state go through one queue so a save and a sync never interleave.
let chain = Promise.resolve();
export const withLock = (fn) => (chain = chain.then(() => fn(), () => fn()));

export async function saveRaw(state) {
  state.writer = INSTANCE;
  await chrome.storage.local.set({ state });
}

const SYNCED = ['spaces', 'folders', 'collections'];
const body = (r) => { const { updatedAt, ...rest } = r; return JSON.stringify(rest); };

// Save after a local edit. Compares with the last saved copy to find what changed:
// changed records get a fresh timestamp and are queued for upload, removed ones leave a tombstone.
export function save(state) {
  return withLock(async () => {
    const { state: prev } = await chrome.storage.local.get('state');
    const now = Date.now();
    state.dirty ||= {}; state.tombs ||= {};
    if (prev) {
      for (const t of SYNCED) {
        const old = new Map((prev[t] || []).map((r) => [r.id, r]));
        for (const r of state[t]) {
          const o = old.get(r.id);
          if (!o || body(o) !== body(r)) { r.updatedAt = now; state.dirty[`${t}:${r.id}`] = 1; state.pristine = false; }
          old.delete(r.id);
        }
        for (const [id, o] of old) { state.tombs[`${t}:${id}`] = { ts: now, spaceId: t === 'spaces' ? id : o.spaceId }; delete state.dirty[`${t}:${id}`]; state.pristine = false; }
      }
    }
    state.updatedAt = now;
    state.writer = INSTANCE;
    await chrome.storage.local.set({ state });
  });
}

export async function getSessions() {
  const { sessions } = await chrome.storage.local.get('sessions');
  return sessions || [];
}

export async function setSessions(sessions) {
  await chrome.storage.local.set({ sessions: sessions.slice(0, MAX_SESSIONS) });
}

const savable = (u) => /^(https?|file):/.test(u || '');

// Take a snapshot of every normal window. Auto snapshots that match the
// latest one only refresh its timestamp, so history is not flooded.
export async function snapshot(auto, name = '') {
  const wins = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
  const windows = wins
    .map((w) => ({ tabs: (w.tabs || []).filter((t) => savable(t.url)).map((t) => ({ url: t.url, title: t.title || t.url, pinned: !!t.pinned })) }))
    .filter((w) => w.tabs.length);
  if (!windows.length) return null;
  const sig = windows.map((w) => w.tabs.map((t) => t.url).join('\n')).join('\n--\n');
  const sessions = await getSessions();
  if (auto && sessions[0] && sessions[0].auto && sessions[0].sig === sig) {
    sessions[0].createdAt = Date.now();
    await setSessions(sessions);
    return sessions[0];
  }
  const s = { id: uid(), createdAt: Date.now(), auto, name, sig, windows };
  sessions.unshift(s);
  await setSessions(sessions);
  return s;
}

export async function sleepIdle(minutes, windowId) {
  const q = { active: false, pinned: false, audible: false, discarded: false };
  if (windowId != null) q.windowId = windowId;
  const tabs = await chrome.tabs.query(q);
  const cutoff = Date.now() - minutes * 60000;
  let n = 0;
  for (const t of tabs) {
    if (!/^https?:/.test(t.url || '')) continue;
    if (minutes > 0 && t.lastAccessed && t.lastAccessed > cutoff) continue;
    try { await chrome.tabs.discard(t.id); n++; } catch { /* tab went away */ }
  }
  return n;
}
