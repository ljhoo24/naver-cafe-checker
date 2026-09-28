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
