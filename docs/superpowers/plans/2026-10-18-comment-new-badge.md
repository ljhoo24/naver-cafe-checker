# 읽은 글 새 댓글 표시 (`+N`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 읽은 글의 댓글 수가 마지막으로 봤을 때보다 늘었으면 PC 게시판 목록의 댓글 수 링크 옆에 `+N`을 표시한다.

**Architecture:** 기준 댓글 수를 `chrome.storage.local`의 `k:` 키(읽음 키 `r:`와 1:1)에 저장한다. `content.js`가 목록 클릭과 글 화면 `댓글 N`에서 기준을 기록하고, scan에서 목록 댓글 수와 비교해 링크에 `data-ncc-cmt-new` 속성을 붙인다. 화면 표시는 CSS `::after`가 한다. `background.js`가 읽음 기록 삭제 시 짝 `k:` 키를 지운다. 동기화(`sync.js`)는 바꾸지 않는다.

**Tech Stack:** Chrome Extension MV3, 순수 JS(빌드 없음), 테스트는 `node --test` + jsdom.

**Spec:** `docs/superpowers/specs/2026-10-18-comment-new-badge-design.md`

---

## 알아둘 것

- 테스트 실행: `npm test`(전체, 약 30초), 파일 하나는 `node --test tests/<name>.test.cjs`. 문법·매니페스트 검사는 `npm run check`.
- 시작 시점 기준선: `npm test` 결과 61개 모두 통과.
- `tests/helpers.cjs`의 `page(html, { url, store })`가 jsdom 창에 `core.js`·`content.js`를 올리고 120ms 기다린다. `h.settle()`은 다시 120ms 대기(scan 디바운스 60ms). 여러 `page`가 같은 `store`를 쓰면 같은 프로필의 여러 탭처럼 `onChanged`가 전달된다.
- `content.js`의 `kind(a)`: 링크 텍스트가 `[3]`, `(1,234)`, `12` 같은 숫자면 `'extra'`(댓글 수 링크), 텍스트가 없고 이미지면 `'media'`, 나머지 `'title'`. 같은 행의 두 번째 제목 링크도 `'extra'`가 되지만 텍스트가 숫자가 아니라서 `parseCount`가 `null`을 돌려 이 기능에서는 제외된다.
- 사이트 요소에는 속성만 붙이고 새 요소를 넣지 않는다(기존 원칙).
- 커밋 메시지는 영어, `feat:`/`fix:`/`docs:`/`chore:` 형식. 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 줄을 붙인다.
- 작업 브랜치: `feat/comment-new-badge`(이미 있음).

## 파일 구조

| 파일 | 책임 | 변경 |
|---|---|---|
| `extension/core.js` | 공용 순수 함수·상수 | `COMMENTS`, `parseCount`, `commentKey`, `orphanCommentKeys`, `fromStorage().bases`, `DEFAULTS.cmtNew` |
| `extension/background.js` | 저장소 정리 | `r:` 삭제 시 `k:` 삭제, `prune()`에서 짝 없는 `k:` 삭제 |
| `extension/content.js` | 목록 표시·읽음 기록 | 기준 표 `bases`, 기준 기록, `data-ncc-cmt-new`, 루트 플래그 `data-ncc-cmt` |
| `extension/content.css` | 표시 | `+N` 스타일 |
| `extension/popup.html`, `popup.js`, `popup.css` | 설정 창 | `cmtNew` 체크박스 |
| `tests/core.test.cjs`, `tests/background.test.cjs`, `tests/popup.test.cjs` | 기존 테스트 | 테스트 추가 |
| `tests/cmtnew.test.cjs` | 새 테스트 | 목록·글 화면 동작 |
| `README.md` | 사용자 문서 | 기능 설명·변경 사항·저장 |

---

### Task 1: core.js 헬퍼

