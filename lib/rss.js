const axios = require('axios');
const xml2js = require('xml2js');

// news.ycombinator.com tra 419 "Sorry" cho UA kieu "Mozilla/5.0" gia mao (axios), nhung chap nhan UA tu khai bao.
const USER_AGENT = 'homelab-bot/1.0 (+personal rss reader)';
const ACCEPT = 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8';

// Ban tin sang (morning.js) va tool getNews.
const GENERAL_FEEDS = [
  { name: 'Hacker News',  url: 'https://news.ycombinator.com/rss', fallbackUrl: 'https://hnrss.org/frontpage', max: 2 },
  { name: 'VnExpress KD', url: 'https://vnexpress.net/rss/kinh-doanh.rss', max: 2 },
  { name: 'CafeBiz',      url: 'https://cafebiz.vn/rss/cong-nghe.rss',     max: 2 },
  { name: 'VnEconomy',    url: 'https://vneconomy.vn/kinh-te-so.rss',      max: 2 },
  // Ten khong duoc la "dev.to": Telegram tu bien no thanh link va mat dinh dang in dam.
  { name: 'DEV Community', url: 'https://dev.to/feed', max: 1 },
];

// Nguon tin AI cho tool getAiNews (da kiem tra con song 2026-11-06).
const AI_FEEDS = [
  { name: 'Hacker News (AI)', url: 'https://hnrss.org/newest?q=AI+OR+LLM&points=100', max: 5 },
  { name: 'TechCrunch AI',    url: 'https://techcrunch.com/category/artificial-intelligence/feed/', max: 5 },
  { name: 'The Verge AI',     url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', max: 4 },
  { name: 'MIT Technology Review AI', url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed', max: 4 },
  { name: 'Google AI Blog',   url: 'https://blog.google/technology/ai/rss/', max: 3 },
  { name: 'Hugging Face Blog', url: 'https://huggingface.co/blog/feed.xml', max: 3 },
  { name: 'VnExpress Số hoá', url: 'https://vnexpress.net/rss/so-hoa.rss', max: 3 },
];

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

// xml2js tra string, hoac {_: text, $: attrs} khi the co thuoc tinh/CDATA.
function textOf(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && typeof v._ === 'string') return v._;
  return '';
}

function linkOf(item) {
  const l = item.link;
  if (typeof l === 'string' && l) return l;
  // Atom: <link href="..." rel="alternate"/>, co the nhieu the
  const links = Array.isArray(l) ? l : (l ? [l] : []);
  const alt = links.find(x => x?.$?.href && (!x.$.rel || x.$.rel === 'alternate')) || links.find(x => x?.$?.href);
  if (alt) return alt.$.href;
  return textOf(item.guid) || '';
}

function isHttpUrl(u) {
  return /^https?:\/\//i.test(String(u || ''));
}

// Nhan chuoi XML (RSS 2.0 hoac Atom) -> [{ title, link, published }] theo thu tu trong feed.
async function parseFeed(xml) {
  const parsed = await new xml2js.Parser({ explicitArray: false }).parseStringPromise(xml);
  const raw = parsed.rss?.channel?.item ?? parsed.feed?.entry ?? [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map(item => {
    const when = textOf(item.pubDate) || textOf(item.published) || textOf(item.updated) || textOf(item['dc:date']);
    const ms = when ? Date.parse(when) : NaN;
    return {
      title: textOf(item.title).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || '(no title)',
      link: linkOf(item),
      published: Number.isNaN(ms) ? null : new Date(ms).toISOString(),
    };
  }).filter(i => isHttpUrl(i.link));
}

async function getOnce(url, http) {
  const { data } = await http.get(url, { timeout: 10000, headers: { 'User-Agent': USER_AGENT, Accept: ACCEPT } });
  return parseFeed(data);
}

// Thu url chinh (retry 1 lan sau 1s), roi fallbackUrl neu co. Khong bao gio throw: loi -> { items: [], error }.
async function fetchFeed(feed, { http = axios, retryDelayMs = 1000 } = {}) {
  const urls = [feed.url, feed.url, ...(feed.fallbackUrl ? [feed.fallbackUrl] : [])];
  let lastErr;
  for (let i = 0; i < urls.length; i++) {
    try {
      const items = await getOnce(urls[i], http);
      return { feed, items: items.slice(0, feed.max), error: null };
    } catch (e) {
      lastErr = e;
      const status = e?.response?.status;
      console.error(`[rss] ${feed.name} (${urls[i]}) loi: ${status || e.code || e.message}`);
      if (i === 0 && retryDelayMs) await new Promise(r => setTimeout(r, retryDelayMs));
    }
  }
  return { feed, items: [], error: lastErr?.response?.status ? `HTTP ${lastErr.response.status}` : (lastErr?.code || lastErr?.message || 'loi') };
}

function fetchFeeds(feeds, opts) {
  return Promise.all(feeds.map(f => fetchFeed(f, opts)));
}

// HTML cho Telegram: ten nguon in dam + moi tin la 1 link. Tieu de duoc escape (dau & < > lam hong parse_mode HTML).
function formatFeedBlocks(results) {
  return results.map(({ feed, items }) => {
    if (items.length === 0) return `<b>${escapeHtml(feed.name)}</b>\n  • <i>(Không tải được feed)</i>`;
    const lines = items.map(i => `  • <a href="${escapeAttr(i.link)}">${escapeHtml(i.title)}</a>`);
    return `<b>${escapeHtml(feed.name)}</b>\n${lines.join('\n')}`;
  }).join('\n\n');
}

async function getRSS(opts) {
  return formatFeedBlocks(await fetchFeeds(GENERAL_FEEDS, opts));
}

// Du lieu co cau truc cho model: [{ source, title, link, published }], moi nhat truoc.
async function getAiNews(opts) {
  const results = await fetchFeeds(AI_FEEDS, opts);
  const items = results.flatMap(r => r.items.map(i => ({ source: r.feed.name, ...i })));
  items.sort((a, b) => (b.published || '').localeCompare(a.published || ''));
  const failed = results.filter(r => r.error).map(r => r.feed.name);
  return { items, failedSources: failed };
}

module.exports = {
  GENERAL_FEEDS, AI_FEEDS, USER_AGENT,
  escapeHtml, parseFeed, fetchFeed, fetchFeeds, formatFeedBlocks, getRSS, getAiNews,
};
