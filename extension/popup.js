(() => {
  'use strict';
  const C = CafeChecker;
  const S = CafeSync;
  const $ = id => document.getElementById(id);
  let settings = C.settings();
  let confirmTimer = null;
  const KEYS = ['enabled', 'dim', 'badge', 'sync', 'likeRetry', 'hotkeys'];
  const HOTKEYS = { prevKey: 'nextKey', nextKey: 'prevKey' };
  const HOTKEY_NAMES = { prevKey: '이전 글', nextKey: '다음 글' };
  const KEY_HINT = '키 버튼을 누른 뒤 원하는 키를 누르세요. 한/영 상태와 관계없이 같은 자리의 키로 동작합니다.';
  let capturing = null;

  function render(items) {
    const state = C.fromStorage(items);
    settings = state.settings;
    $('count').textContent = state.reads.size.toLocaleString('ko-KR');
    for (const k of KEYS) $(k).checked = settings[k];
    $('styles').disabled = !settings.enabled;
    $('likeBox').disabled = !settings.enabled;
    $('hotkeyBox').disabled = !settings.enabled;
    renderKeys();
    renderLike(items['like:last']);
    $('syncNow').disabled = !settings.sync;
    renderSync(items[S.STATUS]);
  }
  function renderKeys() {
    for (const name of Object.keys(HOTKEYS)) {
      const btn = $(name);
      btn.disabled = !settings.hotkeys;
      btn.classList.toggle('capturing', capturing === name);
      btn.textContent = capturing === name ? '키 입력…' : C.keyLabel(settings[name]);
    }
  }
  function keyHint(text, error = false) {
    $('keyHint').textContent = text;
    $('keyHint').classList.toggle('error', error);
  }
  function stopCapture() {
    capturing = null;
    keyHint(KEY_HINT);
    renderKeys();
  }
  function ago(ts) {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return '방금';
    if (s < 3600) return Math.floor(s / 60) + '분 전';
    if (s < 86400) return Math.floor(s / 3600) + '시간 전';
    return new Date(ts).toLocaleDateString('ko-KR');
  }
  function renderSync(st) {
    const el = $('syncStatus');
    el.classList.remove('error');
    if (!settings.sync) el.textContent = '꺼져 있습니다.';
    else if (!st || !st.at) el.textContent = '아직 동기화하지 않았습니다.';
    else if (st.ok) el.textContent = `${ago(st.at)} 동기화 · ${st.synced.toLocaleString('ko-KR')}개 공유`;
    else { el.textContent = '동기화 실패: ' + st.error; el.classList.add('error'); }
  }
  // Shown so an unrecognized "page open too long" message can be reported and matched.
  function renderLike(last) {
    const el = $('likeLast');
    el.hidden = !(last && last.message);
    if (el.hidden) return;
    el.textContent = `최근 좋아요 오류(${ago(last.at)}, ${last.handled ? '자동 처리함' : '처리 안 함'}): “${last.message}”`;
  }
  async function refresh() { render(await chrome.storage.local.get(null)); }
  function status(text) { $('status').textContent = text; }

  for (const k of KEYS) {
    $(k).addEventListener('change', async () => {
      settings = { ...settings, [k]: $(k).checked };
      try { await chrome.storage.local.set({ [C.SETTINGS]: settings }); status(''); }
      catch { status('설정을 저장하지 못했습니다.'); }
    });
  }

  for (const name of Object.keys(HOTKEYS)) {
    $(name).addEventListener('click', () => {
      capturing = capturing === name ? null : name;
      keyHint(capturing ? `${HOTKEY_NAMES[name]}에 쓸 키를 누르세요. (Esc: 취소)` : KEY_HINT);
      renderKeys();
    });
    $(name).addEventListener('blur', () => { if (capturing === name) stopCapture(); });
  }
  document.addEventListener('keydown', async event => {
    if (!capturing) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.code === 'Escape') { stopCapture(); return; }
    if (/^(Shift|Control|Alt|Meta|OS)/.test(event.code) || event.code === 'CapsLock') return;
    const name = capturing;
    const label = C.keyLabel(event.code) || event.key;
    if (!C.isHotkeyCode(event.code)) { keyHint(`${label} 키는 쓸 수 없습니다. 영문·숫자·방향키·기호 키를 눌러 주세요.`, true); return; }
    if (event.code === settings[HOTKEYS[name]]) { keyHint(`${label} 키는 이미 ${HOTKEY_NAMES[HOTKEYS[name]]}에 쓰고 있습니다.`, true); return; }
    settings = { ...settings, [name]: event.code };
    stopCapture();
    try { await chrome.storage.local.set({ [C.SETTINGS]: settings }); keyHint(`${HOTKEY_NAMES[name]}: ${label} 키로 바꿨습니다.`); }
    catch { keyHint('설정을 저장하지 못했습니다.', true); }
  }, true);

  $('syncNow').addEventListener('click', async () => {
    $('syncNow').disabled = true;
    $('syncStatus').textContent = '동기화 중…';
    try { await chrome.runtime.sendMessage({ type: 'ncc-sync-now' }); } catch { status('동기화를 시작하지 못했습니다.'); }
    await refresh();
  });

  $('clear').addEventListener('click', async () => {
    const button = $('clear');
    if (!button.classList.contains('confirm')) {
      button.classList.add('confirm');
      button.textContent = '한 번 더 누르면 전체 삭제';
      confirmTimer = setTimeout(() => { button.classList.remove('confirm'); button.textContent = '읽음 기록 전체 삭제'; }, 4000);
      return;
    }
    clearTimeout(confirmTimer);
    button.classList.remove('confirm');
    button.textContent = '읽음 기록 전체 삭제';
    try {
      const items = await chrome.storage.local.get(null);
      const keys = Object.keys(items).filter(k => k.startsWith(C.READ));
      // Recorded so other browsers on the same Google account clear too.
      await chrome.storage.local.set({ [S.LOCAL_CLEARED]: Date.now() });
      await chrome.storage.local.remove(keys);
      status(`${keys.length.toLocaleString('ko-KR')}개 기록을 삭제했습니다.`);
    } catch { status('삭제하지 못했습니다.'); }
  });

  chrome.storage.onChanged.addListener((_, area) => { if (area === 'local') refresh(); });
  refresh();
})();
