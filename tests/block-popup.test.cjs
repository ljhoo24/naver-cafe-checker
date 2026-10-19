const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const C = require('../extension/block-core.js');
const source=name=>fs.readFileSync(path.join(__dirname,'../extension',name),'utf8');

async function setup() {
  const dom=new JSDOM(source('blocklist.html'),{runScripts:'outside-only',url:'https://extension.test'});
  const w=dom.window; let state=C.settings(),listener;
  w.chrome={ storage:{local:{get:async()=>({[C.KEY]:state})},onChanged:{addListener:fn=>listener=fn}},
    runtime:{sendMessage:async message=>{state=C.update(state,message.action);return {ok:true,state};}} };
  w.eval(source('block-core.js')); w.eval(source('blocklist.js'));
  const flush=async()=>{for(let i=0;i<6;i++) await Promise.resolve();}; await flush();
  return {dom,w,flush,get:id=>w.document.getElementById(id),master:async enabled=>{listener({settings:{newValue:{enabled}}},'local');await flush();},change:async prefs=>{state=C.settings(prefs);listener({[C.KEY]:{newValue:state}},'local');await flush();}};
}

test('block manager explains when checker master switch pauses hiding', async t => {
  const h=await setup(); t.after(()=>h.dom.window.close());
  await h.master(false);
  assert.match(h.get('summary').textContent,/전체 사용.*꺼져/);
  await h.master(true);
  assert.match(h.get('summary').textContent,/숨김 켜짐/);
});
test('popup batch add, duplicate handling, search, removal and preferences',async t=>{
  const h=await setup();t.after(()=>h.dom.window.close());
  h.get('names').value='가나다\n라마바\n가나다';
  h.get('add-form').dispatchEvent(new h.w.Event('submit',{cancelable:true,bubbles:true}));
  await h.flush();assert.equal(h.get('count').textContent,'2');assert.equal(h.get('names').value,'');
  h.get('search').value='라마';h.get('search').dispatchEvent(new h.w.Event('input'));
  assert.equal(h.get('list').children.length,1);
  h.get('list').querySelector('button').click();await h.flush();assert.equal(h.get('count').textContent,'1');
  h.get('enabled').checked=false;h.get('enabled').dispatchEvent(new h.w.Event('change'));await h.flush();
  assert.match(h.get('summary').textContent,/일시 중지/);
  await h.change({blocked:['<img src=x onerror=alert(1)>']});
  h.get('search').value='';h.get('search').dispatchEvent(new h.w.Event('input'));
  assert.equal(h.get('list').querySelectorAll('img').length,0);
});
test('popup displays errors and preserves text for retry',async t=>{
  const h=await setup();t.after(()=>h.dom.window.close());
  h.w.chrome.runtime.sendMessage=async()=>({ok:false,error:'저장 오류'});
  h.get('names').value='저장맨';h.get('add-form').dispatchEvent(new h.w.Event('submit',{cancelable:true}));
  await h.flush();assert.equal(h.get('count').textContent,'0');assert.equal(h.get('names').value,'저장맨');
  assert.equal(h.get('status').textContent,'저장 오류');assert.equal(h.get('add').disabled,false);
});

test('import merges valid JSON and rejects malformed entries without losing the list',async t=>{
  const h=await setup();t.after(()=>h.dom.window.close());
  await h.change({blocked:['기존맨']});
  const input=h.get('import-file');
  Object.defineProperty(input,'files',{configurable:true,value:[{size:100,text:async()=>JSON.stringify({blocked:['기존맨','신규맨']})}]});
  input.dispatchEvent(new h.w.Event('change'));await h.flush();assert.equal(h.get('count').textContent,'2');
  Object.defineProperty(input,'files',{configurable:true,value:[{size:100,text:async()=>JSON.stringify({blocked:['추가맨',{}]})}]});
  input.dispatchEvent(new h.w.Event('change'));await h.flush();assert.equal(h.get('count').textContent,'2');
  assert.match(h.get('status').textContent,/가져오기 실패/);
});
