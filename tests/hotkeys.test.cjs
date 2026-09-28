const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { source, createStore, wait } = require('./helpers.cjs');

// PC article view (ca-fe web-section app) top button bar.
const BAR = (prev = true, next = true) => `
<div class="ArticleTopBtns">
  <div class="left_area"><a href="#" class="BaseButton">수정</a></div>
  <div class="right_area">
    ${prev ? '<a href="#" id="prev" class="BaseButton btn_prev skinGray"><span class="BaseButton__txt"> 이전글 </span></a>' : ''}
    ${next ? '<a href="#" id="next" class="BaseButton btn_next skinGray"><span class="BaseButton__txt"> 다음글 </span></a>' : ''}
    <a href="#" class="BaseButton">목록</a>
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

test('A and S click Naver\'s own previous/next buttons, in any IME mode', async t => {
  const p = await page(BAR());
  t.after(() => p.dom.window.close());
  assert.equal(p.press('KeyA').defaultPrevented, true);
  p.press('KeyS');
  p.press('KeyA', { key: 'ㅁ' });
  p.press('KeyS', { key: 'ㄴ' });
  assert.deepEqual(p.clicks, ['prev', 'next', 'prev', 'next']);
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
  assert.equal(p.press('KeyS').defaultPrevented, true);
  assert.deepEqual(p.clicks, []);
  const host = p.doc.querySelector('[data-ncc-hotkey-notice]');
  assert.ok(host);
  assert.equal(host.shadowRoot.querySelector('div').textContent, '다음 글이 없습니다.');
});

test('key pressed in the outer cafe page reaches the article iframe', async t => {
  const p = await page('<iframe id="cafe_main"></iframe>', { url: 'https://cafe.naver.com/f-e/cafes/31780162/articles/648' });
  t.after(() => p.dom.window.close());
  const inner = p.doc.getElementById('cafe_main').contentDocument;
  inner.body.innerHTML = BAR();
  const innerClicks = [];
  inner.addEventListener('click', e => { const a = e.target.closest('a'); if (a) { innerClicks.push(a.id); e.preventDefault(); } });
  p.press('KeyS');
  assert.deepEqual(innerClicks, ['next']);
});

test('custom keys and the on/off setting apply immediately', async t => {
  const store = createStore();
  const p = await page(BAR(), { store });
  t.after(() => p.dom.window.close());
  await store.local.set({ settings: { prevKey: 'ArrowLeft', nextKey: 'ArrowRight' } });
  p.press('KeyA');
  p.press('ArrowLeft', { key: 'ArrowLeft' });
  p.press('ArrowRight', { key: 'ArrowRight' });
  assert.deepEqual(p.clicks, ['prev', 'next']);
  await store.local.set({ settings: { hotkeys: false } });
  p.press('KeyA');
  assert.deepEqual(p.clicks, ['prev', 'next']);
  await store.local.set({ settings: { enabled: false } });
  p.press('KeyA');
  assert.deepEqual(p.clicks, ['prev', 'next']);
});

test('settings validate key codes and never map one key to both directions', () => {
  const C = require('../extension/core.js');
  assert.deepEqual([C.settings({}).prevKey, C.settings({}).nextKey], ['KeyA', 'KeyS']);
  assert.equal(C.settings({ prevKey: 'Enter' }).prevKey, 'KeyA');
  assert.equal(C.settings({ prevKey: 'Digit1', nextKey: 'Digit2' }).nextKey, 'Digit2');
  assert.deepEqual([C.settings({ prevKey: 'KeyS' }).prevKey, C.settings({ prevKey: 'KeyS' }).nextKey], ['KeyA', 'KeyS']);
  assert.deepEqual(['KeyQ', 'Digit7', 'Numpad3', 'ArrowLeft', 'BracketLeft', 'Comma'].map(C.keyLabel), ['Q', '7', 'Num 3', '←', '[', ',']);
});
