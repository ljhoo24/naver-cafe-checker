const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { source, createStore, wait } = require('./helpers.cjs');

// chrome.storage.sync limits; the fake rejects writes over them like Chrome does.
function createSyncStore() {
  const store = createStore({}, 'sync');
  const set = store.local.set;
  store.writes = 0;
  store.local.set = async items => {
    for (const [k, v] of Object.entries(items)) {
      if (k.length + JSON.stringify(v).length > 8192) throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
    }
    const next = { ...store.data, ...items };
    const total = Object.entries(next).reduce((n, [k, v]) => n + k.length + JSON.stringify(v).length, 0);
    if (total > 102400) throw new Error('QUOTA_BYTES quota exceeded');
    store.writes++;
    return set(items);
  };
  return store;
}

function load(initial, sync = createSyncStore()) {
  const store = createStore(initial);
  const hooks = {};
  const menus = [];
  const alarms = new Map();
  const chrome = {
    runtime: {
      onInstalled: { addListener: fn => { hooks.installed = fn; } },
      onStartup: { addListener: fn => { hooks.startup = fn; } },
      onMessage: { addListener: fn => { hooks.message = fn; } }
    },
    contextMenus: {
      removeAll: cb => { menus.length = 0; cb(); },
      create: item => menus.push(item),
      onClicked: { addListener: fn => { hooks.menu = fn; } }
    },
    alarms: {
      get: async name => alarms.get(name),
      create: async (name, info) => { alarms.set(name, { name, ...info }); },
      onAlarm: { addListener: fn => { hooks.alarm = fn; } }
    },
    storage: {
      local: store.local,
      sync: sync.local,
      onChanged: { addListener: fn => { store.onChanged.addListener(fn); sync.onChanged.addListener(fn); } }
    }
  };
  const context = vm.createContext({ chrome, URL, console });
  context.importScripts = (...names) => names.forEach(name => vm.runInContext(source(name), context));
  vm.runInContext(source('background.js'), context);
  const syncNow = () => new Promise(resolve => hooks.message({ type: 'ncc-sync-now' }, {}, resolve));
  const reads = () => Object.keys(store.data).filter(k => k.startsWith('r:')).sort();
  return { store, sync, hooks, menus, alarms, syncNow, reads };
}

test('creates link context menus limited to cafe URLs', () => {
  const bg = load();
  bg.hooks.installed();
  assert.deepEqual(bg.menus.map(m => m.id), ['ncc-unread', 'ncc-read']);
  for (const m of bg.menus) assert.deepEqual([...m.targetUrlPatterns], ['*://cafe.naver.com/*', '*://m.cafe.naver.com/*']);
});

test('context menu marks and unmarks, including url-name records', async () => {
  const bg = load({ 'a:newsickminza': '31780162', 'r:u:newsickminza:5': 1 });
  bg.hooks.menu({ menuItemId: 'ncc-unread', linkUrl: 'https://cafe.naver.com/f-e/cafes/31780162/articles/5' });
  await wait(20);
  assert.equal(bg.store.data['r:u:newsickminza:5'], undefined);
  assert.ok(bg.store.data['sync:tomb']['r:u:newsickminza:5']);
  bg.hooks.menu({ menuItemId: 'ncc-read', linkUrl: 'https://cafe.naver.com/newsickminza/6' });
  await wait(20);
  assert.ok(bg.store.data['r:c:31780162:6']);
  bg.hooks.menu({ menuItemId: 'ncc-read', linkUrl: 'https://cafe.naver.com/f-e/cafes/31780162/menus/1' });
  await wait(20);
  assert.deepEqual(bg.reads(), ['r:c:31780162:6']);
});

test('prunes oldest records beyond the limit on startup', async () => {
  const initial = { settings: { sync: false } };
  for (let i = 0; i < 50003; i++) initial[`r:c:1:${i}`] = i + 1;
  const bg = load(initial);
  bg.hooks.startup();
  await wait(50);
  assert.equal(bg.reads().length, 50000);
  assert.ok(!('r:c:1:0' in bg.store.data) && !('r:c:1:2' in bg.store.data) && 'r:c:1:3' in bg.store.data);
});

