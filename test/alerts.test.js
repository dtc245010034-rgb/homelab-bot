const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateAlerts, createCooldown } = require('../lib/alerts');

test('khong vuot nguong -> khong canh bao', () => {
  assert.deepEqual(evaluateAlerts({ cpuPct: 50, ramPct: 60, diskPct: 40, tempC: 55 }), []);
});

test('vuot nguong tung loai -> dung key', () => {
  const keys = evaluateAlerts({ cpuPct: 90, ramPct: 90, diskPct: 90, tempC: 90 }).map(a => a.key);
  assert.deepEqual(keys, ['cpu', 'ram', 'disk', 'temp']);
});

test('dung bang nguong chua tinh la vuot (cpu 85 -> khong)', () => {
  assert.deepEqual(evaluateAlerts({ cpuPct: 85, ramPct: 0, diskPct: 0, tempC: 78 }), []);
});

test('noi dung co gia tri lam tron 1 chu so', () => {
  const [a] = evaluateAlerts({ cpuPct: 91.234, ramPct: 0, diskPct: 0, tempC: 0 });
  assert.match(a.text, /91\.2%/);
});

test('nhiet do 0/null (khong co cam bien) khong bao dong', () => {
  assert.deepEqual(evaluateAlerts({ cpuPct: 0, ramPct: 0, diskPct: 0, tempC: 0 }), []);
  assert.deepEqual(evaluateAlerts({ cpuPct: 0, ramPct: 0, diskPct: 0, tempC: null }), []);
});

test('cooldown: lan dau ready, trong thoi gian cho khong ready, qua han thi ready lai', () => {
  let t = 1000;
  const c = createCooldown(1000, () => t);
  assert.equal(c.ready('cpu'), true);
  t = 1999; assert.equal(c.ready('cpu'), false);
  t = 2000; assert.equal(c.ready('cpu'), true);
});

test('cooldown: cac key doc lap nhau', () => {
  let t = 0;
  const c = createCooldown(1000, () => t);
  assert.equal(c.ready('cpu'), true);
  assert.equal(c.ready('ram'), true);
  assert.equal(c.ready('cpu'), false);
});
