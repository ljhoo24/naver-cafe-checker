const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../extension/block-core.js');

test('normalizes unicode and whitespace, preserves exact case and nickname punctuation', () => {
  assert.equal(C.normalize('  가\u200b나   다  '), '가나 다');
  assert.equal(C.normalize('가'), '가');
  assert.deepEqual(C.names(['홍길동', ' 홍길동 ', '홍길동팬', 'Nick', 'nick', '이름,둘']), ['홍길동', '홍길동팬', 'Nick', 'nick', '이름,둘']);
});
test('merges and removes without mutating old state, rejects invalid imports', () => {
  const before = C.settings({ blocked: ['가'] });
  assert.deepEqual(C.update(before, { type: 'add', names: ['나','가'] }).blocked, ['가','나']);
  assert.deepEqual(before.blocked, ['가']);
  assert.deepEqual(C.update(before, { type: 'remove', names: ['가'] }).blocked, []);
  assert.throws(() => C.names(['ok', {}]));
  assert.throws(() => C.names(['x'.repeat(81)]));
  assert.throws(() => C.names(Array.from({length:5001}, (_,i) => String(i))));
  assert.equal(C.update(before, { type: 'preferences', enabled:false }).enabled, false);
});
