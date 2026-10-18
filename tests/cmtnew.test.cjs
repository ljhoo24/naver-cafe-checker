const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, page } = require('./helpers.cjs');

const LIST_URL = 'https://cafe.naver.com/f-e/cafes/1/menus/0';
const CMT = 'data-ncc-cmt-new';
// Comment counts as Naver renders them: a hidden "댓글수" label before "[N]".
const list = (n101, n102) => `
<div class="article-board"><table><tbody class="board-list">
  <tr><td><div class="inner_list">
    <a id="t1" class="article" href="/f-e/cafes/1/articles/101?boardtype=L">첫 글</a>
    <a id="c1" class="cmt" href="/f-e/cafes/1/articles/101?commentFocus=true"><span class="blind">댓글수</span>[${n101}]</a>
  </div></td></tr>
  <tr><td><div class="inner_list">
    <a id="t2" class="article" href="/f-e/cafes/1/articles/102?boardtype=L">둘째 글</a>
    <a id="c2" class="cmt" href="/f-e/cafes/1/articles/102?commentFocus=true"><span class="blind">댓글수</span>[${n102}]</a>
  </div></td></tr>
</tbody></table></div>`;
const noNav = a => a.addEventListener('click', e => e.preventDefault());

test('a read article with more comments than its baseline shows +N', async t => {
  const store = createStore({ 'r:c:1:101': 1, 'k:c:1:101': 3 });
  const h = await page(list(5, 0), { store, url: LIST_URL });
  t.after(() => h.dom.window.close());
  assert.equal(h.get('c1').getAttribute(CMT), '2');
  assert.equal(h.get('t1').hasAttribute(CMT), false);
  assert.equal(h.get('c2').hasAttribute(CMT), false);
  assert.ok(h.doc.documentElement.hasAttribute('data-ncc-cmt'));
});

test('a read article seen without a baseline stores the count quietly', async t => {
  const store = createStore({ 'r:c:1:101': 1 });
  const h = await page(list(7, 0), { store, url: LIST_URL });
  t.after(() => h.dom.window.close());
  assert.equal(store.data['k:c:1:101'], 7);
  assert.equal(h.get('c1').hasAttribute(CMT), false);
  // Unread articles get no baseline.
  assert.equal(store.data['k:c:1:102'], undefined);
});

test('the baseline uses the existing read key, even a cafe url-name one', async t => {
  const store = createStore({ 'a:mycafe': '1', 'r:u:mycafe:101': 1 });
  const h = await page(list(4, 0), { store, url: LIST_URL });
  t.after(() => h.dom.window.close());
  assert.equal(store.data['k:u:mycafe:101'], 4);
  assert.equal(store.data['k:c:1:101'], undefined);
});

test('fewer comments than the baseline shows nothing and keeps the baseline', async t => {
  const store = createStore({ 'r:c:1:101': 1, 'k:c:1:101': 5 });
  const h = await page(list(3, 0), { store, url: LIST_URL });
  t.after(() => h.dom.window.close());
  assert.equal(h.get('c1').hasAttribute(CMT), false);
  assert.equal(store.data['k:c:1:101'], 5);
});

test('+N follows baseline changes from other tabs and list updates', async t => {
  const store = createStore({ 'r:c:1:101': 1, 'k:c:1:101': 3 });
  const h = await page(list(3, 0), { store, url: LIST_URL });
  t.after(() => h.dom.window.close());
  assert.equal(h.get('c1').hasAttribute(CMT), false);
  h.get('c1').innerHTML = '<span class="blind">댓글수</span>[6]';
  await h.settle();
  assert.equal(h.get('c1').getAttribute(CMT), '3');
  await store.local.set({ 'k:c:1:101': 6 });
  await h.settle();
  assert.equal(h.get('c1').hasAttribute(CMT), false);
});

test('clicking a title or its comment count records the row count', async t => {
  const store = createStore();
  const h = await page(list(4, 2), { store, url: LIST_URL });
  t.after(() => h.dom.window.close());
  noNav(h.get('t1'));
  h.get('t1').click();
  await h.settle();
  assert.ok(store.data['r:c:1:101']);
  assert.equal(store.data['k:c:1:101'], 4);
  assert.equal(h.get('c1').hasAttribute(CMT), false);
  noNav(h.get('c2'));
  h.get('c2').click();
  await h.settle();
  assert.equal(store.data['k:c:1:102'], 2);
  // Clicking an already read article again moves its baseline to the row count.
  await store.local.set({ 'k:c:1:101': 1 });
  await h.settle();
  assert.equal(h.get('c1').getAttribute(CMT), '3');
  h.get('t1').click();
  await h.settle();
  assert.equal(store.data['k:c:1:101'], 4);
  assert.equal(h.get('c1').hasAttribute(CMT), false);
});

