const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { source, createStore, wait } = require('./helpers.cjs');

const LIST_URL = 'https://cafe.naver.com/f-e/cafes/1/menus/2?viewType=L&page=1';
const HOUR = 60 * 60 * 1000;
const TABLE = (ids, notice = true) => `
<div class="article-board"><table class="article-table"><tbody id="body">
  ${notice ? '<tr class="board-notice type_main" id="notice"><td>공지</td><td><a class="article" href="/f-e/cafes/1/articles/50">공지</a></td></tr>' : ''}
  ${ids.map(id => `<tr id="r${id}"><td class="num">${id}</td><td><div class="board-list"><div class="inner_list"><a class="article" href="/f-e/cafes/1/articles/${id}">글 ${id}</a></div></div></td></tr>`).join('')}
</tbody></table></div>`;

async function page(html, { store = createStore(), url = LIST_URL } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url, runScripts: 'outside-only' });
  const w = dom.window;
  w.chrome = { runtime: { id: 'test' }, storage: { local: store.local, onChanged: store.onChanged } };
  w.eval(source('core.js'));
  w.eval(source('newmark.js'));
  await wait(250);
  const boundary = () => {
    const row = w.document.querySelector('[data-ncc-new-boundary]');
    return row && { id: row.id, label: row.cells[0].getAttribute('data-ncc-new-label') };
  };
  return { dom, w, store, boundary, doc: w.document };
}

test('visit(): first visit, same visit, new visit after 30 minutes, cafe activity keeps a visit going', () => {
  globalThis.chrome = { storage: { onChanged: { addListener() {} }, local: { get: () => new Promise(() => {}) } } };
  globalThis.CafeChecker = require('../extension/core.js');
  const dom = new JSDOM('', { url: LIST_URL });
  globalThis.location = dom.window.location;
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.MutationObserver = dom.window.MutationObserver;
  require('../extension/newmark.js');
  const { visit, board } = globalThis.__cafeCheckerNewMark;
  const t0 = 1_000_000_000_000;
  const first = visit(undefined, 100, t0);
  assert.deepEqual(first, { mark: 100, latest: 100, at: t0, markAt: t0 });
  const same = visit({ ...first }, 104, t0 + 10 * 60 * 1000);
  assert.deepEqual([same.mark, same.latest], [100, 104]);
  const next = visit(same, 110, t0 + 3 * HOUR);
  assert.deepEqual([next.mark, next.latest, next.markAt], [104, 110, same.at]);
  // Reading articles 20 minutes ago counts as the same visit.
  const reading = visit(same, 110, t0 + 3 * HOUR, t0 + 3 * HOUR - 20 * 60 * 1000);
  assert.deepEqual([reading.mark, reading.latest], [100, 110]);
  assert.deepEqual(board('https://cafe.naver.com/f-e/cafes/1/menus/0?page=2'), { cafeId: '1', menuId: '0' });
  assert.equal(board('https://cafe.naver.com/f-e/cafes/1/menus/2?q=검색어'), null);
  assert.deepEqual(board('https://cafe.naver.com/ArticleList.nhn?search.clubid=1&search.menuid=5'), { cafeId: '1', menuId: '5' });
  assert.equal(board('https://cafe.naver.com/f-e/cafes/1/articles/3'), null);
  for (const k of ['chrome', 'CafeChecker', 'location', 'document', 'window', 'MutationObserver']) delete globalThis[k];
  dom.window.close();
});

test('new visit: divider above the first row seen last time, with count and time', async t => {
  const store = createStore({ 'v:1:2': { mark: 98, latest: 102, at: Date.now() - 2 * HOUR, markAt: Date.now() - 5 * HOUR } });
  const p = await page(TABLE([105, 104, 103, 102, 101]), { store });
  t.after(() => p.dom.window.close());
  assert.deepEqual(p.boundary(), { id: 'r102', label: '▲ 새 글 3개 · 지난 방문 2시간 전' });
  assert.equal(p.doc.getElementById('notice').hasAttribute('data-ncc-new-boundary'), false);
  const saved = store.data['v:1:2'];
  assert.deepEqual([saved.mark, saved.latest], [102, 105]);
  assert.ok(store.data['v:1'] > Date.now() - 5000);
});

test('first visit records the board without a divider; nothing new means no divider', async t => {
  const store = createStore();
  const p = await page(TABLE([105, 104]), { store });
  t.after(() => p.dom.window.close());
  assert.equal(p.boundary(), null);
  assert.deepEqual([store.data['v:1:2'].mark, store.data['v:1:2'].latest], [105, 105]);
  const again = await page(TABLE([105, 104]), { store: createStore({ 'v:1:2': { mark: 100, latest: 105, at: Date.now() - 3 * HOUR, markAt: 0 } }) });
  t.after(() => again.dom.window.close());
  assert.equal(again.boundary(), null);
});

test('same visit keeps the divider; re-rendered rows get it back', async t => {
  const store = createStore({ 'v:1:2': { mark: 102, latest: 105, at: Date.now() - 5 * 60 * 1000, markAt: Date.now() - 4 * HOUR } });
  const p = await page(TABLE([105, 104, 103, 102, 101]), { store });
  t.after(() => p.dom.window.close());
  assert.equal(p.boundary().id, 'r102');
  assert.equal(store.data['v:1:2'].mark, 102);
  p.doc.getElementById('body').innerHTML = TABLE([106, 105, 104, 103, 102], false).match(/<tbody id="body">([\s\S]*)<\/tbody>/)[1];
  await wait(250);
  assert.deepEqual(p.boundary(), { id: 'r102', label: '▲ 새 글 4개 · 지난 방문 4시간 전' });
});

test('page 2 / search / turned off: correct or no divider', async t => {
  const rec = () => createStore({ 'v:1:2': { mark: 102, latest: 104, at: Date.now() - 2 * HOUR, markAt: Date.now() - 2 * HOUR } });
  const older = await page(TABLE([90, 89]), { store: rec(), url: 'https://cafe.naver.com/f-e/cafes/1/menus/2?page=2' });
  t.after(() => older.dom.window.close());
  assert.equal(older.boundary(), null);
  const search = await page(TABLE([105, 104, 101]), { store: rec(), url: 'https://cafe.naver.com/f-e/cafes/1/menus/2?q=hello' });
  t.after(() => search.dom.window.close());
  assert.equal(search.boundary(), null);
  const store = rec();
  const p = await page(TABLE([105, 104, 101]), { store });
  t.after(() => p.dom.window.close());
  // New visit: last visit's newest (104) becomes the mark.
  assert.equal(p.boundary().id, 'r104');
  await store.local.set({ settings: { newMark: false } });
  await wait(250);
  assert.equal(p.boundary(), null);
  assert.equal(p.doc.querySelector('[data-ncc-new-label]'), null);
});

test('activity on an article page keeps the cafe visit alive (throttled)', async t => {
  const store = createStore();
  const p = await page('<div id="article">본문</div>', { store, url: 'https://cafe.naver.com/ca-fe/cafes/1/articles/105' });
  t.after(() => p.dom.window.close());
  assert.equal(store.data['v:1'], undefined, 'opening alone does not count');
  p.w.dispatchEvent(new p.w.Event('scroll'));
  const first = store.data['v:1'];
  assert.ok(first > Date.now() - 5000);
  p.w.dispatchEvent(new p.w.Event('keydown'));
  assert.equal(store.data['v:1'], first, 'at most once a minute');
});
