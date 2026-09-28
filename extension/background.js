importScripts('core.js', 'sync.js');
const C = CafeChecker;
const S = CafeSync;
const LINK_PATTERNS = ['*://cafe.naver.com/*', '*://m.cafe.naver.com/*'];
const PRUNE_EVERY = 200;
const SYNC_SOON = 'ncc-sync-soon';
const SYNC_PERIODIC = 'ncc-sync';
const SYNC_GAP_MS = 60 * 1000;
let newReads = 0;
let syncing = null;
let lastSync = 0;

function createMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'ncc-unread', title: '카페 읽음 표시: 안 읽은 글로 되돌리기', contexts: ['link'], targetUrlPatterns: LINK_PATTERNS });
    chrome.contextMenus.create({ id: 'ncc-read', title: '카페 읽음 표시: 읽은 글로 표시', contexts: ['link'], targetUrlPatterns: LINK_PATTERNS });
  });
}

async function prune() {
  const items = await chrome.storage.local.get(null);
  const stale = C.pruneKeys(items);
  if (stale.length) await chrome.storage.local.remove(stale);
}

async function onMenu(info) {
  const article = C.parseArticle(info.linkUrl || '');
  if (!article) return;
  const items = await chrome.storage.local.get(null);
  const { aliases } = C.fromStorage(items);
  if (info.menuItemId === 'ncc-unread') {
    const keys = C.lookupKeys(article, aliases, C.invertAliases(aliases));
    const now = Date.now();
    // Tombstones tell other signed-in browsers to forget these reads too.
    const tomb = { ...(items[S.LOCAL_TOMB] || {}) };
    for (const k of keys) tomb[k] = now;
    await chrome.storage.local.set({ [S.LOCAL_TOMB]: tomb });
    await chrome.storage.local.remove(keys);
  } else if (info.menuItemId === 'ncc-read') {
    await chrome.storage.local.set({ [C.storeKey(article, aliases)]: Date.now() });
  }
}

// --- Google account sync (chrome.storage.sync) ----------------------------
function syncNow() {
  if (syncing) return syncing;
  syncing = (async () => {
    const local = await chrome.storage.local.get(null);
    if (!C.settings(local[C.SETTINGS]).sync) return { ok: false, disabled: true };
    const remote = await chrome.storage.sync.get(null);
    const now = Date.now();
    const p = S.plan(remote, local, now);
    if (p.localRemove.length) await chrome.storage.local.remove(p.localRemove);
    if (Object.keys(p.localSet).length) await chrome.storage.local.set(p.localSet);
    if (p.syncSet) {
      await chrome.storage.sync.set(p.syncSet);
      if (p.syncRemove.length) await chrome.storage.sync.remove(p.syncRemove);
    }
    // Drop only the tombstones that were part of this sync; newer ones wait for the next run.
    const seen = local[S.LOCAL_TOMB] || {};
    const current = (await chrome.storage.local.get(S.LOCAL_TOMB))[S.LOCAL_TOMB] || {};
    const pending = Object.fromEntries(Object.entries(current).filter(([k, ts]) => seen[k] !== ts));
    const status = { at: now, ok: true, synced: p.synced, total: p.total };
    const write = { [S.STATUS]: status };
    if (Object.keys(pending).length !== Object.keys(current).length) write[S.LOCAL_TOMB] = pending;
    await chrome.storage.local.set(write);
    return status;
  })().catch(async error => {
    const status = { at: Date.now(), ok: false, error: String((error && error.message) || error) };
    try { await chrome.storage.local.set({ [S.STATUS]: status }); } catch { /* ignore */ }
    return status;
  }).finally(() => { lastSync = Date.now(); syncing = null; });
  return syncing;
}

// storage.sync allows only a few writes per minute, so changes are batched.
async function scheduleSync() {
  if (await chrome.alarms.get(SYNC_SOON)) return;
  await chrome.alarms.create(SYNC_SOON, { delayInMinutes: 1 });
}

function setup() {
  chrome.alarms.create(SYNC_PERIODIC, { periodInMinutes: 15 });
  prune().catch(() => {});
  syncNow();
}

chrome.runtime.onInstalled.addListener(() => { createMenus(); setup(); });
chrome.runtime.onStartup.addListener(setup);
chrome.contextMenus.onClicked.addListener(info => { onMenu(info).catch(() => {}); });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === SYNC_SOON || alarm.name === SYNC_PERIODIC) syncNow();
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'ncc-sync-now') return false;
  syncNow().then(sendResponse);
  return true;
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    // Another browser on the same Google account published changes.
    if (Date.now() - lastSync > SYNC_GAP_MS && !syncing) syncNow();
    else scheduleSync().catch(() => {});
    return;
  }
  if (area !== 'local') return;
  let dirty = false;
  for (const [k, change] of Object.entries(changes)) {
    if (k.startsWith(C.READ)) {
      dirty = true;
      if (change.oldValue === undefined && change.newValue !== undefined) newReads++;
    } else if (k.startsWith(C.ALIAS) || k === S.LOCAL_TOMB || k === S.LOCAL_CLEARED) {
      dirty = true;
    } else if (k === C.SETTINGS && C.settings(change.newValue).sync && !C.settings(change.oldValue).sync) {
      syncNow();
    }
  }
  if (newReads >= PRUNE_EVERY) { newReads = 0; prune().catch(() => {}); }
  if (dirty) scheduleSync().catch(() => {});
});
