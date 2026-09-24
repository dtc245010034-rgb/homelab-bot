const test = require('node:test');
const assert = require('node:assert/strict');
const {
  UNTRUSTED_TOOLS, hasUntrustedResult, callsIncludeUntrusted, needsConfirm, clampIndex,
} = require('../lib/agent-policy');

const userText = (t) => ({ role: 'user', parts: [{ text: t }] });
const modelCall = (name) => ({ role: 'model', parts: [{ functionCall: { name, args: {} } }] });
const toolResult = (name) => ({ role: 'user', parts: [{ functionResponse: { id: name, name, response: { text: 'x' } } }] });

test('getNews nam trong danh sach khong tin cay', () => {
  assert.ok(UNTRUSTED_TOOLS.has('getNews'));
});

test('hasUntrustedResult: chua co ket qua tool -> false', () => {
  assert.equal(hasUntrustedResult([userText('tin tuc?')]), false);
  assert.equal(hasUntrustedResult([]), false);
});

test('hasUntrustedResult: getNews tra ve trong request hien tai -> true', () => {
  const c = [userText('tin gi moi'), modelCall('getNews'), toolResult('getNews')];
  assert.equal(hasUntrustedResult(c), true);
});

test('hasUntrustedResult: getNews cua request CU (truoc luot user-text gan nhat) -> false', () => {
  const c = [userText('tin gi'), modelCall('getNews'), toolResult('getNews'),
             { role: 'model', parts: [{ text: 'day la tin' }] },
             userText('nhac toi 8h uong thuoc')];
  assert.equal(hasUntrustedResult(c), false);
});

test('hasUntrustedResult: tool tin cay (getWeather) khong lam nhiem', () => {
  const c = [userText('thoi tiet'), modelCall('getWeather'), toolResult('getWeather')];
  assert.equal(hasUntrustedResult(c), false);
});

test('callsIncludeUntrusted: nhan dien theo ten', () => {
  assert.equal(callsIncludeUntrusted([{ name: 'getNews' }, { name: 'setReminder' }]), true);
  assert.equal(callsIncludeUntrusted([{ name: 'setReminder' }]), false);
  assert.equal(callsIncludeUntrusted(undefined), false);
});

test('needsConfirm: requiresConfirm luon can; sideEffect chi can khi bi nhiem', () => {
  assert.equal(needsConfirm({ requiresConfirm: true }, false), true);
  assert.equal(needsConfirm({ requiresConfirm: false, sideEffect: true }, false), false);
  assert.equal(needsConfirm({ requiresConfirm: false, sideEffect: true }, true), true);
  assert.equal(needsConfirm({ requiresConfirm: false }, true), false); // tool doc thuan tuy khong can
});

test('clampIndex: ngan hon gioi han -> giu nguyen', () => {
  assert.equal(clampIndex('abc\ndef', 100), 'abc\ndef');
});

test('clampIndex: dai hon -> giu phan duoi, cat o ranh gioi dong, co dong danh dau', () => {
  const lines = Array.from({ length: 50 }, (_, i) => `- [topic-${i}](memory/topic-${i}.md) — mo ta ${i}`);
  const out = clampIndex(lines.join('\n'), 300);
  assert.ok(out.length <= 300 + 60);
  assert.match(out, /^\(…index cũ đã bị cắt bớt…\)\n/);
  assert.ok(out.includes('topic-49'));   // dong moi nhat con
  assert.ok(!out.includes('topic-0)'));  // dong cu nhat da rot
  for (const l of out.split('\n').slice(1)) assert.match(l, /^- \[topic-\d+\]/); // khong dong nao bi cat doi
});
