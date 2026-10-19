(function (root) {
  'use strict';
  const KEY = 'cafeQuietSettings';
  const MAX_NAMES = 5000;
  function normalize(value) {
    return typeof value === 'string'
      ? value.normalize('NFC').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim()
      : '';
  }
  function validName(value) {
    const name = normalize(value);
    if (!name || name.length > 80) throw new Error('닉네임은 1~80자로 입력해 주세요.');
    return name;
  }
  function names(values) {
    if (!Array.isArray(values)) throw new Error('닉네임 목록 형식이 올바르지 않습니다.');
    const result = [...new Set(values.map(validName))];
    if (result.length > MAX_NAMES) throw new Error('최대 5,000명까지 등록할 수 있습니다.');
    return result;
  }
  function settings(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      enabled: source.enabled !== false,
      quickBlock: source.quickBlock !== false,
      blocked: Array.isArray(source.blocked)
        ? [...new Set(source.blocked.map(normalize).filter(n => n && n.length <= 80))].slice(0, MAX_NAMES)
        : []
    };
  }
  function update(previous, action) {
    const state = settings(previous);
    if (action.type === 'add') state.blocked = names([...state.blocked, ...names(action.names)]);
    else if (action.type === 'remove') {
      const remove = new Set(names(action.names));
      state.blocked = state.blocked.filter(n => !remove.has(n));
    } else if (action.type === 'preferences') {
      for (const key of ['enabled', 'quickBlock']) {
        if (typeof action[key] === 'boolean') state[key] = action[key];
      }
    } else throw new Error('지원하지 않는 요청입니다.');
    return state;
  }
  const api = { KEY, normalize, validName, names, settings, update };
  root.CafeQuiet = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
