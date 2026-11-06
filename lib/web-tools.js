const dns = require('dns').promises;
const http_ = require('http');
const https_ = require('https');
const net = require('net');
const axios = require('axios');
const { parseFeed, USER_AGENT } = require('./rss');

const MAX_BYTES = 1_500_000;
const MAX_TEXT_CHARS = 12_000;
const MAX_REDIRECTS = 3;

function isPrivateIPv4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168);
}

// IPv6 -> 8 nhom 16-bit (xu ly "::" va duoi dang a.b.c.d); null neu khong hop le.
// Phai phan tich that chu khong so khop chuoi: new URL('http://[::ffff:192.168.1.1]/') doi thanh "::ffff:c0a8:101".
function parseIPv6(ip) {
  let s = String(ip).toLowerCase().split('%')[0];
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    if ([a, b, c, d].some(n => n > 255)) return null;
    s = s.slice(0, dotted.index) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? fill !== 0 : fill < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill('0'), ...tail];
  if (!groups.every(g => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map(g => parseInt(g, 16));
}

const v4of = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  const g = parseIPv6(ip);
  if (!g) return true; // khong phan tich duoc -> chan (fail closed)
  const zeros = (from, to) => g.slice(from, to).every(x => x === 0);
  if (zeros(0, 5) && (g[5] === 0xffff || g[5] === 0)) return isPrivateIPv4(v4of(g[6], g[7])); // ::ffff:a.b.c.d, ::a.b.c.d, ::, ::1
  if (g[0] === 0x64 && g[1] === 0xff9b && zeros(2, 6)) return isPrivateIPv4(v4of(g[6], g[7])); // NAT64
  if (g[0] === 0x2002) return isPrivateIPv4(v4of(g[1], g[2]));                                  // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true;                                               // Teredo
  return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0 || (g[0] & 0xff00) === 0xff00;
}

// Chan SSRF: model/trang web co the dua link toi dich vu trong LAN (camera, router, Pi-hole) - chi cho http(s) ra Internet that.
async function assertPublicUrl(rawUrl, lookup = (h) => dns.lookup(h, { all: true })) {
  let u;
  try { u = new URL(String(rawUrl)); } catch { throw new Error('URL không hợp lệ.'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Chỉ hỗ trợ http/https.');
  if (u.username || u.password) throw new Error('URL không được chứa tài khoản/mật khẩu.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host);
  if (!addrs.length) throw new Error('Không phân giải được tên miền.');
  if (addrs.some(a => isPrivateIp(a.address))) throw new Error('Địa chỉ nội bộ/riêng tư bị chặn.');
  u.validatedAddresses = addrs; // fetchUrl ghim ket noi vao dung cac IP nay (chong DNS rebinding)
  return u;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…' };
function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

function htmlToText(html) {
  const title = decodeEntities((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '').replace(/\s+/g, ' ').trim());
  const body = html
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|br)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const text = decodeEntities(body)
    .split('\n').map(l => l.replace(/[ \t ]+/g, ' ').trim()).filter(Boolean).join('\n');
  return { title, text };
}

// Axios se tu phan giai lai ten mien luc ket noi -> ke tan cong co the tra IP cong khai luc kiem tra roi doi sang IP noi bo (DNS rebinding).
// Ghim: agent chi duoc ket noi toi cac IP da kiem tra o assertPublicUrl.
function pinnedAgents(u) {
  const addrs = u.validatedAddresses || [];
  if (!addrs.length) return {};
  const lookup = (_host, opts, cb) => {
    const done = typeof opts === 'function' ? opts : cb;
    const all = typeof opts === 'object' && opts?.all;
    const list = addrs.map(a => ({ address: a.address, family: net.isIPv6(a.address) ? 6 : 4 }));
    all ? done(null, list) : done(null, list[0].address, list[0].family);
  };
  return { httpAgent: new http_.Agent({ lookup }), httpsAgent: new https_.Agent({ lookup }) };
}

// Doc 1 trang web cong khai -> { url, title, text, truncated }. Tu theo redirect thu cong de kiem tra tung buoc.
async function fetchUrl(rawUrl, { http = axios, lookup, maxChars = MAX_TEXT_CHARS } = {}) {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = await assertPublicUrl(current, lookup);
    const res = await http.get(u.href, {
      ...pinnedAgents(u),
      timeout: 12000,
      maxRedirects: 0,
      maxContentLength: MAX_BYTES,
      responseType: 'arraybuffer',
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' },
      validateStatus: s => s >= 200 && s < 400,
    });
    if (res.status >= 300) {
      const loc = res.headers?.location;
      if (!loc) throw new Error(`HTTP ${res.status} không có Location.`);
      current = new URL(loc, u).href;
      continue;
    }
    const type = String(res.headers?.['content-type'] || '');
    if (type && !/text\/|xml|json/i.test(type)) throw new Error(`Loại nội dung không hỗ trợ: ${type.split(';')[0]}`);
    const raw = Buffer.from(res.data).toString('utf8');
    const { title, text } = /html|xml/i.test(type) || /^\s*</.test(raw) ? htmlToText(raw) : { title: '', text: raw.trim() };
    return { url: u.href, title, text: text.slice(0, maxChars), truncated: text.length > maxChars };
  }
  throw new Error('Quá nhiều lần chuyển hướng.');
}

// Bing News RSS khong can API key; link la trang trung gian apiclick, url that nam trong tham so `url`.
function realLinkOf(link) {
  try {
    const u = new URL(link);
    const target = u.searchParams.get('url');
    return target && /^https?:\/\//i.test(target) ? target : link;
  } catch { return link; }
}

// Tim TIN TUC (khong phai tim web tong quat). -> [{ title, link, source, published }]
async function searchNews(query, { http = axios, language = 'en', max = 8 } = {}) {
  const q = String(query || '').trim().slice(0, 200);
  if (!q) throw new Error('Thiếu từ khoá tìm kiếm.');
  const mkt = language === 'vi' ? 'vi-VN' : 'en-US';
  const { data } = await http.get('https://www.bing.com/news/search', {
    params: { q, format: 'rss', mkt },
    timeout: 12000,
    headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)', Accept: 'application/rss+xml, */*' },
  });
  const items = await parseFeed(data);
  return items.slice(0, max).map(i => ({ title: i.title, link: realLinkOf(i.link), published: i.published }));
}

module.exports = { isPrivateIp, assertPublicUrl, htmlToText, fetchUrl, searchNews, realLinkOf };
