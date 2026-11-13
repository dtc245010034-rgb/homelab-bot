// Phat hien trang chan truy cap tu dong + gioi han tan suat/dong thoi cho renderUrl.
// Khi bi chan: bao lai, KHONG thu lai bang cach khac (khong ne kiem tra bot).
const BLOCKED_NOTE = 'Trang này chặn truy cập tự động. Hãy báo người dùng; không thử cách khác để vượt.';

const BLOCK_STATUSES = new Set([401, 403, 429, 503]);
const MIN_TEXT_CHARS = 80;
const SHORT_TEXT_CHARS = 1500; // chi xet dau hieu captcha khi chu ngan: bai bao dai co nhac "captcha" khong bi bao nham
const BOT_WALL = /captcha|verify you are (?:a )?human|unusual traffic|just a moment|please wait|enable javascript|are you a robot|access denied/i;

function detectBlocked({ status, text }) {
  if (BLOCK_STATUSES.has(status)) return { blocked: true, reason: `Máy chủ trả HTTP ${status}` };
  const t = String(text || '').trim();
  if (t.length < MIN_TEXT_CHARS) return { blocked: true, reason: 'Trang gần như trống sau khi tải (có thể đang chặn)' };
  if (t.length < SHORT_TEXT_CHARS && BOT_WALL.test(t)) return { blocked: true, reason: 'Có dấu hiệu CAPTCHA/kiểm tra bot' };
  return { blocked: false };
}

// 1 lan chay cung luc; toi da maxPerHour lan trong cua so truot 1 gio (tinh luc acquire thanh cong).
function createRenderLimiter({ maxPerHour, now = Date.now }) {
  let running = false;
  let stamps = [];
  return {
    tryAcquire() {
      if (running) return { ok: false, reason: 'busy' };
      const t = now();
      stamps = stamps.filter(s => t - s < 3_600_000);
      if (stamps.length >= maxPerHour) return { ok: false, reason: 'rate' };
      stamps.push(t);
      running = true;
      let released = false;
      return { ok: true, release() { if (!released) { released = true; running = false; } } };
    },
  };
}

module.exports = { BLOCKED_NOTE, detectBlocked, createRenderLimiter };
