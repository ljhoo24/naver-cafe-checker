// Completes a like that failed on a long-open page (see like-hook.js): after the
// reload, finds the same like button, clicks it once and tells the user.
(() => {
  'use strict';
  if (globalThis.__cafeCheckerLikeLoaded) return;
  globalThis.__cafeCheckerLikeLoaded = true;
  const C = CafeChecker;
  const FLAG = 'data-ncc-like-retry';
  const INTENT = 'ncc:like-intent';
  const AUTO = 'ncc:like-auto';
  const LAST_ALERT = 'like:last';
  const INTENT_MAX_AGE_MS = 2 * 60 * 1000;
  const WAIT_MS = 20000;
  const POLL_MS = 300;
  let settings = C.settings();
  let timer = null;

  function alive() {
    try { return !!(chrome.runtime && chrome.runtime.id); } catch { return false; }
  }
  function active() { return settings.enabled && settings.likeRetry; }
  function applyFlag() {
    const root = document.documentElement;
    if (!root) return;
    if (active()) root.setAttribute(FLAG, ''); else root.removeAttribute(FLAG);
  }
  function readIntent() {
    try {
      const intent = JSON.parse(sessionStorage.getItem(INTENT) || 'null');
      if (intent && typeof intent.cid === 'string' && Date.now() - intent.at < INTENT_MAX_AGE_MS) return intent;
      if (intent) sessionStorage.removeItem(INTENT);
    } catch { /* storage blocked */ }
    return null;
  }
  const pressed = btn => btn.getAttribute('aria-pressed') === 'true' || btn.classList.contains('on');
  function findButton(cid) {
    for (const module of document.querySelectorAll('.u_likeit_list_module[data-cid], ._cafeReactionModule[data-cid]')) {
      if (module.getAttribute('data-cid') !== cid) continue;
      const btn = module.querySelector('a.u_likeit_list_btn');
      // The plugin marks a module loaded once it has fetched the current like state.
      if (btn && module.getAttribute('data-loaded') === '1') return btn;
    }
    return null;
  }

  function notice(anchor, text) {
    const host = document.createElement('div');
    host.setAttribute('data-ncc-ui', '');
    const rect = anchor.getBoundingClientRect();
    host.style.cssText = `position:absolute;z-index:2147483647;left:${Math.max(8, rect.left + scrollX)}px;top:${rect.bottom + scrollY + 8}px`;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>div{padding:7px 11px;border-radius:6px;background:#1f2a22;color:#fff;font:12px/1.4 "Malgun Gothic",sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.25);white-space:nowrap}</style><div role="status"></div>`;
    shadow.querySelector('div').textContent = text;
    document.body.appendChild(host);
    setTimeout(() => host.remove(), 5000);
  }

  function tryResume(deadline) {
    timer = null;
    const intent = readIntent();
    if (!intent || !active()) return;
    const btn = findButton(intent.cid);
    if (!btn) {
      // Another frame (or a slow render) may own the button; keep waiting until the deadline.
      if (Date.now() < deadline) timer = setTimeout(() => tryResume(deadline), POLL_MS);
      return;
    }
    try { sessionStorage.removeItem(INTENT); } catch { /* ignore */ }
    btn.scrollIntoView({ block: 'center' });
    if (pressed(btn) === intent.wantOn) {
      notice(btn, intent.wantOn ? '새로고침했습니다. 좋아요가 이미 눌려 있습니다.' : '새로고침했습니다. 좋아요가 이미 취소되어 있습니다.');
      return;
    }
    try { sessionStorage.setItem(AUTO, JSON.stringify({ cid: intent.cid, at: Date.now() })); } catch { /* ignore */ }
    btn.click();
    notice(btn, intent.wantOn ? '오래 열린 페이지라 새로고침 후 좋아요를 눌렀습니다.' : '오래 열린 페이지라 새로고침 후 좋아요를 취소했습니다.');
  }

  // Diagnostics for the popup: the last alert shown right after a like click.
  window.addEventListener('message', event => {
    const data = event.data;
    // Only this frame's own page (like-hook.js); messages from other frames are ignored.
    if ((event.source && event.source !== window) || !data || data.__ncc !== 'like-alert' || !alive()) return;
    try {
      chrome.storage.local.set({ [LAST_ALERT]: { message: String(data.message).slice(0, 300), handled: !!data.handled, at: Date.now() } }).catch(() => {});
    } catch { /* extension reloaded */ }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[C.SETTINGS]) return;
    settings = C.settings(changes[C.SETTINGS].newValue);
    applyFlag();
  });
  chrome.storage.local.get(C.SETTINGS).then(items => {
    settings = C.settings(items[C.SETTINGS]);
    applyFlag();
    if (readIntent() && timer === null) tryResume(Date.now() + WAIT_MS);
  }).catch(() => {});
})();
