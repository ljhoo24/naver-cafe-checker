// "New since your last visit" divider on PC board lists.
//
// Per board it remembers the newest article number seen. When a new visit
// starts (no activity in the cafe for settings.visitGap minutes), that number becomes the
// mark, and the list gets a line above the first row at or below it. Article
// numbers only grow, so this works without timestamps from the list. Only
// attributes are added; content.css draws the line.
(() => {
  'use strict';
  if (globalThis.__cafeCheckerNewMarkLoaded) return;
  globalThis.__cafeCheckerNewMarkLoaded = true;
  const C = CafeChecker;
  const TOUCH_EVERY_MS = 60 * 1000;
  // Newest-first table of the PC list view; notices are pinned and skipped.
  const ROWS = 'table.article-table tr:not(.board-notice)';
  const BOUNDARY = 'data-ncc-new-boundary';
  const LABEL = 'data-ncc-new-label';
  let settings = C.settings();
  let record = null;
  let visitedHref = '';
  let lastTouch = 0;
  let timer = null;

  function alive() {
    try { return !!(chrome.runtime && chrome.runtime.id); } catch { return false; }
  }
  function save(items) {
    if (!alive()) return;
    try { chrome.storage.local.set(items).catch(() => {}); } catch { /* extension reloaded */ }
  }
  // Board of a list URL: /f-e/cafes/<id>/menus/<menuId> (plain list, not a search).
  function board(href) {
    let url;
    try { url = new URL(href); } catch { return null; }
    if (!/^cafe\.naver\.com$/i.test(url.hostname) || url.searchParams.get('q')) return null;
    const m = /^\/(?:f-e|ca-fe)\/cafes\/(\d+)\/menus\/(\d+)\/?$/.exec(url.pathname);
    if (m) return { cafeId: m[1], menuId: m[2] };
    const club = url.searchParams.get('search.clubid');
    const menu = url.searchParams.get('search.menuid') || '0';
    return /ArticleList/i.test(url.pathname) && /^\d+$/.test(club || '') && /^\d+$/.test(menu) ? { cafeId: club, menuId: menu } : null;
  }
  function rows() {
    const out = [];
    for (const row of document.querySelectorAll(ROWS)) {
      const link = row.querySelector('a.article[href]');
      const article = link && C.parseArticle(link.getAttribute('href'), location.href);
      if (article && article.sub === '') out.push({ row, id: Number(article.articleId) });
    }
    return out;
  }
  function ago(ts) {
    const min = Math.max(1, Math.round((Date.now() - ts) / 60000));
    if (min < 60) return `${min}분 전`;
    if (min < 1440) return `${Math.round(min / 60)}시간 전`;
    return `${Math.round(min / 1440)}일 전`;
  }
  function clear() {
    for (const el of document.querySelectorAll(`[${BOUNDARY}], [${LABEL}]`)) {
      el.removeAttribute(BOUNDARY);
      el.removeAttribute(LABEL);
    }
  }
  function draw(list) {
    const fresh = record && record.mark != null ? list.filter(r => r.id > record.mark) : [];
    const boundary = fresh.length ? list.find(r => r.id <= record.mark) : null;
    for (const { row } of list) {
      if (row === (boundary && boundary.row)) continue;
      if (row.hasAttribute(BOUNDARY)) {
        row.removeAttribute(BOUNDARY);
        if (row.cells[0]) row.cells[0].removeAttribute(LABEL);
      }
    }
    if (!boundary) return;
    const label = `▲ 새 글 ${fresh.length}개 · 지난 방문 ${ago(record.markAt)}`;
    if (!boundary.row.hasAttribute(BOUNDARY)) boundary.row.setAttribute(BOUNDARY, '');
    const cell = boundary.row.cells[0];
    if (cell && cell.getAttribute(LABEL) !== label) cell.setAttribute(LABEL, label);
  }

  // Pure: next record for a board given what the list shows now.
  function visit(rec, newest, now, cafeActive, gapMs = 30 * 60 * 1000) {
    if (!rec) return { mark: newest, latest: newest, at: now, markAt: now };
    const last = Math.max(rec.at || 0, cafeActive || 0);
    if (now - last > gapMs) return { mark: rec.latest, latest: Math.max(rec.latest, newest), at: now, markAt: last };
    return { ...rec, latest: Math.max(rec.latest, newest), at: now };
  }

  async function refresh() {
    timer = null;
    if (!settings.enabled || !settings.newMark) { clear(); return; }
    const where = board(location.href);
    if (!where) return;
    const list = rows();
    if (!list.length) return;
    if (visitedHref !== location.href) {
      visitedHref = location.href;
      const key = `${C.VISIT}${where.cafeId}:${where.menuId}`;
      const cafeKey = `${C.VISIT}${where.cafeId}`;
      let items = {};
      try { items = await chrome.storage.local.get([key, cafeKey]); } catch { return; }
      const now = Date.now();
      record = visit(items[key], Math.max(...list.map(r => r.id)), now, items[cafeKey], settings.visitGap * 60 * 1000);
      lastTouch = now;
      save({ [key]: record, [cafeKey]: now });
    }
    draw(rows());
  }
  // Reading articles keeps the visit going, so coming back to the list after a
  // long read still shows the same divider. Only real activity counts, so a tab
  // left open does not keep a visit alive forever.
  function touchArticle() {
    if (!settings.enabled || !settings.newMark) return;
    const article = C.parseArticle(location.href);
    const now = Date.now();
    if (!article || !article.cafeId || now - lastTouch < TOUCH_EVERY_MS) return;
    lastTouch = now;
    save({ [`${C.VISIT}${article.cafeId}`]: now });
  }
  function schedule() {
    if (timer === null) timer = setTimeout(refresh, 150);
  }

  globalThis.__cafeCheckerNewMark = { visit, board };
  for (const type of ['scroll', 'keydown', 'pointerdown']) window.addEventListener(type, touchArticle, { passive: true, capture: true });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[C.SETTINGS]) return;
    settings = C.settings(changes[C.SETTINGS].newValue);
    schedule();
  });
  chrome.storage.local.get(C.SETTINGS).then(items => {
    settings = C.settings(items[C.SETTINGS]);
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    // SPA routing changes the URL without a page load.
    setInterval(() => { if (alive() && location.href !== visitedHref && board(location.href)) schedule(); }, 700);
    schedule();
  }).catch(() => {});
})();
