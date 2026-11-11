import { load, snapshot, sleepIdle } from './store.js';

async function openDashboard() {
  const url = chrome.runtime.getURL('app.html');
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((t) => (t.url || '').startsWith(url));
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

chrome.action.onClicked.addListener(openDashboard);

const ensureAlarm = () => chrome.alarms.create('tick', { periodInMinutes: 1 });
chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(async () => {
  ensureAlarm();
  const { state } = await chrome.storage.local.get('state');
  if (state?.settings?.onStartup) openDashboard();
});

// Optional: show Shelf in every new tab. Done here rather than in the manifest so it can be switched off.
chrome.tabs.onCreated.addListener(async (tab) => {
  const u = tab.pendingUrl || tab.url || '';
  if (!/^[a-z]+:\/\/(newtab|new-tab-page)\/?$/.test(u)) return;
  const { state } = await chrome.storage.local.get('state');
  if (state?.settings?.newTab) chrome.tabs.update(tab.id, { url: chrome.runtime.getURL('app.html') }).catch(() => {});
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'tick') return;
  const state = await load();
  const s = state.settings;
  const { meta = {} } = await chrome.storage.local.get('meta');
  if (s.autoSave && Date.now() - (meta.lastAuto || 0) >= s.autoSaveMinutes * 60000 - 5000) {
    await snapshot(true);
    meta.lastAuto = Date.now();
    await chrome.storage.local.set({ meta });
  }
  if (s.sleepEnabled) await sleepIdle(Math.max(1, s.sleepMinutes));
});
