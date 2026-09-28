// Google account sync through chrome.storage.sync (Chrome profile sync).
// chrome.storage.local stays the full source of truth; storage.sync (100KB total,
// 8KB per item, limited writes) holds a compact snapshot of the most recent reads.
//
// storage.sync layout:
//   s:meta  -> { v, updatedAt, clearedAt, chunks }
//   s:0..N  -> encoded read list, split into chunks
//   s:del   -> { readKey: ts }  tombstones for articles marked unread
//   s:alias -> { cafeUrl: cafeId }
// Encoded read list: groups "c<cafeId>:<ids>" / "u<cafeUrl>:<ids>" joined by ";",
// ids sorted and written as base36 deltas joined by ",".
//
// Local bookkeeping (chrome.storage.local):
//   sync:clearedAt -> ts of the last "clear all" on this device
//   sync:tomb      -> { readKey: ts } unread marks made on this device
//   sync:status    -> { at, ok, synced, error } for the popup
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CafeSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';
  const READ = 'r:';
  const ALIAS = 'a:';
  const META = 's:meta';
  const DEL = 's:del';
  const ALIASES = 's:alias';
  const CHUNK = 's:';
  const LOCAL_CLEARED = 'sync:clearedAt';
  const LOCAL_TOMB = 'sync:tomb';
  const STATUS = 'sync:status';
  const CHUNK_CHARS = 7000;
  const MAX_CHUNKS = 12;
  const MAX_DEL_BYTES = 6000;
  const MAX_ALIAS_BYTES = 4000;
  const TOMB_DAYS = 90;

  function parseKey(key) {
    const m = /^r:(c|u):([^:]+):(\d+)$/.exec(key);
    return m && { group: m[1] + m[2], id: Number(m[3]) };
  }

  function encode(keys) {
    const groups = new Map();
    for (const key of keys) {
      const p = parseKey(key);
      if (!p) continue;
      if (!groups.has(p.group)) groups.set(p.group, []);
      groups.get(p.group).push(p.id);
    }
    const out = [];
    for (const group of [...groups.keys()].sort()) {
      const ids = [...new Set(groups.get(group))].sort((a, b) => a - b);
      let prev = 0;
      out.push(group + ':' + ids.map(id => { const d = id - prev; prev = id; return d.toString(36); }).join(','));
    }
    return out.join(';');
  }

  function decode(text) {
    const keys = [];
    for (const part of String(text || '').split(';')) {
      const m = /^(c|u)([^:;]+):([0-9a-z,]+)$/.exec(part);
      if (!m) continue;
      let id = 0;
      for (const d of m[3].split(',')) {
        const n = parseInt(d, 36);
        if (!Number.isFinite(n)) break;
        id += n;
        keys.push(`${READ}${m[1]}:${m[2]}:${id}`);
      }
    }
    return keys;
  }

  // Encodes the most recent reads that fit in `budget` characters.
  function snapshot(reads, budget = CHUNK_CHARS * MAX_CHUNKS) {
    const entries = Object.entries(reads).sort((a, b) => b[1] - a[1]).map(([k]) => k);
    let n = entries.length;
    let text = encode(entries);
    while (text.length > budget && n > 0) {
      n = Math.max(0, Math.min(n - 1, Math.floor(n * (budget / text.length) * 0.98)));
      text = encode(entries.slice(0, n));
    }
    return { text, count: n };
  }

  function chunks(text) {
    const out = [];
    for (let i = 0; i < text.length; i += CHUNK_CHARS) out.push(text.slice(i, i + CHUNK_CHARS));
    return out;
  }

  // Keeps the newest entries of `obj` whose JSON stays within `bytes`.
  function capObject(obj, bytes, order) {
    const out = {};
    let size = 2;
    for (const [k, v] of Object.entries(obj).sort(order)) {
      const add = JSON.stringify(k).length + JSON.stringify(v).length + 2;
      if (size + add > bytes) break;
      out[k] = v;
      size += add;
    }
    return out;
  }

  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  // Pure merge of both stores. Returns what to write where; nothing is written
  // to storage.sync when the merged snapshot equals the remote one.
  function plan(remote, local, now) {
    const meta = remote[META] && typeof remote[META] === 'object' ? remote[META] : { updatedAt: 0, clearedAt: 0, chunks: 0 };
    const remoteText = Array.from({ length: Number(meta.chunks) || 0 }, (_, i) => remote[CHUNK + i] || '').join('');
    const remoteKeys = decode(remoteText);
    const remoteUpdated = Number(meta.updatedAt) || 0;
    const clearedAt = Math.max(Number(meta.clearedAt) || 0, Number(local[LOCAL_CLEARED]) || 0);

    const tomb = {};
    for (const source of [remote[DEL], local[LOCAL_TOMB]]) {
      for (const [k, ts] of Object.entries(source && typeof source === 'object' ? source : {})) {
        const t = Number(ts) || 0;
        if (t > clearedAt && t > now - TOMB_DAYS * 864e5 && t > (tomb[k] || 0)) tomb[k] = t;
      }
    }

    const reads = {};
    const localRemove = [];
    const removed = new Set();
    for (const [k, ts] of Object.entries(local)) {
      if (!k.startsWith(READ)) continue;
      const t = Number(ts) || 0;
      if (t <= clearedAt || (tomb[k] && tomb[k] >= t)) { localRemove.push(k); removed.add(k); }
      else reads[k] = t;
    }
    const localSet = {};
    if (remoteUpdated > clearedAt) {
      for (const k of remoteKeys) {
        if (!(k in reads) && !removed.has(k) && (tomb[k] || 0) < remoteUpdated) {
          reads[k] = remoteUpdated;
          localSet[k] = remoteUpdated;
        }
      }
    }

    const aliases = {};
    const remoteAliases = remote[ALIASES] && typeof remote[ALIASES] === 'object' ? remote[ALIASES] : {};
    for (const [k, v] of Object.entries(local)) if (k.startsWith(ALIAS)) aliases[k.slice(ALIAS.length)] = String(v);
    for (const [cafeUrl, cafeId] of Object.entries(remoteAliases)) {
      if (!(cafeUrl in aliases) && /^\d+$/.test(String(cafeId))) {
        aliases[cafeUrl] = String(cafeId);
        localSet[ALIAS + cafeUrl] = String(cafeId);
      }
    }

    const snap = snapshot(reads);
    const parts = chunks(snap.text);
    const del = capObject(tomb, MAX_DEL_BYTES, (a, b) => b[1] - a[1]);
    const aliasOut = capObject(aliases, MAX_ALIAS_BYTES, (a, b) => (a[0] in remoteAliases ? 0 : 1) - (b[0] in remoteAliases ? 0 : 1));
    const changed = snap.text !== remoteText || !same(del, remote[DEL] || {}) || !same(aliasOut, remoteAliases)
      || clearedAt !== (Number(meta.clearedAt) || 0);

    let syncSet = null;
    const syncRemove = [];
    if (changed) {
      syncSet = { [META]: { v: 1, updatedAt: now, clearedAt, chunks: parts.length }, [DEL]: del, [ALIASES]: aliasOut };
      parts.forEach((part, i) => { syncSet[CHUNK + i] = part; });
      for (let i = parts.length; i < Math.max(Number(meta.chunks) || 0, MAX_CHUNKS); i++) {
        if ((CHUNK + i) in remote) syncRemove.push(CHUNK + i);
      }
    }
    return { localSet, localRemove, syncSet, syncRemove, synced: snap.count, total: Object.keys(reads).length };
  }

  return {
    META, DEL, ALIASES, CHUNK, LOCAL_CLEARED, LOCAL_TOMB, STATUS, CHUNK_CHARS, MAX_CHUNKS,
    encode, decode, snapshot, chunks, plan
  };
});
