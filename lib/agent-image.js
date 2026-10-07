// Ảnh gửi kèm /agent: chọn bản ảnh, tải từ Telegram, và không để dữ liệu ảnh nằm lại trong file session.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_PLACEHOLDER = '[Ảnh người dùng đã gửi kèm ở lượt này — nội dung ảnh không được lưu lại]';
const DEFAULT_IMAGE_PROMPT = 'Hãy đọc ảnh này và cho biết có việc/sự kiện nào cần thêm vào lịch (không tự thêm nếu chưa rõ).';

// Caption "/agent <lời>" (hoặc "/agent@tenbot <lời>") -> phần lời (có thể rỗng). Không phải /agent -> null.
function parseAgentCaption(caption) {
  const m = /^\/agent(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(String(caption || '').trim());
  return m ? (m[1] || '').trim() : null;
}

// msg.photo là mảng các cỡ của cùng 1 ảnh: lấy cỡ lớn nhất không vượt MAX_IMAGE_BYTES.
function pickPhoto(sizes, maxBytes = MAX_IMAGE_BYTES) {
  const usable = (Array.isArray(sizes) ? sizes : []).filter(p => p && p.file_id && !(p.file_size > maxBytes));
  if (!usable.length) return null;
  const area = (p) => (p.width || 0) * (p.height || 0);
  return usable.reduce((best, p) => (area(p) > area(best) ? p : best));
}

// Bản sao session để ghi đĩa: thay mọi inlineData bằng dòng chữ giữ chỗ (không sửa session đang dùng trong RAM).
function stripInlineData(session) {
  return {
    ...session,
    contents: session.contents.map(c => ({
      ...c,
      parts: (c.parts || []).map(p => (p && p.inlineData ? { text: IMAGE_PLACEHOLDER } : p)),
    })),
  };
}

// http = axios; apiBase = https://api.telegram.org/bot<TOKEN>; fileBase = https://api.telegram.org/file/bot<TOKEN>
async function downloadTelegramFile(http, { apiBase, fileBase }, fileId, maxBytes = MAX_IMAGE_BYTES) {
  const info = await http.get(`${apiBase}/getFile`, { params: { file_id: fileId }, timeout: 10000 });
  const file = info.data && info.data.result;
  if (!file || !file.file_path) throw new Error('Telegram không trả đường dẫn file');
  if (file.file_size > maxBytes) throw new Error('Ảnh quá lớn');
  const res = await http.get(`${fileBase}/${file.file_path}`, {
    responseType: 'arraybuffer', timeout: 20000, maxContentLength: maxBytes,
  });
  const buf = Buffer.from(res.data);
  if (buf.length > maxBytes) throw new Error('Ảnh quá lớn');
  return buf;
}

// Ảnh Telegram gửi dạng "photo" luôn là JPEG; nhận dạng thêm theo magic bytes cho chắc.
function detectMime(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.length >= 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

module.exports = {
  MAX_IMAGE_BYTES, IMAGE_PLACEHOLDER, DEFAULT_IMAGE_PROMPT,
  parseAgentCaption, pickPhoto, stripInlineData, downloadTelegramFile, detectMime,
};
