const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_IMAGE_BYTES, IMAGE_PLACEHOLDER, parseAgentCaption, pickPhoto, stripInlineData, downloadTelegramFile, detectMime,
} = require('../lib/agent-image');

test('parseAgentCaption: nhận /agent kèm lời, /agent@bot, /agent trống; bỏ qua caption khác', () => {
  assert.equal(parseAgentCaption('/agent thêm lịch cho tôi'), 'thêm lịch cho tôi');
  assert.equal(parseAgentCaption('  /AGENT@Dog_bot  đặt nhắc\nlúc 8h '), 'đặt nhắc\nlúc 8h');
  assert.equal(parseAgentCaption('/agent'), '');
  assert.equal(parseAgentCaption('/agentx abc'), null);
  assert.equal(parseAgentCaption('thêm lịch giúp'), null);
  assert.equal(parseAgentCaption('/status'), null);
  assert.equal(parseAgentCaption(undefined), null);
});

test('pickPhoto: lấy cỡ lớn nhất, bỏ cỡ vượt giới hạn, không có gì dùng được -> null', () => {
  const sizes = [
    { file_id: 'a', width: 90, height: 60, file_size: 1000 },
    { file_id: 'b', width: 1280, height: 960, file_size: 200000 },
    { file_id: 'c', width: 320, height: 240, file_size: 9000 },
  ];
  assert.equal(pickPhoto(sizes).file_id, 'b');
  assert.equal(pickPhoto(sizes, 150000).file_id, 'c');
  assert.equal(pickPhoto(sizes, 10), null);
  assert.equal(pickPhoto([]), null);
  assert.equal(pickPhoto(undefined), null);
  assert.equal(pickPhoto([{ file_id: 'z', width: 10, height: 10 }]).file_id, 'z'); // thiếu file_size vẫn dùng được
});

test('stripInlineData: thay ảnh bằng chữ giữ chỗ, không sửa session gốc, giữ nguyên phần khác', () => {
  const session = {
    meta: { x: 1 },
    contents: [
      { role: 'user', parts: [{ text: 'thêm lịch' }, { inlineData: { mimeType: 'image/jpeg', data: 'AAAA' } }] },
      { role: 'model', parts: [{ functionCall: { name: 'addScheduleItem', args: {} } }] },
    ],
  };
  const out = stripInlineData(session);
  assert.deepEqual(out.contents[0].parts, [{ text: 'thêm lịch' }, { text: IMAGE_PLACEHOLDER }]);
  assert.deepEqual(out.contents[1], session.contents[1]);
  assert.deepEqual(out.meta, { x: 1 });
  assert.equal(session.contents[0].parts[1].inlineData.data, 'AAAA');
  assert.ok(!JSON.stringify(out).includes('AAAA'));
});

test('downloadTelegramFile: gọi getFile rồi tải file, trả Buffer', async () => {
  const calls = [];
  const http = {
    get: async (url, opts) => {
      calls.push([url, opts]);
      if (url.endsWith('/getFile')) return { data: { result: { file_path: 'photos/p1.jpg', file_size: 3 } } };
      return { data: new Uint8Array([0xff, 0xd8, 0xff]) };
    },
  };
  const buf = await downloadTelegramFile(http, { apiBase: 'https://api/botT', fileBase: 'https://api/file/botT' }, 'FID');
  assert.deepEqual([...buf], [0xff, 0xd8, 0xff]);
  assert.equal(calls[0][1].params.file_id, 'FID');
  assert.equal(calls[1][0], 'https://api/file/botT/photos/p1.jpg');
  assert.equal(calls[1][1].maxContentLength, MAX_IMAGE_BYTES);
});

test('downloadTelegramFile: lỗi khi file quá lớn hoặc thiếu file_path', async () => {
  const big = { get: async () => ({ data: { result: { file_path: 'x', file_size: MAX_IMAGE_BYTES + 1 } } }) };
  await assert.rejects(downloadTelegramFile(big, { apiBase: 'a', fileBase: 'b' }, 'F'), /quá lớn/);
  const none = { get: async () => ({ data: { result: {} } }) };
  await assert.rejects(downloadTelegramFile(none, { apiBase: 'a', fileBase: 'b' }, 'F'), /đường dẫn/);
});

test('detectMime: JPEG/PNG/WEBP theo magic bytes, còn lại null', () => {
  assert.equal(detectMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(detectMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), 'image/png');
  assert.equal(detectMime(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])), 'image/webp');
  assert.equal(detectMime(Buffer.from('GIF89a......')), null);
  assert.equal(detectMime(Buffer.alloc(0)), null);
});
