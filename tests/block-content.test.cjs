const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const C = require('../extension/block-core.js');
const source = file => fs.readFileSync(path.join(__dirname, '../extension', file), 'utf8');
const isHidden = el => !!el.closest('[data-cafe-quiet-hidden="true"]');
const nativeFixture = () => fs.readFileSync(path.join(__dirname, 'fixtures/native-blocked.html'), 'utf8');

async function setup(html, prefs = { blocked:['차단맨'] }) {
  const dom = new JSDOM(`<body>${html}</body>`, { url:'https://cafe.naver.com/test', runScripts:'outside-only', pretendToBeVisual:true });
  const w = dom.window;
  let state = C.settings(prefs), messages = [], listeners = [], runtimeListener, frames = [], shadows = [];
  w.requestAnimationFrame = fn => { frames.push(fn); return frames.length; };
  const attach = w.Element.prototype.attachShadow;
  w.Element.prototype.attachShadow = function(options) { const shadow = attach.call(this, options); shadows.push(shadow); return shadow; };
  w.chrome = {
    storage: { local: { get: async () => ({[C.KEY]:state}) }, onChanged: { addListener:fn => listeners.push(fn), removeListener:fn => { listeners = listeners.filter(f=>f!==fn); } } },
    runtime: {
      onMessage:{addListener:fn => {runtimeListener=fn;}},
      sendMessage:async message => { messages.push(message); state=C.update(state,message.action); return {ok:true,state}; }
    }
  };
  w.eval(source('block-core.js')); w.eval(source('block-content.js'));
  async function flush() {
    for (let i=0;i<6;i++) { await Promise.resolve(); const batch=frames; frames=[]; batch.forEach(fn=>fn()); }
  }
  await flush();
  return { dom,w,messages,shadows,flush,
    change:async prefs => {state=C.settings(prefs); listeners.forEach(fn=>fn({[C.KEY]:{newValue:state}},'local')); await flush();},
    context:async selection => {runtimeListener({type:'cafe-quiet-context-block',selection},{},()=>{}); await flush();},
    get: id => w.document.getElementById(id)
  };
}

test('hides full PC rows and cards, keeps prefix names and unrelated rows', async t => {
  const h=await setup(`<table><tbody><tr id="bad"><td>비밀 제목</td><td class="p-nick">차단맨</td></tr><tr id="good"><td>좋은 제목</td><td class="p-nick">차단맨팬</td></tr></tbody></table><div class="ArticleCard" id="card"><a>사진 제목</a><span class="nickname">차단맨</span></div><ul class="search_list"><li id="search"><b>검색 결과</b><span class="nick">차단맨</span></li></ul>`);
  t.after(()=>h.dom.window.close());
  for (const id of ['bad','card','search']) assert.ok(isHidden(h.get(id)),id);
  assert.ok(!isHidden(h.get('good')));
  await h.change({blocked:[]});
  assert.equal(h.w.document.querySelectorAll('[data-cafe-quiet-hidden]').length,0);
});

test('blocked comment does not hide the article or siblings; handles legacy comments and replies', async t => {
  const h=await setup(`<div class="ArticleContentBox" id="article"><div class="WriterInfo"><button class="nickname">정상맨</button></div><p id="body">원글</p><ul><li class="CommentItem" id="bad"><a class="comment_nickname">차단맨</a><p>댓글</p></li><li class="CommentItem" id="good"><a class="comment_nickname">정상맨</a><p>좋은 댓글</p><ul><li class="CommentReplyItem" id="reply"><a class="comment_nickname">차단맨</a><p>답글</p></li></ul></li></ul></div><ul id="cmt_list"><li id="legacy"><span class="pers_nick_area"><a onclick="ui(event)">차단맨</a></span><p>구형 댓글</p></li></ul>`);
  t.after(()=>h.dom.window.close());
  for (const id of ['bad','reply','legacy']) assert.ok(isHidden(h.get(id)),id);
  for (const id of ['article','body','good']) assert.ok(!isHidden(h.get(id)),id);
});

