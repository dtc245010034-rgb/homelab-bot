const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const http = require('node:http');
const { PassThrough } = require('node:stream');
const { createRenderProxy } = require('../lib/render-proxy');

const PUBLIC = '93.184.216.34';
const lookupTo = (...addrs) => async () => addrs.map(address => ({ address }));

function makeConnect() {
  const calls = [];
  const connect = (opts) => { calls.push(opts); const up = new PassThrough(); process.nextTick(() => up.emit('connect')); return up; };
  return { calls, connect };
}

// Gui 1 dong thô vao proxy, doi dong trang thai (hoac dong ket noi).
function raw(port, text) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1', () => s.write(text));
    let buf = '';
    s.on('data', (d) => { buf += d; if (buf.includes('\r\n\r\n')) resolve({ socket: s, head: buf }); });
    s.on('close', () => resolve({ socket: s, head: buf }));
    s.on('error', () => {});
  });
}

async function withProxy(opts, fn) {
  const proxy = createRenderProxy(opts);
  const port = await proxy.start();
  try { await fn({ proxy, port }); } finally { await proxy.stop(); }
}

test('CONNECT toi ten mien phan giai ra IP noi bo -> 403, khong ket noi, ghi blockedHosts', async () => {
  const { calls, connect } = makeConnect();
  await withProxy({ lookup: lookupTo('192.168.1.5'), connect }, async ({ proxy, port }) => {
    const r = await raw(port, 'CONNECT intranet.test:443 HTTP/1.1\r\nHost: intranet.test:443\r\n\r\n');
    assert.match(r.head, /^HTTP\/1\.1 403/);
    assert.equal(calls.length, 0);
    assert.ok(proxy.stats().blockedHosts.includes('intranet.test'));
    r.socket.destroy();
  });
});

test('CONNECT toi IP literal loopback/IPv6 noi bo -> 403, khong goi lookup', async () => {
  const { calls, connect } = makeConnect();
  let looked = 0;
  await withProxy({ lookup: async () => { looked++; return [{ address: PUBLIC }]; }, connect }, async ({ port }) => {
    for (const target of ['127.0.0.1:8080', '[::1]:443', '169.254.169.254:80']) {
      const r = await raw(port, `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
      assert.match(r.head, /^HTTP\/1\.1 403/, target);
      r.socket.destroy();
    }
    assert.equal(calls.length, 0);
    assert.equal(looked, 0);
  });
});

test('CONNECT: ten mien co ca IP cong khai lan noi bo -> 403 (chong DNS tra nhieu ban ghi)', async () => {
  const { calls, connect } = makeConnect();
  await withProxy({ lookup: lookupTo(PUBLIC, '10.0.0.7'), connect }, async ({ port }) => {
    const r = await raw(port, 'CONNECT mixed.test:443 HTTP/1.1\r\nHost: mixed.test:443\r\n\r\n');
    assert.match(r.head, /^HTTP\/1\.1 403/);
    assert.equal(calls.length, 0);
    r.socket.destroy();
  });
});

test('CONNECT toi host cong khai: ghim dung IP da kiem tra, tra 200 va du lieu chay hai chieu', async () => {
  const { calls, connect } = makeConnect();
  await withProxy({ lookup: lookupTo(PUBLIC), connect }, async ({ port }) => {
    const r = await raw(port, 'CONNECT example.test:443 HTTP/1.1\r\nHost: example.test:443\r\n\r\n');
    assert.match(r.head, /^HTTP\/1\.1 200/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].host, PUBLIC);
    assert.equal(calls[0].port, 443);
    const echoed = await new Promise((resolve) => { r.socket.once('data', (d) => resolve(d.toString())); r.socket.write('ping'); });
    assert.equal(echoed, 'ping');
    r.socket.destroy();
  });
});

test('HTTP thuong dang absolute-URI toi ten mien noi bo -> 403; yeu cau khong phai absolute-URI -> 400', async () => {
  await withProxy({ lookup: lookupTo('192.168.1.5') }, async ({ port }) => {
    const status = (path) => new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path, headers: { Host: 'intranet.test' } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
    });
    assert.equal(await status('http://intranet.test/'), 403);
    assert.equal(await status('/chi-duong-dan'), 400);
  });
});

test('vuot maxBytes -> exceeded = true va ket noi bi dong', async () => {
  const connect = (opts) => { const up = new PassThrough(); process.nextTick(() => { up.emit('connect'); up.write('x'.repeat(200)); }); return up; };
  await withProxy({ lookup: lookupTo(PUBLIC), connect, maxBytes: 100 }, async ({ proxy, port }) => {
    const r = await raw(port, 'CONNECT big.test:443 HTTP/1.1\r\nHost: big.test:443\r\n\r\n');
    await new Promise((resolve) => { if (r.socket.destroyed) resolve(); else r.socket.on('close', resolve); });
    assert.equal(proxy.stats().exceeded, true);
    assert.ok(proxy.stats().bytes > 100);
  });
});

test('stop() dong cong: ket noi lai bi tu choi', async () => {
  const proxy = createRenderProxy({ lookup: lookupTo(PUBLIC) });
  const port = await proxy.start();
  await proxy.stop();
  await assert.rejects(new Promise((resolve, reject) => { const s = net.connect(port, '127.0.0.1', () => { s.destroy(); resolve(); }); s.on('error', reject); }), /ECONNREFUSED/);
});

test('HTTP thuong toi host cong khai: chuyen tiep toi dung IP da ghim, tra than phan hoi va dem byte', async () => {
  const seen = [];
  const target = http.createServer((req, res) => { seen.push({ url: req.url, host: req.headers.host }); res.end('xin chao'); });
  await new Promise((r) => target.listen(0, '127.0.0.1', r));
  const tport = target.address().port;
  try {
    // Cho phep loopback CHI trong test nay de co the dung may chu dich cuc bo; lookup tra IP ma proxy phai ghim.
    await withProxy({ lookup: lookupTo('127.0.0.1'), isPrivate: () => false }, async ({ proxy, port }) => {
      const body = await new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port, path: `http://pub.test:${tport}/a?b=1`, headers: { Host: `pub.test:${tport}`, 'Proxy-Connection': 'keep-alive' } }, (res) => {
          let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => resolve(b));
        }).on('error', reject);
      });
      assert.equal(body, 'xin chao');
      assert.deepEqual(seen, [{ url: '/a?b=1', host: `pub.test:${tport}` }]);
      assert.equal(proxy.stats().bytes, 8);
    });
  } finally { target.close(); }
});

