const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../extension/sync.js');

test('encode/decode round-trips id and url-name groups compactly', () => {
  const keys = ['r:c:31780162:648', 'r:c:31780162:650', 'r:c:31780162:649', 'r:u:newsickminza:12', 'r:c:5:1', 'junk', 'a:x'];
  const text = S.encode(keys);
  assert.equal(text, 'c31780162:i0,1,1;c5:1;unewsickminza:c');
  assert.deepEqual(S.decode(text).sort(), keys.filter(k => k.startsWith('r:')).sort());
  assert.deepEqual(S.decode('c1:zz;broken;c2:1,2'), ['r:c:1:1295', 'r:c:2:1', 'r:c:2:3']);
});

test('snapshot keeps the newest reads that fit the budget', () => {
  const reads = {};
  for (let i = 0; i < 1000; i++) reads[`r:c:1:${i * 1000}`] = i;
  const snap = S.snapshot(reads, 500);
  assert.ok(snap.text.length <= 500);
  const kept = S.decode(snap.text);
  assert.equal(kept.length, snap.count);
  assert.ok(kept.includes('r:c:1:999000') && !kept.includes('r:c:1:0'));
});

test('plan does not write when remote already matches', () => {
  const local = { 'r:c:1:1': 10 };
  const first = S.plan({}, local, 100);
  assert.ok(first.syncSet);
  const again = S.plan(first.syncSet, local, 200);
  assert.equal(again.syncSet, null);
  assert.deepEqual(again.localSet, {});
  assert.deepEqual(again.localRemove, []);
});
