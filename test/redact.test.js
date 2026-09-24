const test = require('node:test');
const assert = require('node:assert/strict');
const { redact } = require('../lib/redact');

test('che user:pass trong URL rtsp, giu lai host/cong/duong dan', () => {
  const s = 'Command failed: ffmpeg -i "rtsp://admin:S3cret@192.168.1.68:554/Streaming/Channels/101" -y out.jpg';
  const out = redact(s);
  assert.ok(!out.includes('S3cret'));
  assert.ok(!out.includes('admin'));
  assert.match(out, /rtsp:\/\/\*\*\*@192\.168\.1\.68:554\/Streaming\/Channels\/101/);
});

test('mat khau chua ky tu @ van bi che het', () => {
  const out = redact('rtsp://admin:p@ss@192.168.1.68:554/x');
  assert.ok(!out.includes('p@ss'));
  assert.ok(!out.includes('ss@'));
  assert.equal(out, 'rtsp://***@192.168.1.68:554/x');
});

test('che token bot telegram trong URL api', () => {
  assert.equal(
    redact('POST https://api.telegram.org/bot123456789:AAE_abc-DEF123/sendMessage failed'),
    'POST https://api.telegram.org/bot***/sendMessage failed'
  );
});

test('che nhieu URL trong cung mot chuoi', () => {
  const out = redact('a rtsp://u1:p1@h1/x b http://u2:p2@h2/y');
  assert.equal(out, 'a rtsp://***@h1/x b http://***@h2/y');
});

test('van ban thuong va URL khong co credential giu nguyen', () => {
  const s = 'Lỗi: không kết nối được https://api.telegram.org/getMe sau 5s';
  assert.equal(redact(s), s);
});

test('null/undefined -> chuoi rong, so -> chuoi', () => {
  assert.equal(redact(null), '');
  assert.equal(redact(undefined), '');
  assert.equal(redact(42), '42');
});