**Files:**
- Modify: `extension/core.js`
- Test: `tests/core.test.cjs`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/core.test.cjs` 맨 끝에 추가:

```js
test('comment counts, baseline keys and the new-comment setting', () => {
  assert.equal(C.parseCount('[5]'), 5);
  assert.equal(C.parseCount(' ( 1,234 ) '), 1234);
  assert.equal(C.parseCount('12'), 12);
  assert.equal(C.parseCount('댓글 7'), 7);
  assert.equal(C.parseCount('댓글7'), 7);
  assert.equal(C.parseCount('댓글'), null);
  assert.equal(C.parseCount('댓글 3개 남겨주세요'), null);
  assert.equal(C.parseCount('첫 번째 글'), null);
  assert.equal(C.parseCount('[,]'), null);
  assert.equal(C.parseCount(''), null);
  assert.equal(C.commentKey('r:c:1:2'), 'k:c:1:2');
  assert.equal(C.commentKey('r:u:foo:9'), 'k:u:foo:9');
  assert.equal(C.settings({}).cmtNew, true);
  assert.equal(C.settings({ cmtNew: false }).cmtNew, false);
  const state = C.fromStorage({ 'r:c:1:2': 5, 'k:c:1:2': 3, 'k:c:1:3': 'x', 'k:c:1:4': -1, 'k:c:1:5': 0 });
  assert.deepEqual([...state.reads], ['r:c:1:2']);
  assert.deepEqual([...state.bases], [['k:c:1:2', 3], ['k:c:1:5', 0]]);
  assert.deepEqual(C.orphanCommentKeys({ 'r:c:1:2': 5, 'k:c:1:2': 3, 'k:u:foo:9': 1, 'a:foo': '1' }), ['k:u:foo:9']);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/core.test.cjs`
Expected: 새 테스트 FAIL, `C.parseCount is not a function`.

- [ ] **Step 3: 구현**

`extension/core.js` 맨 위 저장 구조 주석에서

```js
//   v:<cafeId> -> timestamp                  last activity in the cafe (keeps a visit going)
//   settings -> { enabled, dim, badge, sync, likeRetry, newMark, visitGap, hotkeys, <hotkey names> }
```

를 다음으로 바꾼다:

```js
//   v:<cafeId> -> timestamp                  last activity in the cafe (keeps a visit going)
//   k:c:<cafeId>:<articleId> -> count        comment count when the article was last seen;
//   k:u:<cafeUrl>:<articleId> -> count       paired with the r: key of the same suffix (local only)
//   settings -> { enabled, dim, badge, cmtNew, sync, likeRetry, newMark, visitGap, hotkeys, <hotkey names> }
```

상수: `const ALIAS = 'a:';` 바로 아래에 추가:

```js
  const COMMENTS = 'k:';
  // "[5]", "(1,234)", "12" in a list row; "댓글 7" on an article page.
  const COUNT = /^(?:댓글\s*)?[\[(]?\s*(\d[\d,]{0,8})\s*[\])]?$/;
```

`DEFAULTS`에서 `enabled: true, dim: true, badge: true, sync: true,`를 `enabled: true, dim: true, badge: true, cmtNew: true, sync: true,`로 바꾼다.

`invertAliases` 함수 바로 아래에 추가:

```js
  // Number shown by a comment count, or null when the text is not one.
  function parseCount(text) {
    const m = COUNT.exec(String(text || '').replace(/\s+/g, ' ').trim());
    if (!m) return null;
    const n = Number(m[1].replace(/,/g, ''));
    return Number.isSafeInteger(n) ? n : null;
  }

  // Comment baseline key paired with a read key: r:c:1:2 -> k:c:1:2.
  function commentKey(readKey) {
    return COMMENTS + readKey.slice(READ.length);
  }

  // Baselines whose read record is gone (removed while nothing cleaned up after it).
  function orphanCommentKeys(items) {
    const all = items || {};
    return Object.keys(all).filter(k => k.startsWith(COMMENTS) && !((READ + k.slice(COMMENTS.length)) in all));
  }
```

`fromStorage`를 다음으로 바꾼다:

```js
  // Splits a chrome.storage dump into { reads:Set, aliases:{}, bases:Map, settings }.
  function fromStorage(items) {
    const reads = new Set();
    const aliases = {};
    const bases = new Map();
    for (const [k, v] of Object.entries(items || {})) {
      if (k.startsWith(READ)) reads.add(k);
      else if (k.startsWith(ALIAS) && DIGITS.test(String(v))) aliases[k.slice(ALIAS.length)] = String(v);
      else if (k.startsWith(COMMENTS) && Number.isSafeInteger(v) && v >= 0) bases.set(k, v);
    }
    return { reads, aliases, bases, settings: settings(items && items[SETTINGS]) };
  }
```

맨 아래 `return { ... }`를 다음으로 바꾼다:

```js
  return {
    READ, ALIAS, COMMENTS, VISIT, VISIT_GAPS, SETTINGS, HOTKEYS, MAX_READS, DEFAULTS,
    settings, isHotkeyCode, keyLabel, cafeRef, parseArticle, isArticleView, storeKey, lookupKeys, invertAliases,
    parseCount, commentKey, orphanCommentKeys, fromStorage, pruneKeys
  };
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/core.test.cjs`
Expected: 모두 PASS.

- [ ] **Step 5: 커밋**

```bash
git add extension/core.js tests/core.test.cjs
git commit -m "feat: comment count helpers and baseline keys in core"
```

---

### Task 2: background.js 기준 정리

**Files:**
- Modify: `extension/background.js`
- Test: `tests/background.test.cjs`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/background.test.cjs`에서 `test('prunes oldest records beyond the limit on startup', ...)` 블록 바로 아래에 추가:

```js
test('comment baselines follow their read records', async () => {
  const bg = load({ settings: { sync: false }, 'r:c:1:1': 1, 'k:c:1:1': 2, 'r:c:1:2': 1, 'k:c:1:2': 5, 'k:c:1:9': 4 });
  bg.hooks.startup();
  await wait(50);
  // Orphan (no r:c:1:9) is pruned; paired baselines stay.
  assert.equal(bg.store.data['k:c:1:9'], undefined);
  assert.equal(bg.store.data['k:c:1:1'], 2);
  assert.equal(bg.store.data['k:c:1:2'], 5);
  // Removing a read record (unread, clear all, sync) removes its baseline.
  await bg.store.local.remove('r:c:1:2');
  await wait(20);
  assert.equal(bg.store.data['k:c:1:2'], undefined);
  assert.equal(bg.store.data['k:c:1:1'], 2);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/background.test.cjs`
Expected: 새 테스트 FAIL (`k:c:1:9`가 남아 있음).

- [ ] **Step 3: 구현**

`extension/background.js`의 `prune`을 다음으로 바꾼다:

```js
async function prune() {
  const items = await chrome.storage.local.get(null);
  const stale = [...C.pruneKeys(items), ...C.orphanCommentKeys(items)];
  if (stale.length) await chrome.storage.local.remove(stale);
}
```

맨 아래 `chrome.storage.onChanged.addListener` 안의 `area === 'local'` 부분을 다음으로 바꾼다(`if (area !== 'local') return;` 다음부터 리스너 끝까지):

```js
  if (area !== 'local') return;
  let dirty = false;
  const baselines = [];
  for (const [k, change] of Object.entries(changes)) {
    if (k.startsWith(C.READ)) {
      dirty = true;
      if (change.oldValue === undefined && change.newValue !== undefined) newReads++;
      // A read record is gone (unread, clear all, prune, sync): its comment baseline goes too.
      if (change.newValue === undefined) baselines.push(C.commentKey(k));
    } else if (k.startsWith(C.ALIAS) || k === S.LOCAL_TOMB || k === S.LOCAL_CLEARED) {
      dirty = true;
    } else if (k === C.SETTINGS && C.settings(change.newValue).sync && !C.settings(change.oldValue).sync) {
      syncNow();
    }
  }
  if (baselines.length) chrome.storage.local.remove(baselines).catch(() => {});
  if (newReads >= PRUNE_EVERY) { newReads = 0; prune().catch(() => {}); }
  if (dirty) scheduleSync().catch(() => {});
});
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/background.test.cjs`
Expected: 모두 PASS (기존 동기화 테스트 포함).

- [ ] **Step 5: 커밋**

```bash
git add extension/background.js tests/background.test.cjs
git commit -m "feat: drop comment baselines with their read records"
```

---

### Task 3: content.js 목록 표시와 처음 보는 행의 기준

**Files:**
- Modify: `extension/content.js`
- Create: `tests/cmtnew.test.cjs`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/cmtnew.test.cjs` 새 파일:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, page } = require('./helpers.cjs');

const LIST_URL = 'https://cafe.naver.com/f-e/cafes/1/menus/0';
const CMT = 'data-ncc-cmt-new';
const list = (n101, n102) => `
<div class="article-board"><table><tbody class="board-list">
  <tr><td><div class="inner_list">
    <a id="t1" class="article" href="/f-e/cafes/1/articles/101?boardtype=L">첫 글</a>
    <a id="c1" class="cmt" href="/f-e/cafes/1/articles/101?commentFocus=true">[${n101}]</a>
  </div></td></tr>
  <tr><td><div class="inner_list">
    <a id="t2" class="article" href="/f-e/cafes/1/articles/102?boardtype=L">둘째 글</a>
    <a id="c2" class="cmt" href="/f-e/cafes/1/articles/102?commentFocus=true">[${n102}]</a>
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
  h.get('c1').textContent = '[6]';
  await h.settle();
  assert.equal(h.get('c1').getAttribute(CMT), '3');
  await store.local.set({ 'k:c:1:101': 6 });
  await h.settle();
  assert.equal(h.get('c1').hasAttribute(CMT), false);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/cmtnew.test.cjs`
Expected: 첫 테스트 FAIL (`data-ncc-cmt-new` 없음), 두·세 번째 FAIL (`k:` 키 없음). 네 번째는 우연히 통과해도 됨.

- [ ] **Step 3: 구현**

`extension/content.js`:

(a) 상수. 

```js
  const ROOT_FLAGS = { dim: 'data-ncc-dim', badge: 'data-ncc-badge' };
```

를 다음으로 바꾼다:

```js
  const ROOT_FLAGS = { dim: 'data-ncc-dim', badge: 'data-ncc-badge', cmtNew: 'data-ncc-cmt' };
  const CMT_NEW = 'data-ncc-cmt-new';
```

(b) 상태. `let urlsById = {};` 아래에 추가:

```js
  // k: comment baseline key -> count when the article was last seen.
  let bases = new Map();
```

(c) `learnAlias` 함수 바로 위(즉 `markRead` 다음)에 추가:

```js
  // --- comments since last seen -----------------------------------------
  // A baseline lives under the k: twin of the article's read key, so only read
  // articles have one.
  function baseKey(article) {
    const read = C.lookupKeys(article, aliases, urlsById).find(k => reads.has(k));
    return read ? C.commentKey(read) : null;
  }
  function setBase(article, count) {
    if (!settings.enabled || !settings.cmtNew || count === null) return;
    const key = baseKey(article);
    if (!key || bases.get(key) === count) return;
    bases.set(key, count);
    save({ [key]: count });
  }
  // New comments on a read list entry. One seen without a baseline gets it now,
  // quietly. A smaller count (another tab's stale list) never lowers it.
  function newComments(article, count) {
    const key = baseKey(article);
    if (!key) return 0;
    if (!bases.has(key)) { setBase(article, count); return 0; }
    return Math.max(0, count - bases.get(key));
  }
```

(d) `scan` 함수 전체를 다음으로 바꾼다:

```js
  function scan() {
    scanTimer = null;
    if (!document.documentElement) return;
    applyRootFlags();
    if (settings.enabled) learnAliasFromPage();
    const badged = new WeakMap();
    for (const a of document.querySelectorAll('a[href]')) {
      const article = settings.enabled ? articleOf(a) : null;
      let value = null;
      let fresh = 0;
      if (article && C.isArticleView(article) && isRead(article)) {
        value = kind(a);
        if (value === 'title') {
          const row = a.closest(ROW) || a.parentElement || a;
          const key = article.cafeId + '|' + article.cafeUrl + '|' + article.articleId;
          const seen = badged.get(row) || new Set();
          if (seen.has(key)) value = 'extra';
          seen.add(key);
          badged.set(row, seen);
        }
        if (value === 'extra' && settings.cmtNew) {
          const count = C.parseCount(a.textContent);
          if (count !== null) fresh = newComments(article, count);
        }
      }
      if (value) { if (a.getAttribute(MARK) !== value) a.setAttribute(MARK, value); }
      else if (a.hasAttribute(MARK)) a.removeAttribute(MARK);
      if (fresh > 0) { if (a.getAttribute(CMT_NEW) !== String(fresh)) a.setAttribute(CMT_NEW, String(fresh)); }
      else if (a.hasAttribute(CMT_NEW)) a.removeAttribute(CMT_NEW);
    }
  }
```

(e) `onStorage` 안에서

```js
      } else if (k === C.SETTINGS) {
```

바로 앞에 분기를 추가한다(앞 분기 `} else if (k.startsWith(C.ALIAS)) { ... }` 의 닫는 괄호 뒤):

```js
      } else if (k.startsWith(C.COMMENTS)) {
        if (Number.isSafeInteger(change.newValue)) bases.set(k, change.newValue); else bases.delete(k);
```

결과 모양:

```js
        aliases = next;
        aliasChanged = true;
      } else if (k.startsWith(C.COMMENTS)) {
        if (Number.isSafeInteger(change.newValue)) bases.set(k, change.newValue); else bases.delete(k);
      } else if (k === C.SETTINGS) {
```

(f) 초기 로드. 파일 끝 `chrome.storage.local.get(null).then(items => {` 블록의 앞부분을 다음 모양으로 만든다(`bases = state.bases;` 한 줄 추가):

```js
  chrome.storage.local.get(null).then(items => {
    const state = C.fromStorage(items);
    reads = state.reads;
    aliases = state.aliases;
    urlsById = C.invertAliases(aliases);
    bases = state.bases;
    settings = state.settings;
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/cmtnew.test.cjs tests/content.test.cjs`
Expected: 모두 PASS.

- [ ] **Step 5: 커밋**

```bash
git add extension/content.js tests/cmtnew.test.cjs
git commit -m "feat: show +N after the comment count of read articles"
```

---

### Task 4: content.js 기준 기록 (목록 클릭, 글 화면)

**Files:**
- Modify: `extension/content.js`
- Test: `tests/cmtnew.test.cjs`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/cmtnew.test.cjs` 맨 끝에 추가:

```js
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

const ARTICLE_URL = 'https://cafe.naver.com/f-e/cafes/1/articles/200?boardtype=L';
const articlePage = top => `
<div class="ArticleContentBox">
  <div class="ArticleTopBtns"><a id="cmtTop" href="?commentFocus=true">${top}</a></div>
  <div class="se-main-container">본문</div>
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
  const a = await page(articlePage('댓글 5'), { store, url: 'https://cafe.naver.com/f-e/cafes/1/articles/101' });
  t.after(() => a.dom.window.close());
  await l.settle();
  assert.equal(store.data['k:c:1:101'], 5);
  assert.equal(l.get('c1').hasAttribute(CMT), false);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/cmtnew.test.cjs`
Expected: 새 테스트 4개 중 "without a comment count" 외 3개 FAIL (`k:` 값이 기대와 다르거나 없음).

- [ ] **Step 3: 구현**

`extension/content.js`:

(a) Task 3에서 넣은 `newComments` 함수 바로 아래에 추가:

```js
  // Comment count shown in the same list row as `a`, e.g. "[5]".
  function rowCount(a, article) {
    const row = a.closest(ROW) || a.parentElement;
    if (!row) return null;
    for (const link of row.querySelectorAll('a[href]')) {
      const other = articleOf(link);
      const count = other && sameArticle(other, article) && kind(link) === 'extra' ? C.parseCount(link.textContent) : null;
      if (count !== null) return count;
    }
    return null;
  }
  // "댓글 5" button on the article page itself.
  function articleCount() {
    for (const el of document.querySelectorAll('a, button')) {
      const text = el.textContent.replace(/\s+/g, ' ').trim();
      if (!text.startsWith('댓글')) continue;
      const count = C.parseCount(text);
      if (count !== null) return count;
    }
    return null;
  }
```

(b) `scan`에서

```js
    if (settings.enabled) learnAliasFromPage();
```

다음 줄에 추가:

```js
    // While reading, the article's own count is the baseline (own comments included).
    if (currentArticle && settings.enabled && settings.cmtNew) setBase(currentArticle, articleCount());
```

(c) `onClick`에서

```js
    if (article && article.sub === '') markRead(article);
```

를 다음으로 바꾼다:

```js
    if (article && article.sub === '') { markRead(article); setBase(article, rowCount(a, article)); }
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/cmtnew.test.cjs tests/content.test.cjs`
Expected: 모두 PASS.

- [ ] **Step 5: 커밋**

```bash
git add extension/content.js tests/cmtnew.test.cjs
git commit -m "feat: record comment baselines from list clicks and the article page"
```

---

### Task 5: 설정 끄기, CSS, 설정 창

**Files:**
- Modify: `extension/content.css`, `extension/popup.html`, `extension/popup.js`, `extension/popup.css`
- Test: `tests/cmtnew.test.cjs`, `tests/popup.test.cjs`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/cmtnew.test.cjs` 맨 끝에 추가:

```js
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
```

`tests/popup.test.cjs` 맨 끝에 추가:

```js
test('new comment toggle saves', async t => {
  const p = await popup({});
  t.after(() => p.dom.window.close());
  assert.equal(p.$('cmtNew').checked, true);
  p.$('cmtNew').checked = false;
  p.$('cmtNew').dispatchEvent(new p.w.Event('change'));
  await wait(20);
  assert.equal(p.store.data.settings.cmtNew, false);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/cmtnew.test.cjs tests/popup.test.cjs`
Expected: cmtnew 쪽은 Task 3·4 구현으로 이미 PASS일 수 있다(설정 처리는 `settings.cmtNew` 검사로 이미 들어감) — 그래도 테스트는 회귀 방지로 남긴다. popup 쪽은 FAIL (`Cannot read properties of null (reading 'checked')`).

- [ ] **Step 3: 구현**

`extension/content.css` 맨 끝에 추가:

```css

/* New comments on a read article (content.js): "+3" after its comment count. */
html[data-ncc-cmt] a[data-ncc-cmt-new]::after {
  content: "+" attr(data-ncc-cmt-new);
  display: inline-block;
  margin-left: 4px;
  color: #03c75a !important;
  font-size: inherit;
  font-weight: 700;
  font-style: normal;
  text-decoration: none;
}
```

`extension/popup.html`에서

```html
      <label><input type="checkbox" id="badge"> 제목 앞에 <span class="badge">읽음</span> 배지</label>
```

다음 줄에 추가:

```html
      <label><input type="checkbox" id="cmtNew"> 읽은 뒤 새 댓글 수 표시 <span class="cmtnew">[5] <b>+3</b></span></label>
```

`extension/popup.js`에서

```js
  const KEYS = ['enabled', 'dim', 'badge', 'newMark', 'sync', 'likeRetry', 'hotkeys'];
```

를 다음으로 바꾼다:

```js
  const KEYS = ['enabled', 'dim', 'badge', 'cmtNew', 'newMark', 'sync', 'likeRetry', 'hotkeys'];
```

`extension/popup.css`에서 `.badge { ... }` 줄 다음에 추가:

```css
.cmtnew { color: #a0a0a0; font-size: 12px; }
.cmtnew b { color: #03c75a; }
```

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: 전체 PASS (61 + 새 테스트 13개 = 74개).

Run: `npm run check`
Expected: `Manifest references, minimal permissions and JavaScript syntax OK`

- [ ] **Step 5: 화면 확인**

`extension/popup.html`을 브라우저로 열어(또는 확장 프로그램 로드 후 툴바 버튼) **표시 방식**에 새 체크박스와 회색 `[5]` + 초록 `+3` 예시가 한 줄로 보이는지 본다. 목록 표시는 실제 카페 확인(Task 8)에서 본다.

- [ ] **Step 6: 커밋**

```bash
git add extension/content.css extension/popup.html extension/popup.js extension/popup.css tests/cmtnew.test.cjs tests/popup.test.cjs
git commit -m "feat: new-comment badge style and settings toggle"
```

---

### Task 6: README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 변경 사항 섹션 추가**

`### v2.3.2 변경 사항` 바로 위에 추가:

```markdown
### v2.4.0 변경 사항

- **읽은 뒤 새 댓글 표시:** 읽은 글에 그 뒤로 댓글이 달리면 목록의 댓글 수 옆에 `+3`처럼 늘어난 수를 표시합니다 (아래 **읽은 뒤 새 댓글** 참고).

```

- [ ] **Step 2: 사용법 툴바 버튼 문장 수정**

`- **툴바 버튼:** 전체 사용 여부, 흐리게/배지/새 글 경계선 표시,`를 `- **툴바 버튼:** 전체 사용 여부, 흐리게/배지/새 댓글 수/새 글 경계선 표시,`로 바꾼다.

- [ ] **Step 3: 기능 섹션 추가**

`## 여기부터 새 글` 바로 위에 추가:

```markdown
## 읽은 뒤 새 댓글

읽은 글에 그 뒤로 댓글이 달리면 PC 게시판 목록의 댓글 수 옆에 늘어난 수를 초록색으로 표시합니다. 예: `[5] +3`.

- 기준은 그 글을 마지막으로 봤을 때의 댓글 수입니다. 글을 보는 동안에는 글 화면의 `댓글 N`을 따라가므로, 직접 단 댓글은 새 댓글로 치지 않습니다. 목록에서 글을 클릭할 때는 그 행의 댓글 수를 기준으로 씁니다.
- 글을 다시 열면 기준이 지금 댓글 수로 바뀌어 표시가 사라집니다.
- 이 기능을 쓰기 전에 읽은 글이나 다른 기기에서 읽은 글은 목록에 처음 보일 때의 댓글 수가 기준이 되고, 그때는 표시하지 않습니다.
- 댓글이 지워져 목록의 수가 기준보다 작아지면 표시하지 않고 기준도 그대로 둡니다. 그래서 삭제 뒤에 달린 댓글은 지워진 수만큼 덜 보일 수 있습니다.
- 댓글 수가 `[5]` 같은 링크로 나오는 목록형 보기에서만 표시합니다. 앨범형·카드형 보기와 모바일 웹은 제외입니다.
- 기준 댓글 수는 이 브라우저에만 저장되고 Google 동기화 대상이 아닙니다.
- 설정 창 **표시 방식**에서 끌 수 있습니다.

```

- [ ] **Step 4: 저장과 권한 섹션 수정**

`기록과 설정은 \`chrome.storage.local\`에 저장되며,`로 시작하는 문단의 첫 문장을 다음으로 바꾼다:

```markdown
기록과 설정, 읽은 글의 기준 댓글 수는 `chrome.storage.local`에 저장되며, 동기화를 켜면 최근 기록의 압축본이 `chrome.storage.sync`(Chrome 계정 동기화)에 저장됩니다.
```

- [ ] **Step 5: 검증 섹션 항목 추가**

`- 동기화 테스트:`로 시작하는 줄 바로 위에 추가:

```markdown
- 새 댓글 테스트: 목록 댓글 수와 기준 비교(`+N`), 기준 없는 읽은 글의 조용한 기준 기록, 카페 주소 이름으로 저장된 읽음 기록, 댓글 수 감소 시 기준 유지, 다른 탭의 기준 변경 반영, 제목·댓글 수 클릭 시 행의 댓글 수 기록, 글 화면 `댓글 N` 추적(직접 단 댓글, 숫자가 나뉜 구조), 다시 읽으면 표시 해제, 설정 끄기, 읽음 기록 삭제·정리 시 기준 삭제. 실제 카페 화면에서는 아직 확인하지 않았습니다.
```

- [ ] **Step 6: 커밋**

```bash
git add README.md
git commit -m "docs: document the new-comment badge"
```

---

### Task 7: 버전 2.4.0과 빌드

**Files:**
- Modify: `extension/manifest.json`, `package.json`, `package-lock.json`

- [ ] **Step 1: 버전 올리기**

Run: `npm version 2.4.0 --no-git-tag-version`
Expected: `v2.4.0` 출력, `package.json`과 `package-lock.json`의 버전이 바뀜.

`extension/manifest.json`에서 `"version": "2.3.2",`를 `"version": "2.4.0",`로 바꾼다.

- [ ] **Step 2: 검사와 테스트**

Run: `npm run check`
Expected: `Manifest references, minimal permissions and JavaScript syntax OK` (manifest와 package 버전이 다르면 여기서 실패).

Run: `npm test`
Expected: 전체 PASS.

- [ ] **Step 3: 빌드**

Run: `npm run build`
Expected: `dist/naver-cafe-checker-v2.4.0.zip` 생성. `dist/`는 git에 올리지 않는다(.gitignore).

- [ ] **Step 4: 커밋**

```bash
git add extension/manifest.json package.json package-lock.json
git commit -m "chore: release 2.4.0"
```

---

### Task 8: 실제 카페 확인 (사람이 직접)

자동 테스트로 대신할 수 없는 부분이다. 결과에 따라 Task 4의 `articleCount`를 고치거나 글 화면 기록을 뺀다.

- [ ] **Step 1: 확장 프로그램 다시 로드**

`chrome://extensions`에서 **카페 읽음 표시** 새로고침(↻), 열린 카페 탭 새로고침.

- [ ] **Step 2: 글 화면 댓글 수 위치**

댓글이 있는 글을 열고 개발자 도구(F12)의 Console에서 본문 프레임(`cafe_main` 등)을 고른 뒤 실행:

```js
[...document.querySelectorAll('a, button')].map(el => el.textContent.replace(/\s+/g, ' ').trim()).filter(t => t.startsWith('댓글'))
```

Expected: `["댓글 5", ...]`처럼 첫 항목이 그 글의 댓글 수. 비어 있거나 첫 항목이 다른 것이면 `articleCount`의 후보 선택을 실제 요소에 맞게 고친다.

- [ ] **Step 3: 목록 수와 글 화면 수 비교**

답글(대댓글)이 있는 글 3개 이상에서 목록 `[N]`과 글 화면 `댓글 N`이 같은지 본다.
- 같으면: 그대로 둔다.
- 다르면: 글 화면 기록을 뺀다. `scan`의 `setBase(currentArticle, articleCount())` 줄과 그 위 주석, `articleCount` 함수를 지우고, `tests/cmtnew.test.cjs`의 'the article page keeps the baseline…'와 'reading the article again clears…' 테스트를 지운다('…without a comment count…'는 남긴다). README **읽은 뒤 새 댓글**의 첫 항목에서 글 화면 관련 문장을 빼고, 스펙의 "실제 카페에서 확인할 것" 2번에 결과를 적는다.

- [ ] **Step 4: 동작 확인**

1. 목록에서 댓글 있는 글을 열고 목록으로 돌아온다 → `+N` 없음.
2. 그 글에 다른 계정이나 다른 사람이 댓글을 달게 한 뒤(또는 활발한 게시판에서 시간이 지난 뒤) 목록을 새로고침한다 → 댓글 수 옆에 초록 `+N`.
3. 그 글을 다시 열었다가 목록으로 → `+N` 사라짐.
4. 글에 직접 댓글을 달고 목록으로 → `+1`이 뜨지 않음.
5. 설정 창에서 끄면 `+N` 사라짐.