test('hides blocked article, mobile list item, membership entry and isolated menu name', async t => {
  const h=await setup(`<div class="ArticleContentBox" id="article"><div class="WriterInfo"><span class="nickname">차단맨</span></div><h1>제목</h1><p>내용</p></div><ul class="article_list"><li id="mobile"><b>모바일 글</b><div class="user_area"><span class="ellip">차단맨</span></div></li></ul><ul class="member_list"><li id="member"><span class="nick">차단맨</span><b>회원 등급</b></li></ul><div id="menu">차단맨</div><p id="mention">차단맨 이야기가 나옵니다</p><textarea id="editor">차단맨</textarea>`);
  t.after(()=>h.dom.window.close());
  for (const id of ['article','mobile','member','menu']) assert.ok(isHidden(h.get(id)),id);
  for (const id of ['mention','editor']) assert.ok(!isHidden(h.get(id)),id);
});

test('reconciles inserted nodes, recycled authors, ancestor class changes and pause/resume', async t => {
  const h=await setup('<ul class="article_list" id="items"></ul>');
  t.after(()=>h.dom.window.close());
  h.get('items').innerHTML='<li id="row"><span class="nickname" id="nick">차단맨</span><b>제목</b></li>';
  await h.flush(); assert.ok(isHidden(h.get('row')));
  h.get('nick').firstChild.textContent='정상맨';
  await h.flush(); assert.ok(!isHidden(h.get('row')));
  h.get('nick').setAttribute('data-nickname','차단맨');
  await h.flush(); assert.ok(isHidden(h.get('row')));
  await h.change({enabled:false,blocked:['차단맨']}); assert.ok(!isHidden(h.get('row')));
  await h.change({enabled:true,blocked:['차단맨']}); assert.ok(isHidden(h.get('row')));
  h.get('row').remove(); await h.flush();
  assert.equal(h.w.document.querySelectorAll('[data-cafe-quiet-hidden]').length,0);
});

test('hover quick block and undo work without changing the site nickname', async t => {
  const h=await setup('<table><tr id="row"><td>제목</td><td class="p-nick" id="nick">정상맨</td></tr></table>');
  t.after(()=>h.dom.window.close());
  h.get('nick').dispatchEvent(new h.w.Event('pointerover',{bubbles:true}));
  const shadow=h.shadows[0]; assert.ok(shadow);
  assert.equal(shadow.getElementById('block').hidden,false);
  shadow.getElementById('block').click(); await h.flush();
  assert.ok(isHidden(h.get('row')));
  assert.equal(h.get('nick').textContent,'정상맨');
  assert.ok(!shadow.getElementById('undo').hidden);
  shadow.getElementById('undo').click(); await h.flush();
  assert.ok(!isHidden(h.get('row')));
  await h.change({quickBlock:false,blocked:[]});
  h.get('nick').dispatchEvent(new h.w.Event('pointerover',{bubbles:true}));
  assert.ok(shadow.getElementById('block').hidden);
});

test('right click author or selected nickname blocks; blank context and multiline selection do not', async t => {
  const h=await setup('<span class="nickname" id="nick">우클릭맨</span>');
  t.after(()=>h.dom.window.close());
  await h.context(''); assert.equal(h.messages.length,0);
  h.get('nick').dispatchEvent(new h.w.Event('contextmenu',{bubbles:true}));
  await h.context(''); assert.ok(isHidden(h.get('nick')));
  await h.context('선택맨'); assert.equal(h.messages.at(-1).action.names[0],'선택맨');
  const before=h.messages.length;
  await h.context('여러\n사람'); assert.equal(h.messages.length,before);
});

test('hostile nickname stays text and save errors do not hide content', async t => {
  const h=await setup('<span class="nickname" id="nick">&lt;img src=x onerror=alert(1)&gt;</span>',{blocked:[]});
  t.after(()=>h.dom.window.close());
  h.w.chrome.runtime.sendMessage=async()=>({ok:false,error:'저장 실패'});
  h.get('nick').dispatchEvent(new h.w.Event('pointerover',{bubbles:true}));
  const shadow=h.shadows[0]; shadow.getElementById('block').click(); await h.flush();
  assert.ok(!isHidden(h.get('nick')));
  assert.equal(shadow.querySelectorAll('img').length,0);
  assert.equal(shadow.getElementById('message').textContent,'저장 실패');
});

test('decorated and truncated author labels match without hiding another author’s embedded widget', async t => {
  const h=await setup('<div class="ArticleContentBox" id="article"><div class="WriterInfo"><span class="nickname">정상맨</span></div><aside><span class="nickname" id="widget">차단맨</span></aside></div><table><tr id="decorated"><td><a class="nickname">차단맨<span class="blind">프로필 보기</span></a></td></tr><tr id="short"><td><a class="nickname" title="차단맨">차단…</a></td></tr></table>');
  t.after(()=>h.dom.window.close());
  assert.ok(!isHidden(h.get('article'))); assert.ok(isHidden(h.get('widget')));
  assert.ok(isHidden(h.get('decorated'))); assert.ok(isHidden(h.get('short')));
  h.get('short').querySelector('a').title='정상맨'; await h.flush();
  assert.ok(!isHidden(h.get('short')));
});

