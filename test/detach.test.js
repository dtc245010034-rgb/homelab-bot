const test = require('node:test');
const assert = require('node:assert/strict');
const { createDetacher } = require('../lib/detach');

const tick = () => new Promise(r => setImmediate(r));

test('run tra ve true va chay fn', async () => {
  const run = createDetacher();
  let ran = false;
  assert.equal(run('a', async () => { ran = true; }), true);
  await tick();
  assert.equal(ran, true);
});

test('cung key dang chay -> bo qua (false), fn thu hai khong chay', async () => {
  const run = createDetacher();
  let release; const gate = new Promise(r => { release = r; });
  let calls = 0;
  assert.equal(run('cam', async () => { calls++; await gate; }), true);
  await tick();
  assert.equal(run('cam', async () => { calls++; }), false);
  release(); await tick();
  assert.equal(calls, 1);
});

test('key khac nhau chay song song', async () => {
  const run = createDetacher();
  let release; const gate = new Promise(r => { release = r; });
  assert.equal(run('a', () => gate), true);
  assert.equal(run('b', async () => {}), true);
  release(); await tick();
});

test('nha khoa sau khi xong: chay lai duoc', async () => {
  const run = createDetacher();
  run('a', async () => {}); await tick();
  assert.equal(run('a', async () => {}), true);
});

test('fn nem loi: goi onError, khong throw ra ngoai, va nha khoa', async () => {
  const errors = [];
  const run = createDetacher((key, e) => errors.push([key, e.message]));
  assert.equal(run('x', async () => { throw new Error('boom'); }), true);
  await tick();
  assert.deepEqual(errors, [['x', 'boom']]);
  assert.equal(run('x', async () => {}), true);
});

test('fn dong bo nem loi cung duoc bat', async () => {
  const errors = [];
  const run = createDetacher((key, e) => errors.push(e.message));
  run('s', () => { throw new Error('sync-boom'); });
  await tick();
  assert.deepEqual(errors, ['sync-boom']);
});
