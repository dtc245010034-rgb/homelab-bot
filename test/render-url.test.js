const test = require('node:test');
const assert = require('node:assert/strict');
const { renderUrl, effectiveTimeoutMs } = require('../lib/render-url');
const { createRenderLimiter, BLOCKED_NOTE } = require('../lib/render-guard');

const pub = async () => [{ address: '93.184.216.34' }];
const CFG = { enabled: true, chromePath: 'google-chrome-stable', timeoutMs: 60000, maxPerHour: 10 };
const prose = (n) => 'Mot doan van ban binh thuong khong co gi dac biet ca. '.repeat(Math.ceil(n / 52)).slice(0, n);

function harness({ renderResult, renderError, cfg = CFG, limiter } = {}) {
  const h = { renderCalls: [], proxyStops: 0, proxyStarts: 0, oembedCalls: [] };
  h.render = async (url, opts) => { h.renderCalls.push({ url, opts }); if (renderError) throw renderError; return renderResult || { status: 200, title: 'T', text: prose(500) }; };
  h.createProxy = () => ({ start: async () => { h.proxyStarts++; return 4321; }, stop: async () => { h.proxyStops++; }, stats: () => ({ bytes: 0, exceeded: false, blockedHosts: [] }) });
  h.http = { get: async (url, o) => { h.oembedCalls.push({ url, o }); return { data: { title: "dogvạnvật's Creator Profile", author_name: 'dogvạnvật', author_url: 'https://www.tiktok.com/@dogvanvat', html: '<x>' } }; } };
  h.limiter = limiter || createRenderLimiter({ maxPerHour: cfg.maxPerHour });
  h.opts = { cfg, limiter: h.limiter, http: h.http, lookup: pub, render: h.render, createProxy: h.createProxy };
  return h;
}

test('effectiveTimeoutMs: ke theo thoi gian con lai cua yeu cau tru 15s', () => {
  assert.equal(effectiveTimeoutMs({ configuredMs: 60000, remainingMs: Infinity }), 60000);
  assert.equal(effectiveTimeoutMs({ configuredMs: 60000, remainingMs: 80000 }), 60000);
  assert.equal(effectiveTimeoutMs({ configuredMs: 90000, remainingMs: 70000 }), 55000);
  assert.equal(effectiveTimeoutMs({ configuredMs: 60000, remainingMs: 20000 }), 0);
  assert.equal(effectiveTimeoutMs({ configuredMs: 60000, remainingMs: 30000 }), 15000);
});

test('TikTok ho so: di duong oEmbed, khong mo Chrome, khong dung gioi han', async () => {
  const h = harness();
  const r = await renderUrl('https://www.tiktok.com/@dogvanvat', h.opts);
  assert.equal(r.source, 'oembed');
  assert.equal(r.authorName, 'dogvạnvật');
  assert.equal(h.renderCalls.length, 0);
  assert.equal(h.proxyStarts, 0);
  assert.equal(h.limiter.tryAcquire().ok, true); // chua bi chiem
});

test('TikTok link rut gon: bao chua ho tro, khong mo Chrome', async () => {
  const h = harness();
  await assert.rejects(renderUrl('https://vm.tiktok.com/ZM1/', h.opts), /rút gọn|chưa hỗ trợ/);
  assert.equal(h.renderCalls.length, 0);
  assert.equal(h.oembedCalls.length, 0);
});

test('URL khong hop le (IPv6 loopback, file:, co tai khoan) bi chan truoc khi toi Chrome', async () => {
  const h = harness();
  for (const u of ['http://[::1]/', 'file:///etc/passwd', 'http://u:p@example.com/', 'http://127.0.0.1:8080/', 'khong phai url']) {
    await assert.rejects(renderUrl(u, h.opts), Error, u);
  }
  assert.equal(h.renderCalls.length, 0);
});

test('RENDER_ENABLED=0 -> tu choi, noi ro dang tat', async () => {
  const h = harness({ cfg: { ...CFG, enabled: false } });
  await assert.rejects(renderUrl('https://example.com/', h.opts), /đang tắt/);
  assert.equal(h.renderCalls.length, 0);
});

test('limiter: dang ban hoac qua han muc moi gio -> tu choi, Chrome khong chay', async () => {
  const h = harness();
  const holding = h.limiter.tryAcquire();
  await assert.rejects(renderUrl('https://example.com/', h.opts), /bận/);
  holding.release();
  const small = harness({ cfg: { ...CFG, maxPerHour: 1 } });
  await renderUrl('https://example.com/', small.opts);
  await assert.rejects(renderUrl('https://example.com/', small.opts), /mỗi giờ/);
  assert.equal(h.renderCalls.length, 0);
  assert.equal(small.renderCalls.length, 1);
});

test('con it thoi gian cua yeu cau (<=30s) -> tu choi, khong chiem limiter', async () => {
  const h = harness();
  await assert.rejects(renderUrl('https://example.com/', { ...h.opts, remainingMs: 20000 }), /thời gian/);
  assert.equal(h.renderCalls.length, 0);
  assert.equal(h.limiter.tryAcquire().ok, true);
});

test('trang thuong: truyen timeout da kep + cong proxy + duong dan Chrome vao render, tra title/text', async () => {
  const h = harness();
  const r = await renderUrl('https://example.com/a', { ...h.opts, remainingMs: 70000 });
  assert.equal(r.source, 'chrome');
  assert.equal(r.title, 'T');
  assert.equal(r.truncated, false);
  assert.equal(h.renderCalls[0].url, 'https://example.com/a');
  assert.deepEqual(h.renderCalls[0].opts, { timeoutMs: 55000, chromePath: 'google-chrome-stable', proxyPort: 4321 });
  assert.equal(h.proxyStops, 1);
});

test('chu dai 20000 ky tu bi cat con 12000 va truncated = true', async () => {
  const h = harness({ renderResult: { status: 200, title: 'Dai', text: prose(20000) } });
  const r = await renderUrl('https://example.com/', h.opts);
  assert.equal(r.text.length, 12000);
  assert.equal(r.truncated, true);
});

test('trang chan bot (403): tra blocked + BLOCKED_NOTE, khong goi render lan hai', async () => {
  const h = harness({ renderResult: { status: 403, title: '', text: 'x' } });
  const r = await renderUrl('https://example.com/', h.opts);
  assert.equal(r.blocked, true);
  assert.equal(r.note, BLOCKED_NOTE);
  assert.ok(r.reason);
  assert.ok(!('text' in r));
  assert.equal(h.renderCalls.length, 1);
});

test('render nem loi: van dung proxy va nha limiter (lan sau chay duoc)', async () => {
  const h = harness({ renderError: new Error('Chrome thoat som') });
  await assert.rejects(renderUrl('https://example.com/', h.opts), /Chrome thoat som/);
  assert.equal(h.proxyStops, 1);
  const again = h.limiter.tryAcquire();
  assert.equal(again.ok, true);
});