test('newsickminza current mobile home, split article body, comments, related cards and PC manager', async t => {
  // Minimal markup based on public pages inspected 2026-09-12, with invented names/content.
  const h=await setup(`<a class="id mlink gm-tcol-c" id="manager"><div class="ellipsis"><div class="ellipsis">차단맨</div></div></a>
    <div class="MultiLinkWrap ArticleListItem" id="home"><a class="mainLink"><div class="HeadlineTextBox">목록 제목</div><div class="SupportingTextBox"><span class="SupportingText is_ellips"><span class="text"> 차단맨 </span></span></div></a><div class="subLinkSlot">댓글 3</div></div>
    <div id="ct"><div><div class="post_title" id="title"><h2>숨길 제목</h2><div class="user_wrap"><div class="info_wrap"><div class="info"><a class="nick"><span class="end_user_nick"><span class="ellip">차단맨</span></span></a></div></div></div></div></div><div id="postContent" class="post_cont">숨길 본문</div>
    <div class="comment_item" id="comment"><div class="comment_inner"><div class="comment_header"><a class="user"><span class="thumb">프로필</span><span class="nick_name"><span class="ellip">차단맨</span></span></a></div><p>숨길 댓글</p></div></div>
    <div class="comment_item" id="other"><span class="nick_name">정상맨</span><p>유지할 댓글</p></div>
    <a class="LinkWrap type_flex" data-nlog-area="recommend_feed.item" id="related"><div class="contentSlot"><div class="HeadlineTextBox">추천글 제목</div><div class="SupportingTextBox"><span class="SupportingText is_ellips"><span class="text"> 차단맨 </span></span></div></div></a></div>`);
  t.after(()=>h.dom.window.close());
  for (const id of ['manager','home','title','postContent','comment','related']) assert.ok(isHidden(h.get(id)),id);
  assert.ok(!isHidden(h.get('ct')));assert.ok(!isHidden(h.get('other')));
  await h.change({blocked:[]});
  for (const id of ['manager','home','title','postContent','comment','related']) assert.ok(!isHidden(h.get(id)),id);
});

test('PC bottom board list hides the entire related row inside Article, not just the nickname', async t => {
  const h=await setup(`<div id="app"><div class="Article" id="shell"><div class="ArticleContentBox" id="article"><div class="WriterInfo"><button class="nickname">정상맨</button></div><p>현재 글</p></div>
    <section id="board"><h2>자유게시판 게시판 글</h2><ul>
      <li id="above"><a href="/ArticleRead.nhn?articleid=462">윗글</a><button id="Related4620">정상맨</button><span>12:13</span></li>
      <li id="blocked"><div><a href="/ArticleRead.nhn?articleid=461">숨길 제목</a></div><div><button id="Related4611"><span class="nickname">차단맨</span></button></div><span>04:58</span></li>
      <li id="below"><a href="/ArticleRead.nhn?articleid=460">유지할 제목</a><button id="Related4602">다른사람</button><span>01:23</span></li>
    </ul><nav id="paging">1 2 3 전체보기</nav></section></div></div>`);
  t.after(()=>h.dom.window.close());
  assert.ok(isHidden(h.get('blocked')), 'title, author and date must disappear together');
  for (const id of ['app','shell','article','board','above','below','paging']) assert.ok(!isHidden(h.get(id)),id);
  await h.change({blocked:[]}); assert.ok(!isHidden(h.get('blocked')));
  await h.change({blocked:['차단맨']}); assert.ok(isHidden(h.get('blocked')));
  h.get('Related4611').textContent='정상맨'; await h.flush();
  assert.ok(!isHidden(h.get('blocked')), 'pagination can reuse the same row for a different writer');
});

