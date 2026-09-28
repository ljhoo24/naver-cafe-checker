const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = name => fs.readFileSync(path.join(__dirname, '../extension', name), 'utf8');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// One fake chrome.storage.local shared by every window, like frames/tabs of one profile.
function createStore(initial = {}) {
  const data = { ...initial };
  const listeners = new Set();
  const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  function emit(changes) { if (Object.keys(changes).length) for (const fn of listeners) fn(clone(changes), 'local'); }
  const local = {
    async get(keys) {
      if (keys === null || keys === undefined) return clone(data);
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter(k => k in data).map(k => [k, clone(data[k])]));
    },
    async set(items) {
      const changes = {};
      for (const [k, v] of Object.entries(items)) { changes[k] = { oldValue: clone(data[k]), newValue: clone(v) }; data[k] = clone(v); }
      emit(changes);
    },
    async remove(keys) {
      const changes = {};
      for (const k of [].concat(keys)) if (k in data) { changes[k] = { oldValue: data[k] }; delete data[k]; }
      emit(changes);
    }
  };
  return { data, local, onChanged: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) } };
}

async function page(html, { url = 'https://cafe.naver.com/f-e/cafes/31780162/menus/0', store = createStore() } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, { url, runScripts: 'outside-only' });
  const w = dom.window;
  w.chrome = { runtime: { id: 'test' }, storage: { local: store.local, onChanged: store.onChanged } };
  w.eval(source('core.js'));
  w.eval(source('content.js'));
  await wait(120);
  return { dom, w, store, doc: w.document, get: id => w.document.getElementById(id), settle: () => wait(120) };
}

module.exports = { source, wait, createStore, page };
