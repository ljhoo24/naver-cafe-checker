// Runs in the page's MAIN world: Naver's like (reaction) plugin reports failures
// with window.alert(), which an isolated content script cannot intercept.
//
// When a like click fails because the page was open too long (its like token
// expired), the alert is suppressed, the intended click is remembered in
// sessionStorage and the page reloads. like.js repeats the click after reload.
(() => {
  'use strict';
  if (window.__nccLikeHook) return;
  window.__nccLikeHook = true;
  const MODULE = '.u_likeit_list_module, ._cafeReactionModule';
  const BUTTON = 'a.u_likeit_list_btn';
  const FLAG = 'data-ncc-like-retry';
  const INTENT = 'ncc:like-intent';
  const AUTO = 'ncc:like-auto';
  // The server sends the text; match the "expired, please reload" family only so
  // other failures (own article, permission, network) still show normally.
  const EXPIRED = /새로\s*고침|오래|만료|시간이\s*(?:지나|경과|초과)|유효\s*시간|다시\s*접속|페이지를\s*다시/;
  // The plugin retries internally for up to ~12s before alerting.
  const CLICK_WINDOW_MS = 20000;
  const AUTO_WINDOW_MS = 60000;
  let lastClick = null;

  const pressed = btn => btn.getAttribute('aria-pressed') === 'true' || btn.classList.contains('on');
  function read(key) {
    try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { return null; }
  }
  function report(message, handled) {
    window.postMessage({ __ncc: 'like-alert', message: String(message).slice(0, 300), handled }, location.origin);
  }
  function reload() {
    // The PC article view is an iframe inside the cafe page; reload the whole
    // page like a user would. Same-origin, so top is reachable.
    try { window.top.location.reload(); } catch { location.reload(); }
  }

  // Capture phase runs before the plugin toggles the button, so this is the state before the click.
  document.addEventListener('click', event => {
    const btn = event.target instanceof Element ? event.target.closest(BUTTON) : null;
    if (!btn || event.target.closest('.like_count_btn')) return;
    const cid = btn.closest(MODULE) && btn.closest(MODULE).getAttribute('data-cid');
    if (cid) lastClick = { cid, at: Date.now(), wantOn: !pressed(btn) };
  }, true);

  const originalAlert = window.alert;
  window.alert = function (message) {
    const now = Date.now();
    const click = lastClick && now - lastClick.at < CLICK_WINDOW_MS ? lastClick : null;
    if (click) {
      const auto = read(AUTO);
      const alreadyRetried = !!auto && auto.cid === click.cid && now - auto.at < AUTO_WINDOW_MS;
      const enabled = document.documentElement.hasAttribute(FLAG);
      if (enabled && !alreadyRetried && EXPIRED.test(String(message))) {
        lastClick = null;
        try {
          sessionStorage.setItem(INTENT, JSON.stringify({ cid: click.cid, wantOn: click.wantOn, at: now }));
        } catch {
          return originalAlert.apply(this, arguments);
        }
        report(message, true);
        reload();
        return undefined;
      }
      report(message, false);
    }
    return originalAlert.apply(this, arguments);
  };
})();
