const test = require('node:test');
const assert = require('node:assert/strict');
const { callWithFallback, GeminiTimeoutError, formatSlowNote } = require('../lib/agent-gemini');

const noSleep = () => Promise.resolve();
const never = () => new Promise(() => {});
const base = (over = {}) => ({
  models: ['a', 'b', 'c'], timeoutMs: 30, sleep: noSleep,
  isPerMinute: (e) => /PerMinute/.test(e.message), onAttempt: () => {}, onDailyExhausted: () => {}, record: () => {},
  ...over,
});

test('model dau tien tra loi: dung ket qua, ghi 1 ban ghi ok', async () => {
  const rec = [];
  const r = await callWithFallback(base({ generate: async ({ model }) => ({ model }), record: (x) => rec.push(x) }));
  assert.equal(r.model, 'a');
  assert.equal(rec.length, 1);
  assert.equal(rec[0].model, 'a'); assert.equal(rec[0].outcome, 'ok');
});

test('model treo qua timeout thi sang model ke tiep NGAY, khong thu lai cung model', async () => {
  const seen = [], rec = [];
  const r = await callWithFallback(base({
    generate: ({ model }) => { seen.push(model); return model === 'a' ? never() : Promise.resolve({ model }); },
    record: (x) => rec.push(x),
  }));
  assert.equal(r.model, 'b');
  assert.deepEqual(seen, ['a', 'b']);
  assert.deepEqual(rec.map(x => x.outcome), ['timeout', 'ok']);
});

test('timeout: huy yeu cau dang treo qua AbortSignal', async () => {
  let sig;
  await callWithFallback(base({
    models: ['a', 'b'],
    generate: ({ model, signal }) => { if (model === 'a') { sig = signal; return never(); } return Promise.resolve({}); },
  }));
  assert.equal(sig.aborted, true);
});

test('tat ca model deu treo: nem GeminiTimeoutError', async () => {
  await assert.rejects(
    callWithFallback(base({ models: ['a', 'b'], generate: never })),
    (e) => e instanceof GeminiTimeoutError && e.isTimeout === true && /không phản hồi/.test(e.message),
  );
});

test('loi 503 thi thu lai 1 lan cung model roi moi sang model khac (hanh vi cu)', async () => {
  const seen = [];
  const err = Object.assign(new Error('high demand'), { status: 503 });
  const r = await callWithFallback(base({
    generate: async ({ model }) => { seen.push(model); if (model === 'a') throw err; return { model }; },
  }));
  assert.deepEqual(seen, ['a', 'a', 'b']);
  assert.equal(r.model, 'b');
});

test('429 het quota ngay: danh dau het va sang model ke tiep', async () => {
  const marked = [];
  const err = Object.assign(new Error('{"x":1}'), { status: 429 });
  const r = await callWithFallback(base({
    generate: async ({ model }) => { if (model === 'a') throw err; return { model }; },
    onDailyExhausted: (model) => marked.push(model),
  }));
  assert.deepEqual(marked, ['a']);
  assert.equal(r.model, 'b');
});

test('loi khac (400) nem ngay, khong doi model', async () => {
  const seen = [];
  const err = Object.assign(new Error('bad schema'), { status: 400 });
  await assert.rejects(callWithFallback(base({ generate: async ({ model }) => { seen.push(model); throw err; } })), /bad schema/);
  assert.deepEqual(seen, ['a']);
});

test('onAttempt duoc goi moi lan goi that (ke ca thu lai)', async () => {
  const attempts = [];
  const err = Object.assign(new Error('x'), { status: 503 });
  await callWithFallback(base({
    generate: async ({ model }) => { if (model === 'a') throw err; return {}; },
    onAttempt: (m) => attempts.push(m),
  }));
  assert.deepEqual(attempts, ['a', 'a', 'b']);
});

test('formatSlowNote: nhanh va khong co su co -> rong', () => {
  assert.equal(formatSlowNote([{ model: 'a', ms: 2000, outcome: 'ok' }], 3000), '');
});

test('formatSlowNote: neu ro model timeout, model thay the va tong thoi gian', () => {
  const s = formatSlowNote([
    { model: 'gemini-3.6-flash', ms: 25000, outcome: 'timeout' },
    { model: 'gemini-3-flash-preview', ms: 2100, outcome: 'ok' },
  ], 28000);
  assert.match(s, /gemini-3\.6-flash/);
  assert.match(s, /25s/);
  assert.match(s, /gemini-3-flash-preview/);
  assert.match(s, /28s/);
});

test('formatSlowNote: khong co timeout nhung tong thoi gian lau -> neu model cham nhat', () => {
  const s = formatSlowNote([{ model: 'gemini-3.6-flash', ms: 47000, outcome: 'ok' }], 48000);
  assert.match(s, /gemini-3\.6-flash/);
  assert.match(s, /47s/);
});
