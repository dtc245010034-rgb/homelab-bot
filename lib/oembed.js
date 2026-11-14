// oEmbed cong khai cua TikTok: ten kenh (ho so) hoac tieu de/nguoi dang/anh bia (mot video), khong can JavaScript.
// Khong bao gio tra khoi `html` cua oEmbed (co the chua the script).
const axios = require('axios');
const { USER_AGENT } = require('./rss');

const OEMBED_URL = 'https://www.tiktok.com/oembed';
const VALID_PATH = /^\/@[\w.\-]+(?:\/video\/\d+)?\/?$/;

function hostOf(rawUrl) {
  try { return new URL(String(rawUrl)).hostname.toLowerCase(); } catch { return ''; }
}

function isTiktokHost(rawUrl) {
  const h = hostOf(rawUrl);
  return h === 'tiktok.com' || h.endsWith('.tiktok.com');
}

async function fetchOembed(rawUrl, { http = axios } = {}) {
  let u;
  try { u = new URL(String(rawUrl)); } catch { throw new Error('URL không hợp lệ.'); }
  const host = u.hostname.toLowerCase();
  if (host !== 'tiktok.com' && host !== 'www.tiktok.com') {
    throw new Error('Link TikTok rút gọn chưa hỗ trợ; hãy gửi link đầy đủ dạng tiktok.com/@tên hoặc tiktok.com/@tên/video/<số>.');
  }
  if (!VALID_PATH.test(u.pathname)) {
    throw new Error('Chỉ hỗ trợ link hồ sơ (tiktok.com/@tên) hoặc một video (tiktok.com/@tên/video/<số>); dạng link này chưa hỗ trợ.');
  }
  const target = `https://www.tiktok.com${u.pathname}`;
  let data;
  try {
    ({ data } = await http.get(OEMBED_URL, {
      params: { url: target },
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      timeout: 10000,
      maxContentLength: 65536,
    }));
  } catch (e) {
    throw new Error(`Không lấy được thông tin từ oEmbed của TikTok: ${e.message}`);
  }
  if (!data || typeof data !== 'object') throw new Error('oEmbed của TikTok trả dữ liệu không hợp lệ.');
  const str = (v) => (typeof v === 'string' ? v : '');
  if (!str(data.title) && !str(data.author_name)) {
    throw new Error('TikTok không cung cấp thông tin cho link này (video riêng tư, đã xoá hoặc chưa công khai). Hãy báo người dùng; không thử cách khác để vượt.');
  }
  const result = {
    source: 'oembed',
    url: target,
    title: str(data.title),
    authorName: str(data.author_name),
    authorUrl: str(data.author_url),
  };
  if (typeof data.thumbnail_url === 'string' && data.thumbnail_url.startsWith('https://')) result.thumbnailUrl = data.thumbnail_url;
  return result;
}

module.exports = { isTiktokHost, fetchOembed };
