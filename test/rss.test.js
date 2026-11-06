const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFeed, fetchFeed, formatFeedBlocks, getAiNews, AI_FEEDS, GENERAL_FEEDS, USER_AGENT } = require('../lib/rss');

const RSS = `<rss version="2.0"><channel>
  <item><title>Tin A &amp; B</title><link>https://a.example/1</link><pubDate>Thu, 05 Nov 2026 22:17:15 +0000</pubDate></item>
  <item><title><![CDATA[Tin <b>C</b>]]></title><link>https://a.example/2</link></item>
  <item><title>Khong link</title></item>
</channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom">
  <entry><title type="html">Atom tin</title><link rel="alternate" href="https://v.example/x"/><published>2026-11-06T01:00:00Z</published></entry>
</feed>`;

const quiet = (fn) => async (...a) => { const o = console.error; console.error = () => {}; try { return await fn(...a); } finally { console.error = o; } };

test('parseFeed: RSS - giai ma entity, bo the HTML, bo muc khong co link', async () => {
  const items = await parseFeed(RSS);
  assert.deepEqual(items.map(i => i.title), ['Tin A & B', 'Tin C']);
  assert.equal(items[0].published, '2026-11-05T22:17:15.000Z');
  assert.equal(items[1].published, null);
});

test('parseFeed: Atom (The Verge) lay duoc link tu thuoc tinh href', async () => {
  const items = await parseFeed(ATOM);
  assert.deepEqual(items, [{ title: 'Atom tin', link: 'https://v.example/x', published: '2026-11-06T01:00:00.000Z' }]);
});

test('parseFeed: chi 1 item (xml2js khong tao mang) van chay', async () => {
  const items = await parseFeed('<rss><channel><item><title>Mot</title><link>https://a.example/1</link></item></channel></rss>');
  assert.equal(items.length, 1);
});

test('fetchFeed: gui UA tu khai bao (HN tu choi Mozilla/5.0 gia, tra 419)', async () => {
  let headers;
  const http = { get: async (_u, o) => { headers = o.headers; return { data: RSS }; } };
  await fetchFeed({ name: 'x', url: 'https://x.example/rss', max: 5 }, { http });
  assert.equal(headers['User-Agent'], USER_AGENT);
  assert.notEqual(headers['User-Agent'], 'Mozilla/5.0');
});

test('fetchFeed: HN 419 hai lan -> dung fallbackUrl', quiet(async () => {
  const calls = [];
  const http = { get: async (u) => { calls.push(u); if (u.includes('ycombinator')) { const e = new Error('x'); e.response = { status: 419 }; throw e; } return { data: RSS }; } };
  const r = await fetchFeed({ name: 'HN', url: 'https://news.ycombinator.com/rss', fallbackUrl: 'https://hnrss.org/frontpage', max: 2 }, { http, retryDelayMs: 0 });
  assert.equal(r.error, null);
  assert.equal(r.items.length, 2);
  assert.deepEqual(calls, ['https://news.ycombinator.com/rss', 'https://news.ycombinator.com/rss', 'https://hnrss.org/frontpage']);
}));

test('fetchFeed: loi that -> khong throw, tra error co ma HTTP', quiet(async () => {
  const http = { get: async () => { const e = new Error('x'); e.response = { status: 500 }; throw e; } };
  const r = await fetchFeed({ name: 'x', url: 'https://x.example/rss', max: 2 }, { http, retryDelayMs: 0 });
  assert.deepEqual(r.items, []);
  assert.equal(r.error, 'HTTP 500');
}));

test('fetchFeed: loi thoang qua o lan dau, retry thanh cong', quiet(async () => {
  let n = 0;
  const http = { get: async () => { if (n++ === 0) throw new Error('boom'); return { data: RSS }; } };
  const r = await fetchFeed({ name: 'x', url: 'https://x.example/rss', max: 1 }, { http, retryDelayMs: 0 });
  assert.equal(r.items.length, 1);
}));

test('formatFeedBlocks: escape tieu de + href, feed loi hien thong bao', () => {
  const out = formatFeedBlocks([
    { feed: { name: 'A' }, items: [{ title: 'x < y & "z"', link: 'https://a.example/?a=1&b="2"' }] },
    { feed: { name: 'B' }, items: [] },
  ]);
  assert.match(out, /<b>A<\/b>/);
  assert.match(out, /x &lt; y &amp; "z"/);
  assert.match(out, /href="https:\/\/a\.example\/\?a=1&amp;b=&quot;2&quot;"/);
  assert.match(out, /<b>B<\/b>\n  • <i>\(Không tải được feed\)<\/i>/);
});

test('ten nguon khong bi Telegram tu bien thanh link (khong phai "dev.to")', () => {
  assert.ok(!GENERAL_FEEDS.some(f => /^[a-z0-9-]+\.[a-z]{2,}$/i.test(f.name)));
});

test('getAiNews: gop nhieu nguon, moi nhat truoc, bao nguon loi', quiet(async () => {
  const feeds = AI_FEEDS.length;
  const http = { get: async (u) => {
    if (u.includes('techcrunch')) throw new Error('down');
    return { data: u.includes('verge') ? ATOM : RSS };
  } };
  const { items, failedSources } = await getAiNews({ http, retryDelayMs: 0 });
  assert.ok(feeds > 3);
  assert.deepEqual(failedSources, ['TechCrunch AI']);
  const dates = items.map(i => i.published || '');
  assert.deepEqual(dates, [...dates].sort().reverse());
  assert.ok(items.every(i => i.source && i.link.startsWith('https://')));
}));
