const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../extension/core.js');

const pick = p => p && { cafeId: p.cafeId, cafeUrl: p.cafeUrl, articleId: p.articleId, sub: p.sub };

test('parses PC, mobile, legacy and short article URLs', () => {
  const cases = [
    ['https://cafe.naver.com/f-e/cafes/31780162/articles/1234?boardtype=L&menuid=2', { cafeId: '31780162', cafeUrl: null, articleId: '1234', sub: '' }],
    ['/f-e/cafes/31780162/articles/1234?commentFocus=true', { cafeId: '31780162', cafeUrl: null, articleId: '1234', sub: '' }],
    ['https://cafe.naver.com/ca-fe/cafes/31780162/articles/77', { cafeId: '31780162', cafeUrl: null, articleId: '77', sub: '' }],
    ['https://m.cafe.naver.com/ca-fe/web/cafes/31780162/articles/55?fromList=true', { cafeId: '31780162', cafeUrl: null, articleId: '55', sub: '' }],
    ['https://m.cafe.naver.com/ca-fe/web/cafes/31780162/articles/55/comments', { cafeId: '31780162', cafeUrl: null, articleId: '55', sub: 'comments' }],
    ['https://m.cafe.naver.com/ca-fe/web/cafes/newsickminza/articles/9', { cafeId: null, cafeUrl: 'newsickminza', articleId: '9', sub: '' }],
    ['https://cafe.naver.com/ArticleRead.nhn?clubid=10050146&page=1&menuid=3&articleid=987&referrerAllArticles=false', { cafeId: '10050146', cafeUrl: null, articleId: '987', sub: '' }],
    ['/ArticleRead.nhn?search.clubid=10050146&search.articleid=988', { cafeId: '10050146', cafeUrl: null, articleId: '988', sub: '' }],
    ['https://m.cafe.naver.com/ArticleRead.nhn?clubid=1&articleid=2', { cafeId: '1', cafeUrl: null, articleId: '2', sub: '' }],
    ['https://cafe.naver.com/NewSickMinza/123', { cafeId: null, cafeUrl: 'newsickminza', articleId: '123', sub: '' }],
    ['https://m.cafe.naver.com/newsickminza/123', { cafeId: null, cafeUrl: 'newsickminza', articleId: '123', sub: '' }],
    ['https://cafe.naver.com/newsickminza?iframe_url=/ArticleRead.nhn%3Fclubid%3D31780162%26articleid%3D5', { cafeId: '31780162', cafeUrl: null, articleId: '5', sub: '' }],
    ['https://cafe.naver.com/newsickminza?iframe_url_utf8=%2Fnewsickminza%2F6', { cafeId: null, cafeUrl: 'newsickminza', articleId: '6', sub: '' }]
  ];
  for (const [url, expected] of cases) assert.deepEqual(pick(C.parseArticle(url)), expected, url);
});

test('ignores non-article URLs', () => {
  for (const url of [
    'https://cafe.naver.com/newsickminza',
    'https://cafe.naver.com/f-e/cafes/31780162/menus/0?viewType=L',
    'https://cafe.naver.com/f-e/cafes/31780162/articles/write',
    'https://cafe.naver.com/ArticleList.nhn?search.clubid=31780162&search.menuid=1',
    'https://cafe.naver.com/f-e/cafes/31780162/members/abc',
    'https://blog.naver.com/someone/123',
    'https://evil.example/f-e/cafes/1/articles/2',
    'javascript:void(0)', '#', ''
  ]) assert.equal(C.parseArticle(url), null, url);
  assert.equal(C.isArticleView(C.parseArticle('https://m.cafe.naver.com/ca-fe/web/cafes/1/articles/2/modify')), false);
});

test('keys connect cafe url names with numeric ids in both directions', () => {
  const byUrl = C.parseArticle('https://cafe.naver.com/newsickminza/123');
  const byId = C.parseArticle('https://cafe.naver.com/f-e/cafes/31780162/articles/123');
  assert.equal(C.storeKey(byUrl, {}), 'r:u:newsickminza:123');
  const aliases = { newsickminza: '31780162' };
  const urlsById = C.invertAliases(aliases);
  assert.equal(C.storeKey(byUrl, aliases), 'r:c:31780162:123');
  assert.ok(C.lookupKeys(byId, aliases, urlsById).includes('r:u:newsickminza:123'));
  assert.ok(C.lookupKeys(byUrl, aliases, urlsById).includes('r:c:31780162:123'));
  assert.deepEqual(C.lookupKeys(byId, {}, {}), ['r:c:31780162:123']);
});

test('storage helpers: defaults, split and pruning oldest first', () => {
  assert.deepEqual(C.settings({ dim: false, badge: 'x' }), { ...C.settings({}), dim: false });
  assert.equal(C.settings({}).dim, true);
  assert.equal(C.settings({}).newMark, true);
  const state = C.fromStorage({ 'r:c:1:2': 5, 'a:foo': '1', 'a:bad': 'x', settings: { enabled: false } });
  assert.deepEqual([...state.reads], ['r:c:1:2']);
  assert.deepEqual(state.aliases, { foo: '1' });
  assert.equal(state.settings.enabled, false);
  assert.deepEqual(C.pruneKeys({ 'r:c:1:1': 30, 'r:c:1:2': 10, 'r:c:1:3': 20, 'a:x': '1' }, 2), ['r:c:1:2']);
  assert.deepEqual(C.pruneKeys({ 'r:c:1:1': 1 }, 2), []);
});

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
