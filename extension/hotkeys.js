// Keyboard shortcuts.
//   Article page: previous / next article, like, write a comment, back to the list.
//   List page:    previous / next page, open the first unread article.
// Each action presses Naver's own control, so order, scope and permission checks
// stay exactly Naver's.
(() => {
  'use strict';
  if (globalThis.__cafeCheckerHotkeysLoaded) return;
  globalThis.__cafeCheckerHotkeysLoaded = true;
  const C = CafeChecker;
  // PC article view (ca-fe web-section app).
  const ARTICLE_BAR = '.ArticleTopBtns';
  // Naver's "이전글" (up arrow) is the entry above in the newest-first list, i.e. a
  // newer article. Users expect "previous" to mean the older one, so the
  // directions map to the opposite labels.
  const ARTICLE_NAV = { prevKey: { selector: 'a.btn_next', text: '다음글' }, nextKey: { selector: 'a.btn_prev', text: '이전글' } };
  const LIKE = '.like_article a.u_likeit_list_btn, .ReactionLikeIt a.u_likeit_list_btn';
  const COMMENT = '.CommentWriter textarea.comment_inbox_text, textarea.comment_inbox_text';
  // PC board list (f-e app): table rows, album and card views, pagination.
  const LIST = 'table.article-table, .article-album-view, .article-card-view, .Pagination';
  const LIST_ROWS = 'table.article-table tr:not(.board-notice), .article-album-view > li.item, .article-card-view > li.item';
  const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
  let settings = C.settings();
  let noticeTimer = null;

  const text = el => el.textContent.replace(/\s+/g, '');
  const pressed = btn => btn.getAttribute('aria-pressed') === 'true' || btn.classList.contains('on');

  function editing(event) {
    const targets = [event.target, document.activeElement];
    return targets.some(el => el instanceof Element && (el.matches(EDITABLE) || el.closest(EDITABLE) || el.isContentEditable));
  }
  // This document plus same-origin child frames (the PC cafe page shows the
  // article or list in an iframe, and the key may arrive in the outer page).
  function documents(root = document, depth = 0) {
    const out = [root];
    if (depth >= 2) return out;
    for (const frame of root.querySelectorAll('iframe')) {
      let doc = null;
      try { doc = frame.contentDocument; } catch { /* cross-origin */ }
      if (doc && doc.documentElement) out.push(...documents(doc, depth + 1));
    }
    return out;
  }
  function first(selector, docs, filter = () => true) {
    for (const doc of docs) {
      for (const el of doc.querySelectorAll(selector)) if (filter(el)) return el;
    }
    return null;
  }
  // The screen decides which shortcuts apply; an article page wins over a list
  // shown below it.
  function screen(docs) {
    for (const doc of docs) if (doc.querySelector(ARTICLE_BAR)) return 'article';
    for (const doc of docs) if (doc.querySelector(LIST)) return 'list';
    return null;
  }
  function topDocument() {
    try { return window.top.document; } catch { return document; }
  }
  // Shown in the top page: inside the PC iframe a fixed element would sit at the
  // bottom of a very tall frame, out of view.
  function notice(message) {
    const doc = topDocument();
    let host = doc.querySelector('[data-ncc-hotkey-notice]');
    if (!host) {
      host = doc.createElement('div');
      host.setAttribute('data-ncc-hotkey-notice', '');
      host.setAttribute('data-ncc-ui', '');
      host.style.cssText = 'position:fixed;left:50%;bottom:48px;transform:translateX(-50%);z-index:2147483647';
      host.attachShadow({ mode: 'open' }).innerHTML = '<style>div{padding:8px 14px;border-radius:6px;background:#1f2a22;color:#fff;font:13px/1.4 "Malgun Gothic",sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.25);white-space:nowrap}</style><div role="status"></div>';
      doc.body.appendChild(host);
    }
    host.shadowRoot.querySelector('div').textContent = message;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => host.remove(), 2000);
  }

  const ACTIONS = {
    prevKey: docs => articleNav(docs, 'prevKey', '이전 글이 없습니다.'),
    nextKey: docs => articleNav(docs, 'nextKey', '다음 글이 없습니다.'),
    likeKey(docs) {
      const btn = first(LIKE, docs);
      if (!btn) return notice('좋아요 버튼을 찾지 못했습니다.');
      // A shortcut only likes; undoing a like stays a deliberate click on the heart.
      if (pressed(btn)) return notice('이미 좋아요한 글입니다.');
      btn.click();
      notice('좋아요를 눌렀습니다.');
    },
    commentKey(docs) {
      const box = first(COMMENT, docs, el => !el.readOnly && !el.disabled);
      if (!box) return notice('댓글을 쓸 수 없는 글입니다.');
      box.scrollIntoView({ block: 'center' });
      box.focus();
    },
    listKey(docs) {
      const btn = first(`${ARTICLE_BAR} a.BaseButton, a.BaseButton`, docs, el => text(el) === '목록');
      if (btn) btn.click(); else notice('목록 버튼을 찾지 못했습니다.');
    },
    prevPageKey: docs => page(docs, -1),
    nextPageKey: docs => page(docs, 1),
    unreadKey(docs) {
      for (const doc of docs) {
        for (const row of doc.querySelectorAll(LIST_ROWS)) {
          const links = [...row.querySelectorAll('a[href]')].filter(a => C.parseArticle(a.getAttribute('href'), doc.location.href));
          // content.js marks every link of a read article.
          if (!links.length || links.some(a => a.hasAttribute('data-ncc-read'))) continue;
          (row.querySelector('a.article') || links[0]).click();
          return;
        }
      }
      notice('이 페이지에 안 읽은 글이 없습니다.');
    }
  };
  function articleNav(docs, name, missing) {
    const { selector, text: label } = ARTICLE_NAV[name];
    const btn = first(`${ARTICLE_BAR} ${selector}`, docs, el => text(el).includes(label));
    if (btn) btn.click(); else notice(missing);
  }
  // Pagination shows ten numbers; outside them the arrow buttons move one block,
  // which lands exactly on the neighbouring page.
  function page(docs, step) {
    const pager = first('.Pagination', docs);
    const current = pager && pager.querySelector('button.number[aria-current="page"], button.number[aria-pressed="true"]');
    if (!current) return notice('페이지 이동 버튼을 찾지 못했습니다.');
    let target = step < 0 ? current.previousElementSibling : current.nextElementSibling;
    if (!target || !target.matches('button.number')) {
      target = step < 0 ? pager.querySelector('button.btn[aria-label="이전"]') : pager.querySelector('button.btn.type_next');
    }
    if (target) target.click(); else notice(step < 0 ? '첫 페이지입니다.' : '마지막 페이지입니다.');
  }

  function onKeyDown(event) {
    if (!settings.enabled || !settings.hotkeys) return;
    if (event.defaultPrevented || event.repeat || event.isComposing) return;
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    if (!C.isHotkeyCode(event.code) || editing(event)) return;
    const docs = documents();
    const current = screen(docs);
    const hotkey = current && C.HOTKEYS.find(h => h.screen === current && settings[h.name] === event.code);
    if (!hotkey) return;
    event.preventDefault();
    event.stopPropagation();
    ACTIONS[hotkey.name](docs);
  }

  window.addEventListener('keydown', onKeyDown, true);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[C.SETTINGS]) settings = C.settings(changes[C.SETTINGS].newValue);
  });
  chrome.storage.local.get(C.SETTINGS).then(items => { settings = C.settings(items[C.SETTINGS]); }).catch(() => {});
})();