test('Related author buttons in div rows hide only their shared title row and update on pagination', async t => {
  const h=await setup(`<div id="app"><div class="Article" id="shell"><div class="WriterInfo"><button class="nickname">정상맨</button></div>
    <section id="board"><div id="blocked"><div><a href="/ca-fe/cafes/1/articles/11">차단 글</a></div><div><button id="Related110">차단맨</button></div><time>04:58</time></div>
    <div id="good"><a href="/ca-fe/cafes/1/articles/12">다른 글</a><button id="Related121">정상맨</button></div><nav id="paging">1 2 3</nav></section></div></div>`);
  t.after(()=>h.dom.window.close());
  assert.ok(isHidden(h.get('blocked')));
  for (const id of ['app','board','good','paging']) assert.ok(!isHidden(h.get(id)),id);
  h.get('board').insertAdjacentHTML('afterbegin','<div id="new"><a href="/ArticleRead.nhn?articleid=13">추가 글</a><button id="Related130">차단맨</button></div>');
  await h.flush(); assert.ok(isHidden(h.get('new')));
  await h.change({enabled:false,blocked:['차단맨']});
  assert.ok(!isHidden(h.get('blocked'))); assert.ok(!isHidden(h.get('new')));
});

test('unrecognized related row must not collapse an entire list containing several authors', async t => {
  const h=await setup('<div id="board"><h2>글 목록</h2><div><button id="Related110">차단맨</button></div><div><a href="/ArticleRead.nhn?articleid=12">다른 사람 글</a><button id="Related121">정상맨</button></div></div>');
  t.after(()=>h.dom.window.close());
  assert.ok(!isHidden(h.get('board')));
  assert.ok(!isHidden(h.get('Related121')));
});

test('actual Naver related list uses anchor role=button: hide whole row and preserve neighbors', async t => {
  const html=fs.readFileSync(path.join(__dirname,'fixtures/related-articles.html'),'utf8');
  const h=await setup(html); t.after(()=>h.dom.window.close());
  assert.equal(h.get('Related4611').tagName,'A');
  assert.ok(isHidden(h.get('Related4611')), 'nickname matches');
  assert.ok(isHidden(h.get('row-blocked')), 'whole row must hide, not just the anchor');
  for (const id of ['main-article','related-board','row-above','row-below','related-paging']) assert.ok(!isHidden(h.get(id)),id);
  await h.change({blocked:[]}); assert.ok(!isHidden(h.get('row-blocked')));
  await h.change({blocked:['차단맨']}); assert.ok(isHidden(h.get('row-blocked')));
  h.get('Related4611').textContent='정상 작성자'; await h.flush();
  assert.ok(!isHidden(h.get('row-blocked')));
  h.get('row-blocked').querySelector('.tit').href='#';
  h.get('Related4611').textContent='차단맨'; await h.flush();
  assert.ok(isHidden(h.get('row-blocked')), 'restricted-board links use # and still need row hiding');
});

test('quick block detects the real related member link and restores its row on undo', async t => {
  const html=fs.readFileSync(path.join(__dirname,'fixtures/related-articles.html'),'utf8');
  const h=await setup(html,{blocked:[]}); t.after(()=>h.dom.window.close());
  h.get('Related4611').dispatchEvent(new h.w.Event('pointerover',{bubbles:true}));
  const shadow=h.shadows[0]; assert.ok(shadow, 'anchor must be recognized as an author');
  shadow.getElementById('block').click(); await h.flush();
  assert.ok(isHidden(h.get('row-blocked')));
  shadow.getElementById('undo').click(); await h.flush();
  assert.ok(!isHidden(h.get('row-blocked')));
});

test('native blocked rows disappear without nicknames or a local block list; normal titles remain', async t => {
  const h = await setup(nativeFixture(), {blocked:[]});
  t.after(() => h.dom.window.close());
  assert.ok(isHidden(h.get('native-blocked')), 'native placeholder must hide the entire row');
  for (const id of ['board','normal-row','quoted-title','paging']) assert.ok(!isHidden(h.get(id)), id);
  await h.change({enabled:false, blocked:[]});
  assert.ok(!isHidden(h.get('native-blocked')), 'pause restores the native notice');
  await h.change({enabled:true, blocked:[]});
  assert.ok(isHidden(h.get('native-blocked')));
});

