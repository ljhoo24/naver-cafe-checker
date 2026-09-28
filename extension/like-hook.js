// Runs in the page's MAIN world: Naver's like (reaction) plugin reports failures
// with window.alert(), which an isolated content script cannot intercept.
//
// When a like click fails because the page was open too long (its like token
// expired), the alert is suppressed, the intended click is remembered in
// sessionStorage and the page reloads. like.js repeats the click after reload.
// When the server answers that an earlier request is still being processed,
// the same button is clicked again after a short wait instead.
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
  // e.g. "이전 요청을 처리중입니다": the failed request stays locked server-side for a few seconds.
  const BUSY = /처리\s*중|진행\s*중/;
  const BUSY_DELAYS_MS = [2000, 3000, 4000];
  const BUSY_WINDOW_MS = 60000;
  // The plugin retries internally for up to ~12s before alerting.
  const CLICK_WINDOW_MS = 20000;
  const AUTO_WINDOW_MS = 60000;
  let lastClick = null;
  const busyRetries = new Map();

  const pressed = btn => btn.getAttribute('aria-pressed') === 'true' || btn.classList.contains('on');
  function read(key) {
    try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { return null; }
  }
  function report(message, handled) {
    window.postMessage({ __ncc: 'like-alert', message: String(message).slice(0, 300), handled }, location.origin);
  }
  function findButton(cid) {
    for (const module of document.querySelectorAll(MODULE)) {
      if (module.getAttribute('data-cid') === cid) return module.querySelector(BUTTON);
    }
    return null;
  }
  // Clicks the button again later; false once this button's retries are used up.
  function retryLater(click, now) {
    let state = busyRetries.get(click.cid);
    if (!state || now - state.first > BUSY_WINDOW_MS) state = { first: now, count: 0 };
    if (state.count >= BUSY_DELAYS_MS.length) return false;
    const delay = BUSY_DELAYS_MS[state.count];
    state.count++;
    busyRetries.set(click.cid, state);
    setTimeout(() => {
      const btn = findButton(click.cid);
      // The plugin reverted the button on failure; if it already shows the wanted
      // state (e.g. the user clicked again meanwhile), leave it alone.
      if (btn && pressed(btn) !== click.wantOn) btn.click();
    }, delay);
    return true;
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
      if (enabled && BUSY.test(String(message)) && retryLater(click, now)) {
        report(message, true);
        return undefined;
      }
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
