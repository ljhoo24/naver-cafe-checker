// Keyboard shortcuts on an article page: previous / next article.
// Clicks Naver's own "이전글" / "다음글" buttons so the order, board scope and
// permission checks stay exactly Naver's.
(() => {
  'use strict';
  if (globalThis.__cafeCheckerHotkeysLoaded) return;
  globalThis.__cafeCheckerHotkeysLoaded = true;
  const C = CafeChecker;
  // PC article view (ca-fe web-section app): .ArticleTopBtns .right_area holds the buttons.
  const BAR = '.ArticleTopBtns';
  const BUTTONS = { prev: { selector: 'a.btn_prev', text: '이전글' }, next: { selector: 'a.btn_next', text: '다음글' } };
  const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
  let settings = C.settings();
  let noticeTimer = null;

  function editing(event) {
    const targets = [event.target, document.activeElement];
    return targets.some(el => el instanceof Element && (el.matches(EDITABLE) || el.closest(EDITABLE) || el.isContentEditable));
  }
  // This document plus same-origin child frames (the PC cafe page shows the
  // article in an iframe, and the key may arrive in the outer page).
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
  function find(direction) {
    const { selector, text } = BUTTONS[direction];
    let bar = null;
    for (const doc of documents()) {
      for (const candidate of doc.querySelectorAll(BAR)) {
        bar = bar || candidate;
        const btn = [...candidate.querySelectorAll(selector)].find(a => a.textContent.replace(/\s+/g, '').includes(text));
        if (btn) return { bar: candidate, btn };
      }
    }
    return { bar, btn: null };
  }
  function topDocument() {
    try { return window.top.document; } catch { return document; }
  }
  // Shown in the top page: inside the PC iframe a fixed element would sit at the
  // bottom of a very tall frame, out of view.
  function notice(text) {
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
    host.shadowRoot.querySelector('div').textContent = text;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => host.remove(), 2000);
  }

  function onKeyDown(event) {
    if (!settings.enabled || !settings.hotkeys) return;
    if (event.defaultPrevented || event.repeat || event.isComposing) return;
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    const direction = event.code === settings.prevKey ? 'prev' : event.code === settings.nextKey ? 'next' : null;
    if (!direction || editing(event)) return;
    const { bar, btn } = find(direction);
    // Not an article page (list, home, ...): leave the key alone.
    if (!bar) return;
    event.preventDefault();
    event.stopPropagation();
    if (btn) btn.click();
    else notice(direction === 'prev' ? '이전 글이 없습니다.' : '다음 글이 없습니다.');
  }

  window.addEventListener('keydown', onKeyDown, true);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[C.SETTINGS]) settings = C.settings(changes[C.SETTINGS].newValue);
  });
  chrome.storage.local.get(C.SETTINGS).then(items => { settings = C.settings(items[C.SETTINGS]); }).catch(() => {});
})();
