const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const { PassThrough } = require('node:stream');
const { execFileSync, spawnSync } = require('node:child_process');
const { createCdpClient, buildScopeArgs, buildChromeArgs, renderWithChrome, reapLeftovers, stopScope } = require('../lib/render-chrome');
const { EventEmitter } = require('node:events');
const path = require('node:path');
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

test('cdp: du lieu khong co NUL vuot maxBufferBytes -> reject lenh dang cho va goi onOverflow', async () => {
  const input = new PassThrough(), output = new PassThrough();
  let overflowed = 0;
  const cdp = createCdpClient(input, output, { maxBufferBytes: 1000, onOverflow: () => { overflowed++; } });
  const p = cdp.send('X.y');
  input.write('a'.repeat(1500));
  await assert.rejects(p, /quá lớn/);
  assert.equal(overflowed, 1);
});

// Chrome gia: tra loi lenh CDP theo ten, de kiem tra renderWithChrome gui nhung lenh nao.
function fakeChromeSpawn(sent, evalValue) {
  return () => {
    const toChrome = new PassThrough(), fromChrome = new PassThrough();
    const child = new EventEmitter();
    Object.assign(child, { pid: 999999, stderr: new PassThrough(), stdio: [null, null, null, toChrome, fromChrome], kill() {} });
    let buf = '';
    toChrome.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\0')) >= 0) {
        const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
        sent.push(m);
        const results = {
          'Target.createTarget': { targetId: 'T' }, 'Target.attachToTarget': { sessionId: 'S' },
          'Page.getFrameTree': { frameTree: { frame: { id: 'F' } } }, 'Page.navigate': { frameId: 'F' },
          'Page.createIsolatedWorld': { executionContextId: 7 },
          'Runtime.evaluate': { result: { value: evalValue !== undefined ? evalValue : JSON.stringify({ t: 'Tieu de', x: 'Noi dung '.repeat(20) }) } },
        };
        fromChrome.write(JSON.stringify({ id: m.id, result: results[m.method] || {} }) + '\0');
        if (m.method === 'Page.navigate') fromChrome.write(JSON.stringify({ method: 'Page.loadEventFired', params: {}, sessionId: 'S' }) + '\0');
      }
    });
    return child;
  };
}

test('renderWithChrome: chan tai file (Browser.setDownloadBehavior deny) va cat chu ngay trong trang', async () => {
  const sent = [];
  const r = await renderWithChrome('http://example.test/', { timeoutMs: 20000, chromePath: 'chrome', proxyPort: 1, spawn: fakeChromeSpawn(sent) });
  assert.equal(r.title, 'Tieu de');
  const dl = sent.find(m => m.method === 'Browser.setDownloadBehavior');
  assert.ok(dl, 'khong gui Browser.setDownloadBehavior');
  assert.equal(dl.params.behavior, 'deny');
  const ev = sent.find(m => m.method === 'Runtime.evaluate');
  assert.match(ev.params.expression, /slice\(0,\s*\d+\)/); // cat trong trang, khong keo ca innerText ve tien trinh bot
});

test('reapLeftovers: chi diet tien trinh con song co profileDir trong cmdline, bo qua PID khac/khong ton tai', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-proc-'));
  const mk = (pid, cmd) => { fs.mkdirSync(path.join(root, String(pid))); fs.writeFileSync(path.join(root, String(pid), 'cmdline'), cmd); };
  mk(111, 'chrome\0--type=utility\0--user-data-dir=/tmp/homelab-render-X\0');
  mk(222, 'node\0--user-data-dir=/tmp/other\0');            // PID bi tai su dung boi tien trinh khac
  const killed = [];
  const kill = (pid, sig) => { killed.push([pid, sig]); fs.rmSync(path.join(root, String(pid)), { recursive: true }); };
  await reapLeftovers({ profileDir: '/tmp/homelab-render-X', procRoot: root, kill, waitMs: 1000 });
  assert.deepEqual(killed, [[111, 'SIGKILL']]);
  fs.rmSync(root, { recursive: true, force: true });
});

test('reapLeftovers: diet ca tien trinh con moi sinh sau luc chup danh sach PID (Chrome khoi dong lai dich vu mang)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-proc-'));
  const mk = (pid, cmd) => { fs.mkdirSync(path.join(root, String(pid))); fs.writeFileSync(path.join(root, String(pid), 'cmdline'), cmd); };
  mk(111, 'chrome\0--user-data-dir=/tmp/homelab-render-Y\0');
  mk(444, 'chrome\0--type=utility\0--user-data-dir=/tmp/homelab-render-Y\0');   // khong co trong danh sach PID da chup
  mk(555, 'chrome\0--user-data-dir=/tmp/homelab-render-Z\0');                    // cua lan chay khac: khong dung toi
  const killed = [];
  const kill = (pid, sig) => { killed.push(pid); fs.rmSync(path.join(root, String(pid)), { recursive: true }); };
  await reapLeftovers({ profileDir: '/tmp/homelab-render-Y', procRoot: root, kill, waitMs: 1000 });
  assert.deepEqual(killed.sort(), [111, 444]);
  assert.ok(fs.existsSync(path.join(root, '555')));
  fs.rmSync(root, { recursive: true, force: true });
});

test('renderWithChrome: doc chu trong the gioi co lap (contextId), trang khong ghi de duoc JSON/slice', async () => {
  const sent = [];
  await renderWithChrome('http://example.test/', { timeoutMs: 20000, chromePath: 'chrome', proxyPort: 1, spawn: fakeChromeSpawn(sent) });
  assert.ok(sent.some(m => m.method === 'Page.createIsolatedWorld' && m.params.frameId === 'F'));
  const ev = sent.find(m => m.method === 'Runtime.evaluate');
  assert.equal(ev.params.contextId, 7);
});

test('renderWithChrome: trang doc hai tra tieu de/noi dung qua lon hoac sai kieu -> bot van nhan chuoi da cat', async () => {
  const hostile = JSON.stringify({ t: 'T'.repeat(5000), x: ['a'.repeat(100000), 'b'.repeat(100000)] });
  const r = await renderWithChrome('http://example.test/', { timeoutMs: 20000, chromePath: 'chrome', proxyPort: 1, spawn: fakeChromeSpawn([], hostile) });
  assert.equal(typeof r.title, 'string'); assert.ok(r.title.length <= 500);
  assert.equal(typeof r.text, 'string'); assert.ok(r.text.length <= 20000);
  const junk = await renderWithChrome('http://example.test/', { timeoutMs: 20000, chromePath: 'chrome', proxyPort: 1, spawn: fakeChromeSpawn([], 'khong phai json {') });
  assert.equal(junk.text, '');
});

test('stopScope: systemctl treo khong giu finally mai -> tra ve sau timeout', async () => {
  const t0 = Date.now();
  await stopScope('homelab-render-x', { exec: () => ({ /* khong bao gio goi callback */ }), timeoutMs: 80 });
  assert.ok(Date.now() - t0 < 1000);
});
