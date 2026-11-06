const test = require('node:test');
const assert = require('node:assert/strict');
const { isPrivateIp, assertPublicUrl, htmlToText, fetchUrl, searchNews, realLinkOf } = require('../lib/web-tools');

const pub = async () => [{ address: '93.184.216.34' }];

test('isPrivateIp: dai noi bo/loopback/link-local/IPv6 bi chan, IP cong khai thi khong', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '172.31.255.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:192.168.1.1']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '2606:4700::1111']) assert.equal(isPrivateIp(ip), false, ip);
});

test('isPrivateIp: IPv6 dang hex/nen/nhung IPv4 (lo hong SSRF bao boi security review)', () => {
  const blocked = [
    '::ffff:c0a8:101', '::ffff:7f00:1', '::ffff:a00:1', '::ffff:a9fe:a9fe', '0:0:0:0:0:ffff:c0a8:101',
    '::c0a8:101', '64:ff9b::c0a8:101', '64:ff9b::a00:1', '2002:c0a8:101::1', '2002:7f00:1::', '2001:0:4136:e378:8000:63bf:3fff:fdd2',
    'fec0::1', 'ff02::1', 'fc00::', 'fdff::1', 'fe80::1%eth0', 'zzzz::1', '1:2:3:4:5:6:7:8:9', '',
  ];
  for (const ip of blocked) assert.equal(isPrivateIp(ip), true, ip);
  for (const ip of ['::ffff:808:808', '64:ff9b::808:808', '2002:808:808::1', '2606:4700:4700::1111', '2a00:1450:4001::200e']) assert.equal(isPrivateIp(ip), false, ip);
});

test('assertPublicUrl: URL IPv4-mapped o moi dang (URL tu doi sang hex) deu bi chan', async () => {
  for (const u of ['http://[::ffff:192.168.1.1]/', 'http://[::ffff:c0a8:101]/', 'http://[::ffff:127.0.0.1]:8080/', 'http://[0:0:0:0:0:ffff:a00:1]/', 'http://[64:ff9b::192.168.1.1]/', 'http://[2002:c0a8:101::]/']) {
    await assert.rejects(assertPublicUrl(u, pub), /nội bộ/, u);
  }
});

test('fetchUrl: ghim ket noi vao IP da kiem tra (agent.lookup tra dung IP do, khong phan giai lai)', async () => {
  let opts;
  const http = { get: async (_u, o) => { opts = o; return reply(200, { 'content-type': 'text/plain' }, 'ok'); } };
  await fetchUrl('https://example.com/', { http, lookup: async () => [{ address: '93.184.216.34' }] });
  const got = await new Promise(r => opts.httpsAgent.options.lookup('rebind.example', { all: true }, (e, l) => r(l)));
  assert.deepEqual(got, [{ address: '93.184.216.34', family: 4 }]);
  const single = await new Promise(r => opts.httpsAgent.options.lookup('rebind.example', {}, (e, a, f) => r([a, f])));
  assert.deepEqual(single, ['93.184.216.34', 4]);
});

test('assertPublicUrl: chan file:, javascript:, tai khoan trong URL, IP noi bo', async () => {
  await assert.rejects(assertPublicUrl('file:///etc/passwd', pub), /http/);
  await assert.rejects(assertPublicUrl('javascript:alert(1)', pub), /http/);
  await assert.rejects(assertPublicUrl('https://user:pw@example.com/', pub), /tài khoản/);
  await assert.rejects(assertPublicUrl('http://192.168.1.10/cam', pub), /nội bộ/);
  await assert.rejects(assertPublicUrl('http://[::1]/', pub), /nội bộ/);
  await assert.rejects(assertPublicUrl('not a url', pub), /không hợp lệ/);
});

test('assertPublicUrl: ten mien tro ve IP noi bo bi chan (DNS tro ve LAN)', async () => {
  await assert.rejects(assertPublicUrl('http://evil.example/', async () => [{ address: '192.168.1.1' }]), /nội bộ/);
  await assert.rejects(assertPublicUrl('http://mixed.example/', async () => [{ address: '8.8.8.8' }, { address: '10.0.0.1' }]), /nội bộ/);
  const u = await assertPublicUrl('https://example.com/a', pub);
  assert.equal(u.hostname, 'example.com');
});

