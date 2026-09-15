require('dotenv').config({ path: __dirname + '/.env' });
const axios  = require('axios');
const xml2js = require('xml2js');
const fs     = require('fs');
const FormData = require('form-data');
const { generateWeatherMap } = require('./wmap');

// ─── Config ───────────────────────────────────────────────
const TOKEN        = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID      = 8915208045;
const OWM_KEY      = process.env.OWM_API_KEY;
const THAI_NGUYEN  = { lat: 21.5942, lon: 105.8412, name: 'Thái Nguyên' };
const API          = `https://api.telegram.org/bot${TOKEN}`;

// ─── RSS Sources ──────────────────────────────────────────
const RSS_FEEDS = [
  { name: 'Hacker News',  url: 'https://news.ycombinator.com/rss',         max: 2 },
  { name: 'VnExpress KD', url: 'https://vnexpress.net/rss/kinh-doanh.rss', max: 2 },
  { name: 'CafeBiz',      url: 'https://cafebiz.vn/rss/cong-nghe.rss',     max: 2 },
  { name: 'VnEconomy',    url: 'https://vneconomy.vn/kinh-te-so.rss',      max: 2 },
  { name: 'dev.to',       url: 'https://dev.to/feed',                      max: 1 }
];

// ─── Helpers ──────────────────────────────────────────────
async function send(text) {
  try {
    await axios.post(`${API}/sendMessage`, {
      chat_id: CHAT_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    }, { timeout: 10000 });
  } catch (e) {
    console.error('[morning-send error]', e.message);
  }
}

// ─── ETF Price ────────────────────────────────────────────
async function getETFPrice() {
  try {
    const symbols = ['E1VFVN30.VN'];
    const results = [];

    for (const symbol of symbols) {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2d`;
        const { data } = await axios.get(url, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          timeout: 10000
        });
        const result0   = data.chart.result[0];
        const meta      = result0.meta;
        const closes    = result0.indicators?.quote?.[0]?.close?.filter(x => x != null) || [];
        const price     = meta.regularMarketPrice;
        const prev      = closes.length >= 2 ? closes[closes.length - 2] : meta.chartPreviousClose;
        const change    = price - prev;
        const changePct = ((change / prev) * 100).toFixed(2);
        const sign      = change >= 0 ? '+' : '';
        const tag       = change >= 0 ? '[TĂNG]' : '[GIẢM]';
        const name      = symbol === 'E1VFVN30.VN' ? 'E1VFVN30' : 'TCSME';
        results.push(
          `▸ <b>${name}:</b> <code>${price.toLocaleString('vi-VN')}đ</code> (${sign}${changePct}%) <code>${tag}</code>`
        );
      } catch {
        const name = symbol === 'E1VFVN30.VN' ? 'E1VFVN30' : 'TCSME';
        results.push(`▸ <b>${name}:</b> <code>[Không lấy được dữ liệu]</code>`);
      }
    }
    return results.join('\n');
  } catch (e) {
    return `▸ <code>Lỗi lấy giá ETF: ${e.message}</code>`;
  }
}

// ─── Weather ──────────────────────────────────────────────
async function getWeather() {
  try {
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${THAI_NGUYEN.lat}&lon=${THAI_NGUYEN.lon}&appid=${OWM_KEY}&units=metric&lang=vi&cnt=9`;
    const { data } = await axios.get(url, { timeout: 10000 });

    const now      = data.list[0];
    const temp     = Math.round(now.main.temp);
    const feels    = Math.round(now.main.feels_like);
    const humidity = now.main.humidity;
    const desc     = now.weather[0].description;

    const slots = data.list.slice(0, 4).map(x => {
      const hour = new Date(x.dt * 1000).toLocaleTimeString('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit'
      });
      const t = Math.round(x.main.temp);
      const r = x.rain?.['3h'] ? ` [Mưa ${x.rain['3h']}mm]` : '';
      return `   • ${hour} : <code>${t}°C</code>${r}`;
    });

    const tempDrop = data.list[0].main.temp - data.list[4]?.main.temp;
    const hasRain  = data.list.slice(0, 4).some(x => x.rain?.['3h'] > 0);
    const maxTemp  = Math.max(...data.list.slice(0, 4).map(x => x.main.temp_max));
    const minTemp  = Math.min(...data.list.slice(0, 4).map(x => x.main.temp_min));
    const warnings = [];
    if (hasRain)       warnings.push('Có mưa — nhớ mang áo mưa');
    if (maxTemp >= 37) warnings.push('Nắng nóng gay gắt');
    if (now.wind.speed > 5) warnings.push(`Gió mạnh (${now.wind.speed.toFixed(1)} m/s)`);
    if (tempDrop > 4) warnings.push(`Nhiệt độ giảm ${tempDrop.toFixed(0)}°C`);
    if (now.main.temp < 20) warnings.push('Trời lạnh dưới 20°C');

    return (
      `▸ <b>Khu vực:</b> <code>${THAI_NGUYEN.name}</code> (${desc})\n` +
      `▸ <b>Nhiệt độ:</b> <code>${temp}°C</code> (Cảm giác ${feels}°C) · <b>Biên độ:</b> <code>${Math.round(minTemp)}–${Math.round(maxTemp)}°C</code>\n` +
      `▸ <b>Độ ẩm:</b> <code>${humidity}%</code>\n` +
      `▸ <b>Diễn biến trong ngày:</b>\n` +
      slots.join('\n') +
      (warnings.length ? `\n▸ <b>Lưu ý:</b> <code>${warnings.join(' · ')}</code>` : '')
    );
  } catch (e) {
    return `▸ <code>Lỗi thời tiết: ${e.message}</code>`;
  }
}

