(() => {
  'use strict';
  if (globalThis.__cafeCheckerLoaded) return;
  globalThis.__cafeCheckerLoaded = true;
  const C = CafeChecker;
  const MARK = 'data-ncc-read';
  const ROOT_FLAGS = { dim: 'data-ncc-dim', badge: 'data-ncc-badge', cmtNew: 'data-ncc-cmt' };
  const CMT_NEW = 'data-ncc-cmt-new';
  // Smallest element that represents one list entry, used so that a title and
  // its comment-count link in the same row get only one "읽음" badge.
  const ROW = 'tr, li, [role="row"], [role="listitem"], .item, article';
  const CAFE_LINK = 'a[class*="cafe_link"], a[class*="cafe_name"], a[class*="CafeName"], a[class*="cafeName"]';

  let settings = C.settings();
  let reads = new Set();
  let aliases = {};
  let urlsById = {};
  // k: comment baseline key -> count when the article was last seen.
  let bases = new Map();
  let lastHref = '';
  let scanTimer = null;
  let aliasLearned = false;
  let currentArticle = null;
  // Keyed by raw href, resolved against the current URL; cleared on navigation.
  const parsed = new Map();

  function alive() {
    try { return !!(chrome.runtime && chrome.runtime.id); } catch { return false; }
  }
  function save(items) {
    if (!alive()) return;
    try { chrome.storage.local.set(items).catch(() => {}); } catch { /* extension reloaded */ }
  }
  function parse(href) {
    if (!parsed.has(href)) {
      if (parsed.size > 5000) parsed.clear();
      parsed.set(href, C.parseArticle(href, location.href));
    }
    return parsed.get(href);
  }
  function sameArticle(a, b) {
    if (!a || !b || a.articleId !== b.articleId) return false;
    const idA = a.cafeId || aliases[a.cafeUrl];
    const idB = b.cafeId || aliases[b.cafeUrl];
    return (!!idA && idA === idB) || (!!a.cafeUrl && a.cafeUrl === b.cafeUrl);
  }
  // Article a list link points to. Buttons on an article page (like, comments,
  // share, author, sort order) use "#" or the page's own URL; those are not list
  // entries, so links to the article being viewed are ignored.
  function articleOf(a) {
    const raw = (a.getAttribute('href') || '').trim();
    if (!raw || raw[0] === '#' || /^javascript:/i.test(raw)) return null;
    const article = parse(raw);
    return article && !sameArticle(article, currentArticle) ? article : null;
  }
  function isRead(article) {
    return C.lookupKeys(article, aliases, urlsById).some(k => reads.has(k));
  }
  function markRead(article) {
    if (!settings.enabled || !C.isArticleView(article) || isRead(article)) return;
    const key = C.storeKey(article, aliases);
    reads.add(key);
    save({ [key]: Date.now() });
    schedule();
  }
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
  // The article's own "댓글 5" button (a.button_comment in the cafe_main frame).
  // Counts inside links to other articles listed on the page are never it.
  function articleCount() {
    for (const el of [...document.querySelectorAll('.button_comment'), ...document.querySelectorAll('a, button')]) {
      const text = el.textContent.replace(/\s+/g, ' ').trim();
      if (!text.startsWith('댓글')) continue;
      const link = el.closest('a[href]');
      if (link && articleOf(link)) continue;
      const count = C.parseCount(text);
      if (count !== null) return count;
    }
    return null;
  }

  function learnAlias(cafeUrl, cafeId) {
    if (!cafeUrl || !cafeId || !C.cafeRef(cafeUrl) || aliases[cafeUrl] === cafeId) return;
    aliases = { ...aliases, [cafeUrl]: cafeId };
    urlsById = C.invertAliases(aliases);
    save({ [C.ALIAS + cafeUrl]: cafeId });
    schedule();
  }

  // --- cafe url name <-> numeric id -------------------------------------
  function cafeIdIn(href) {
    let url;
    try { url = new URL(href, location.href); } catch { return null; }
    if (!/(^|\.)cafe\.naver\.com$/i.test(url.hostname)) return null;
    const club = url.searchParams.get('clubid') || url.searchParams.get('search.clubid');
    if (club && /^\d+$/.test(club)) return String(Number(club));
    const m = /\/cafes\/(\d+)(?:\/|$)/.exec(url.pathname);
    return m ? String(Number(m[1])) : null;
  }
  function cafeUrlIn(href) {
    let url;
    try { url = new URL(href, location.href); } catch { return null; }
    if (!/^(m\.)?cafe\.naver\.com$/i.test(url.hostname)) return null;
    const m = /^\/([A-Za-z0-9_-]{2,40})\/?$/.exec(url.pathname);
    const ref = m && C.cafeRef(m[1]);
    return ref && ref.cafeUrl;
  }
  function learnAliasFromPage() {
    // section.cafe.naver.com paths are not cafe url names.
    if (aliasLearned || !/^(m\.)?cafe\.naver\.com$/i.test(location.hostname)) return;
    // Legacy PC shell declares both in inline script.
    for (const script of document.scripts) {
      const text = script.textContent;
      if (!text || text.indexOf('g_sClubId') < 0) continue;
      const id = /g_sClubId\s*=\s*["'](\d+)["']/.exec(text);
      const home = /g_sCafeHome\s*=\s*["']https?:\/\/cafe\.naver\.com\/["']\s*\+\s*["']([A-Za-z0-9_-]+)["']/.exec(text);
      const cafeUrl = home ? home[1].toLowerCase() : cafeUrlIn(location.origin + '/' + location.pathname.split('/')[1]);
      if (id && cafeUrl) { learnAlias(cafeUrl, String(Number(id[1]))); aliasLearned = true; return; }
    }
    // New PC / mobile page on /cafes/<id>/...: its header or footer links to the cafe home.
    const here = cafeIdIn(location.href);
    if (here) {
      for (const a of document.querySelectorAll(CAFE_LINK)) {
        const cafeUrl = cafeUrlIn(a.href);
        if (cafeUrl) { learnAlias(cafeUrl, here); aliasLearned = true; return; }
      }
      return;
    }
    // Page addressed by url name (/<cafeUrl> or /<cafeUrl>/<articleId>): links are
    // dominated by the cafe's own numeric id.
    const segment = /^\/([A-Za-z0-9_-]{2,40})(?:\/\d+)?\/?$/.exec(location.pathname);
    const ref = segment && C.cafeRef(segment[1]);
    if (!ref || !ref.cafeUrl) return;
    const counts = new Map();
    let total = 0;
    for (const a of document.querySelectorAll('a[href]')) {
      const id = cafeIdIn(a.getAttribute('href'));
      if (!id) continue;
      total++;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    for (const [id, n] of counts) {
      if (n >= 3 && n / total >= 0.8) { learnAlias(ref.cafeUrl, id); aliasLearned = true; return; }
    }
  }

  // --- rendering --------------------------------------------------------
  function kind(a) {
    const text = a.textContent.replace(/\s+/g, ' ').trim();
    if (!text || text.length < 2 && a.querySelector('img, picture, video, [style*="background"]')) return 'media';
    return C.parseCount(text) !== null ? 'extra' : 'title';
  }
  function applyRootFlags() {
    const root = document.documentElement;
    if (!root) return;
    for (const [name, attr] of Object.entries(ROOT_FLAGS)) {
      if (settings.enabled && settings[name]) root.setAttribute(attr, '');
      else root.removeAttribute(attr);
    }
  }
  function scan() {
    scanTimer = null;
    if (!document.documentElement) return;
    applyRootFlags();
    if (settings.enabled) learnAliasFromPage();
    // While reading, the article's own count is the baseline (own comments included).
    if (currentArticle && settings.enabled && settings.cmtNew) setBase(currentArticle, articleCount());
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
  function schedule() {
    if (scanTimer === null) scanTimer = setTimeout(scan, 60);
  }

  // --- reading detection ------------------------------------------------
  function checkLocation() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    parsed.clear();
    const article = C.parseArticle(location.href);
    currentArticle = C.isArticleView(article) ? article : null;
    schedule();
    if (!settings.enabled) return;
    learnAliasFromPage();
    if (currentArticle) markRead(currentArticle);
  }
  function onClick(event) {
    if (event.type === 'auxclick' && event.button !== 1) return;
    const a = event.target instanceof Element && event.target.closest('a[href]');
    if (!a) return;
    const article = articleOf(a);
    if (article && article.sub === '') { markRead(article); setBase(article, rowCount(a, article)); }
  }

  // --- wiring -----------------------------------------------------------
  function onStorage(changes, area) {
    if (area !== 'local') return;
    let aliasChanged = false;
    for (const [k, change] of Object.entries(changes)) {
      if (k.startsWith(C.READ)) {
        if (change.newValue === undefined) reads.delete(k); else reads.add(k);
      } else if (k.startsWith(C.ALIAS)) {
        const cafeUrl = k.slice(C.ALIAS.length);
        const next = { ...aliases };
        if (change.newValue === undefined) delete next[cafeUrl]; else next[cafeUrl] = String(change.newValue);
        aliases = next;
        aliasChanged = true;
      } else if (k.startsWith(C.COMMENTS)) {
        if (Number.isSafeInteger(change.newValue)) bases.set(k, change.newValue); else bases.delete(k);
      } else if (k === C.SETTINGS) {
        const wasEnabled = settings.enabled;
        settings = C.settings(change.newValue);
        if (settings.enabled && !wasEnabled) { lastHref = ''; checkLocation(); }
      }
    }
    if (aliasChanged) urlsById = C.invertAliases(aliases);
    schedule();
  }
  function observe() {
    new MutationObserver(schedule).observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['href']
    });
  }

  document.addEventListener('click', onClick, true);
  document.addEventListener('auxclick', onClick, true);
  window.addEventListener('popstate', checkLocation);
  window.addEventListener('hashchange', checkLocation);
  chrome.storage.onChanged.addListener(onStorage);

  chrome.storage.local.get(null).then(items => {
    const state = C.fromStorage(items);
    reads = state.reads;
    aliases = state.aliases;
    urlsById = C.invertAliases(aliases);
    bases = state.bases;
    settings = state.settings;
    const start = () => {
      checkLocation();
      scan();
      observe();
      // SPA routers change the URL through history.pushState, which content
      // scripts cannot hook from their isolated world.
      setInterval(() => { if (alive()) checkLocation(); }, 700);
    };
    if (document.documentElement) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  }).catch(() => {});
})();