// The PC article body is the cafe_main iframe at /ca-fe/cafes/<id>/articles/<n>.
const ARTICLE_URL = 'https://cafe.naver.com/ca-fe/cafes/1/articles/200?menuid=1&referrerAllArticles=false';
const articlePage = top => `
<div class="ArticleContentBox">
  <div class="se-main-container">본문</div>
  <div class="ArticleTool"><a id="cmtTop" href="#" role="button" class="button_comment">${top}</a><a href="#">URL 복사</a></div>
</div>`;

test('the article page keeps the baseline in step with its comment count', async t => {
  const store = createStore();
  const h = await page(articlePage('댓글 2'), { store, url: ARTICLE_URL });
  t.after(() => h.dom.window.close());
  assert.ok(store.data['r:c:1:200']);
  assert.equal(store.data['k:c:1:200'], 2);
  // Own comment posted while reading.
  h.get('cmtTop').textContent = '댓글 3';
  await h.settle();
  assert.equal(store.data['k:c:1:200'], 3);
  // Count split over elements, e.g. a hidden label and a number.
  h.get('cmtTop').innerHTML = '<span class="blind">댓글</span><strong class="num">4</strong>';
  await h.settle();
  assert.equal(store.data['k:c:1:200'], 4);
});

test('an article page without a comment count records no baseline', async t => {
  const store = createStore();
  const h = await page('<div class="ArticleContentBox"><a href="#">좋아요 4</a></div>', { store, url: ARTICLE_URL });
  t.after(() => h.dom.window.close());
  assert.ok(store.data['r:c:1:200']);
  assert.equal(store.data['k:c:1:200'], undefined);
});

test('reading the article again clears +N on open lists', async t => {
  const store = createStore({ 'r:c:1:101': 1, 'k:c:1:101': 3 });
  const l = await page(list(5, 0), { store, url: LIST_URL });
  t.after(() => l.dom.window.close());
  assert.equal(l.get('c1').getAttribute(CMT), '2');
  const a = await page(articlePage('댓글 5'), { store, url: 'https://cafe.naver.com/ca-fe/cafes/1/articles/101?menuid=1' });
  t.after(() => a.dom.window.close());
  await l.settle();
  assert.equal(store.data['k:c:1:101'], 5);
  assert.equal(l.get('c1').hasAttribute(CMT), false);
});

test('turning the setting off removes +N and stops recording baselines', async t => {
  const store = createStore({ 'r:c:1:101': 1, 'k:c:1:101': 3 });
  const h = await page(list(5, 1), { store, url: LIST_URL });
  t.after(() => h.dom.window.close());
  assert.equal(h.get('c1').getAttribute(CMT), '2');
  await store.local.set({ settings: { cmtNew: false } });
  await h.settle();
  assert.equal(h.get('c1').hasAttribute(CMT), false);
  assert.equal(h.doc.documentElement.hasAttribute('data-ncc-cmt'), false);
  assert.equal(h.get('c1').getAttribute('data-ncc-read'), 'extra');
  noNav(h.get('t2'));
  h.get('t2').click();
  await h.settle();
  assert.ok(store.data['r:c:1:102']);
  assert.equal(store.data['k:c:1:102'], undefined);
  await store.local.set({ settings: { cmtNew: true } });
  await h.settle();
  assert.equal(h.get('c1').getAttribute(CMT), '2');
});

test('other articles listed on the article page never become its baseline', async t => {
  const store = createStore();
  const other = `<ul class="list"><li><a id="o1" href="/ca-fe/cafes/1/articles/300"><span class="num"><span class="blind">댓글</span> [9]</span></a></li></ul>`;
  // Rendered before the article's own button (e.g. the button is still loading).
  const h = await page(other, { store, url: ARTICLE_URL });
  t.after(() => h.dom.window.close());
  assert.ok(store.data['r:c:1:200']);
  assert.equal(store.data['k:c:1:200'], undefined);
  h.doc.body.insertAdjacentHTML('beforeend', articlePage('댓글 2'));
  await h.settle();
  assert.equal(store.data['k:c:1:200'], 2);
});