const IFACES = { eth0: [{ address: '2001:db8:aa:bb::5', cidr: '2001:db8:aa:bb::5/64', family: 'IPv6', internal: false }] };

test('CONNECT toi IPv6 toan cau cung /64 voi giao dien cua may (mac dinh isPrivate) -> 403, khong ket noi', async () => {
  const { calls, connect } = makeConnect();
  await withProxy({ lookup: lookupTo('2001:db8:aa:bb::1'), connect, interfaces: () => IFACES }, async ({ proxy, port }) => {
    for (const target of ['[2001:db8:aa:bb::5]:3001', '[2001:db8:aa:bb::1]:22', 'host-doc-hai.test:80']) {
      const r = await raw(port, `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
      assert.match(r.head, /^HTTP\/1\.1 403/, target);
      r.socket.destroy();
    }
    assert.equal(calls.length, 0);
    assert.ok(proxy.stats().blockedHosts.length >= 1);
  });
});

test('CONNECT: cong ngoai 1..65535 -> 400, khong ket noi, proxy khong sap', async () => {
  const { calls, connect } = makeConnect();
  await withProxy({ lookup: lookupTo(PUBLIC), connect }, async ({ port }) => {
    for (const target of ['example.test:99999', 'example.test:0']) {
      const r = await raw(port, `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
      assert.match(r.head, /^HTTP\/1\.1 400/, target);
      r.socket.destroy();
    }
    assert.equal(calls.length, 0);
    const ok = await raw(port, 'CONNECT example.test:443 HTTP/1.1\r\nHost: example.test:443\r\n\r\n');
    assert.match(ok.head, /^HTTP\/1\.1 200/);   // van phuc vu binh thuong sau khi bi gui rac
    ok.socket.destroy();
  });
});

test('CONNECT: connect() nem loi dong bo -> 502, khong gay unhandled rejection', async () => {
  let unhandled = 0;
  const onUnhandled = () => { unhandled++; };
  process.on('unhandledRejection', onUnhandled);
  try {
    await withProxy({ lookup: lookupTo(PUBLIC), connect: () => { throw new Error('boom'); } }, async ({ port }) => {
      const r = await raw(port, 'CONNECT example.test:443 HTTP/1.1\r\nHost: example.test:443\r\n\r\n');
      assert.match(r.head, /^HTTP\/1\.1 502/);
      r.socket.destroy();
      await new Promise(r2 => setTimeout(r2, 50));
    });
  } finally { process.off('unhandledRejection', onUnhandled); }
  assert.equal(unhandled, 0);
});

test('start(): cong dang bi chiem/loi listen -> reject thay vi treo', async () => {
  const proxy = createRenderProxy({});
  const orig = http.Server.prototype.listen;
  http.Server.prototype.listen = function () { process.nextTick(() => this.emit('error', new Error('EADDRINUSE'))); return this; };
  try { await assert.rejects(proxy.start(), /EADDRINUSE/); } finally { http.Server.prototype.listen = orig; }
});
