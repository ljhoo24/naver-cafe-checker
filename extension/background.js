importScripts('core.js');
const C = CafeChecker;
const LINK_PATTERNS = ['*://cafe.naver.com/*', '*://m.cafe.naver.com/*'];
const PRUNE_EVERY = 200;
let newReads = 0;

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
  const { aliases } = C.fromStorage(await chrome.storage.local.get(null));
  if (info.menuItemId === 'ncc-unread') {
    await chrome.storage.local.remove(C.lookupKeys(article, aliases, C.invertAliases(aliases)));
  } else if (info.menuItemId === 'ncc-read') {
    await chrome.storage.local.set({ [C.storeKey(article, aliases)]: Date.now() });
  }
}

chrome.runtime.onInstalled.addListener(() => { createMenus(); prune(); });
chrome.runtime.onStartup.addListener(() => { prune(); });
chrome.contextMenus.onClicked.addListener(info => { onMenu(info).catch(() => {}); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const [k, change] of Object.entries(changes)) {
    if (k.startsWith(C.READ) && change.oldValue === undefined && change.newValue !== undefined) newReads++;
  }
  if (newReads >= PRUNE_EVERY) { newReads = 0; prune().catch(() => {}); }
});
