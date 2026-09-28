(() => {
  'use strict';
  const C = CafeChecker;
  const $ = id => document.getElementById(id);
  let settings = C.settings();
  let confirmTimer = null;

  function render(items) {
    const state = C.fromStorage(items);
    settings = state.settings;
    $('count').textContent = state.reads.size.toLocaleString('ko-KR');
    for (const k of ['enabled', 'dim', 'badge']) $(k).checked = settings[k];
    $('styles').disabled = !settings.enabled;
  }
  async function refresh() { render(await chrome.storage.local.get(null)); }
  function status(text) { $('status').textContent = text; }

  for (const k of ['enabled', 'dim', 'badge']) {
    $(k).addEventListener('change', async () => {
      settings = { ...settings, [k]: $(k).checked };
      try { await chrome.storage.local.set({ [C.SETTINGS]: settings }); status(''); }
      catch { status('설정을 저장하지 못했습니다.'); }
    });
  }

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
      await chrome.storage.local.remove(keys);
      status(`${keys.length.toLocaleString('ko-KR')}개 기록을 삭제했습니다.`);
    } catch { status('삭제하지 못했습니다.'); }
  });

  chrome.storage.onChanged.addListener((_, area) => { if (area === 'local') refresh(); });
  refresh();
})();