test('two browsers on one Google account share reads, unread marks and clear-all', async () => {
  const sync = createSyncStore();
  const a = load({ 'r:c:100:1': Date.now() - 5000, 'r:c:100:2': Date.now() - 4000, 'a:mycafe': '100' }, sync);
  const b = load({ 'r:c:200:9': Date.now() - 3000 }, sync);

  assert.equal((await a.syncNow()).ok, true);
  await b.syncNow();
  assert.deepEqual(b.reads(), ['r:c:100:1', 'r:c:100:2', 'r:c:200:9']);
  assert.equal(b.store.data['a:mycafe'], '100');
  await a.syncNow();
  assert.deepEqual(a.reads(), ['r:c:100:1', 'r:c:100:2', 'r:c:200:9']);

  // Nothing new: no further writes to storage.sync.
  const writes = sync.writes;
  await a.syncNow(); await b.syncNow();
  assert.equal(sync.writes, writes);

  // Unread on B propagates to A and is not resurrected by A's older copy.
  b.hooks.menu({ menuItemId: 'ncc-unread', linkUrl: 'https://cafe.naver.com/f-e/cafes/100/articles/1' });
  await wait(20);
  await b.syncNow(); await a.syncNow(); await b.syncNow();
  assert.deepEqual(a.reads(), ['r:c:100:2', 'r:c:200:9']);
  assert.deepEqual(b.reads(), ['r:c:100:2', 'r:c:200:9']);
  assert.deepEqual(b.store.data['sync:tomb'], {});

  // Reading it again later wins over the old unread mark.
  await wait(5);
  await a.store.local.set({ 'r:c:100:1': Date.now() });
  await a.syncNow(); await b.syncNow();
  assert.ok(b.store.data['r:c:100:1']);

  // Clear-all on A clears B; reads made on B afterwards survive.
  await wait(5);
  await a.store.local.set({ 'sync:clearedAt': Date.now() });
  await a.store.local.remove(a.reads());
  await a.syncNow();
  await wait(5);
  await b.store.local.set({ 'r:c:300:1': Date.now() });
  await b.syncNow(); await a.syncNow();
  assert.deepEqual(b.reads(), ['r:c:300:1']);
  assert.deepEqual(a.reads(), ['r:c:300:1']);
});

test('large history stays within storage.sync quotas, newest reads first', async () => {
  const now = Date.now();
  const initial = {};
  // 50,000 reads spread over 40 cafes with sparse article numbers.
  for (let i = 0; i < 50000; i++) initial[`r:c:${10000000 + (i % 40)}:${1000000 + i * 37}`] = now - 50000 + i;
  for (let i = 0; i < 300; i++) initial[`a:cafe${i}`] = String(20000000 + i);
  const tomb = {};
  for (let i = 0; i < 400; i++) tomb[`r:c:12345678:${5000000 + i}`] = now - i;
  initial['sync:tomb'] = tomb;
  const bg = load(initial);
  const status = await bg.syncNow();
  assert.equal(status.ok, true, status.error);
  assert.ok(status.synced > 15000, `only ${status.synced} synced`);
  const other = load({}, bg.sync);
  await other.syncNow();
  const got = other.reads();
  assert.equal(got.length, status.synced);
  const newest = `r:c:${10000000 + (49999 % 40)}:${1000000 + 49999 * 37}`;
  const oldest = `r:c:${10000000}:${1000000}`;
  assert.ok(got.includes(newest) && !got.includes(oldest));
});

test('sync disabled: nothing is written to the account', async () => {
  const bg = load({ 'r:c:1:1': 1, settings: { sync: false } });
  const status = await bg.syncNow();
  assert.equal(status.disabled, true);
  assert.deepEqual(bg.sync.data, {});
});

test('quota errors are reported to the popup status', async () => {
  const bg = load({ 'r:c:1:1': 1 });
  bg.sync.local.set = async () => { throw new Error('MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded'); };
  const status = await bg.syncNow();
  assert.equal(status.ok, false);
  assert.match(bg.store.data['sync:status'].error, /MAX_WRITE_OPERATIONS/);
  assert.ok(bg.store.data['r:c:1:1']);
});

test('local changes schedule one batched sync alarm', async () => {
  const bg = load({ settings: { sync: true } });
  await bg.store.local.set({ 'r:c:1:1': Date.now() });
  await bg.store.local.set({ 'r:c:1:2': Date.now() });
  await wait(10);
  assert.deepEqual([...bg.alarms.keys()], ['ncc-sync-soon']);
  assert.equal(bg.alarms.get('ncc-sync-soon').delayInMinutes, 1);
});
