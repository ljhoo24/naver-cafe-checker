(() => {
  'use strict';
  const C = CafeQuiet;
  const $ = id => document.getElementById(id);
  let state = C.settings();
  let checkerEnabled = true;
  let busy = false;
  function status(message, error = false) {
    $('status').textContent = message;
    $('status').classList.toggle('error', error);
  }
  function render() {
    $('enabled').checked = state.enabled;
    $('quick-block').checked = state.quickBlock;
    $('count').textContent = state.blocked.length;
    $('summary').textContent = !checkerEnabled
      ? '체커 전체 사용이 꺼져 있습니다. 팝업에서 켜면 숨김이 적용됩니다.'
      : state.enabled ? `숨김 켜짐 · 네이버 차단 안내와 ${state.blocked.length}명의 닉네임·글을 숨깁니다.`
      : '숨김 일시 중지 · 차단 목록은 보관 중입니다.';
    $('summary').classList.toggle('paused', !checkerEnabled || !state.enabled);
    const query = C.normalize($('search').value).toLocaleLowerCase('ko');
    const visible = state.blocked.filter(n => n.toLocaleLowerCase('ko').includes(query)).sort((a,b) => a.localeCompare(b, 'ko'));
    const fragment = document.createDocumentFragment();
    for (const name of visible) {
      const li = document.createElement('li');
      const label = document.createElement('span'); label.textContent = name;
      const button = document.createElement('button'); button.textContent = '해제';
      button.setAttribute('aria-label', `${name} 차단 해제`);
      button.addEventListener('click', () => void change({ type: 'remove', names: [name] }, '차단을 해제했습니다.'));
      li.append(label, button); fragment.append(li);
    }
    $('list').replaceChildren(fragment);
    $('empty').hidden = visible.length > 0;
    $('empty').textContent = query ? '검색 결과가 없습니다.' : '아직 차단한 사용자가 없어요. 닉네임을 추가해 주세요.';
  }
  async function change(action, message) {
    if (busy) return false;
    busy = true;
    for (const el of document.querySelectorAll('button, input[type="checkbox"]')) el.disabled = true;
    try {
      const result = await chrome.runtime.sendMessage({ channel: 'cafe-quiet', action });
      if (!result?.ok) throw new Error(result?.error || '저장하지 못했습니다. 다시 시도해 주세요.');
      state = C.settings(result.state);
      render(); status(message);
      return true;
    } catch (error) { render(); status(error.message, true); return false; }
    finally {
      busy = false;
      for (const el of document.querySelectorAll('button, input[type="checkbox"]')) el.disabled = false;
    }
  }
  $('add-form').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const names = C.names($('names').value.split(/\r?\n/).filter(n => n.trim()));
      if (!names.length) throw new Error('차단할 닉네임을 입력해 주세요.');
      if (await change({ type: 'add', names }, '차단 목록에 추가했습니다. 열린 카페에도 바로 적용됩니다.')) {
        $('names').value = ''; $('names').focus();
      }
    } catch (error) { status(error.message, true); }
  });
  $('names').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault(); $('add-form').requestSubmit();
    }
  });
  $('names').placeholder = '닉네임 입력 · 여러 명은 Shift+Enter';
  $('enabled').addEventListener('change', () => void change({ type: 'preferences', enabled: $('enabled').checked }, '설정을 적용했습니다.'));
  $('quick-block').addEventListener('change', () => void change({ type: 'preferences', quickBlock: $('quick-block').checked }, '설정을 적용했습니다.'));
  $('search').addEventListener('input', render);
  $('export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ version: 1, blocked: state.blocked }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'cafe-quiet-blocklist.json';
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    status('차단 목록을 JSON 파일로 내보냈습니다.');
  });
  $('import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async () => {
    try {
      const file = $('import-file').files[0]; if (!file) return;
      if (file.size > 2 * 1024 * 1024) throw new Error('2MB 이하의 목록 파일을 선택해 주세요.');
      const data = JSON.parse(await file.text());
      const names = C.names(Array.isArray(data) ? data : data?.blocked);
      await change({ type: 'add', names }, '기존 목록에 합쳐서 가져왔습니다.');
    } catch (error) { status(`가져오기 실패: ${error.message}`, true); }
    finally { $('import-file').value = ''; }
  });
  let changed = false;
  let checkerChanged = false;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[C.KEY]) { changed = true; state = C.settings(changes[C.KEY].newValue); }
    if (changes.settings) { checkerChanged = true; checkerEnabled = changes.settings.newValue?.enabled !== false; }
    render();
  });
  chrome.storage.local.get([C.KEY, 'settings']).then(stored => {
    if (!changed) state = C.settings(stored[C.KEY]);
    if (!checkerChanged) checkerEnabled = stored.settings?.enabled !== false;
    render();
  }).catch(() => status('차단 목록을 불러오지 못했습니다. 확장 프로그램을 다시 열어 주세요.', true));
})();
