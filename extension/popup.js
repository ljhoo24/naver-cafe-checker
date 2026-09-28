(() => {
  'use strict';
  const C = CafeChecker;
  const S = CafeSync;
  const $ = id => document.getElementById(id);
  let settings = C.settings();
  let confirmTimer = null;

  function render(items) {
    const state = C.fromStorage(items);
    settings = state.settings;
    $('count').textContent = state.reads.size.toLocaleString('ko-KR');
    for (const k of ['enabled', 'dim', 'badge', 'sync']) $(k).checked = settings[k];
    $('styles').disabled = !settings.enabled;
    $('syncNow').disabled = !settings.sync;
    renderSync(items[S.STATUS]);
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
  async function refresh() { render(await chrome.storage.local.get(null)); }
  function status(text) { $('status').textContent = text; }

  for (const k of ['enabled', 'dim', 'badge', 'sync']) {
    $(k).addEventListener('change', async () => {
      settings = { ...settings, [k]: $(k).checked };
      try { await chrome.storage.local.set({ [C.SETTINGS]: settings }); status(''); }
      catch { status('설정을 저장하지 못했습니다.'); }
    });
  }

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