test('native blocking after render stays hidden and recycled normal rows are restored', async t => {
  const h = await setup(nativeFixture());
  t.after(() => h.dom.window.close());
  const row = h.get('normal-row');
  row.querySelector('.p-nick').textContent = '차단맨';
  await h.flush();
  assert.ok(isHidden(row));
  row.innerHTML = '<td>849</td><td><button id="blockedArticle849">차단한 멤버의 게시글입니다.</button></td><td></td><td>12:56</td>';
  await h.flush();
  assert.ok(isHidden(row), 'removing the author must not reveal a previously hidden row');
  row.innerHTML = '<td>847</td><td><a class="article" href="/f-e/cafes/31780162/articles/847">다음 페이지 정상 글</a></td><td class="p-nick">정상맨</td>';
  await h.flush();
  assert.ok(!isHidden(row));
  h.get('rows').insertAdjacentHTML('beforeend', '<tr id="late-native"><td><button id="blockedArticle846">차단한 멤버의 게시글입니다.</button></td></tr>');
  await h.flush();
  assert.ok(isHidden(h.get('late-native')));
});

test('native blocked cards, article notices and comments hide only their own units', async t => {
  const h = await setup(`<ul class="article-card-view" id="cards"><li class="item" id="card-native"><button id="blockedArticle10">차단한 멤버의 게시글입니다.</button></li><li class="item" id="card-normal">정상 글</li></ul>
    <ul class="article-album-view"><li class="item" id="album-native"><button id="blockedArticle11">차단한 멤버의 게시글입니다.</button></li></ul>
    <div class="ArticleContentBox" id="native-article"><p class="blocked_article_notice">차단한 멤버의 게시글입니다.</p></div>
    <div class="ArticleContentBox" id="normal-article"><div class="WriterInfo"><span class="nickname">정상맨</span></div><p id="quote">차단한 멤버의 게시글입니다.</p><ul>
      <li class="CommentItem" id="native-comment"><div class="comment_box"><p class="comment_deleted">차단한 멤버의 댓글입니다.</p><button>더보기</button></div></li>
      <li class="CommentItem" id="deleted-comment"><p class="comment_deleted">삭제된 댓글입니다.</p></li>
      <li class="CommentItem" id="normal-comment"><span class="comment_nickname">정상맨</span><p>차단한 멤버의 댓글입니다.</p></li></ul></div>
    <div contenteditable="true" id="editor"><button id="blockedArticle12">차단한 멤버의 게시글입니다.</button></div>`, {blocked:[]});
  t.after(() => h.dom.window.close());
  for (const id of ['card-native','album-native','native-article','native-comment']) assert.ok(isHidden(h.get(id)), id);
  for (const id of ['cards','card-normal','normal-article','quote','deleted-comment','normal-comment','editor']) assert.ok(!isHidden(h.get(id)), id);
});

test('read badges and new-post divider coexist with native blocking', async t => {
  const checkerRoot = path.join(__dirname, '../extension');
  if (!fs.existsSync(checkerRoot)) return t.skip('Optional sibling naver-cafe-checker is not present');
  const h = await setup(nativeFixture(), {blocked:[]});
  t.after(() => h.dom.window.close());
  h.dom.reconfigure({url:'https://cafe.naver.com/f-e/cafes/31780162/menus/0'});
  const checkerData = {'r:c:31780162:849':1, 'v:31780162:0':{mark:848,latest:849,at:Date.now(),markAt:Date.now()}};
  const checkerChrome = {
    runtime:{id:'checker-test'},
    storage:{local:{get:async () => checkerData, set:async values => Object.assign(checkerData, values)},onChanged:{addListener:()=>{}}}
  };
  h.w.eval(fs.readFileSync(path.join(checkerRoot, 'core.js'), 'utf8'));
  for (const file of ['content.js','newmark.js']) {
    h.w.Function('chrome', fs.readFileSync(path.join(checkerRoot, file), 'utf8'))(checkerChrome);
  }
  for (let i=0; i<50 && !h.get('quoted-title').hasAttribute('data-ncc-new-boundary'); i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
    await h.flush();
  }
  assert.equal(h.get('normal-title').getAttribute('data-ncc-read'), 'title');
  assert.ok(h.get('quoted-title').hasAttribute('data-ncc-new-boundary'));
  assert.ok(isHidden(h.get('native-blocked')));
  assert.ok(!isHidden(h.get('normal-row')));
  // Both extensions' styles must preserve row hiding regardless of stylesheet order.
  for (const css of [source('block-content.css'), fs.readFileSync(path.join(checkerRoot,'content.css'),'utf8'), source('block-content.css')]) {
    const style = h.w.document.createElement('style'); style.textContent = css; h.w.document.head.append(style);
  }
  assert.equal(h.w.getComputedStyle(h.get('native-blocked')).display, 'none');
});
