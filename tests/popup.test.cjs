const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { source, createStore, wait } = require('./helpers.cjs');

async function popup(initial) {
  const store = createStore(initial);
  const messages = [];
  const body = /<body>([\s\S]*?)<script/.exec(source('popup.html'))[1];
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, { runScripts: 'outside-only' });
  const w = dom.window;
  w.chrome = {
    runtime: { sendMessage: async m => { messages.push(m); await store.local.set({ 'sync:status': { at: Date.now(), ok: true, synced: 2, total: 2 } }); } },
    storage: { local: store.local, onChanged: store.onChanged }
  };
  for (const f of ['core.js', 'sync.js', 'popup.js']) w.eval(source(f));
  await wait(30);
  return { dom, w, store, messages, $: id => w.document.getElementById(id) };
}

test('shows count, settings and sync status; toggles save', async t => {
  const p = await popup({ 'r:c:1:1': 1, 'r:c:1:2': 2, 'a:x': '1', 'sync:status': { at: Date.now() - 120000, ok: true, synced: 2, total: 2 } });
  t.after(() => p.dom.window.close());
  assert.equal(p.$('count').textContent, '2');
  assert.equal(p.$('sync').checked, true);
  assert.match(p.$('syncStatus').textContent, /2분 전 동기화 · 2개 공유/);
  p.$('sync').checked = false;
  p.$('sync').dispatchEvent(new p.w.Event('change'));
  await wait(20);
  assert.equal(p.store.data.settings.sync, false);
  assert.equal(p.$('syncStatus').textContent, '꺼져 있습니다.');
  assert.equal(p.$('syncNow').disabled, true);
});

test('like retry toggle and the last like error message', async t => {
  const p = await popup({ 'like:last': { message: '오래 열어둔 페이지입니다', handled: false, at: Date.now() } });
  t.after(() => p.dom.window.close());
  assert.equal(p.$('likeRetry').checked, true);
  assert.equal(p.$('likeLast').hidden, false);
  assert.match(p.$('likeLast').textContent, /처리 안 함.*오래 열어둔 페이지입니다/);
  p.$('likeRetry').checked = false;
  p.$('likeRetry').dispatchEvent(new p.w.Event('change'));
  await wait(20);
  assert.equal(p.store.data.settings.likeRetry, false);
  const q = await popup({});
  t.after(() => q.dom.window.close());
  assert.equal(q.$('likeLast').hidden, true);
});

test('hotkeys: shows A/S, captures a new key, rejects duplicates and unusable keys, Esc cancels', async t => {
  const p = await popup({});
  t.after(() => p.dom.window.close());
  const key = code => p.w.document.dispatchEvent(new p.w.KeyboardEvent('keydown', { code, key: code, bubbles: true, cancelable: true }));
  assert.equal(p.$('prevKey').textContent, 'A');
  assert.equal(p.$('nextKey').textContent, 'S');
  p.$('prevKey').click();
  assert.equal(p.$('prevKey').textContent, '키 입력…');
  key('ShiftLeft');
  assert.equal(p.$('prevKey').textContent, '키 입력…');
  key('KeyQ');
  await wait(20);
  assert.equal(p.store.data.settings.prevKey, 'KeyQ');
  assert.equal(p.$('prevKey').textContent, 'Q');
  p.$('nextKey').click();
  key('KeyQ');
  await wait(20);
  assert.match(p.$('keyHint').textContent, /이미 이전 글에/);
  key('Enter');
  assert.match(p.$('keyHint').textContent, /쓸 수 없습니다/);
  key('Escape');
  await wait(20);
  assert.equal(p.$('nextKey').textContent, 'S');
  assert.equal(p.store.data.settings.nextKey, 'KeyS');
  p.$('hotkeys').checked = false;
  p.$('hotkeys').dispatchEvent(new p.w.Event('change'));
  await wait(20);
  assert.equal(p.store.data.settings.hotkeys, false);
  assert.equal(p.$('prevKey').disabled, true);
});

test('sync now asks the background and shows the result; errors are visible', async t => {
  const p = await popup({ 'sync:status': { at: 1, ok: false, error: 'QUOTA_BYTES quota exceeded' } });
  t.after(() => p.dom.window.close());
  assert.match(p.$('syncStatus').textContent, /동기화 실패: QUOTA_BYTES/);
  p.$('syncNow').click();
  await wait(30);
  assert.equal(JSON.stringify(p.messages), '[{"type":"ncc-sync-now"}]');
  assert.match(p.$('syncStatus').textContent, /방금 동기화/);
});

test('clear-all needs a second click and records the clear for other browsers', async t => {
  const p = await popup({ 'r:c:1:1': 1, 'a:x': '1' });
  t.after(() => p.dom.window.close());
  p.$('clear').click();
  await wait(20);
  assert.ok(p.store.data['r:c:1:1']);
  p.$('clear').click();
  await wait(20);
  assert.equal(p.store.data['r:c:1:1'], undefined);
  assert.equal(p.store.data['a:x'], '1');
  assert.ok(p.store.data['sync:clearedAt'] > 0);
  assert.equal(p.$('count').textContent, '0');
});
