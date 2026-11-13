const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const { PassThrough } = require('node:stream');
const { execFileSync, spawnSync } = require('node:child_process');
const { createCdpClient, buildScopeArgs, buildChromeArgs, renderWithChrome } = require('../lib/render-chrome');
const { createRenderProxy } = require('../lib/render-proxy');

const tmpRenderDirs = () => fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('homelab-render-'));
const canRun = (() => {
  try {
    execFileSync('google-chrome-stable', ['--version'], { stdio: 'ignore' });
    return spawnSync('systemd-run', ['--user', '--scope', '--quiet', 'true'], { stdio: 'ignore' }).status === 0;
  } catch { return false; }
})();

test('cdp: send ghi dung khung JSON ket thuc NUL, ket qua va loi duoc ghep theo id', async () => {
  const input = new PassThrough(), output = new PassThrough();
  const cdp = createCdpClient(input, output);
  const written = [];
  output.on('data', (d) => written.push(d.toString()));
  const p1 = cdp.send('A.b', { x: 1 });
  await new Promise(r => setImmediate(r));
  assert.equal(written.join(''), '{"id":1,"method":"A.b","params":{"x":1}}\0');
  input.write('{"id":1,"result":{"ok":true}}\0');
  assert.deepEqual(await p1, { ok: true });
  const p2 = cdp.send('C.d');
  input.write('{"id":2,"error":{"message":"boom"}}\0');
  await assert.rejects(p2, /boom/);
});

test('cdp: sessionId duoc gui kem va su kien goi dung handler, hai khung dinh nhau van tach dung', async () => {
  const input = new PassThrough(), output = new PassThrough();
  const cdp = createCdpClient(input, output);
  const written = [];
  output.on('data', (d) => written.push(d.toString()));
  const events = [];
  cdp.on('Page.loadEventFired', (params, sessionId) => events.push([params, sessionId]));
  const p = cdp.send('E.f', {}, 'S1');
  await new Promise(r => setImmediate(r));
  assert.match(written.join(''), /"sessionId":"S1"/);
  input.write('{"method":"Page.loadEventFired","params":{"t":1},"sessionId":"S1"}\0{"id":1,"result":{}}\0');
  await p;
  assert.deepEqual(events, [[{ t: 1 }, 'S1']]);
});

test('cdp: ky tu UTF-8 nhieu byte bi cat giua hai chunk van giai ma dung', async () => {
  const input = new PassThrough(), output = new PassThrough();
  const cdp = createCdpClient(input, output);
  const p = cdp.send('X.y');
  const buf = Buffer.from('{"id":1,"result":{"t":"dogvạnvật"}}\0');
  const cut = buf.indexOf(Buffer.from('ạ')) + 1; // cat giua ky tu 3 byte
  input.write(buf.subarray(0, cut));
  input.write(buf.subarray(cut));
  assert.deepEqual(await p, { t: 'dogvạnvật' });
});

test('cdp: dau vao dong thi cac lenh dang cho bi reject', async () => {
  const input = new PassThrough(), output = new PassThrough();
  const cdp = createCdpClient(input, output);
  const p = cdp.send('X.y');
  input.end();
  await assert.rejects(p, /đã đóng/);
});

test('buildChromeArgs: co cac co an toan va khong co co ne kiem tra bot', () => {
  const a = buildChromeArgs({ profileDir: '/tmp/p', proxyPort: 4321 });
  for (const f of ['--headless=new', '--remote-debugging-pipe', '--proxy-server=http://127.0.0.1:4321', '--proxy-bypass-list=<-loopback>',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--blink-settings=imagesEnabled=false', '--user-data-dir=/tmp/p']) {
    assert.ok(a.includes(f), f);
  }
  assert.ok(!a.some(x => /user-agent|AutomationControlled/i.test(x)));
});

test('buildScopeArgs: tran RAM/CPU dung theo thiet ke', () => {
  const a = buildScopeArgs({ unit: 'u1' });
  for (const f of ['--user', '--scope', '--unit=u1', 'MemoryMax=600M', 'MemoryHigh=450M', 'MemorySwapMax=0', 'CPUQuota=150%', 'CPUWeight=20']) {
    assert.ok(a.includes(f), f);
  }
});

test('renderWithChrome: spawn that bai (ENOENT) -> loi tieng Viet va khong de lai thu muc tam', async () => {
  const before = tmpRenderDirs();
  const spawn = () => { const e = new Error('spawn systemd-run ENOENT'); e.code = 'ENOENT'; throw e; };
  await assert.rejects(renderWithChrome('http://example.test/', { timeoutMs: 5000, chromePath: 'google-chrome-stable', proxyPort: 1, spawn }), /không tìm thấy/i);
  assert.deepEqual(tmpRenderDirs(), before);
});

test('renderWithChrome (tich hop): doc duoc chu do JavaScript tao ra, tien trinh Chrome chinh duoc nang oom_score_adj len 1000, don sach sau khi xong',
  { skip: !canRun && 'thieu google-chrome-stable hoac systemd-run --user' }, async () => {
  const before = tmpRenderDirs();
  const oomSeen = [];
  const page = '<html><head><title>Trang thu</title></head><body><script>document.body.textContent="xin chao tu js " + "x".repeat(100)</script></body></html>';
  const server = http.createServer((req, res) => {
    if (req.url === '/') {
      try {
        const pids = spawnSync('pgrep', ['-f', 'user-data-dir=/tmp/homelab-render-'], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean);
        for (const pid of pids) oomSeen.push(fs.readFileSync(`/proc/${pid}/oom_score_adj`, 'utf8').trim());
      } catch {}
    }
    res.setHeader('Content-Type', 'text/html'); res.end(page);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const proxy = createRenderProxy({ isPrivate: () => false });
  const proxyPort = await proxy.start();
  try {
    const r = await renderWithChrome(`http://127.0.0.1:${server.address().port}/`, { timeoutMs: 90000, chromePath: 'google-chrome-stable', proxyPort });
    assert.match(r.text, /xin chao tu js/);
    assert.equal(r.title, 'Trang thu');
    assert.equal(r.status, 200);
    // Chrome tu dat lai diem cua tien trinh con (200/300) nen chi bao dam: sau khi nang, tien trinh chinh/network da o 1000 luc trang duoc tai.
    assert.ok(oomSeen.length > 0 && Math.max(...oomSeen.map(Number)) === 1000, `oom_score_adj: ${oomSeen}`);
  } finally { await proxy.stop(); server.close(); }
  assert.deepEqual(tmpRenderDirs(), before);
  assert.equal(spawnSync('pgrep', ['-f', 'user-data-dir=/tmp/homelab-render-']).status, 1, 'con tien trinh Chrome sot lai');
});

test('renderWithChrome (tich hop SSRF): proxy mac dinh chan loopback, may chu noi bo nhan 0 request',
  { skip: !canRun && 'thieu google-chrome-stable hoac systemd-run --user' }, async () => {
  let hits = 0;
  const server = http.createServer((req, res) => { hits++; res.end('bi mat noi bo'); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const proxy = createRenderProxy();
  const proxyPort = await proxy.start();
  try {
    let out = null;
    try { out = await renderWithChrome(`http://127.0.0.1:${server.address().port}/`, { timeoutMs: 90000, chromePath: 'google-chrome-stable', proxyPort }); } catch { /* bi tu choi cung duoc */ }
    assert.equal(hits, 0);
    assert.ok(proxy.stats().blockedHosts.includes('127.0.0.1'));
    if (out) assert.ok(!/bi mat noi bo/.test(out.text));
  } finally { await proxy.stop(); server.close(); }
});
