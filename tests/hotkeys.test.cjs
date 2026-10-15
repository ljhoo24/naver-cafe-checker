const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { source, createStore, wait } = require('./helpers.cjs');

// PC article view (ca-fe web-section app) top button bar.
// Naver's 이전글 (btn_prev) is the newer article; 다음글 (btn_next) the older one.
const BAR = (prev = true, next = true) => `
<div class="ArticleTopBtns">
  <div class="left_area"><a href="#" class="BaseButton">수정</a></div>
  <div class="right_area">
    ${prev ? '<a href="#" id="naverPrev" class="BaseButton btn_prev skinGray"><span class="BaseButton__txt"> 이전글 </span></a>' : ''}
    ${next ? '<a href="#" id="naverNext" class="BaseButton btn_next skinGray"><span class="BaseButton__txt"> 다음글 </span></a>' : ''}
    <a href="#" id="toList" class="BaseButton">목록</a>
  </div>
</div>
<div class="LayerBox"><button type="button" class="btn_prev">이전으로</button></div>
<textarea id="comment"></textarea><div id="editor" contenteditable="true"></div>`;

async function page(html, { store = createStore(), url = 'https://cafe.naver.com/ca-fe/cafes/31780162/articles/648' } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url, runScripts: 'outside-only' });
  const w = dom.window;
  const clicks = [];
  w.document.addEventListener('click', e => { const a = e.target.closest('a, button'); if (a) { clicks.push(a.id || a.className); e.preventDefault(); } });
  w.chrome = { runtime: { id: 'test' }, storage: { local: store.local, onChanged: store.onChanged } };
  w.eval(source('core.js'));
  w.eval(source('hotkeys.js'));
  await wait(20);
  const press = (code, init = {}, target = w.document.body) => {
    const event = new w.KeyboardEvent('keydown', { code, key: init.key || code.replace(/^Key/, '').toLowerCase(), bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  };
  return { dom, w, store, clicks, press, doc: w.document };
}

test('A = older article (Naver 다음글), S = newer article (Naver 이전글), in any IME mode', async t => {
  const p = await page(BAR());
  t.after(() => p.dom.window.close());
  assert.equal(p.press('KeyA').defaultPrevented, true);
  p.press('KeyS');
  p.press('KeyA', { key: 'ㅁ' });
  p.press('KeyS', { key: 'ㄴ' });
  assert.deepEqual(p.clicks, ['naverNext', 'naverPrev', 'naverNext', 'naverPrev']);
});

test('ignored while typing, with modifiers, on key repeat and off article pages', async t => {
  const p = await page(BAR());
  t.after(() => p.dom.window.close());
  p.press('KeyA', {}, p.doc.getElementById('comment'));
  p.press('KeyA', {}, p.doc.getElementById('editor'));
  p.press('KeyA', { ctrlKey: true });
  p.press('KeyS', { shiftKey: true });
  p.press('KeyA', { repeat: true });
  p.press('KeyD');
  assert.deepEqual(p.clicks, []);
  const list = await page('<div class="article-board"><a href="/f-e/cafes/1/articles/2">글</a></div>', { url: 'https://cafe.naver.com/f-e/cafes/1/menus/0' });
  t.after(() => list.dom.window.close());
  assert.equal(list.press('KeyA').defaultPrevented, false);
  assert.deepEqual(list.clicks, []);
});

test('first/last article: a short notice instead of a click', async t => {
  const p = await page(BAR(true, false));
  t.after(() => p.dom.window.close());
  assert.equal(p.press('KeyA').defaultPrevented, true);
  assert.deepEqual(p.clicks, []);
  const host = p.doc.querySelector('[data-ncc-hotkey-notice]');
  assert.ok(host);
  assert.equal(host.shadowRoot.querySelector('div').textContent, '이전 글이 없습니다.');
});

test('key pressed in the outer cafe page reaches the article iframe', async t => {
  const p = await page('<iframe id="cafe_main"></iframe>', { url: 'https://cafe.naver.com/f-e/cafes/31780162/articles/648' });
  t.after(() => p.dom.window.close());
  const inner = p.doc.getElementById('cafe_main').contentDocument;
  inner.body.innerHTML = BAR();
  const innerClicks = [];
  inner.addEventListener('click', e => { const a = e.target.closest('a'); if (a) { innerClicks.push(a.id); e.preventDefault(); } });
  p.press('KeyS');
  assert.deepEqual(innerClicks, ['naverPrev']);
});

test('custom keys and the on/off setting apply immediately', async t => {
  const store = createStore();
  const p = await page(BAR(), { store });
  t.after(() => p.dom.window.close());
  await store.local.set({ settings: { prevKey: 'ArrowLeft', nextKey: 'ArrowRight' } });
  p.press('KeyA');
  p.press('ArrowLeft', { key: 'ArrowLeft' });
  p.press('ArrowRight', { key: 'ArrowRight' });
  assert.deepEqual(p.clicks, ['naverNext', 'naverPrev']);
  await store.local.set({ settings: { hotkeys: false } });
  p.press('KeyA');
  assert.deepEqual(p.clicks, ['naverNext', 'naverPrev']);
  await store.local.set({ settings: { enabled: false } });
  p.press('KeyA');
  assert.deepEqual(p.clicks, ['naverNext', 'naverPrev']);
});

test('settings validate key codes; a key does one thing per screen, the later duplicate is turned off', () => {
  const C = require('../extension/core.js');
  assert.deepEqual([C.settings({}).prevKey, C.settings({}).nextKey], ['KeyA', 'KeyS']);
  assert.equal(C.settings({ prevKey: 'Enter' }).prevKey, 'KeyA');
  assert.equal(C.settings({ prevKey: 'Digit1', nextKey: 'Digit2' }).nextKey, 'Digit2');
  assert.deepEqual([C.settings({ prevKey: 'KeyS' }).prevKey, C.settings({ prevKey: 'KeyS' }).nextKey], ['KeyS', '']);
  // A/S serve both screens by default; '' keeps a shortcut off.
  assert.deepEqual([C.settings({}).prevPageKey, C.settings({}).nextPageKey, C.settings({}).unreadKey], ['KeyA', 'KeyS', 'KeyN']);
  assert.equal(C.settings({ likeKey: '' }).likeKey, '');
  assert.equal(C.settings({ unreadKey: 'KeyA' }).unreadKey, '');
  assert.deepEqual(['KeyQ', 'Digit7', 'Numpad3', 'ArrowLeft', 'BracketLeft', 'Comma'].map(C.keyLabel), ['Q', '7', 'Num 3', '←', '[', ',']);
});

// Article page parts beyond the top bar: like module, comment writer, list button.
const ARTICLE_EXTRA = (liked = false) => `
<div class="like_article"><div class="ReactionLikeIt u_likeit_list_module _cafeReactionModule" data-cid="1_2">
  <a id="like" href="#" class="like_no u_likeit_list_btn _button${liked ? ' on' : ''}" data-type="like" aria-pressed="${liked}"></a>
</div></div>
<div class="CommentWriter"><div class="comment_inbox"><textarea id="commentBox" class="comment_inbox_text"></textarea></div></div>`;

test('article page: L likes (never unlikes), C focuses the comment box, Q returns to the list', async t => {
  const p = await page(BAR() + ARTICLE_EXTRA());
  t.after(() => p.dom.window.close());
  p.dom.window.HTMLElement.prototype.scrollIntoView = function () { p.w.__scrolled = this.id; };
  p.press('KeyL');
  assert.deepEqual(p.clicks, ['like']);
  p.press('KeyC');
  assert.equal(p.doc.activeElement.id, 'commentBox');
  assert.equal(p.w.__scrolled, 'commentBox');
  p.doc.activeElement.blur();
  const liked = await page(BAR() + ARTICLE_EXTRA(true));
  t.after(() => liked.dom.window.close());
  liked.press('KeyL');
  assert.deepEqual(liked.clicks, []);
  assert.equal(liked.doc.querySelector('[data-ncc-hotkey-notice]').shadowRoot.querySelector('div').textContent, '이미 좋아요한 글입니다.');
  liked.press('KeyQ');
  assert.deepEqual(liked.clicks, ['toList']);
});

const LIST_PAGE = (current = 2, last = 10, readIds = [], nextBlock = false) => `
<div class="article-board"><table class="article-table"><tbody>
  <tr class="board-notice type_main"><td><a href="/f-e/cafes/1/articles/50" class="article" id="notice">공지</a></td></tr>
  ${[105, 104, 103].map(id => `<tr><td><div class="board-list"><div class="inner_list"><a href="/f-e/cafes/1/articles/${id}" id="a${id}" class="article"${readIds.includes(id) ? ' data-ncc-read="title"' : ''}>글 ${id}</a></div></div></td></tr>`).join('')}
</tbody></table></div>
<div class="Pagination">
  ${current > 10 ? '<button type="button" class="btn" aria-label="이전" id="prevBlock"></button>' : ''}
  ${Array.from({ length: last }, (_, i) => i + 1 + (current > 10 ? 10 : 0)).map(n => `<button type="button" class="btn number" id="p${n}" aria-pressed="${n === current}"${n === current ? ' aria-current="page"' : ''}>${n}</button>`).join('')}
  ${nextBlock ? '<button type="button" class="btn type_next" id="nextBlock" aria-label="다음"></button>' : ''}
</div>`;

test('list page: A/S move one page, across the 10-page blocks too', async t => {
  const p = await page(LIST_PAGE(2), { url: 'https://cafe.naver.com/f-e/cafes/1/menus/2?page=2' });
  t.after(() => p.dom.window.close());
  p.press('KeyA');
  p.press('KeyS');
  assert.deepEqual(p.clicks, ['p1', 'p3']);
  const end = await page(LIST_PAGE(10, 10, [], true), { url: 'https://cafe.naver.com/f-e/cafes/1/menus/2?page=10' });
  t.after(() => end.dom.window.close());
  end.press('KeyS');
  assert.deepEqual(end.clicks, ['nextBlock']);
  const blockStart = await page(LIST_PAGE(11, 3), { url: 'https://cafe.naver.com/f-e/cafes/1/menus/2?page=11' });
  t.after(() => blockStart.dom.window.close());
  blockStart.press('KeyA');
  assert.deepEqual(blockStart.clicks, ['prevBlock']);
  const first = await page(LIST_PAGE(1, 1), { url: 'https://cafe.naver.com/f-e/cafes/1/menus/2' });
  t.after(() => first.dom.window.close());
  first.press('KeyA');
  assert.deepEqual(first.clicks, []);
  assert.equal(first.doc.querySelector('[data-ncc-hotkey-notice]').shadowRoot.querySelector('div').textContent, '첫 페이지입니다.');
});

test('list page: N opens the first unread article, skipping notices and read ones', async t => {
  const p = await page(LIST_PAGE(1, 1, [105]), { url: 'https://cafe.naver.com/f-e/cafes/1/menus/2' });
  t.after(() => p.dom.window.close());
  p.press('KeyN');
  assert.deepEqual(p.clicks, ['a104']);
  const allRead = await page(LIST_PAGE(1, 1, [105, 104, 103]), { url: 'https://cafe.naver.com/f-e/cafes/1/menus/2' });
  t.after(() => allRead.dom.window.close());
  allRead.press('KeyN');
  assert.deepEqual(allRead.clicks, []);
  assert.equal(allRead.doc.querySelector('[data-ncc-hotkey-notice]').shadowRoot.querySelector('div').textContent, '이 페이지에 안 읽은 글이 없습니다.');
});

test('article keys win on an article page; turned-off keys do nothing', async t => {
  const store = createStore({ settings: { likeKey: '' } });
  const p = await page(BAR() + ARTICLE_EXTRA() + LIST_PAGE(2), { store });
  t.after(() => p.dom.window.close());
  p.press('KeyS');
  p.press('KeyN');
  p.press('KeyL');
  assert.deepEqual(p.clicks, ['naverPrev']);
});
