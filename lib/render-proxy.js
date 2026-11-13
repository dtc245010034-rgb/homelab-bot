// Proxy cuc bo cho Chrome ngam cua renderUrl: moi ket noi cua Chrome (ke ca toi 127.0.0.1) di qua day.
// Tu phan giai ten mien, CHAN neu bat ky dia chi nao la noi bo, roi ket noi toi dung IP da kiem tra (ghim IP, chong DNS rebinding).
const dns = require('dns').promises;
const http = require('http');
const net = require('net');
const { isPrivateIp } = require('./web-tools');

const MAX_BLOCKED_HOSTS = 20;
const bare = (h) => String(h).replace(/^\[|\]$/g, '');
const deny = (code, text) => `HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`;

function createRenderProxy({
  lookup = (h) => dns.lookup(h, { all: true }),
  isPrivate = isPrivateIp,
  connect = net.connect,
  maxBytes = 8 * 1024 * 1024,
} = {}) {
  const live = new Set();
  const st = { bytes: 0, exceeded: false, blockedHosts: [] };
  const track = (s) => { live.add(s); s.on('close', () => live.delete(s)); s.on('error', () => {}); return s; };
  const destroyAll = () => { for (const s of live) s.destroy(); };
  const count = (chunk) => {
    st.bytes += chunk.length;
    if (st.bytes > maxBytes && !st.exceeded) { st.exceeded = true; destroyAll(); }
  };
  const block = (host) => {
    if (!st.blockedHosts.includes(host) && st.blockedHosts.length < MAX_BLOCKED_HOSTS) st.blockedHosts.push(host);
  };

  // -> { ip } hop le | { blocked: true } | { failed: true }
  async function resolveSafe(rawHost) {
    const host = bare(rawHost);
    let addrs;
    if (net.isIP(host)) addrs = [{ address: host }];
    else {
      try { addrs = await lookup(host); } catch { return { failed: true }; }
    }
    if (!addrs || !addrs.length) return { failed: true };
    if (addrs.some(a => isPrivate(a.address))) { block(host); return { blocked: true }; }
    return { ip: addrs[0].address };
  }

  const server = http.createServer(async (req, res) => {
    let u;
    try { u = new URL(req.url); } catch { res.writeHead(400, { Connection: 'close' }); res.end(); return; }
    if (u.protocol !== 'http:' || st.exceeded) { res.writeHead(u.protocol === 'http:' ? 403 : 400, { Connection: 'close' }); res.end(); return; }
    const r = await resolveSafe(u.hostname);
    if (!r.ip) { res.writeHead(r.blocked ? 403 : 502, { Connection: 'close' }); res.end(); return; }
    const headers = { ...req.headers };
    for (const k of Object.keys(headers)) if (k.toLowerCase().startsWith('proxy-')) delete headers[k];
    const up = http.request({ host: r.ip, port: u.port || 80, method: req.method, path: u.pathname + u.search, headers });
    up.on('socket', track);
    up.on('response', (ures) => {
      res.writeHead(ures.statusCode, ures.headers);
      ures.on('data', count);
      ures.pipe(res);
    });
    up.on('error', () => { if (!res.headersSent) res.writeHead(502, { Connection: 'close' }); res.end(); });
    req.pipe(up);
  });

  server.on('connection', track);

  server.on('connect', async (req, client, head) => {
    const m = /^(\[[^\]]+\]|[^:]+):(\d{1,5})$/.exec(String(req.url));
    if (!m || st.exceeded) { client.end(deny(m ? 403 : 400, m ? 'Forbidden' : 'Bad Request')); return; }
    const r = await resolveSafe(m[1]);
    if (!r.ip) { client.end(deny(r.blocked ? 403 : 502, r.blocked ? 'Forbidden' : 'Bad Gateway')); return; }
    const up = track(connect({ host: r.ip, port: Number(m[2]) }));
    up.once('connect', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) up.write(head);
      up.on('data', count);
      up.pipe(client);
      client.pipe(up);
    });
    up.on('error', () => { if (client.writable) client.end(deny(502, 'Bad Gateway')); else client.destroy(); });
    up.on('close', () => client.destroy());
    client.on('close', () => up.destroy());
  });

  return {
    start() { return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port))); },
    stop() { destroyAll(); return new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); }); },
    stats() { return { bytes: st.bytes, exceeded: st.exceeded, blockedHosts: [...st.blockedHosts] }; },
  };
}

module.exports = { createRenderProxy };
