const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { source, createStore, wait } = require('./helpers.cjs');

async function integrated(initial = {}) {
  const store = createStore({settings:{sync:false}, ...initial});
  const dom = new JSDOM(`<table class="article-table"><tbody>
    <tr id="blocked"><td>853</td><td><a id="blocked-link" class="article" href="/f-e/cafes/1/articles/853">차단 글</a></td><td class="p-nick">차단맨</td></tr>
    <tr id="native"><td>852</td><td><button id="blockedArticle852">차단한 멤버의 게시글입니다.</button></td><td></td></tr>
    <tr id="read"><td>851</td><td><a id="read-link" class="article" href="/f-e/cafes/1/articles/851">읽은 글</a></td><td class="p-nick">정상맨</td></tr>
    <tr id="boundary"><td>850</td><td><a id="boundary-link" class="article" href="/f-e/cafes/1/articles/850">차단된 경계</a></td><td class="p-nick">차단맨</td></tr>
    <tr id="normal"><td>849</td><td><a id="normal-link" class="article" href="/f-e/cafes/1/articles/849">보이는 글</a></td><td class="p-nick">정상맨</td></tr>
  </tbody></table>`, {url:'https://cafe.naver.com/f-e/cafes/1/menus/0',runScripts:'outside-only',pretendToBeVisual:true});
  const w = dom.window, clicks = [];
  const observers = [];
  const Observer = w.MutationObserver;
  w.MutationObserver = class extends Observer {
    constructor(callback) { super(callback); observers.push(this); }
  };
  w.chrome = {runtime:{id:'test',onMessage:{addListener() {}}},storage:{local:store.local,onChanged:store.onChanged}};
  w.document.addEventListener('click', e => { e.preventDefault(); clicks.push(e.target.id); });
  // Load the packaged script order, not a hand-wired blocker test double.
  for (const group of JSON.parse(source('manifest.json')).content_scripts) {
    for (const file of group.js.filter(f => /^(core|content|newmark|hotkeys|block-core|block-content)\.js$/.test(f))) w.eval(source(file));
    for (const file of group.css || []) {
      const style = w.document.createElement('style'); style.textContent = source(file); w.document.head.append(style);
    }
  }
  await wait(400);
  return {dom,w,store,clicks,close:()=>{observers.forEach(o=>o.disconnect());w.close();},get:id=>w.document.getElementById(id),hidden:id=>w.getComputedStyle(w.document.getElementById(id)).display==='none'};
}

test('checker alone hides native notices and nickname rows while retaining read badges and navigation', async t => {
  const h = await integrated({cafeQuietSettings:{blocked:['차단맨']},'r:c:1:851':1});
  t.after(()=>h.close());
  assert.ok(h.hidden('native'));
  assert.ok(h.hidden('blocked'));
  assert.ok(!h.hidden('read'));
  assert.equal(h.get('read-link').getAttribute('data-ncc-read'),'title');
  h.w.document.body.dispatchEvent(new h.w.KeyboardEvent('keydown',{code:'KeyN',bubbles:true,cancelable:true}));
  assert.deepEqual(h.clicks,['normal-link'], 'unread shortcut must skip blocked rows');
  await h.store.local.set({settings:{enabled:false,sync:false}}); await wait(200);
  assert.ok(!h.hidden('native')); assert.ok(!h.hidden('blocked'));
  await h.store.local.set({settings:{enabled:true,sync:false}}); await wait(200);
  assert.ok(h.hidden('native')); assert.ok(h.hidden('blocked'));
  await h.store.local.set({cafeQuietSettings:{enabled:false,blocked:['차단맨']}}); await wait(200);
  assert.ok(!h.hidden('native')); assert.ok(!h.hidden('blocked'));
  assert.equal(h.get('read-link').getAttribute('data-ncc-read'),'title');
});

test('native hiding works with an empty block list but respects a disabled checker at startup', async t => {
  const h = await integrated({settings:{enabled:false,sync:false}});
  t.after(()=>h.close());
  assert.ok(!h.hidden('native'));
  await h.store.local.set({settings:{enabled:true,sync:false}}); await wait(200);
  assert.ok(h.hidden('native'));
  assert.ok(!h.hidden('blocked'));
});

test('new-post divider counts visible posts and moves off hidden rows when blocking changes', async t => {
  const h = await integrated({cafeQuietSettings:{blocked:['차단맨']},'v:1:0':{mark:850,latest:853,at:Date.now(),markAt:Date.now()}});
  t.after(()=>h.close());
  assert.ok(h.get('normal').hasAttribute('data-ncc-new-boundary'));
  assert.match(h.get('normal').cells[0].getAttribute('data-ncc-new-label'),/새 글 1개/);
  await h.store.local.set({cafeQuietSettings:{enabled:false,blocked:['차단맨']}}); await wait(250);
  assert.ok(h.get('boundary').hasAttribute('data-ncc-new-boundary'));
  assert.ok(!h.get('normal').hasAttribute('data-ncc-new-boundary'));
  assert.match(h.get('boundary').cells[0].getAttribute('data-ncc-new-label'),/새 글 2개/);
});
