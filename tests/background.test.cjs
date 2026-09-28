const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { source, createStore, wait } = require('./helpers.cjs');

function load(initial) {
  const store = createStore(initial);
  const hooks = {};
  const menus = [];
  const chrome = {
    runtime: { onInstalled: { addListener: fn => { hooks.installed = fn; } }, onStartup: { addListener: fn => { hooks.startup = fn; } } },
    contextMenus: {
      removeAll: cb => { menus.length = 0; cb(); },
      create: item => menus.push(item),
      onClicked: { addListener: fn => { hooks.menu = fn; } }
    },
    storage: { local: store.local, onChanged: store.onChanged }
  };
  const context = vm.createContext({ chrome, URL, console });
  context.importScripts = name => vm.runInContext(source(name), context);
  vm.runInContext(source('background.js'), context);
  return { store, hooks, menus };
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
  bg.hooks.menu({ menuItemId: 'ncc-read', linkUrl: 'https://cafe.naver.com/newsickminza/6' });
  await wait(20);
  assert.ok(bg.store.data['r:c:31780162:6']);
  bg.hooks.menu({ menuItemId: 'ncc-read', linkUrl: 'https://cafe.naver.com/f-e/cafes/31780162/menus/1' });
  await wait(20);
  assert.equal(Object.keys(bg.store.data).filter(k => k.startsWith('r:')).length, 1);
});

test('prunes oldest records beyond the limit on startup', async () => {
  const initial = {};
  for (let i = 0; i < 50003; i++) initial[`r:c:1:${i}`] = i + 1;
  const bg = load(initial);
  bg.hooks.startup();
  await wait(50);
  const left = Object.keys(bg.store.data);
  assert.equal(left.length, 50000);
  assert.ok(!('r:c:1:0' in bg.store.data) && !('r:c:1:2' in bg.store.data) && 'r:c:1:3' in bg.store.data);
});
