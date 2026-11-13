// Chay Chrome ngam (headless) de doc chu cua trang can JavaScript.
// - Chay trong `systemd-run --user --scope` voi tran RAM/CPU; khong dat duoc scope thi TU CHOI chay (khong chay khong gioi han).
//   (systemd-run --scope thuc thi lenh ngay trong cung PID, nen child.pid chinh la tien trinh Chrome chinh.)
// - Noi chuyen CDP qua pipe (fd 3 ghi lenh, fd 4 doc), khung JSON ket thuc bang NUL.
// - Moi luu luong di qua proxy cuc bo (lib/render-proxy.js). KHONG doi User-Agent, KHONG co co an dau tu dong hoa.
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { StringDecoder } = require('string_decoder');
const { spawn: realSpawn, execFile } = require('child_process');

const BLOCKED_URL_PATTERNS = ['*.png', '*.jpg', '*.jpeg', '*.gif', '*.webp', '*.svg', '*.ico', '*.woff', '*.woff2', '*.ttf', '*.otf', '*.mp4', '*.webm', '*.mp3', '*.m4a'];
const SETTLE_MAX_MS = 4000;
const SETTLE_STEP_MS = 500;
const LOAD_WAIT_MAX_MS = 25000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function createCdpClient(input, output, { maxBufferBytes = 4 * 1024 * 1024, onOverflow = () => {} } = {}) {
  let nextId = 1;
  const pending = new Map();
  const handlers = new Map();
  const decoder = new StringDecoder('utf8');
  let buf = '';
  let scanFrom = 0; // chi quet NUL tren phan moi, khong quet lai ca bo dem moi lan
  const failAll = (err) => { for (const p of pending.values()) p.reject(err); pending.clear(); };

  input.on('data', (d) => {
    buf += decoder.write(d);
    let i;
    while ((i = buf.indexOf('\0', scanFrom)) >= 0) {
      const raw = buf.slice(0, i);
      buf = buf.slice(i + 1);
      scanFrom = 0;
      if (!raw) continue;
      let m;
      try { m = JSON.parse(raw); } catch { continue; }
      if (m.id !== undefined && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error.message || 'lỗi CDP')); else p.resolve(m.result || {});
      } else if (m.method) {
        for (const fn of handlers.get(m.method) || []) fn(m.params, m.sessionId);
      }
    }
    scanFrom = buf.length;
    // Trang doc hai co the day mot khung khong ket thuc: dung de khong an het RAM cua tien trinh bot.
    if (buf.length > maxBufferBytes) {
      buf = ''; scanFrom = 0;
      failAll(new Error('Dữ liệu từ Chrome quá lớn, đã hủy.'));
      onOverflow();
    }
  });
  const closed = () => failAll(new Error('Chrome đã đóng kết nối.'));
  input.on('end', closed);
  input.on('close', closed);

  return {
    send(method, params, sessionId) {
      const id = nextId++;
      const msg = { id, method, ...(params !== undefined ? { params } : {}), ...(sessionId ? { sessionId } : {}) };
      const p = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      output.write(JSON.stringify(msg) + '\0');
      return p;
    },
    on(event, fn) { if (!handlers.has(event)) handlers.set(event, []); handlers.get(event).push(fn); },
  };
}

function buildScopeArgs({ unit }) {
  return ['--user', '--scope', '--quiet', `--unit=${unit}`,
    '-p', 'MemoryMax=600M', '-p', 'MemoryHigh=450M', '-p', 'MemorySwapMax=0', '-p', 'CPUQuota=150%', '-p', 'CPUWeight=20'];
}

function buildChromeArgs({ profileDir, proxyPort }) {
  return ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check',
    '--disable-dev-shm-usage', '--mute-audio', '--remote-debugging-pipe',
    `--user-data-dir=${profileDir}`,
    `--proxy-server=http://127.0.0.1:${proxyPort}`, '--proxy-bypass-list=<-loopback>',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--blink-settings=imagesEnabled=false', '--js-flags=--max-old-space-size=192'];
}

// Chrome tu dat lai oom_score_adj cua tien trinh chinh ve 0 (va 200/300 cho tien trinh con) nen "thua huong" khong ben:
// nang diem cua MOI tien trinh trong scope sau khi Chrome da khoi dong (nang diem khong can quyen root). Best-effort;
// tran RAM cua scope moi la lop bao ve that, con day chi de kernel uu tien giet Chrome truoc dog-bot khi may het RAM.
async function scopePids(pid) {
  try {
    const line = (await fsp.readFile(`/proc/${pid}/cgroup`, 'utf8')).split('\n').find(l => l.startsWith('0::'));
    if (!line) return [];
    return (await fsp.readFile(`/sys/fs/cgroup${line.slice(3)}/cgroup.procs`, 'utf8')).split('\n').filter(Boolean).map(Number);
  } catch { return []; }
}

async function raiseOomScores(pid) {
  const procs = await scopePids(pid);
  await Promise.all(procs.map(p => fsp.writeFile(`/proc/${p}/oom_score_adj`, '1000').catch(() => {})));
}

