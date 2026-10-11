const test = require('node:test');
const assert = require('node:assert/strict');
const { createConfirmStore, confirmKeyboard, parseConfirmCallback } = require('../lib/agent-confirm');

test('request: tra ve id 8 ky tu hex; bam nut dung id -> promise "yes"', async () => {
  const store = createConfirmStore({ timeoutMs: 1000 });
  const { id, promise } = store.request(1);
  assert.match(id, /^[0-9a-f]{8}$/);
  assert.equal(store.answer(1, 'yes', id), 'ok');
  assert.equal(await promise, 'yes');
  assert.equal(store.hasPending(1), false);
});

test('answer: go tay (khong id) ap dung cho yeu cau dang cho', async () => {
  const store = createConfirmStore({ timeoutMs: 1000 });
  const { promise } = store.request(1);
  assert.equal(store.answer(1, 'no'), 'ok');
  assert.equal(await promise, 'no');
});

test('answer: nut cua yeu cau cu (sai id) -> stale, yeu cau hien tai khong bi anh huong', async () => {
  const store = createConfirmStore({ timeoutMs: 1000 });
  const { id, promise } = store.request(1);
  assert.equal(store.answer(1, 'yes', 'deadbeef'), 'stale');
  assert.equal(store.hasPending(1), true);
  assert.equal(store.answer(1, 'yes', id), 'ok');
  assert.equal(await promise, 'yes');
});

test('answer: khong co yeu cau nao dang cho -> none', () => {
  const store = createConfirmStore({ timeoutMs: 1000 });
  assert.equal(store.answer(1, 'yes'), 'none');
  assert.equal(store.answer(1, 'yes', 'deadbeef'), 'none');
});

test('het han -> promise "timeout", sau do bam nut cu -> none', async () => {
  const store = createConfirmStore({ timeoutMs: 20 });
  const { id, promise } = store.request(1);
  assert.equal(await promise, 'timeout');
  assert.equal(store.hasPending(1), false);
  assert.equal(store.answer(1, 'yes', id), 'none');
});

test('moi chat co yeu cau rieng', async () => {
  const store = createConfirmStore({ timeoutMs: 1000 });
  const a = store.request(1);
  const b = store.request(2);
  assert.equal(store.answer(2, 'yes', b.id), 'ok');
  assert.equal(await b.promise, 'yes');
  assert.equal(store.hasPending(1), true);
  assert.equal(store.answer(1, 'no', a.id), 'ok');
  assert.equal(await a.promise, 'no');
});

test('request moi trong cung chat huy yeu cau cu (resolve "no"), id cu thanh stale', async () => {
  const store = createConfirmStore({ timeoutMs: 1000 });
  const first = store.request(1);
  const second = store.request(1);
  assert.equal(await first.promise, 'no');
  assert.equal(store.answer(1, 'yes', first.id), 'stale');
  assert.equal(store.answer(1, 'yes', second.id), 'ok');
  assert.equal(await second.promise, 'yes');
});

test('confirmKeyboard: hai nut yes/no mang id, callback_data <= 64 byte', () => {
  const kb = confirmKeyboard('abcd1234');
  assert.equal(kb.length, 1);
  assert.equal(kb[0].length, 2);
  assert.match(kb[0][0].text, /Xác nhận/);
  assert.match(kb[0][1].text, /Huỷ/);
  for (const b of kb[0]) assert.ok(Buffer.byteLength(b.callback_data) <= 64);
  assert.deepEqual(parseConfirmCallback(kb[0][0].callback_data), { answer: 'yes', id: 'abcd1234' });
  assert.deepEqual(parseConfirmCallback(kb[0][1].callback_data), { answer: 'no', id: 'abcd1234' });
});

test('parseConfirmCallback: du lieu la hoac sai dinh dang -> null', () => {
  assert.equal(parseConfirmCallback('cmd_help'), null);
  assert.equal(parseConfirmCallback('agc:maybe:abcd1234'), null);
  assert.equal(parseConfirmCallback('agc:yes:'), null);
  assert.equal(parseConfirmCallback('agc:yes:XYZ!'), null);
  assert.equal(parseConfirmCallback(undefined), null);
});
