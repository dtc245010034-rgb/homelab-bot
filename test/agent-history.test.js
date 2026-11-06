const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fold, queryTerms, sessionToExchanges, buildTranscript, countUserTurns, searchHistory } = require('../lib/agent-history');

const u = (t) => ({ role: 'user', parts: [{ text: t }] });
const m = (t) => ({ role: 'model', parts: [{ text: t }] });
const call = (name) => ({ role: 'model', parts: [{ functionCall: { name, args: {} } }] });
const resp = (name, text) => ({ role: 'user', parts: [{ functionResponse: { name, response: { text } } }] });
const session = (iso, contents) => ({ meta: { createdAt: iso, lastActivityAt: iso }, contents });

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hist-'));
  const dirs = { sessionsDir: root, archiveDir: path.join(root, 'archive'), summariesDir: path.join(root, 'summaries') };
  fs.mkdirSync(dirs.archiveDir); fs.mkdirSync(dirs.summariesDir);
  const put = (file, obj) => fs.writeFileSync(file, typeof obj === 'string' ? obj : JSON.stringify(obj));
  return { root, dirs, put, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('fold: bo dau, d-gach, hoa thuong', () => {
  assert.equal(fold('Đà Lạt, HÔM KIA'), 'da lat, hom kia');
});

test('queryTerms: bo tu dung va tu 1 ky tu; neu chi con tu dung thi giu lai', () => {
  assert.deepEqual(queryTerms('hôm kia mình hỏi gì về Đà Lạt'), ['hoi', 'da', 'lat']);
  assert.deepEqual(queryTerms('của'), ['cua']);
  assert.deepEqual(queryTerms('a'), []);
});

test('sessionToExchanges: bo functionCall/Response, lay cau tra loi cuoi cua moi cau hoi', () => {
  const s = session('2026-11-01T00:00:00Z', [
    u('thời tiết?'), call('getWeather'), resp('getWeather', 'du lieu tho'), m('Hà Nội 25 độ'),
    u('tin AI?'), m('có 3 tin'),
  ]);
  assert.deepEqual(sessionToExchanges(s), [{ q: 'thời tiết?', a: 'Hà Nội 25 độ' }, { q: 'tin AI?', a: 'có 3 tin' }]);
  assert.equal(countUserTurns(s), 4 - 2); // 2 luot user-text (functionResponse khong tinh)
});

test('buildTranscript: cat ngan o giua khi qua dai, giu dau va cuoi', () => {
  const s = session('2026-11-01T00:00:00Z', Array.from({ length: 40 }, (_, i) => (i % 2 ? m(`tra loi ${i} `.repeat(30)) : u(`cau hoi ${i} `.repeat(30)))));
  const t = buildTranscript(s, 2000);
  assert.ok(t.length < 2200);
  assert.match(t, /lược bớt/);
  assert.match(t, /^Người dùng: cau hoi 0/);
  assert.match(t, /tra loi 39/);
});

test('searchHistory: tim trong phien luu tru, khong dau van khop, xep moi nhat truoc', () => {
  const { dirs, put, done } = setup();
  try {
    put(path.join(dirs.archiveDir, '42-2026-10-01T03-00-00-000Z-idle48h.json'), session('2026-10-01T03:00:00Z', [u('Giá vàng hôm nay?'), m('Vàng 80 triệu')]));
    put(path.join(dirs.archiveDir, '42-2026-11-03T03-00-00-000Z-manual.json'), session('2026-11-03T03:00:00Z', [u('Lịch đi Đà Lạt thế nào'), m('Đi Đà Lạt 3 ngày'), u('giá vàng'), m('Vàng 85 triệu')]));
    put(path.join(dirs.archiveDir, '99-2026-11-03T03-00-00-000Z-manual.json'), session('2026-11-03T03:00:00Z', [u('giá vàng của người khác'), m('x')]));
    const r = searchHistory({ ...dirs, chatId: 42, query: 'gia vang', now: Date.parse('2026-11-06T00:00:00Z') });
    assert.equal(r.exchanges.length, 2);
    assert.equal(r.exchanges[0].date, '2026-11-03'); // moi nhat truoc khi diem bang nhau
    assert.match(r.exchanges[0].answer, /85 triệu/);
    assert.ok(r.exchanges.every(e => !/người khác/.test(e.question)), 'khong lay phien cua chat khac');
    assert.equal(searchHistory({ ...dirs, chatId: 42, query: 'Đà Lạt' }).exchanges.length, 1);
  } finally { done(); }
});

test('searchHistory: phien dang chay bo qua cau hoi dang xu ly; sinceDays loc theo ngay', () => {
  const { dirs, put, done } = setup();
  try {
    put(path.join(dirs.sessionsDir, '42.json'), session('2026-11-05T10:00:00Z', [u('nhắc mình mua sữa'), m('đã ghi'), u('hôm kia mình hỏi gì về sữa')]));
    put(path.join(dirs.archiveDir, '42-2026-09-01T03-00-00-000Z-manual.json'), session('2026-09-01T03:00:00Z', [u('mua sữa ở đâu'), m('Co.op')]));
    const now = Date.parse('2026-11-06T00:00:00Z');
    const all = searchHistory({ ...dirs, chatId: 42, query: 'sữa', now });
    assert.equal(all.exchanges.length, 2);
    assert.ok(all.exchanges.every(e => e.question !== 'hôm kia mình hỏi gì về sữa'));
    const recent = searchHistory({ ...dirs, chatId: 42, query: 'sữa', sinceDays: 7, now });
    assert.deepEqual(recent.exchanges.map(e => e.session), ['đang chạy']);
  } finally { done(); }
});

test('searchHistory: tim trong ban tom tat, kem ngay; khong khop -> note', () => {
  const { dirs, put, done } = setup();
  try {
    put(path.join(dirs.summariesDir, '42-2026-10-01T03-00-00-000Z-idle48h.md'), 'when: 2026-10-01T03:00:00Z\nreason: idle48h\n\n- Hỏi về router mới\n- Chốt mua TP-Link\n');
    put(path.join(dirs.summariesDir, '7-2026-10-01T03-00-00-000Z-idle48h.md'), 'when: 2026-10-01T03:00:00Z\n\n- router cua chat khac\n');
    const r = searchHistory({ ...dirs, chatId: 42, query: 'router' });
    assert.equal(r.summaries.length, 1);
    assert.equal(r.summaries[0].date, '2026-10-01');
    assert.match(r.summaries[0].summary, /TP-Link/);
    assert.doesNotMatch(r.summaries[0].summary, /^when:/m);
    const none = searchHistory({ ...dirs, chatId: 42, query: 'khongcoganhu' });
    assert.deepEqual(none.exchanges, []);
    assert.match(none.note, /Không tìm thấy/);
  } finally { done(); }
});

test('searchHistory: file hong / thu muc thieu / tu khoa trong khong lam bot chet', () => {
  const { dirs, put, done } = setup();
  try {
    put(path.join(dirs.archiveDir, '42-2026-10-01T03-00-00-000Z-manual.json'), '{khong phai json');
    assert.deepEqual(searchHistory({ ...dirs, chatId: 42, query: 'gi do' }).exchanges, []);
    assert.deepEqual(searchHistory({ sessionsDir: '/khong/co', archiveDir: '/khong/co/a', summariesDir: '/khong/co/s', chatId: 1, query: 'abc' }).exchanges, []);
    assert.ok(searchHistory({ ...dirs, chatId: 42, query: '  ' }).error);
  } finally { done(); }
});
