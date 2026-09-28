const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, page, wait } = require('./helpers.cjs');

const PC_LIST = `
<div class="article-board"><table><tbody class="board-list">
  <tr id="row1"><td><div class="inner_list">
    <a id="t1" class="article" href="/f-e/cafes/31780162/articles/101?boardtype=L">첫 번째 글</a>
    <a id="c1" class="cmt" href="/f-e/cafes/31780162/articles/101?commentFocus=true">[3]</a>
  </div></td><td class="td_name"><span class="nickname">작성자</span></td></tr>
  <tr id="row2"><td><div class="inner_list">
    <a id="t2" class="article" href="/f-e/cafes/31780162/articles/102?boardtype=L">두 번째 글</a>
  </div></td></tr>
</tbody></table></div>
<div class="article-album-view"><div class="item">
  <a id="thumb" class="thumbLink" href="https://cafe.naver.com/f-e/cafes/31780162/articles/101"><img src="x.png"></a>
</div></div>
<a id="menu" href="/f-e/cafes/31780162/menus/2">자유게시판</a>`;

const noNav = a => a.addEventListener('click', e => e.preventDefault());

test('marks read titles once per row, dims comment counts and thumbnails', async t => {
  const store = createStore({ 'r:c:31780162:101': 1 });
  const h = await page(PC_LIST, { store });
  t.after(() => h.dom.window.close());
  assert.equal(h.get('t1').getAttribute('data-ncc-read'), 'title');
  assert.equal(h.get('c1').getAttribute('data-ncc-read'), 'extra');
  assert.equal(h.get('thumb').getAttribute('data-ncc-read'), 'media');
  assert.equal(h.get('t2').hasAttribute('data-ncc-read'), false);
  assert.equal(h.get('menu').hasAttribute('data-ncc-read'), false);
  assert.ok(h.doc.documentElement.hasAttribute('data-ncc-dim'));
  assert.ok(h.doc.documentElement.hasAttribute('data-ncc-badge'));
});

test('clicking a title records it and every open page updates', async t => {
  const store = createStore();
  const list = await page(PC_LIST, { store });
  const other = await page(PC_LIST, { store, url: 'https://cafe.naver.com/f-e/cafes/31780162/menus/2' });
  t.after(() => { list.dom.window.close(); other.dom.window.close(); });
  noNav(list.get('t2'));
  list.get('t2').click();
  await list.settle();
  assert.ok(store.data['r:c:31780162:102']);
  assert.equal(list.get('t2').getAttribute('data-ncc-read'), 'title');
  assert.equal(other.get('t2').getAttribute('data-ncc-read'), 'title');
});

test('opening an article page records it; SPA navigation is detected', async t => {
  const store = createStore();
  const reader = await page('<div id="app"></div>', { store, url: 'https://cafe.naver.com/f-e/cafes/31780162/articles/555?boardtype=L' });
  t.after(() => reader.dom.window.close());
  assert.ok(store.data['r:c:31780162:555']);
  reader.w.history.pushState({}, '', '/f-e/cafes/31780162/articles/556');
  await wait(800);
  assert.ok(store.data['r:c:31780162:556']);
  reader.w.history.pushState({}, '', '/f-e/cafes/31780162/articles/write');
  await wait(800);
  assert.equal(Object.keys(store.data).filter(k => k.startsWith('r:')).length, 2);
});

test('rows added or changed later are re-evaluated', async t => {
  const store = createStore({ 'r:c:31780162:9': 1 });
  const h = await page('<ul id="list"></ul>', { store });
  t.after(() => h.dom.window.close());
  h.get('list').innerHTML = '<li><a id="late" href="https://m.cafe.naver.com/ca-fe/web/cafes/31780162/articles/9">나중에 로드된 글</a></li>';
  await h.settle();
  assert.equal(h.get('late').getAttribute('data-ncc-read'), 'title');
  h.get('late').setAttribute('href', 'https://m.cafe.naver.com/ca-fe/web/cafes/31780162/articles/10');
  await h.settle();
  assert.equal(h.get('late').hasAttribute('data-ncc-read'), false);
});