test('htmlToText: bo script/style, lay title, giai ma entity', () => {
  const { title, text } = htmlToText('<html><head><title>Tin &amp; Bai</title><style>.a{}</style></head><body><script>evil()</script><h1>Xin chao</h1><p>Dong 1 &nbsp;va&nbsp;2</p><p>Dong 2</p></body></html>');
  assert.equal(title, 'Tin & Bai');
  assert.ok(!/evil|\.a\{/.test(text));
  assert.match(text, /Xin chao\nDong 1 va 2\nDong 2/);
});

const reply = (status, headers, body = '') => ({ status, headers, data: Buffer.from(body) });

test('fetchUrl: doc trang HTML, cat theo maxChars', async () => {
  const http = { get: async () => reply(200, { 'content-type': 'text/html; charset=utf-8' }, '<title>T</title><p>' + 'x'.repeat(100) + '</p>') };
  const r = await fetchUrl('https://example.com/', { http, lookup: pub, maxChars: 20 });
  assert.equal(r.title, 'T');
  assert.equal(r.text.length, 20);
  assert.equal(r.truncated, true);
});

test('fetchUrl: redirect sang dia chi noi bo bi chan o buoc nhay (SSRF qua redirect)', async () => {
  const lookup = async (h) => [{ address: h === 'internal.example' ? '192.168.1.1' : '93.184.216.34' }];
  const http = { get: async (u) => (u.startsWith('https://example.com') ? reply(302, { location: 'http://internal.example/admin' }) : reply(200, { 'content-type': 'text/html' }, 'SECRET')) };
  await assert.rejects(fetchUrl('https://example.com/', { http, lookup }), /nội bộ/);
});

test('fetchUrl: theo redirect hop le, chan vong lap redirect', async () => {
  let n = 0;
  const http = { get: async (u) => (u.endsWith('/a') ? reply(301, { location: '/b' }) : reply(200, { 'content-type': 'text/plain' }, 'ok ' + (++n))) };
  assert.equal((await fetchUrl('https://example.com/a', { http, lookup: pub })).text, 'ok 1');
  const loop = { get: async () => reply(302, { location: '/again' }) };
  await assert.rejects(fetchUrl('https://example.com/a', { http: loop, lookup: pub }), /chuyển hướng/);
});

test('fetchUrl: tu choi file nhi phan', async () => {
  const http = { get: async () => reply(200, { 'content-type': 'application/pdf' }, '%PDF') };
  await assert.rejects(fetchUrl('https://example.com/x.pdf', { http, lookup: pub }), /không hỗ trợ/);
});

test('realLinkOf: lay link goc tu trang trung gian cua Bing', () => {
  assert.equal(
    realLinkOf('http://www.bing.com/news/apiclick.aspx?ref=FexRss&aid=&url=https%3a%2f%2fwww.huffpost.com%2fentry%2fabc_n_1&c=1'),
    'https://www.huffpost.com/entry/abc_n_1');
  assert.equal(realLinkOf('https://x.example/a'), 'https://x.example/a');
  assert.equal(realLinkOf('http://www.bing.com/x?url=javascript:alert(1)'), 'http://www.bing.com/x?url=javascript:alert(1)');
});

test('searchNews: tra link goc, gioi han max, chon mkt theo ngon ngu', async () => {
  const bing = (n) => `<rss><channel><title>q</title>${Array.from({ length: n }, (_, i) =>
    `<item><title>Tin ${i}</title><link>http://www.bing.com/news/apiclick.aspx?url=${encodeURIComponent('https://site.example/' + i)}&amp;c=1</link><pubDate>Fri, 06 Nov 2026 01:00:00 GMT</pubDate></item>`).join('')}</channel></rss>`;
  let params;
  const http = { get: async (_u, o) => { params = o.params; return { data: bing(10) }; } };
  const r = await searchNews('openai', { http, language: 'vi', max: 3 });
  assert.equal(r.length, 3);
  assert.equal(r[0].link, 'https://site.example/0');
  assert.equal(params.mkt, 'vi-VN');
  assert.equal(params.q, 'openai');
  await assert.rejects(searchNews('   ', { http }), /từ khoá/);
});
