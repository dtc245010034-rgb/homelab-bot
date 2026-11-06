const test = require('node:test');
const assert = require('node:assert/strict');
const { mdToTelegramHtml } = require('../lib/telegram-md');

test('doi **dam**, [chu](link) va gach dau dong sang HTML Telegram', () => {
  const out = mdToTelegramHtml('**Tin 1**\n- OpenAI ra mat X [nguon](https://a.example/p?x=1&y=2)\n* Dong 2');
  assert.equal(out, '<b>Tin 1</b>\n• OpenAI ra mat X <a href="https://a.example/p?x=1&amp;y=2">nguon</a>\n• Dong 2');
});

test('khong de noi dung do model tao ra tu chen the HTML', () => {
  const out = mdToTelegramHtml('<script>alert(1)</script> <a href="x">x</a> [a](javascript:alert(1))');
  assert.ok(!/<script|<a href="x"/.test(out));
  assert.match(out, /&lt;script&gt;/);
  assert.ok(!/href="javascript/.test(out));
});

test('cat dai khong cat giua the HTML (cat tren ban markdown, convert sau)', () => {
  const md = ('[x](https://a.example/' + 'p'.repeat(50) + ') ').repeat(200);
  const out = mdToTelegramHtml(md, 300);
  assert.ok(out.length < 1200);
  assert.equal((out.match(/<a /g) || []).length, (out.match(/<\/a>/g) || []).length);
  assert.ok(out.endsWith('…'));
});

test('muc ### giu 1 emoji dau, noi dung trong blockquote, danh so keycap, y con └, cau chot in nghieng ngoai khoi', () => {
  const md = 'Mo dau\n\n### 🧰 Cong cu 📦:\n- **Tin** `getNews`\n  - y con\n\n### ⏳ Loi hen\n1. Mot\n2. Hai\n\nCan doi gi khong?';
  assert.equal(mdToTelegramHtml(md),
    'Mo dau\n\n<b>🧰 Cong cu</b>\n<blockquote>• <b>Tin</b> <code>getNews</code>\n      └ y con</blockquote>\n\n' +
    '<b>⏳ Loi hen</b>\n<blockquote>1\ufe0f\u20e3 Mot\n2\ufe0f\u20e3 Hai</blockquote>\n<i>Can doi gi khong?</i>');
});

test('the HTML hong long nhau thi quay ve van ban thuan thay vi lam Telegram tu choi tin', () => {
  const out = mdToTelegramHtml('**a [b**](https://x.example) c');
  assert.ok(!/<b>|<a /.test(out));
  assert.match(out, /\*\*a \[b\*\*\]/);
});
