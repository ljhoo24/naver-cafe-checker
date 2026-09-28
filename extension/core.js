// Shared by content script, service worker, popup and tests.
// Storage layout (chrome.storage.local, one key per record so frames never race):
//   r:c:<cafeId>:<articleId> -> timestamp   read article, cafe known by numeric id
//   r:u:<cafeUrl>:<articleId> -> timestamp  read article, cafe known only by its url name
//   a:<cafeUrl> -> cafeId                    learned cafe url name -> numeric id
//   settings -> { enabled, dim, badge, sync }
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CafeChecker = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';
  const READ = 'r:';
  const ALIAS = 'a:';
  const SETTINGS = 'settings';
  const MAX_READS = 50000;
  const DEFAULTS = Object.freeze({ enabled: true, dim: true, badge: true, sync: true });
  const CAFE_HOSTS = new Set(['cafe.naver.com', 'm.cafe.naver.com']);
  const NOT_CAFE_URLS = new Set(['f-e', 'ca-fe', 'cafes', 'web', 'app']);
  // /f-e/cafes/1/articles/2, /ca-fe/cafes/..., /ca-fe/web/cafes/..., /ca-fe/app/cafes/...,
  // optionally /menus/<id>/ before articles and a trailing sub page (/comments, /modify ...).
  const CAFES_PATH = /^\/(?:f-e|ca-fe)(?:\/(?:web|app))?\/cafes\/([^/]+)\/(?:menus\/\d+\/)?articles\/(\d+)(?:\/([^/]*))?\/?$/i;
  const SHORT_PATH = /^\/([A-Za-z0-9_-]{2,40})\/(\d+)\/?$/;
  const DIGITS = /^\d{1,12}$/;

  function settings(value) {
    const v = value && typeof value === 'object' ? value : {};
    const out = {};
    for (const k of Object.keys(DEFAULTS)) out[k] = typeof v[k] === 'boolean' ? v[k] : DEFAULTS[k];
    return out;
  }

  function cafeRef(raw) {
    const value = String(raw || '').trim();
    if (DIGITS.test(value)) return { cafeId: String(Number(value)), cafeUrl: null };
    if (/^[A-Za-z0-9_-]{2,40}$/.test(value) && !NOT_CAFE_URLS.has(value.toLowerCase())) {
      return { cafeId: null, cafeUrl: value.toLowerCase() };
    }
    return null;
  }

  function param(params, names) {
    for (const [k, v] of params) if (names.includes(k.toLowerCase()) && v) return v;
    return '';
  }

  // Returns { cafeId, cafeUrl, articleId, sub } or null. Exactly one of cafeId/cafeUrl is set.
  function parseArticle(href, base, depth = 0) {
    let url;
    try { url = new URL(href, base || 'https://cafe.naver.com/'); } catch { return null; }
    if (!/^https?:$/.test(url.protocol) || !CAFE_HOSTS.has(url.hostname.toLowerCase())) return null;
    const params = url.searchParams;

    const articleParam = param(params, ['articleid', 'search.articleid']);
    const clubParam = param(params, ['clubid', 'search.clubid', 'cafeid']);
    if (DIGITS.test(articleParam) && DIGITS.test(clubParam)) {
      return { cafeId: String(Number(clubParam)), cafeUrl: null, articleId: String(Number(articleParam)), sub: '' };
    }

    let path = url.pathname;
    try { path = decodeURI(path); } catch { /* keep raw */ }
    const long = CAFES_PATH.exec(path);
    if (long) {
      const cafe = cafeRef(long[1]);
      if (cafe) return { ...cafe, articleId: String(Number(long[2])), sub: (long[3] || '').toLowerCase() };
    }
    const short = SHORT_PATH.exec(path);
    if (short) {
      const cafe = cafeRef(short[1]);
      if (cafe) return { ...cafe, articleId: String(Number(short[2])), sub: '' };
    }

    // Legacy PC shell: cafe.naver.com/<cafeUrl>?iframe_url=/ArticleRead.nhn%3Fclubid...
    if (depth < 2) {
      const inner = param(params, ['iframe_url_utf8', 'iframe_url']);
      if (inner) return parseArticle(inner, url.origin + '/', depth + 1);
    }
    return null;
  }

  // Only the article itself; sub pages like /modify or /reply are not "the article link".
  function isArticleView(parsed) {
    return !!parsed && (parsed.sub === '' || parsed.sub === 'comments');
  }

  // Key under which a newly read article is stored.
  function storeKey(parsed, aliases) {
    const cafeId = parsed.cafeId || (aliases && aliases[parsed.cafeUrl]) || null;
    return cafeId ? `${READ}c:${cafeId}:${parsed.articleId}` : `${READ}u:${parsed.cafeUrl}:${parsed.articleId}`;
  }

  // Every key that could mean "this article was read" (an article may have been
  // recorded by cafe url name before the id mapping was learned, or vice versa).
  function lookupKeys(parsed, aliases, urlsById) {
    const keys = new Set();
    const cafeId = parsed.cafeId || (aliases && aliases[parsed.cafeUrl]) || null;
    if (cafeId) {
      keys.add(`${READ}c:${cafeId}:${parsed.articleId}`);
      for (const cafeUrl of (urlsById && urlsById[cafeId]) || []) keys.add(`${READ}u:${cafeUrl}:${parsed.articleId}`);
    }
    if (parsed.cafeUrl) keys.add(`${READ}u:${parsed.cafeUrl}:${parsed.articleId}`);
    return [...keys];
  }

  function invertAliases(aliases) {
    const out = {};
    for (const [cafeUrl, cafeId] of Object.entries(aliases || {})) (out[cafeId] = out[cafeId] || []).push(cafeUrl);
    return out;
  }

  // Splits a chrome.storage dump into { reads:Set, aliases:{}, settings }.
  function fromStorage(items) {
    const reads = new Set();
    const aliases = {};
    for (const [k, v] of Object.entries(items || {})) {
      if (k.startsWith(READ)) reads.add(k);
      else if (k.startsWith(ALIAS) && DIGITS.test(String(v))) aliases[k.slice(ALIAS.length)] = String(v);
    }
    return { reads, aliases, settings: settings(items && items[SETTINGS]) };
  }

  // Oldest read keys to delete so at most `max` remain.
  function pruneKeys(items, max = MAX_READS) {
    const reads = Object.entries(items || {}).filter(([k]) => k.startsWith(READ));
    if (reads.length <= max) return [];
    reads.sort((a, b) => (Number(a[1]) || 0) - (Number(b[1]) || 0));
    return reads.slice(0, reads.length - max).map(([k]) => k);
  }

  return {
    READ, ALIAS, SETTINGS, MAX_READS, DEFAULTS,
    settings, cafeRef, parseArticle, isArticleView, storeKey, lookupKeys, invertAliases, fromStorage, pruneKeys
  };
});