// ─── RSS ──────────────────────────────────────────────────
async function getRSS() {
  const parser = new xml2js.Parser({ explicitArray: false });
  const blocks = [];

  for (const feed of RSS_FEEDS) {
    try {
      const { data } = await axios.get(feed.url, {
        timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      const result = await parser.parseStringPromise(data);
      const items  = result.rss?.channel?.item || [];
      const list   = Array.isArray(items) ? items : [items];

      const itemLines = [];
      list.slice(0, feed.max).forEach(item => {
        const title = item.title?.replace(/<[^>]+>/g, '').trim() || '(no title)';
        const link  = item.link || item.guid || '#';
        itemLines.push(`  • <a href="${link}">${title}</a>`);
      });

      if (itemLines.length > 0) {
        blocks.push(`<b>${feed.name}</b>\n` + itemLines.join('\n'));
      }
    } catch {
      blocks.push(`<b>${feed.name}</b>\n  • <i>(Không tải được feed)</i>`);
    }
  }
  return blocks.join('\n\n');
}

// ─── Main Report ──────────────────────────────────────────
async function sendMorningReport() {
  console.log('[morning] Generating Modern Card report...');
  const hour = new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh', hour: 'numeric', hour12: false });
  const hNum = parseInt(hour, 10);
  const timeLabel = hNum >= 5 && hNum < 12 ? 'BÁO CÁO BUỔI SÁNG' : hNum >= 12 && hNum < 18 ? 'BÁO CÁO BUỔI TRƯA' : 'BÁO CÁO BUỔI TỐI';
  const now = new Date().toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  const [etf, weather, rss, mapPath] = await Promise.all([
    getETFPrice(),
    getWeather(),
    getRSS(),
    generateWeatherMap('vn', 'rain', OWM_KEY).catch(e => { console.error('[morning-wmap]', e.message); return null; })
  ]);

  const msg =
    `<b>${timeLabel}</b>\n` +
    `<blockquote>` +
    `📅 <b>Thời gian:</b> <code>${now}</code>` +
    `</blockquote>\n\n` +

    `<b>THỊ TRƯỜNG CHỨNG KHOÁN</b>\n` +
    `<blockquote>\n` +
    `${etf}\n` +
    `</blockquote>\n\n` +

    `<b>DỰ BÁO THỜI TIẾT</b>\n` +
    `<blockquote>\n` +
    `${weather}\n` +
    `</blockquote>\n\n` +

    `<b>BẢN TIN CHỌN LỌC</b>\n` +
    `<blockquote>\n` +
    `${rss}\n` +
    `</blockquote>`;

  await send(msg);

  if (mapPath) {
    try {
      const form = new FormData();
      form.append('chat_id', CHAT_ID);
      form.append('photo', fs.createReadStream(mapPath));
      form.append('caption', 'Bản đồ Radar Mưa: Việt Nam & Biển Đông');
      await axios.post(`${API}/sendPhoto`, form, { headers: form.getHeaders(), timeout: 30000 });
    } catch (e) {
      console.error('[morning-wmap-send error]', e.message);
    } finally {
      try { fs.unlinkSync(mapPath); } catch {}
    }
  }

  console.log('[morning] Modern Card report sent!');
}

// ─── Exports ──────────────────────────────────────────────
module.exports = { sendMorningReport, getETFPrice };

if (require.main === module) {
  sendMorningReport().catch(console.error);
}