test('legacy shell learns cafe url name, so short and id links match', async t => {
  const store = createStore();
  const shell = `<script>var g_sClubId = "31780162"; var g_sCafeHome = "https://cafe.naver.com/" + "newsickminza";</script>
    <a id="short" href="https://cafe.naver.com/newsickminza/700">짧은 주소 글</a>`;
  const h = await page(shell, { store, url: 'https://cafe.naver.com/newsickminza/700' });
  t.after(() => h.dom.window.close());
  assert.equal(store.data['a:newsickminza'], '31780162');
  assert.ok(store.data['r:c:31780162:700']);
  const list = await page('<a id="long" href="/f-e/cafes/31780162/articles/700">긴 주소 글</a>', { store });
  t.after(() => list.dom.window.close());
  assert.equal(list.get('long').getAttribute('data-ncc-read'), 'title');
  assert.equal(h.get('short').getAttribute('data-ncc-read'), 'title');
});

test('new PC frame learns alias from cafe home link; old url-name records still match', async t => {
  const store = createStore({ 'r:u:newsickminza:42': 1 });
  const h = await page(`<a id="a" href="/f-e/cafes/31780162/articles/42">글</a>
    <footer><a class="Layout_cafe_link__3KjUv" href="https://cafe.naver.com/newsickminza">https://cafe.naver.com/newsickminza</a></footer>`, { store });
  t.after(() => h.dom.window.close());
  await h.settle();
  assert.equal(store.data['a:newsickminza'], '31780162');
  assert.equal(h.get('a').getAttribute('data-ncc-read'), 'title');
});

test('page addressed by url name learns id from its own links', async t => {
  const store = createStore();
  const links = [1, 2, 3, 4].map(n => `<a href="/f-e/cafes/31780162/articles/${n}">글 ${n}</a>`).join('');
  const h = await page(links, { store, url: 'https://m.cafe.naver.com/newsickminza' });
  t.after(() => h.dom.window.close());
  assert.equal(store.data['a:newsickminza'], '31780162');
});

test('cafe home feed (section host) marks links but never learns aliases from its own path', async t => {
  const store = createStore({ 'r:c:31780162:1': 1 });
  const links = [1, 2, 3, 4].map(n => `<a id="f${n}" href="https://cafe.naver.com/f-e/cafes/31780162/articles/${n}">글 ${n}</a>`).join('');
  const h = await page(links, { store, url: 'https://section.cafe.naver.com/feed' });
  t.after(() => h.dom.window.close());
  assert.equal(h.get('f1').getAttribute('data-ncc-read'), 'title');
  assert.equal(Object.keys(store.data).some(k => k.startsWith('a:')), false);
});

test('settings: disabling removes marks and stops recording; style flags follow', async t => {
  const store = createStore({ 'r:c:31780162:101': 1 });
  const h = await page(PC_LIST, { store });
  t.after(() => h.dom.window.close());
  await store.local.set({ settings: { enabled: true, dim: false, badge: true } });
  await h.settle();
  assert.equal(h.doc.documentElement.hasAttribute('data-ncc-dim'), false);
  assert.ok(h.doc.documentElement.hasAttribute('data-ncc-badge'));
  await store.local.set({ settings: { enabled: false, dim: true, badge: true } });
  await h.settle();
  assert.equal(h.doc.querySelectorAll('[data-ncc-read]').length, 0);
  assert.equal(h.doc.documentElement.hasAttribute('data-ncc-badge'), false);
  noNav(h.get('t2'));
  h.get('t2').click();
  await h.settle();
  assert.equal(store.data['r:c:31780162:102'], undefined);
  await store.local.set({ settings: { enabled: true, dim: true, badge: true } });
  await h.settle();
  assert.equal(h.get('t1').getAttribute('data-ncc-read'), 'title');
});

test('clearing records elsewhere unmarks immediately', async t => {
  const store = createStore({ 'r:c:31780162:101': 1 });
  const h = await page(PC_LIST, { store });
  t.after(() => h.dom.window.close());
  await store.local.remove('r:c:31780162:101');
  await h.settle();
  assert.equal(h.doc.querySelectorAll('[data-ncc-read]').length, 0);
});
