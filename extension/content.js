(() => {
  'use strict';
  if (globalThis.__cafeCheckerLoaded) return;
  globalThis.__cafeCheckerLoaded = true;
  const C = CafeChecker;
  const MARK = 'data-ncc-read';
  const ROOT_FLAGS = { dim: 'data-ncc-dim', badge: 'data-ncc-badge' };
  // Smallest element that represents one list entry, used so that a title and
  // its comment-count link in the same row get only one "읽음" badge.
  const ROW = 'tr, li, [role="row"], [role="listitem"], .item, article';
  const COUNT_TEXT = /^[\[(]?\s*[\d,]+\s*[\])]?$/;
  const CAFE_LINK = 'a[class*="cafe_link"], a[class*="cafe_name"], a[class*="CafeName"], a[class*="cafeName"]';

  let settings = C.settings();
  let reads = new Set();
  let aliases = {};
  let urlsById = {};
  let lastHref = '';
  let scanTimer = null;
  let aliasLearned = false;
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
    return COUNT_TEXT.test(text) ? 'extra' : 'title';
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
    const badged = new WeakMap();
    for (const a of document.querySelectorAll('a[href]')) {
      const article = settings.enabled ? parse(a.getAttribute('href')) : null;
      let value = null;
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
      }
      if (value) { if (a.getAttribute(MARK) !== value) a.setAttribute(MARK, value); }
      else if (a.hasAttribute(MARK)) a.removeAttribute(MARK);
    }
  }
  function schedule() {
    if (scanTimer === null) scanTimer = setTimeout(scan, 60);
  }

  // --- reading detection ------------------------------------------------
  function checkLocation() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    if (!settings.enabled) return;
    learnAliasFromPage();
    const article = C.parseArticle(location.href);
    if (article) markRead(article);
  }
  function onClick(event) {
    if (event.type === 'auxclick' && event.button !== 1) return;
    const a = event.target instanceof Element && event.target.closest('a[href]');
    if (!a) return;
    const article = parse(a.getAttribute('href'));
    if (article && article.sub === '') markRead(article);
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
