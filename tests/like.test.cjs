const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM, VirtualConsole } = require('jsdom');
const { source, createStore, wait } = require('./helpers.cjs');

const URL_ = 'https://cafe.naver.com/ca-fe/cafes/31780162/articles/648?menuid=1&fromNext=true';
const EXPIRED_MSG = '페이지를 오래 열어두어 좋아요를 할 수 없습니다. 새로고침 후 다시 시도해주세요.';
const ARTICLE_LIKE = `
<div class="ReactionLikeIt u_likeit_list_module _cafeReactionModule" data-sid="CAFE" data-cid="31780162_648" id="module">
  <a id="like" class="like_no u_likeit_list_btn _button" href="#" role="button" data-type="like" aria-pressed="false"><span class="u_ico _icon"></span></a>
  <a id="count" class="like_count_btn" href="#" role="button">4</a>
</div>
<ul><li><div class="u_likeit_list_module _cafeReactionModule" data-cid="31780162_648_c1" data-loaded="1">
  <a id="commentLike" class="u_likeit_list_btn _button" href="#" data-type="like" aria-pressed="false"></a>
</div></li></ul>`;

// Mimics Naver's reaction plugin: optimistic toggle, then either success or,
// with an expired page token, revert + window.alert(server message).
const FAKE_PLUGIN = `
  window.__likeRequests = 0;
  document.addEventListener('click', e => {
    const btn = e.target.closest('a.u_likeit_list_btn');
    if (!btn) return;
    e.preventDefault();
    const before = btn.getAttribute('aria-pressed') === 'true';
    btn.setAttribute('aria-pressed', String(!before)); btn.classList.toggle('on', !before);
    window.__likeRequests++;
    setTimeout(() => {
      if (!window.__fail) return;
      btn.setAttribute('aria-pressed', String(before)); btn.classList.toggle('on', before);
      window.alert(window.__fail);
    }, 30);
  });`;

async function page({ store = createStore(), fail = null, session = {}, loadedAfter = 0, html = ARTICLE_LIKE } = {}) {
  const reloads = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', e => { if (/navigation|reload/i.test(e.message)) reloads.push(e.message); });
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, { url: URL_, runScripts: 'outside-only', virtualConsole });
  const w = dom.window;
  for (const [k, v] of Object.entries(session)) w.sessionStorage.setItem(k, v);
  const alerts = [];
  w.alert = message => { alerts.push(message); };
  w.HTMLElement.prototype.scrollIntoView = function () { w.__scrolled = this.id; };
  w.chrome = { runtime: { id: 'test' }, storage: { local: store.local, onChanged: store.onChanged } };
  w.eval(source('like-hook.js'));
  w.eval(FAKE_PLUGIN);
  w.__fail = fail;
  const markLoaded = () => w.document.querySelectorAll('#module').forEach(m => m.setAttribute('data-loaded', '1'));
  if (loadedAfter) setTimeout(markLoaded, loadedAfter); else markLoaded();
  w.eval(source('core.js'));
  w.eval(source('like.js'));
  await wait(50);
  return { dom, w, store, alerts, reloads, get: id => w.document.getElementById(id), session: k => w.sessionStorage.getItem(k) };
}

test('expired like: alert suppressed, intent saved, page reloaded, diagnostics recorded', async t => {
  const p = await page({ fail: EXPIRED_MSG });
  t.after(() => p.dom.window.close());
  p.get('like').click();
  await wait(80);
  assert.deepEqual(p.alerts, []);
  assert.equal(p.reloads.length, 1);
  const intent = JSON.parse(p.session('ncc:like-intent'));
  assert.equal(intent.cid, '31780162_648');
  assert.equal(intent.wantOn, true);
  assert.equal(p.store.data['like:last'].handled, true);
  assert.equal(p.store.data['like:last'].message, EXPIRED_MSG);
});

