(() => {
  'use strict';
  if (globalThis.__cafeQuietLoaded) return;
  globalThis.__cafeQuietLoaded = true;
  const C = CafeQuiet;
  const HIDDEN = 'data-cafe-quiet-hidden';
  const RELATED_AUTHORS = 'a[id^="Related"], button[id^="Related"], .RelatedArticlesList .member_area > .member';
  // Keep site adapters here: Naver changes both legacy and newer Vue/React views.
  const AUTHORS = [
    '.nickname', '.nick', '.p-nick', '.m-nick', '.nick_area', '.nick_name',
    '.comment_nickname', '.comment_nick', '.txt_nick', '.writer_nick', '.writer_name',
    '.member_nick', '.member_nickname', '.user_nick', '.user_name', '.nick_box .name',
    '.cmt_nick', '.pers_nick_area', '.cafe-nickname',
    'a.id.mlink', 'button[id^="writerInfo"]', RELATED_AUTHORS,
    '.ArticleListItem .SupportingText.is_ellips .text',
    'a[data-nlog-area="recommend_feed.item"] .SupportingText.is_ellips .text',
    '.user_area .ellip', '.profile_info .name', '.WriterInfo .nickname',
    '[data-nickname]', '[data-nick]', '[class*="nickname__"]', '[class*="nickname_"]',
    'a[onclick*="ui(event"]', 'a[onclick*="showMember"]', 'a[onclick*="memberInfo"]'
  ].join(',');
  const COMMENTS = '.CommentItem, .comment_item, .comment-item, .CommentReplyItem, .reply_item, .u_cbox_comment, .comm_cont, #cmt_list li, .cmt_list li, [data-comment-id]';
  const LIST_ITEMS = [
    'tr', '.ArticleItem', '.ArticleListItem', '.article_item', '.article-item', '.ArticleCard', '.article_card',
    'a[data-nlog-area="recommend_feed.item"]',
    '.RelatedArticlesList > .list_item',
    '.article-board li', '.article_list li', '.article-list li', '.board_list li',
    '.list_area li', '.list_area > .list_item', '.search_list li', '.search_result li',
    '.member_list li', '.member-list li', '.member_list tr', '.ranking_list li',
    '.rank_list li', '.popular_list li', '.best_list li', '[data-article-id]',
    '[class*="ArticleItem_item__"]', '[class*="ArticleCard_card__"]'
  ].join(',');
  const ARTICLES = '.ArticleContentBox, .ArticleContent, .article_view, .article-view, #postContent, #app .Article, article';
  const ARTICLE_LINKS = 'a[href*="/articles/"], a[href*="ArticleRead"], a.article';
  const OWNER_UNITS = [COMMENTS, LIST_ITEMS, ARTICLES].join(',');
  const IGNORED = 'script, style, noscript, template, textarea, input, select, option, [contenteditable]:not([contenteditable="false"]), [data-cafe-quiet-ui]';
  // Native blocking removes the nickname entirely. Match Naver's dedicated
  // notice elements, never arbitrary titles/body text quoting the same words.
  const NATIVE_NOTICES = 'button[id^="blockedArticle"], p.blocked_article_notice, .CommentItem .comment_deleted';
  const NATIVE_TEXT = /^차단한 멤버의 (?:게시글|댓글)입니다\.$/;
  let state = C.settings();
  let checkerEnabled = true;
  const enabled = () => checkerEnabled && state.enabled;
  let hidden = new Set();
  let frame = null;
  let contextName = '';
  let lastHover = null;
  let ui;
  let toastTimer;

  function nickname(element) {
    const explicit = element.getAttribute('data-nickname') || element.getAttribute('data-nick');
    if (explicit) return C.normalize(explicit);
    const clone = element.cloneNode(true);
    for (const decoration of clone.querySelectorAll('.blind, .sr-only, .member_grade, [aria-hidden="true"]')) decoration.remove();
    const text = C.normalize(clone.textContent);
    return /(?:…|\.\.\.)$/.test(text) && element.title ? C.normalize(element.title) : text;
  }
  function authorAt(element) {
    if (!(element instanceof Element) || element.closest(IGNORED)) return null;
    return element.closest(AUTHORS);
  }
  function relatedRow(element) {
    const author = element.closest(RELATED_AUTHORS);
    if (!author) return null;
    // Naver renders <a class="member" role="button">, not a button tag.
    // Its explicit list-item wrapper also works for restricted links (href="#").
    const item = author.closest('.RelatedArticlesList > .list_item');
    if (item) return item;
    // PC's bottom board list can use div rows instead of li/tr. Find the
    // smallest shared container for this author and its article title link.
    // Never climb into a group containing other rows or the main article.
    for (let row = author.parentElement; row && row !== document.body; row = row.parentElement) {
      if (row.matches(ARTICLES + ', ul, ol, nav, main')) return null;
      if (row.querySelectorAll(RELATED_AUTHORS).length !== 1) return null;
      if (row.querySelector(ARTICLE_LINKS)) return row;
      if (row.matches('li, tr, [role="row"], [role="listitem"]')) return null;
    }
    return null;
  }
  function owner(element) {
    const mobileTitle = element.closest('.post_title');
    if (mobileTitle) return mobileTitle;
    const related = relatedRow(element);
    if (related) return related;
    const unit = element.closest(OWNER_UNITS);
    // Resolve an otherwise unrecognized list row before the enclosing Article.
    const item = element.closest('li');
    if (item && (!unit || (unit.matches(ARTICLES) && unit.contains(item))) && item.querySelector(ARTICLE_LINKS)) return item;
    if (unit) {
      if (unit.matches(ARTICLES) && !unit.matches(COMMENTS + ',' + LIST_ITEMS)) {
        // Only the primary author can hide an article. A name in its body or
        // an unknown embedded widget must not hide someone else's whole post.
        const primary = Array.from(unit.querySelectorAll(AUTHORS)).find(candidate =>
          !candidate.closest(COMMENTS + ',' + LIST_ITEMS) && !candidate.closest(IGNORED));
        if (!primary || !(primary === element || primary.contains(element))) return element;
      }
      return unit;
    }
    return element;
  }
  function scan() {
    frame = null;
    if (!document.body) return;
    const next = new Set();
    if (enabled()) {
      for (const el of document.querySelectorAll(NATIVE_NOTICES)) {
        if (el.closest(IGNORED) || !NATIVE_TEXT.test(C.normalize(el.textContent))) continue;
        const unit = el.matches('p.blocked_article_notice')
          ? el.closest(ARTICLES)
          : el.closest(COMMENTS + ',' + LIST_ITEMS + ', .article-card-view > li, .article-album-view > li');
        next.add(unit || el);
      }
    }
    const blocked = new Set(enabled() ? state.blocked : []);
    if (blocked.size) {
      for (const el of document.querySelectorAll(AUTHORS)) {
        if (el.closest(IGNORED) || !blocked.has(nickname(el))) continue;
        next.add(owner(el));
        if (el.closest('.post_title')) {
          const body = el.closest('#ct')?.querySelector('#postContent');
          if (body) next.add(body);
        }
      }
      // Catch standalone names in menus, member lists and other unrecognized UI.
      // Only exact text matches; a nickname that is a prefix of another stays visible.
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent || parent.closest(IGNORED) || !blocked.has(C.normalize(node.textContent))) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      let text;
      while ((text = walker.nextNode())) {
        const el = text.parentElement;
        if (el === document.body || el === document.documentElement) continue;
        // Do not collapse a whole article because another person's comment mentions a name.
        if (blocked.has(C.normalize(el.textContent))) next.add(el);
      }
    }
    observer.disconnect();
    for (const el of hidden) if (!next.has(el)) el.removeAttribute(HIDDEN);
    for (const el of next) if (el.getAttribute(HIDDEN) !== 'true') el.setAttribute(HIDDEN, 'true');
    hidden = next;
    observe();
    if (lastHover?.element.closest(`[${HIDDEN}]`)) hideHover();
  }
  function schedule() {
    if (frame === null) frame = requestAnimationFrame(scan);
  }
  const observer = new MutationObserver(records => {
    if (records.some(r => !r.target.parentElement?.closest('[data-cafe-quiet-ui]') &&
        !(r.target instanceof Element && r.target.closest('[data-cafe-quiet-ui]')))) schedule();
  });
  function observe() {
    observer.observe(document, {
      subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ['class', 'id', 'data-nickname', 'data-nick', 'href', 'onclick', 'title']
    });
  }

  function getUI() {
    if (ui?.host.isConnected) return ui;
    const host = document.createElement('div');
    host.setAttribute('data-cafe-quiet-ui', 'true');
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `<style>
      :host { all: initial; }
      button { font: 600 12px/1.4 system-ui,sans-serif; cursor:pointer; }
      #block { position:fixed; z-index:2147483647; border:1px solid #ccd8d2; border-radius:8px; padding:7px 10px; color:#244b3e; background:#fff; box-shadow:0 3px 14px #142b2526; max-width:240px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      #toast { position:fixed; z-index:2147483647; right:20px; bottom:22px; max-width:min(350px,calc(100vw - 48px)); padding:13px 16px; border-radius:12px; color:#fff; background:#203f35; font:13px/1.6 system-ui,sans-serif; box-shadow:0 4px 18px #0002; }
      #undo { margin-left:12px; padding:4px 6px; border:0; border-radius:4px; background:#fff; color:#203f35; }
      [hidden] { display:none !important; }
    </style><button id="block" hidden></button><div id="toast" role="status" hidden><span id="message"></span><button id="undo" hidden>되돌리기</button></div>`;
    document.documentElement.append(host);
    ui = { host, button: shadow.getElementById('block'), toast: shadow.getElementById('toast'),
      message: shadow.getElementById('message'), undo: shadow.getElementById('undo') };
    ui.button.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      if (lastHover) void blockName(lastHover.name);
    });
    return ui;
  }
  function toast(message, undoName) {
    const view = getUI();
    view.message.textContent = message;
    view.toast.hidden = false;
    view.undo.hidden = !undoName;
    view.undo.onclick = async () => {
      try {
        await action({ type: 'remove', names: [undoName] });
        toast('차단을 되돌렸습니다.');
      } catch (error) { toast(error.message); }
    };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { view.toast.hidden = true; }, 7000);
  }
  async function action(change) {
    const result = await chrome.runtime.sendMessage({ channel: 'cafe-quiet', action: change });
    if (!result?.ok) throw new Error(result?.error || '저장하지 못했습니다. 페이지를 새로고침해 주세요.');
    state = C.settings(result.state);
    scan();
  }
  async function blockName(value) {
    try {
      const name = C.validName(value);
      const existed = state.blocked.includes(name);
      hideHover();
      await action({ type: 'add', names: [name] });
      toast(enabled() ? '닉네임과 작성한 글을 숨겼습니다.' : '차단 목록에 추가했습니다. 현재 숨김 기능은 꺼져 있습니다.', existed ? null : name);
    } catch (error) { toast(error.message); }
  }
  function hideHover() {
    lastHover = null;
    if (ui) ui.button.hidden = true;
  }
  document.addEventListener('pointerover', event => {
    if (event.target === ui?.host) return;
    if (!checkerEnabled || !state.quickBlock) return hideHover();
    const el = authorAt(event.target);
    if (!el || el.closest(`[${HIDDEN}]`)) return hideHover();
    const name = nickname(el);
    if (!name || name.length > 80 || state.blocked.includes(name)) return hideHover();
    const view = getUI();
    lastHover = { name, element: el };
    const rect = el.getBoundingClientRect();
    view.button.textContent = `차단 · ${name}`;
    view.button.title = `${name} 님을 모든 카페에서 숨기기`;
    view.button.style.left = `${Math.max(4, Math.min(rect.left, innerWidth - 244))}px`;
    view.button.style.top = `${Math.max(4, Math.min(rect.bottom, innerHeight - 42))}px`;
    view.button.hidden = false;
  }, true);
  // Keep the button reachable across the small gap underneath a nickname.
  document.addEventListener('pointerout', event => {
    if (event.relatedTarget === ui?.host || event.target === ui?.host) return;
    if (!event.relatedTarget) hideHover();
  }, true);
  document.addEventListener('scroll', hideHover, true);
  window.addEventListener('resize', hideHover);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hideHover(); }, true);
  document.addEventListener('contextmenu', event => {
    const author = authorAt(event.target);
    contextName = author ? nickname(author) : '';
  }, true);
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type !== 'cafe-quiet-context-block') return;
    const selection = message.selection?.trim();
    const value = selection || contextName;
    if (!value || /[\r\n]/.test(value)) {
      toast('닉네임 위에서 우클릭하거나 닉네임 하나만 선택해 주세요.');
    } else void blockName(value);
    respond({ ok: true });
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || (!changes[C.KEY] && !changes.settings)) return;
    if (changes[C.KEY]) state = C.settings(changes[C.KEY].newValue);
    if (changes.settings) checkerEnabled = changes.settings.newValue?.enabled !== false;
    if (!checkerEnabled || !state.quickBlock) hideHover();
    schedule();
  });
  observe();
  // Subscribe before loading; a newer storage event must win over a stale read.
  let loaded = false;
  let checkerChanged = false;
  const markChanged = (changes, area) => {
    if (area !== 'local') return;
    if (changes[C.KEY]) loaded = true;
    if (changes.settings) checkerChanged = true;
  };
  chrome.storage.onChanged.addListener(markChanged);
  chrome.storage.local.get([C.KEY, 'settings']).then(stored => {
    if (!loaded) state = C.settings(stored[C.KEY]);
    if (!checkerChanged) checkerEnabled = stored.settings?.enabled !== false;
    chrome.storage.onChanged.removeListener(markChanged);
    schedule();
  }).catch(() => toast('차단 목록을 불러오지 못했습니다. 페이지를 새로고침해 주세요.'));
})();