// `systemctl stop` doi khi tra ve khi mot tien trinh con cua Chrome (vd dich vu mang) chua kip thoat, khi may ban; Chrome con
// co the khoi dong lai dich vu mang SAU luc ta chup danh sach PID. Nen quet /proc tim moi tien trinh co profileDir trong cmdline
// (ten thu muc mkdtemp la duy nhat cua lan chay nay, khong nham PID bi tai su dung), diet va quet lai cho toi khi het.
async function reapLeftovers({ profileDir, procRoot = '/proc', kill = process.kill.bind(process), waitMs = 2000 }) {
  const scan = async () => {
    let names = [];
    try { names = (await fsp.readdir(procRoot)).filter(n => /^\d+$/.test(n)); } catch { return []; }
    const found = [];
    for (const n of names) {
      try { if ((await fsp.readFile(`${procRoot}/${n}/cmdline`, 'utf8')).includes(profileDir)) found.push(Number(n)); } catch { /* da thoat */ }
    }
    return found;
  };
  const t0 = Date.now();
  for (;;) {
    const mine = await scan();
    if (!mine.length) return;
    for (const pid of mine) { try { kill(pid, 'SIGKILL'); } catch { /* da thoat */ } }
    if (Date.now() - t0 >= waitMs) return;
    await sleep(50);
  }
}

function stopScope(unit) {
  return new Promise((resolve) => execFile('systemctl', ['--user', 'stop', `${unit}.scope`], () => resolve()));
}

async function renderWithChrome(url, { timeoutMs, chromePath = 'google-chrome-stable', proxyPort, spawn = realSpawn }) {
  const profileDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'homelab-render-'));
  const unit = `homelab-render-${process.pid}-${Date.now()}`;
  const startedAt = Date.now();
  let child = null;
  let timer = null;
  try {
    const argv = [...buildScopeArgs({ unit }), chromePath, ...buildChromeArgs({ profileDir, proxyPort })];
    try {
      child = spawn('systemd-run', argv, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
    } catch (e) {
      if (e && e.code === 'ENOENT') throw new Error('Không tìm thấy systemd-run hoặc Chrome để mở trang.');
      throw e;
    }
    let stderr = '';
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-300); });
    child.stdio[3].on('error', () => {});

    const cdp = createCdpClient(child.stdio[4], child.stdio[3], { onOverflow: () => { try { child.kill('SIGKILL'); } catch { /* da thoat */ } } });

    const failure = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Quá thời gian mở trang (>${Math.round(timeoutMs / 1000)} giây).`)), timeoutMs);
      child.once('error', (e) => reject(new Error(e.code === 'ENOENT' ? 'Không tìm thấy systemd-run hoặc Chrome để mở trang.' : `Không chạy được Chrome: ${e.message}`)));
      child.once('exit', (code) => reject(new Error(code === 127 || /No such file|not found|Failed to execute/i.test(stderr)
        ? 'Không tìm thấy Chrome (cài google-chrome-stable hoặc đặt RENDER_CHROME_PATH).'
        : `Chrome thoát sớm (mã ${code}); có thể không đặt được giới hạn tài nguyên: ${stderr.trim()}`)));
    });
    failure.catch(() => {});

    const remaining = () => Math.max(0, timeoutMs - (Date.now() - startedAt));

    const work = (async () => {
      await cdp.send('Browser.getVersion');
      await cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' }); // trang doc hai khong duoc ghi file ra dia
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      const S = (method, params) => cdp.send(method, params, sessionId);
      await raiseOomScores(child.pid);
      await S('Network.enable');
      await S('Network.setBlockedURLs', { urls: BLOCKED_URL_PATTERNS });
      await S('Page.enable');
      const { frameTree } = await S('Page.getFrameTree');
      const mainFrameId = frameTree.frame.id;

      let status = null;
      cdp.on('Network.responseReceived', (p, sid) => {
        if (sid === sessionId && p.type === 'Document' && p.frameId === mainFrameId) status = p.response.status;
      });
      let onLoad;
      const loaded = new Promise((resolve) => { onLoad = resolve; });
      cdp.on('Page.loadEventFired', (p, sid) => { if (sid === sessionId) onLoad(); });

      const nav = await S('Page.navigate', { url });
      if (nav.errorText) throw new Error(`Không mở được trang: ${nav.errorText}`);
      await Promise.race([loaded, sleep(Math.min(LOAD_WAIT_MAX_MS, remaining()))]);
      await raiseOomScores(child.pid);

      const read = async () => {
        const r = await S('Runtime.evaluate', {
          expression: 'JSON.stringify({ t: document.title.slice(0, 500), x: document.body ? document.body.innerText.slice(0, 20000) : "" })',
          returnByValue: true,
        });
        return JSON.parse(r.result.value);
      };
      let cur = await read();
      for (let waited = 0, stable = 0; waited < SETTLE_MAX_MS && stable < 2 && remaining() > SETTLE_STEP_MS; waited += SETTLE_STEP_MS) {
        await sleep(SETTLE_STEP_MS);
        const next = await read();
        stable = next.x === cur.x ? stable + 1 : 0;
        cur = next;
      }
      return { status, title: cur.t, text: cur.x };
    })();
    work.catch(() => {});

    return await Promise.race([work, failure]);
  } finally {
    if (timer) clearTimeout(timer);
    await stopScope(unit);
    if (child) { try { child.kill('SIGKILL'); } catch { /* da thoat */ } }
    await reapLeftovers({ profileDir });
    await fsp.rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

module.exports = { createCdpClient, buildScopeArgs, buildChromeArgs, renderWithChrome, reapLeftovers };