test('after reload the same like button is clicked once, when the plugin is ready', async t => {
  const intent = JSON.stringify({ cid: '31780162_648', wantOn: true, at: Date.now() });
  const p = await page({ session: { 'ncc:like-intent': intent }, loadedAfter: 400 });
  t.after(() => p.dom.window.close());
  await wait(100);
  assert.equal(p.w.__likeRequests, 0, 'waits for data-loaded');
  await wait(700);
  assert.equal(p.w.__likeRequests, 1);
  assert.equal(p.get('like').getAttribute('aria-pressed'), 'true');
  assert.equal(p.get('commentLike').getAttribute('aria-pressed'), 'false');
  assert.equal(p.session('ncc:like-intent'), null);
  assert.equal(p.w.__scrolled, 'like');
  assert.ok(p.w.document.querySelector('[data-ncc-ui]'), 'notice shown');
});

test('if the automatic click fails again, the alert is shown and no reload loop happens', async t => {
  const intent = JSON.stringify({ cid: '31780162_648', wantOn: true, at: Date.now() });
  const p = await page({ fail: EXPIRED_MSG, session: { 'ncc:like-intent': intent } });
  t.after(() => p.dom.window.close());
  await wait(400);
  assert.equal(p.w.__likeRequests, 1);
  assert.deepEqual(p.alerts, [EXPIRED_MSG]);
  assert.equal(p.reloads.length, 0);
  assert.equal(p.session('ncc:like-intent'), null);
});

test('already liked after reload: nothing is clicked (no accidental unlike)', async t => {
  const intent = JSON.stringify({ cid: '31780162_648', wantOn: true, at: Date.now() });
  const liked = ARTICLE_LIKE.replace('id="like" class="like_no u_likeit_list_btn _button"', 'id="like" class="like_no u_likeit_list_btn _button on"').replace('data-type="like" aria-pressed="false"><span', 'data-type="like" aria-pressed="true"><span');
  const p = await page({ session: { 'ncc:like-intent': intent }, html: liked });
  t.after(() => p.dom.window.close());
  await wait(400);
  assert.equal(p.w.__likeRequests, 0);
  assert.equal(p.get('like').getAttribute('aria-pressed'), 'true');
  assert.equal(p.session('ncc:like-intent'), null);
});

test('other like errors keep the normal alert; unrelated alerts are untouched', async t => {
  const p = await page({ fail: '본인 글에는 좋아요를 할 수 없습니다.' });
  t.after(() => p.dom.window.close());
  p.get('like').click();
  await wait(80);
  assert.deepEqual(p.alerts, ['본인 글에는 좋아요를 할 수 없습니다.']);
  assert.equal(p.reloads.length, 0);
  assert.equal(p.store.data['like:last'].handled, false);
  p.w.alert('다른 알림');
  assert.equal(p.alerts.length, 2);
  // Clicking the like count (member list) is not a like attempt.
  const q = await page({ fail: EXPIRED_MSG });
  t.after(() => q.dom.window.close());
  q.w.document.getElementById('count').click();
  q.w.alert(EXPIRED_MSG);
  assert.deepEqual(q.alerts, [EXPIRED_MSG]);
  assert.equal(q.reloads.length, 0);
});

test('disabled in settings: alert shown, no reload', async t => {
  const store = createStore({ settings: { likeRetry: false } });
  const p = await page({ store, fail: EXPIRED_MSG });
  t.after(() => p.dom.window.close());
  assert.equal(p.w.document.documentElement.hasAttribute('data-ncc-like-retry'), false);
  p.get('like').click();
  await wait(80);
  assert.deepEqual(p.alerts, [EXPIRED_MSG]);
  assert.equal(p.reloads.length, 0);
  await store.local.set({ settings: { likeRetry: true } });
  assert.equal(p.w.document.documentElement.hasAttribute('data-ncc-like-retry'), true);
});

test('a frame without the button leaves the intent for the frame that has it; stale intents are dropped', async t => {
  const intent = JSON.stringify({ cid: '31780162_648', wantOn: true, at: Date.now() });
  const shell = await page({ session: { 'ncc:like-intent': intent }, html: '<div id="app"></div>' });
  t.after(() => shell.dom.window.close());
  await wait(700);
  assert.equal(shell.session('ncc:like-intent'), intent);
  const stale = JSON.stringify({ cid: '31780162_648', wantOn: true, at: Date.now() - 10 * 60 * 1000 });
  const old = await page({ session: { 'ncc:like-intent': stale } });
  t.after(() => old.dom.window.close());
  await wait(400);
  assert.equal(old.w.__likeRequests, 0);
  assert.equal(old.session('ncc:like-intent'), null);
});
