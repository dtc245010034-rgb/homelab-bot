const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRmse, shouldAlert, createHealthTracker } = require('../lib/motion');

test('parseRmse: doc gia tri chuan hoa trong ngoac va nhan 65535', () => {
  assert.equal(Math.round(parseRmse('1234.56 (0.0188)')), Math.round(0.0188 * 65535));
  assert.equal(parseRmse('0 (0)'), 0);
});

test('parseRmse: khong parse duoc -> null (khong nham thanh "khong co chuyen dong")', () => {
  assert.equal(parseRmse(''), null);
  assert.equal(parseRmse('compare: unable to open image'), null);
  assert.equal(parseRmse(undefined), null);
});

const base = { threshold: 6000, cooldownMs: 300000, now: 1_000_000, lastAlertAt: 0 };

test('shouldAlert: duoi nguong -> false', () => {
  assert.equal(shouldAlert({ ...base, rmse: 1500 }), false);
  assert.equal(shouldAlert({ ...base, rmse: 6000 }), false); // bang nguong chua tinh la vuot
});

test('shouldAlert: vuot nguong va het cooldown -> true', () => {
  assert.equal(shouldAlert({ ...base, rmse: 9000 }), true);
});

test('shouldAlert: vuot nguong nhung dang trong cooldown -> false', () => {
  assert.equal(shouldAlert({ ...base, rmse: 9000, lastAlertAt: base.now - 60000 }), false);
});

test('shouldAlert: rmse null -> false', () => {
  assert.equal(shouldAlert({ ...base, rmse: null }), false);
});

test('health tracker: bao "down" dung 1 lan sau du so lan that bai lien tiep', () => {
  const h = createHealthTracker({ failThreshold: 3 });
  assert.equal(h.recordFailure(), null);
  assert.equal(h.recordFailure(), null);
  assert.equal(h.recordFailure(), 'down');
  assert.equal(h.isDown, true);
  assert.equal(h.recordFailure(), null); // khong lap lai canh bao
});

test('health tracker: thanh cong sau khi down -> "up" 1 lan', () => {
  const h = createHealthTracker({ failThreshold: 2 });
  h.recordFailure(); h.recordFailure();
  assert.equal(h.recordSuccess(), 'up');
  assert.equal(h.isDown, false);
  assert.equal(h.recordSuccess(), null);
});

test('health tracker: thanh cong xen giua reset bo dem that bai', () => {
  const h = createHealthTracker({ failThreshold: 3 });
  h.recordFailure(); h.recordFailure();
  h.recordSuccess();
  assert.equal(h.recordFailure(), null);
  assert.equal(h.recordFailure(), null);
  assert.equal(h.isDown, false);
});
