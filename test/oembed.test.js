const test = require('node:test');
const assert = require('node:assert/strict');
const { isTiktokHost, fetchOembed } = require('../lib/oembed');
const { USER_AGENT } = require('../lib/rss');

const PROFILE = 'https://www.tiktok.com/@dogvanvat';
const fakeHttp = (data) => { const calls = []; return { calls, get: async (url, opts) => { calls.push({ url, opts }); return { data }; } }; };

test('isTiktokHost: tiktok.com va subdomain dung, ten gia thi sai', () => {
  assert.equal(isTiktokHost(PROFILE), true);
  assert.equal(isTiktokHost('https://vm.tiktok.com/ZM1/'), true);
  assert.equal(isTiktokHost('https://tiktok.com/@a'), true);
  assert.equal(isTiktokHost('https://nottiktok.com/'), false);
  assert.equal(isTiktokHost('https://tiktok.com.evil.example/'), false);
  assert.equal(isTiktokHost('khong phai url'), false);
});

test('fetchOembed: trang ho so -> ten kenh, khong tra khoi html, goi dung tham so', async () => {
  const http = fakeHttp({ title: "dogvạnvật's Creator Profile", author_name: 'dogvạnvật', author_url: PROFILE, html: '<script>x</script>' });
  const r = await fetchOembed(PROFILE, { http });
  assert.equal(r.source, 'oembed');
  assert.equal(r.authorName, 'dogvạnvật');
  assert.equal(r.authorUrl, PROFILE);
  assert.equal(r.title, "dogvạnvật's Creator Profile");
  assert.ok(!('html' in r));
  const c = http.calls[0];
  assert.equal(c.url, 'https://www.tiktok.com/oembed');
  assert.deepEqual(c.opts.params, { url: PROFILE });
  assert.equal(c.opts.headers['User-Agent'], USER_AGENT);
  assert.equal(c.opts.timeout, 10000);
  assert.equal(c.opts.maxContentLength, 65536);
});

test('fetchOembed: link mot video duoc chap nhan va lay thumbnail_url https', async () => {
  const video = 'https://www.tiktok.com/@dogvanvat/video/7000000000000000000';
  const http = fakeHttp({ title: 'cap video', author_name: 'dogvạnvật', author_url: PROFILE, thumbnail_url: 'https://p16.example/t.jpg' });
  const r = await fetchOembed(video, { http });
  assert.equal(r.thumbnailUrl, 'https://p16.example/t.jpg');
  const bad = await fetchOembed(video, { http: fakeHttp({ title: 'x', thumbnail_url: 'http://insecure.example/t.jpg' }) });
  assert.equal(bad.thumbnailUrl, undefined);
});

test('fetchOembed: link rut gon va trang chu bi tu choi, khong goi mang', async () => {
  for (const u of ['https://vm.tiktok.com/ZM1/', 'https://www.tiktok.com/', 'https://www.tiktok.com/@a/live']) {
    const http = fakeHttp({});
    await assert.rejects(fetchOembed(u, { http }), /rút gọn|chưa hỗ trợ/, u);
    assert.equal(http.calls.length, 0, u);
  }
});

test('fetchOembed: loi mang -> reject co chu oEmbed', async () => {
  const http = { get: async () => { throw new Error('ECONNRESET'); } };
  await assert.rejects(fetchOembed(PROFILE, { http }), /oEmbed/);
});
