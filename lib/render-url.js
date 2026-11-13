// renderUrl: diem vao cua cong cu doc trang can JavaScript.
//   TikTok -> oEmbed (khong mo Chrome); trang khac -> Chrome ngam qua proxy chan IP noi bo.
// Bi chan bot thi bao lai, KHONG thu lai bang cach khac.
const { assertPublicUrl } = require('./web-tools');
const { isTiktokHost, fetchOembed } = require('./oembed');
const { detectBlocked, BLOCKED_NOTE } = require('./render-guard');
const { createRenderProxy } = require('./render-proxy');
const { renderWithChrome } = require('./render-chrome');

const MAX_TEXT_CHARS = 12_000;
const MIN_USABLE_MS = 15_000;

// Tran that cua 1 lan render = min(tran cau hinh, thoi gian con lai cua yeu cau agent - marginMs de lai cho lan goi model cuoi).
// Tra 0 neu con lai it hon MIN_USABLE_MS sau khi tru margin (khong dang de mo Chrome).
function effectiveTimeoutMs({ configuredMs, remainingMs, marginMs = 15_000 }) {
  const usable = remainingMs - marginMs;
  if (usable < MIN_USABLE_MS) return 0;
  return Math.min(configuredMs, usable);
}

async function renderUrl(rawUrl, {
  cfg, limiter, remainingMs = Infinity, http, lookup,
  render = renderWithChrome, createProxy = createRenderProxy,
}) {
  const u = await assertPublicUrl(rawUrl, lookup);

  if (isTiktokHost(u.href)) return fetchOembed(u.href, { http });

  if (!cfg.enabled) throw new Error('Tính năng đọc trang bằng Chrome đang tắt (RENDER_ENABLED=0).');

  const timeoutMs = effectiveTimeoutMs({ configuredMs: cfg.timeoutMs, remainingMs });
  if (timeoutMs === 0) throw new Error('Không đủ thời gian còn lại của yêu cầu này để mở trang bằng Chrome; hãy thử lại bằng một yêu cầu mới.');

  const slot = limiter.tryAcquire();
  if (!slot.ok) {
    throw new Error(slot.reason === 'busy'
      ? 'Đang bận một lần đọc trang khác, thử lại sau ít giây.'
      : `Đã đạt giới hạn ${cfg.maxPerHour} lần đọc trang bằng Chrome mỗi giờ; thử lại sau.`);
  }

  const proxy = createProxy();
  try {
    const proxyPort = await proxy.start();
    const r = await render(u.href, { timeoutMs, chromePath: cfg.chromePath, proxyPort });
    const verdict = detectBlocked({ status: r.status, text: r.text });
    if (verdict.blocked) return { source: 'chrome', url: u.href, blocked: true, reason: verdict.reason, note: BLOCKED_NOTE };
    const text = r.text.length > MAX_TEXT_CHARS ? r.text.slice(0, MAX_TEXT_CHARS) : r.text;
    return { source: 'chrome', url: u.href, title: r.title, text, truncated: r.text.length > MAX_TEXT_CHARS };
  } finally {
    await proxy.stop();
    slot.release();
  }
}

module.exports = { renderUrl, effectiveTimeoutMs };
