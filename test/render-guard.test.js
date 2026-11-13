const test = require('node:test');
const assert = require('node:assert/strict');
const { detectBlocked, createRenderLimiter, BLOCKED_NOTE } = require('../lib/render-guard');

const normal = (n) => 'Day la mot doan van ban binh thuong ve thoi tiet va tin tuc. '.repeat(Math.ceil(n / 58)).slice(0, n);

test('BLOCKED_NOTE: nguyen van theo thiet ke', () => {
  assert.equal(BLOCKED_NOTE, 'Trang này chặn truy cập tự động. Hãy báo người dùng; không thử cách khác để vượt.');
});

test('detectBlocked: ma HTTP 401/403/429/503 -> blocked', () => {
  for (const status of [401, 403, 429, 503]) {
    const r = detectBlocked({ status, text: normal(500) });
    assert.equal(r.blocked, true, String(status));
    assert.match(r.reason, new RegExp(String(status)));
  }
});

test('detectBlocked: chu qua ngan -> blocked, reason nhac trong', () => {
  const r = detectBlocked({ status: 200, text: 'Loading...' });
  assert.equal(r.blocked, true);
  assert.match(r.reason, /trống/);
});

test('detectBlocked: dau hieu captcha/kiem tra bot trong chu ngan -> blocked', () => {
  for (const t of ['Please wait...', 'Just a moment...', 'Please verify you are human to continue. ' + normal(300), 'We detected unusual traffic from your network. ' + normal(300), 'Complete the CAPTCHA below. ' + normal(300)]) {
    assert.equal(detectBlocked({ status: 200, text: t }).blocked, true, t.slice(0, 40));
  }
});

test('detectBlocked: bai dai co nhac captcha khong bi bao nham', () => {
  const t = normal(3000) + ' captcha ' + normal(100);
  assert.equal(detectBlocked({ status: 200, text: t }).blocked, false);
});

test('detectBlocked: trang binh thuong, status 200 hoac null -> khong blocked', () => {
  assert.equal(detectBlocked({ status: 200, text: normal(500) }).blocked, false);
  assert.equal(detectBlocked({ status: null, text: normal(500) }).blocked, false);
});

test('limiter: dang chay thi lan thu hai bi busy, release xong thi lai duoc', () => {
  const l = createRenderLimiter({ maxPerHour: 10, now: () => 0 });
  const a = l.tryAcquire();
  assert.equal(a.ok, true);
  assert.deepEqual(l.tryAcquire(), { ok: false, reason: 'busy' });
  a.release();
  assert.equal(l.tryAcquire().ok, true);
});

test('limiter: release goi hai lan khong lam hong trang thai', () => {
  const l = createRenderLimiter({ maxPerHour: 10, now: () => 0 });
  const a = l.tryAcquire(); a.release(); a.release();
  const b = l.tryAcquire();
  assert.equal(b.ok, true);
  assert.deepEqual(l.tryAcquire(), { ok: false, reason: 'busy' });
});

test('limiter: qua maxPerHour trong cung gio -> rate, sau 1 gio thi ok lai', () => {
  let t = 0;
  const l = createRenderLimiter({ maxPerHour: 3, now: () => t });
  for (let i = 0; i < 3; i++) { const a = l.tryAcquire(); assert.equal(a.ok, true, `lan ${i + 1}`); a.release(); }
  assert.deepEqual(l.tryAcquire(), { ok: false, reason: 'rate' });
  t = 3600001;
  assert.equal(l.tryAcquire().ok, true);
});
