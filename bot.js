require('dotenv').config({ path: __dirname + '/.env' });
const axios  = require('axios');
const si     = require('systeminformation');
const wol    = require('wakeonlan');
const ping   = require('ping');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const { exec } = require('child_process');
const util   = require('util');
const FormData = require('form-data');
const { sendMorningReport, getETFPrice } = require('./morning');
const { generateWeatherMap } = require('./wmap');
const { createAgent, getCurrentModel } = require('./agent');
const { createScheduler } = require('./scheduler');
const schedule = require('./schedule');

const execAsync = util.promisify(exec);

// ─── Config ───────────────────────────────────────────────
const TOKEN         = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_CHAT  = 8915208045;
const MAC_ADDRESS   = 'F4:B5:20:50:F1:D5';
const MAIN_PC_IP    = '192.168.1.62';
const API           = `https://api.telegram.org/bot${TOKEN}`;
const PIHOLE_SECRET = path.join(os.homedir(), 'homelab-bot', '.pihole-secret');
const MOTION_STATE  = path.join(__dirname, '.motion-state');
const CAM_RTSP      = process.env.CAM_RTSP_URL;
const CAM_SNAP      = '/tmp/cam_snap.jpg';
const OWM_KEY       = process.env.OWM_API_KEY;

// ─── State ────────────────────────────────────────────────
let lastUpdateId         = 0;
let rebootConfirmPending = false;
let rebootConfirmTimer   = null;
let lastAlertCheck       = 0;

// ─── Render Helper (In-place Edit or New Message) ─────────
async function render(chatId, text, buttons = null, messageId = null) {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: buttons ? { inline_keyboard: buttons } : undefined
  };

  if (messageId) {
    try {
      await axios.post(`${API}/editMessageText`, { ...payload, message_id: messageId }, { timeout: 8000 });
      return;
    } catch (err) {
      if (err.response?.data?.description?.includes('message is not modified')) return;
      // If edit fails (e.g., photo message), fallback to send
    }
  }

  try {
    await axios.post(`${API}/sendMessage`, payload, { timeout: 10000 });
  } catch (e) {
    console.error('[render error]', e.message);
  }
}

async function send(chatId, text) {
  await render(chatId, text);
}

async function answerCb(id, text = '') {
  try {
    await axios.post(`${API}/answerCallbackQuery`, { callback_query_id: id, text }, { timeout: 4000 });
  } catch {}
}

async function sendDocument(chatId, filePath, caption) {
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('document', fs.createReadStream(filePath));
  if (caption) form.append('caption', caption);
  await axios.post(`${API}/sendDocument`, form, { headers: form.getHeaders(), timeout: 20000 });
}

function formatUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

function progressBar(pct, len = 8) {
  const safePct = Math.max(0, Math.min(100, pct));
  const filled  = Math.round((safePct / 100) * len);
  return '█'.repeat(filled) + '░'.repeat(len - filled);
}

function getStatusTag(val, warn = 75, crit = 85) {
  if (val >= crit) return '<code>[NGUY HIỂM]</code>';
  if (val >= warn) return '<code>[CẢNH BÁO]</code>';
  return '<code>[ỔN ĐỊNH]</code>';
}

// ─── Pi-hole Helper ───────────────────────────────────────
async function setPiholeBlocking(enable, seconds = 0) {
  if (!fs.existsSync(PIHOLE_SECRET)) throw new Error('Pi-hole secret file not found');
  const pass = fs.readFileSync(PIHOLE_SECRET, 'utf8').trim();
  const authRes = await axios.post('http://localhost/api/auth', { password: pass }, { timeout: 5000 });
  const sid = authRes.data?.session?.sid;
  if (!sid) throw new Error('Auth failed');
  const body = { blocking: enable };
  if (!enable && seconds > 0) body.timer = seconds;
  await axios.post('http://localhost/api/dns/blocking', body, { headers: { sid }, timeout: 5000 });
  axios.delete('http://localhost/api/auth', { headers: { sid } }).catch(() => {});
}

async function getPiholeStats() {
  if (!fs.existsSync(PIHOLE_SECRET)) throw new Error('Pi-hole secret file not found');
  const pass = fs.readFileSync(PIHOLE_SECRET, 'utf8').trim();
  const authRes = await axios.post('http://localhost/api/auth', { password: pass }, { timeout: 5000 });
  const sid = authRes.data?.session?.sid;
  if (!sid) throw new Error('Auth failed');
  const { data } = await axios.get('http://localhost/api/stats/summary', { headers: { sid }, timeout: 5000 });
  axios.delete('http://localhost/api/auth', { headers: { sid } }).catch(() => {});
  return data;
}

// ─── System Alerts ────────────────────────────────────────
async function checkAlerts() {
  try {
    const [cpu, mem, disks, temps] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.cpuTemperature()
    ]);
    const ramPct   = ((mem.total - mem.available) / mem.total) * 100;
    const rootD    = disks.find(x => x.mount === '/') || disks[0];
    const diskPct  = rootD?.use ?? 0;
    const tempMain = temps.main || 0;
    const alerts   = [];

    if (cpu.currentLoad > 85) alerts.push(`▸ CPU quá tải: <code>${cpu.currentLoad.toFixed(1)}%</code>`);
    if (ramPct > 85)          alerts.push(`▸ RAM quá tải: <code>${ramPct.toFixed(1)}%</code>`);
    if (diskPct > 85)         alerts.push(`▸ Dung lượng ổ cứng sắp đầy: <code>${diskPct.toFixed(1)}%</code>`);
    if (tempMain > 78)        alerts.push(`▸ Nhiệt độ CPU cao: <code>${tempMain}°C</code>`);

    if (alerts.length > 0) {
      await send(ALLOWED_CHAT,
        `<b>CẢNH BÁO TÀI NGUYÊN HỆ THỐNG</b>\n` +
        `<blockquote>\n` +
        alerts.join('\n') +
        `\n\n💡 Dùng <code>/top</code> hoặc <code>/status</code> để kiểm tra.` +
        `\n</blockquote>`
      );
    }
  } catch (e) {
    console.error('[alert error]', e.message);
  }
}

// ─── /status ──────────────────────────────────────────────
async function getSystemStatus() {
  const [cpu, mem, disks, time, cpuInfo, temps] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.fsSize(),
    si.time(),
    si.cpu(),
    si.cpuTemperature()
  ]);
  const ramPct   = ((mem.total - mem.available) / mem.total) * 100;
  const ramUsed  = (mem.total - mem.available) / 1024 ** 3;
  const ramTotal = mem.total / 1024 ** 3;
  const rootD    = disks.find(x => x.mount === '/') || disks[0];
  const diskPct  = rootD?.use ?? 0;
  const diskUsed = rootD ? rootD.used / 1024 ** 3 : null;
  const diskTotal= rootD ? rootD.size / 1024 ** 3 : null;
  const tempC    = temps.main ?? null;

  return {
    host: cpuInfo.brand,
    uptimeSec: time.uptime,
    cpuLoadPct: cpu.currentLoad,
    ramPct, ramUsedGB: ramUsed, ramTotalGB: ramTotal,
    diskPct, diskUsedGB: diskUsed, diskTotalGB: diskTotal,
    tempC
  };
}

async function handleStatus(chatId, msgId = null) {
  try {
    const s = await getSystemStatus();
    const ramUsed  = s.ramUsedGB.toFixed(2);
    const ramTotal = s.ramTotalGB.toFixed(2);
    const diskUsed = s.diskUsedGB != null ? s.diskUsedGB.toFixed(1) : '?';
    const diskTotal= s.diskTotalGB != null ? s.diskTotalGB.toFixed(1) : '?';
    const tempStr  = s.tempC != null ? `${s.tempC}°C` : 'N/A';

    const text =
      `<b>TRẠNG THÁI HỆ THỐNG MÁY CHỦ</b>\n` +
      `<blockquote>` +
      `🖥️ <b>Host:</b> <code>${s.host}</code>\n` +
      `⏱️ <b>Uptime:</b> <code>${formatUptime(s.uptimeSec)}</code>` +
      `</blockquote>\n\n` +

      `<b>TÀI NGUYÊN PHẦN CỨNG</b>\n` +
      `<blockquote>` +
      `▸ <b>CPU:</b>  <code>[${progressBar(s.cpuLoadPct)}] ${s.cpuLoadPct.toFixed(1)}%</code> ${getStatusTag(s.cpuLoadPct)}\n` +
      `▸ <b>RAM:</b>  <code>[${progressBar(s.ramPct)}] ${s.ramPct.toFixed(1)}%</code> (${ramUsed} / ${ramTotal} GB)\n` +
      `▸ <b>SSD:</b>  <code>[${progressBar(s.diskPct)}] ${s.diskPct.toFixed(1)}%</code> (${diskUsed} / ${diskTotal} GB)\n` +
      `▸ <b>Nhiệt độ:</b> <code>${tempStr}</code>` +
      `</blockquote>`;

    const buttons = [
      [{ text: '🔄 Làm mới', callback_data: 'cmd_status' }, { text: '⚡ Top tiến trình', callback_data: 'cmd_top' }],
      [{ text: '🌡️ Chi tiết nhiệt độ', callback_data: 'cmd_temp' }, { text: '⚙️ PM2 Services', callback_data: 'cmd_services' }],
      [{ text: '◀ Menu chính', callback_data: 'cmd_help' }]
    ];
    await render(chatId, text, buttons, msgId);
  } catch (e) {
    await render(chatId, `<b>LỖI KIỂM TRA STATUS</b>\n<blockquote><code>${e.message}</code></blockquote>`, null, msgId);
  }
}

// ─── /top ─────────────────────────────────────────────────
async function handleTop(chatId, msgId = null) {
  try {
    const { stdout: cpuOut } = await execAsync('ps -eo pid,comm,%cpu,%mem --sort=-%cpu | head -6');
    const { stdout: memOut } = await execAsync('ps -eo pid,comm,%mem,%cpu --sort=-%mem | head -6');

    const text =
      `<b>TIẾN TRÌNH TIÊU THỤ TÀI NGUYÊN</b>\n\n` +
      `<b>TOP TIẾN TRÌNH ĂN CPU</b>\n` +
      `<blockquote><pre>${cpuOut.trim()}</pre></blockquote>\n\n` +
      `<b>TOP TIẾN TRÌNH ĂN RAM</b>\n` +
      `<blockquote><pre>${memOut.trim()}</pre></blockquote>`;

    const buttons = [
      [{ text: '🔄 Làm mới', callback_data: 'cmd_top' }, { text: '🖥️ Trạng thái máy', callback_data: 'cmd_status' }],
      [{ text: '◀ Menu chính', callback_data: 'cmd_help' }]
    ];
    await render(chatId, text, buttons, msgId);
  } catch (e) {
    await render(chatId, `<b>LỖI KIỂM TRA TOP</b>\n<blockquote><code>${e.message}</code></blockquote>`, null, msgId);
  }
}

// ─── /temp ────────────────────────────────────────────────
async function handleTemp(chatId, msgId = null) {
  try {
    const temps = await si.cpuTemperature();
    let detail = '';
    if (temps.main && temps.main > 0) {
      const cores = (temps.cores || []).map((t, i) => `   • Core ${i}: <code>${t}°C</code>`).join('\n');
      detail = `▸ <b>Package CPU:</b> <code>${temps.main}°C</code> (Max: <code>${temps.max || temps.main}°C</code>)\n` + (cores ? `▸ <b>Từng nhân:</b>\n${cores}` : '');
    } else {
      const { stdout } = await execAsync('sensors 2>/dev/null | grep -E "Core|Package|temp" | head -8');
      detail = `<code>${stdout.trim() || 'Không có cảm biến khả dụng.'}</code>`;
    }

    const text =
      `<b>NHIỆT ĐỘ PHẦN CỨNG CPU</b>\n` +
      `<blockquote>\n` +
      `${detail}\n` +
      `</blockquote>`;

    const buttons = [
      [{ text: '🔄 Đo lại', callback_data: 'cmd_temp' }, { text: '🖥️ Status', callback_data: 'cmd_status' }],
      [{ text: '◀ Menu chính', callback_data: 'cmd_help' }]
    ];
    await render(chatId, text, buttons, msgId);
  } catch (e) {
    await render(chatId, `<b>LỖI ĐỌC NHIỆT ĐỘ</b>\n<blockquote><code>${e.message}</code></blockquote>`, null, msgId);
  }
}

// ─── /services ────────────────────────────────────────────
async function handleServices(chatId, msgId = null) {
  try {
    const { stdout } = await execAsync('pm2 jlist');
    const procs = JSON.parse(stdout);
    if (!procs.length) {
      await render(chatId, '<b>DỊCH VỤ PM2</b>\n<blockquote>Không có tiến trình PM2 nào đang chạy.</blockquote>', null, msgId);
      return;
    }
    const lines = procs.map(p => {
      const s    = (p.pm2_env.status || '').toUpperCase();
      const cpu  = p.monit?.cpu ?? 0;
      const mem  = p.monit?.memory ? (p.monit.memory / 1024 / 1024).toFixed(1) + 'MB' : '0MB';
      const rst  = p.pm2_env.restart_time ?? 0;
      const tag  = s === 'ONLINE' ? '<code>[CHẠY]</code>' : '<code>[TẮT]</code>';
      return `▸ ${tag} <b>${p.name}</b> (id: <code>${p.pm_id}</code>)\n   └ CPU: <code>${cpu}%</code> · RAM: <code>${mem}</code> · Restart: <code>${rst}</code>`;
    });

    const text =
      `<b>DANH SÁCH DỊCH VỤ PM2 (${procs.length})</b>\n` +
      `<blockquote>\n` +
      lines.join('\n\n') + '\n' +
      `</blockquote>`;

    const buttons = [
      [{ text: '🔄 Làm mới', callback_data: 'cmd_services' }, { text: '◀ Menu chính', callback_data: 'cmd_help' }]
    ];
    await render(chatId, text, buttons, msgId);
  } catch (e) {
    await render(chatId, `<b>LỖI KIỂM TRA PM2</b>\n<blockquote><code>${e.message}</code></blockquote>`, null, msgId);
  }
}

// ─── /tailscale ───────────────────────────────────────────
async function handleTailscale(chatId, msgId = null) {
  try {
    const { stdout } = await execAsync('tailscale status 2>&1');
    const lines = stdout.trim().split('\n').filter(Boolean);
    const formatted = lines.map(line => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) return `▸ <code>${line}</code>`;
      const ip = parts[0];
      const name = parts[1];
      const osName = parts[3];
      const rest = parts.slice(4).join(' ');
      const isOnline = !rest.includes('offline');
      const stateTag = rest === '-' ? '<code>[HOST]</code>' : isOnline ? '<code>[ONLINE]</code>' : '<code>[OFFLINE]</code>';
      return `▸ ${stateTag} <b>${name}</b> · <code>${ip}</code> (${osName})`;
    });

    const text =
      `<b>MẠNG LƯỚI TAILSCALE MESH</b>\n` +
      `<blockquote>\n` +
      formatted.join('\n') + '\n' +
      `</blockquote>`;

    const buttons = [
      [{ text: '🔄 Làm mới', callback_data: 'cmd_ts' }, { text: '🔍 Quét LAN', callback_data: 'cmd_devices' }],
      [{ text: '◀ Menu chính', callback_data: 'cmd_help' }]
    ];
    await render(chatId, text, buttons, msgId);
  } catch (e) {
    await render(chatId, `<b>LỖI TAILSCALE</b>\n<blockquote><code>${e.message}</code></blockquote>`, null, msgId);
  }
}

// ─── /netscan ─────────────────────────────────────────────
async function handleNetscan(chatId, msgId = null) {
  try {
    const { stdout } = await execAsync('ip neigh');
    const lines = stdout.trim().split('\n').filter(Boolean);
    const validLines = lines.filter(l => !l.includes('FAILED') && l.includes('dev'));

    const knownMap = {
      '192.168.1.1': 'Router / Gateway',
      '192.168.1.2': 'Server (Self)',
      '192.168.1.62': 'PC Chính',
      '192.168.1.68': 'Hikvision Camera'
    };

    const deviceList = validLines.map(line => {
      const match = line.match(/^(\S+)\s+dev\s+\S+\s+lladdr\s+(\S+)\s+(\S+)/);
      if (match) {
        const ip = match[1];
        const mac = match[2];
        const state = match[3];
        const label = knownMap[ip] ? ` · <b>${knownMap[ip]}</b>` : '';
        return `▸ <code>${ip.padEnd(15)}</code> ${label}\n   └ MAC: <code>${mac}</code> [${state}]`;
      }
      return `▸ <code>${line}</code>`;
    });

    const text =
      `<b>THIẾT BỊ HOẠT ĐỘNG TRONG MẠNG LAN</b>\n` +
      `<blockquote>\n` +
      (deviceList.length > 0 ? deviceList.join('\n\n') : 'Không tìm thấy thiết bị nào trong ARP cache.') + '\n' +
      `</blockquote>`;

    const buttons = [
      [{ text: '🔄 Quét lại', callback_data: 'cmd_devices' }, { text: '📡 Tailscale', callback_data: 'cmd_ts' }],
      [{ text: '◀ Menu chính', callback_data: 'cmd_help' }]
    ];
    await render(chatId, text, buttons, msgId);
  } catch (e) {
    await render(chatId, `<b>LỖI QUÉT MẠNG LAN</b>\n<blockquote><code>${e.message}</code></blockquote>`, null, msgId);
  }
}

// ─── /ip & /speedtest ─────────────────────────────────────
async function handleIp(chatId, msgId = null) {
  await render(chatId, '<b>CHẨN ĐOÁN MẠNG</b>\n<blockquote>Đang đo đạc IP ngoại mạng và độ trễ ping...</blockquote>', null, msgId);
  try {
    const [ipRes, pingCloudflare, pingGoogle] = await Promise.all([
      axios.get('http://ip-api.com/json', { timeout: 5000 }).then(r => r.data).catch(() => null),
      ping.promise.probe('1.1.1.1', { timeout: 3 }),
      ping.promise.probe('8.8.8.8', { timeout: 3 })
    ]);

    const publicIp = ipRes?.query || 'Không rõ';
    const isp      = ipRes?.isp || 'Không rõ';
    const city     = ipRes?.city ? `${ipRes.city}, ${ipRes.countryCode}` : 'Không rõ';
    const cfTime   = pingCloudflare.alive ? `${pingCloudflare.time} ms` : 'TIMEOUT';
    const ggTime   = pingGoogle.alive ? `${pingGoogle.time} ms` : 'TIMEOUT';

    const text =
      `<b>THÔNG TIN KẾT NỐI NGOẠI MẠNG & PING</b>\n` +
      `<blockquote>` +
      `▸ <b>Public IP:</b> <code>${publicIp}</code>\n` +
      `▸ <b>Nhà mạng:</b> <code>${isp}</code>\n` +
      `▸ <b>Vị trí:</b> <code>${city}</code>` +
      `</blockquote>\n\n` +

      `<b>ĐỘ TRỄ KẾT NỐI (LATENCY)</b>\n` +
      `<blockquote>` +
      `▸ <b>Cloudflare DNS (1.1.1.1):</b> <code>${cfTime}</code>\n` +
      `▸ <b>Google DNS (8.8.8.8):</b> <code>${ggTime}</code>` +
      `</blockquote>`;

    const buttons = [
      [{ text: '🔄 Đo lại', callback_data: 'cmd_ip' }, { text: '🏓 Ping PC Chính', callback_data: 'cmd_ping' }],
      [{ text: '◀ Menu chính', callback_data: 'cmd_help' }]
    ];
    await render(chatId, text, buttons, msgId);
  } catch (e) {
    await render(chatId, `<b>LỖI CHẨN ĐOÁN MẠNG</b>\n<blockquote><code>${e.message}</code></blockquote>`, null, msgId);
  }
}

// ─── /cleanup ─────────────────────────────────────────────
async function handleCleanup(chatId, msgId = null) {
  await render(chatId, '<b>DỌN DẸP HỆ THỐNG</b>\n<blockquote>Đang xóa bộ nhớ đệm và tệp tin rác tạm thời...</blockquote>', null, msgId);
  try {
    const dirs = ['/tmp', '/var/tmp', path.join(os.homedir(), '.cache'), path.join(os.homedir(), '.local/share/Trash')];
    let totalFreedMb = 0;

    for (const dir of dirs) {
      if (fs.existsSync(dir)) {
        try {
          const { stdout: before } = await execAsync(`du -sm "${dir}" 2>/dev/null | cut -f1`);
          const sizeBefore = parseInt(before.trim(), 10) || 0;

          if (dir === '/tmp' || dir === '/var/tmp') {
            await execAsync(`find "${dir}" -type f -mtime +1 -delete 2>/dev/null || true`);
            await execAsync(`find "${dir}" -type d -empty -delete 2>/dev/null || true`);
          } else if (dir.includes('.cache')) {
            await execAsync(`find "${dir}" -type f -mtime +7 -delete 2>/dev/null || true`);
            await execAsync(`find "${dir}" -type d -empty -delete 2>/dev/null || true`);
          } else if (dir.includes('Trash')) {
            await execAsync(`rm -rf "${dir}"/* "${dir}"/.[!.]* 2>/dev/null || true`);
          }

          const { stdout: after } = await execAsync(`du -sm "${dir}" 2>/dev/null | cut -f1`);
          const sizeAfter = parseInt(after.trim(), 10) || 0;
          const freed = Math.max(0, sizeBefore - sizeAfter);
          totalFreedMb += freed;
        } catch {}
      }
    }

    const { stdout: diskInfo } = await execAsync("df -h / | awk 'NR==2 {print $3 \"/\" $2 \" (\" $5 \" used)\"}'");

    const text =
      `<b>DỌN DẸP RÁC HOÀN TẤT</b>\n` +
      `<blockquote>` +
      `▸ <b>Dung lượng vừa giải phóng:</b> <code>${totalFreedMb} MB</code>\n` +
      `▸ <b>Trạng thái ổ cứng SSD:</b> <code>${diskInfo.trim()}</code>\n` +
      `▸ <b>Thời gian thực hiện:</b> <code>${new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</code>` +
      `</blockquote>`;

    const buttons = [
      [{ text: '🧹 Dọn tiếp', callback_data: 'cmd_cleanup' }, { text: '◀ Menu chính', callback_data: 'cmd_help' }]
    ];
    await render(chatId, text, buttons, msgId);
  } catch (e) {
    await render(chatId, `<b>LỖI DỌN DẸP</b>\n<blockquote><code>${e.message}</code></blockquote>`, null, msgId);
  }
}

// ─── /ping (Main PC) ──────────────────────────────────────
async function handlePing(chatId, msgId = null) {
  try {
    const res = await ping.promise.probe(MAIN_PC_IP, { timeout: 3 });
    const isOnline = res.alive;
    const stateTag = isOnline ? '<code>[ONLINE - Đang bật]</code>' : '<code>[OFFLINE - Đang tắt]</code>';
    const pingTime = isOnline ? `<code>${res.time} ms</code>` : '<code>N/A</code>';

    const text =
      `<b>TRẠNG THÁI MÁY TÍNH CHÍNH</b>\n` +
      `<blockquote>` +
      `▸ <b>Địa chỉ IP:</b> <code>${MAIN_PC_IP}</code>\n` +
      `▸ <b>Trạng thái:</b> ${stateTag}\n` +
      `▸ <b>Độ trễ Ping:</b> ${pingTime}` +
      `</blockquote>`;

    const buttons = isOnline
      ? [
          [{ text: '🔄 Kiểm tra lại', callback_data: 'cmd_ping' }],
          [{ text: '◀ Menu chính', callback_data: 'cmd_help' }]
        ]
      : [
          [{ text: '⚡ Bật máy (WoL)', callback_data: 'cmd_wol' }, { text: '🔄 Kiểm tra lại', callback_data: 'cmd_ping' }],
          [{ text: '◀ Menu chính', callback_data: 'cmd_help' }]
        ];

    await render(chatId, text, buttons, msgId);
  } catch (e) {
    await render(chatId, `<b>LỖI PING MÁY CHÍNH</b>\n<blockquote><code>${e.message}</code></blockquote>`, null, msgId);
  }
}

// ─── /wol (Main PC) ───────────────────────────────────────
async function handleWol(chatId, force = false, msgId = null) {
  try {
    if (!force) {
      const check = await ping.promise.probe(MAIN_PC_IP, { timeout: 2 });
      if (check.alive) {
        const text =
          `<b>THÔNG BÁO WAKE-ON-LAN</b>\n` +
          `<blockquote>` +
          `Máy tính chính hiện đang <b>ONLINE</b> tại <code>${MAIN_PC_IP}</code>.\n` +
          `Nếu vẫn muốn gửi gói tin, hãy dùng lệnh <code>/wol force</code>.` +
          `</blockquote>`;
        const buttons = [[{ text: '◀ Menu chính', callback_data: 'cmd_help' }]];
        await render(chatId, text, buttons, msgId);
        return;
      }
    }
    await wol(MAC_ADDRESS, { address: '192.168.1.255' });
    const text =
      `<b>ĐÃ PHÁT GÓI TIN WAKE-ON-LAN</b>\n` +
      `<blockquote>` +
      `▸ <b>Target MAC:</b> <code>${MAC_ADDRESS}</code>\n` +
      `▸ <b>Broadcast IP:</b> <code>192.168.1.255</code>\n` +
      `▸ <b>Trạng thái:</b> Magic packet đã gửi (chờ máy khởi động ~30-60s)` +
      `</blockquote>`;

    const buttons = [
      [{ text: '🏓 Kiểm tra Ping', callback_data: 'cmd_ping' }, { text: '◀ Menu chính', callback_data: 'cmd_help' }]
    ];
    await render(chatId, text, buttons, msgId);
  } catch (e) {
    await render(chatId, `<b>LỖI WAKE-ON-LAN</b>\n<blockquote><code>${e.message}</code></blockquote>`, null, msgId);
  }
}

// ─── /motion ──────────────────────────────────────────────
async function handleMotion(chatId, args = [], msgId = null) {
  const action = (args[0] || '').toLowerCase();
  if (action === 'on') {
    fs.writeFileSync(MOTION_STATE, '1');
    if (fs.existsSync('/tmp/cam_prev.jpg')) fs.unlinkSync('/tmp/cam_prev.jpg');
    const text = '<b>CẢNH BÁO CHUYỂN ĐỘNG</b>\n<blockquote>Đã <b>BẬT</b> tính năng phát hiện chuyển động camera.</blockquote>';
    const buttons = [[{ text: '🔴 Tắt cảnh báo', callback_data: 'motion_off' }, { text: '◀ Menu chính', callback_data: 'cmd_help' }]];
    await render(chatId, text, buttons, msgId);
  } else if (action === 'off') {
    if (fs.existsSync(MOTION_STATE)) fs.unlinkSync(MOTION_STATE);
    const text = '<b>CẢNH BÁO CHUYỂN ĐỘNG</b>\n<blockquote>Đã <b>TẮT</b> tính năng phát hiện chuyển động camera.</blockquote>';
    const buttons = [[{ text: '🟢 Bật cảnh báo', callback_data: 'motion_on' }, { text: '◀ Menu chính', callback_data: 'cmd_help' }]];
    await render(chatId, text, buttons, msgId);
  } else {
    const isOn = fs.existsSync(MOTION_STATE);
    const text =
      `<b>GIÁM SÁT CHUYỂN ĐỘNG CAMERA</b>\n` +
      `<blockquote>` +
      `▸ <b>Trạng thái:</b> ${isOn ? '<code>[ĐANG BẬT]</code>' : '<code>[ĐANG TẮT]</code>'}\n` +
      `▸ <b>Độ nhạy:</b> <code>RMSE > 6000</code>\n` +
      `▸ <b>Hành động:</b> Tự động quay clip 10s gửi Telegram` +
      `</blockquote>`;

    const buttons = [
      [{ text: isOn ? '🔴 Tắt giám sát' : '🟢 Bật giám sát', callback_data: isOn ? 'motion_off' : 'motion_on' }],
      [{ text: '◀ Menu chính', callback_data: 'cmd_help' }]
    ];
    await render(chatId, text, buttons, msgId);
  }
}

// ─── /cam ─────────────────────────────────────────────────
async function handleCam(chatId) {
  try {
    await execAsync(`ffmpeg -y -rtsp_transport tcp -i "${CAM_RTSP}" -vframes 1 ${CAM_SNAP} 2>/dev/null`);
    if (!fs.existsSync(CAM_SNAP)) throw new Error('Không tạo được ảnh chụp camera');

    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('photo', fs.createReadStream(CAM_SNAP));
    form.append('caption', `📷 Camera Snapshot — ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`);
    await axios.post(`${API}/sendPhoto`, form, { headers: form.getHeaders(), timeout: 15000 });
  } catch (e) {
    await send(chatId, `<b>LỖI CAMERA</b>\n<blockquote><code>${e.message}</code></blockquote>`);
  }
}

// ─── /wmap ────────────────────────────────────────────────
async function handleWmap(chatId, args = [], msgId = null) {
  const preset = (args[0] || '').toLowerCase();
  const layer  = (args[1] || 'rain').toLowerCase();

  if (!preset) {
    const text =
      `<b>BẢN ĐỒ RADAR THỜI TIẾT</b>\n` +
      `<blockquote>` +
      `Chọn khu vực và lớp dữ liệu bạn muốn xem:` +
      `</blockquote>`;

    const buttons = [
      [
        { text: '🌧️ Mưa VN', callback_data: 'wmap_vn_rain' },
        { text: '☁️ Mây VN', callback_data: 'wmap_vn_clouds' },
        { text: '💨 Gió VN', callback_data: 'wmap_vn_wind' }
      ],
      [
        { text: '🌧️ Mưa Thái Nguyên', callback_data: 'wmap_tn_rain' },
        { text: '🌡️ Nhiệt độ TN', callback_data: 'wmap_tn_temp' }
      ],
      [{ text: '◀ Menu chính', callback_data: 'cmd_help' }]
    ];
    await render(chatId, text, buttons, msgId);
    return;
  }

  if (!['vn', 'tn'].includes(preset) || !['rain', 'clouds', 'wind', 'temp'].includes(layer)) {
    await render(chatId, '<b>LỖI CÚ PHÁP</b>\n<blockquote>Dùng: <code>/wmap [vn|tn] [rain|clouds|wind|temp]</code></blockquote>', null, msgId);
    return;
  }

  await render(chatId, `<b>BẢN ĐỒ THỜI TIẾT</b>\n<blockquote>Đang dựng ảnh radar (${preset.toUpperCase()} - ${layer.toUpperCase()})...</blockquote>`, null, msgId);
  try {
    const filePath = await generateWeatherMap(preset, layer, OWM_KEY);
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('photo', fs.createReadStream(filePath));
    form.append('caption', `🗺️ Bản đồ Thời tiết [${preset.toUpperCase()} - ${layer.toUpperCase()}]`);
    await axios.post(`${API}/sendPhoto`, form, { headers: form.getHeaders(), timeout: 30000 });
    try { fs.unlinkSync(filePath); } catch {}
  } catch (e) {
    console.error('[wmap error]', e.message);
    await send(chatId, `<b>LỖI BẢN ĐỒ THỜI TIẾT</b>\n<blockquote><code>${e.message}</code></blockquote>`);
  }
}

// ─── /pihole ──────────────────────────────────────────────
async function handlePihole(chatId, args = [], msgId = null) {
  const action  = (args[0] || '').toLowerCase();
  const minutes = parseInt(args[1], 10) || 0;
  try {
    if (!action) {
      let isOn = false;
      try {
        const { stdout } = await execAsync('sudo pihole status');
        isOn = stdout.toLowerCase().includes('enabled');
      } catch {}

      let statsLine = 'Không lấy được dữ liệu thống kê';
      try {
        const s = await getPiholeStats();
        const totalQ   = s.queries?.total ?? 0;
        const blocked  = (s.queries?.status?.GRAVITY ?? 0) + (s.queries?.status?.GRAVITY_CNAME ?? 0);
        const blockPct = totalQ > 0 ? (blocked / totalQ * 100).toFixed(1) : '0.0';
        const domains  = s.gravity?.domains_being_blocked ?? '?';
        const clients  = s.clients?.active ?? '?';
        const cached   = s.queries?.status?.CACHE ?? '?';
        const forward  = s.queries?.status?.FORWARDED ?? '?';

        statsLine =
          `▸ <b>Truy vấn hôm nay:</b> <code>${totalQ.toLocaleString()}</code>\n` +
          `▸ <b>Tên miền đã chặn:</b> <code>${blocked.toLocaleString()}</code> (${blockPct}%)\n` +
          `▸ <b>Danh sách Gravity:</b> <code>${domains.toLocaleString()}</code> domains\n` +
          `▸ <b>Thiết bị hoạt động:</b> <code>${clients} clients</code>\n` +
          `▸ <b>Cache hits:</b> <code>${cached.toLocaleString()}</code> · Forward: <code>${forward.toLocaleString()}</code>`;
      } catch (err) {
        statsLine = `▸ <code>Lỗi thống kê: ${err.message}</code>`;
      }

      const text =
        `<b>TRÌNH CHẶN QUẢNG CÁO PI-HOLE DNS</b>\n` +
        `<blockquote>` +
        `▸ <b>Trạng thái:</b> ${isOn ? '<code>[ĐANG BẬT]</code>' : '<code>[ĐANG TẮT]</code>'}\n\n` +
        statsLine +
        `</blockquote>`;

      const piholeButtons = isOn ? [
        [{ text: '⏸️ Tắt 5p', callback_data: 'pihole_off_5' }, { text: '⏸️ Tắt 15p', callback_data: 'pihole_off_15' }],
        [{ text: '⏸️ Tắt 30p', callback_data: 'pihole_off_30' }, { text: '⏹️ Tắt hẳn', callback_data: 'pihole_off_0' }],
        [{ text: '◀ Menu chính', callback_data: 'cmd_help' }]
      ] : [
        [{ text: '▶️ Bật lại Pi-hole', callback_data: 'pihole_on' }],
        [{ text: '◀ Menu chính', callback_data: 'cmd_help' }]
      ];

      await render(chatId, text, piholeButtons, msgId);
    } else if (action === 'off') {
      if (minutes > 0) {
        await setPiholeBlocking(false, minutes * 60);
        await render(chatId, `<b>PI-HOLE DNS</b>\n<blockquote>Đã tạm tắt Pi-hole trong <b>${minutes} phút</b>.</blockquote>`, [[{ text: '◀ Menu chính', callback_data: 'cmd_help' }]], msgId);
      } else {
        await setPiholeBlocking(false);
        await render(chatId, `<b>PI-HOLE DNS</b>\n<blockquote>Đã tắt Pi-hole. Dùng <code>/pihole on</code> để bật lại.</blockquote>`, [[{ text: '◀ Menu chính', callback_data: 'cmd_help' }]], msgId);
      }
    } else if (action === 'on') {
      await setPiholeBlocking(true);
      await render(chatId, `<b>PI-HOLE DNS</b>\n<blockquote>Đã bật lại Pi-hole thành công.</blockquote>`, [[{ text: '◀ Menu chính', callback_data: 'cmd_help' }]], msgId);
    } else {
      await render(chatId, '<b>CÚ PHÁP PI-HOLE</b>\n<blockquote>Dùng: <code>/pihole | /pihole on | /pihole off [phút]</code></blockquote>', null, msgId);
    }
  } catch (e) {
    await render(chatId, `<b>LỖI PI-HOLE</b>\n<blockquote><code>${e.message}</code></blockquote>`, null, msgId);
  }
}

// ─── /weekly ──────────────────────────────────────────────
async function handleWeekly(chatId, msgId = null) {
  try {
    const LOG_FILE = path.join(os.homedir(), 'homelab-bot', 'pihole-weekly.json');
    const [cpu, mem, disks, time] = await Promise.all([
      si.currentLoad(), si.mem(), si.fsSize(), si.time()
    ]);
    const ramPct  = ((mem.total - mem.available) / mem.total) * 100;
    const rootD   = disks.find(x => x.mount === '/') || disks[0];
    const diskPct = rootD?.use ?? 0;

    let etfLine = '';
    try {
      const raw = await getETFPrice();
      etfLine = `\n\n<b>THỊ TRƯỜNG</b>\n<blockquote>${raw}</blockquote>`;
    } catch {}

    let piholeSection = '';
    try {
      let log = [];
      try { log = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch {}
      const weekTotal   = log.reduce((a, x) => a + x.total, 0);
      const weekBlocked = log.reduce((a, x) => a + x.blocked, 0);
      const weekPct     = weekTotal > 0 ? (weekBlocked / weekTotal * 100).toFixed(1) : '0';
      if (log.length > 0) {
        piholeSection = `\n\n<b>PI-HOLE 7 NGÀY</b>\n<blockquote>▸ Tổng: <code>${weekTotal.toLocaleString()}</code> · Chặn: <code>${weekBlocked.toLocaleString()}</code> (${weekPct}%)</blockquote>`;
      }
    } catch {}

    let securitySection = '';
    try {
      const { stdout: secOut } = await execAsync("apt list --upgradable 2>/dev/null | grep -c security || true");
      const secCount = parseInt(secOut.trim(), 10) || 0;

      let banCount = 0;
      const bannedIPs = new Set();
      try {
        const f2bLog = fs.readFileSync('/var/log/fail2ban.log', 'utf8');
        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        for (const line of f2bLog.split('\n')) {
          const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
          const ipMatch = line.match(/\bBan (\d{1,3}(?:\.\d{1,3}){3})/);
          if (tsMatch && ipMatch && new Date(tsMatch[1].replace(' ', 'T')).getTime() > weekAgo) {
            bannedIPs.add(ipMatch[1]);
            banCount++;
          }
        }
      } catch {}

      securitySection = `\n\n<b>BẢO MẬT</b>\n<blockquote>▸ Bản vá bảo mật đang chờ: <code>${secCount}</code>\n▸ IP bị fail2ban chặn (7 ngày): <code>${banCount}</code></blockquote>`;
    } catch {}

    const text =
      `<b>TỔNG KẾT HOMELAB TRONG TUẦN</b>\n` +
      `<blockquote>` +
      `▸ <b>Uptime:</b> <code>${formatUptime(time.uptime)}</code>\n` +
      `▸ <b>CPU TB:</b> <code>${cpu.currentLoad.toFixed(1)}%</code>\n` +
      `▸ <b>RAM TB:</b> <code>${ramPct.toFixed(1)}%</code>\n` +
      `▸ <b>Ổ cứng SSD:</b> <code>${diskPct.toFixed(1)}%</code> (${(rootD.used/1024**3).toFixed(1)} / ${(rootD.size/1024**3).toFixed(1)} GB)` +
      `</blockquote>` +
      etfLine +
      piholeSection +
      securitySection;

    const buttons = [[{ text: '◀ Menu chính', callback_data: 'cmd_help' }]];
    await render(chatId, text, buttons, msgId);
  } catch (e) {
    await render(chatId, `<b>LỖI TỔNG KẾT TUẦN</b>\n<blockquote><code>${e.message}</code></blockquote>`, null, msgId);
  }
}

// ─── /reboot ──────────────────────────────────────────────
async function handleReboot(chatId, msgId = null) {
  if (rebootConfirmPending) {
    await render(chatId, '<b>XÁC NHẬN REBOOT</b>\n<blockquote>Đang chờ xác nhận. Hãy gõ <code>yes</code> hoặc <code>no</code>.</blockquote>', null, msgId);
    return;
  }
  rebootConfirmPending = true;
  const text =
    `<b>XÁC NHẬN KHỞI ĐỘNG LẠI SERVER</b>\n` +
    `<blockquote>` +
    `Máy chủ sẽ tắt và khởi động lại ngay lập tức.\n` +
    `Gõ <b>yes</b> để xác nhận | <b>no</b> để hủy.\n` +
    `⏱️ Tự hủy yêu cầu sau 30 giây.` +
    `</blockquote>`;

  rebootConfirmTimer = setTimeout(async () => {
    if (rebootConfirmPending) {
      rebootConfirmPending = false;
      await send(chatId, '<b>THỜI GIAN REBOOT ĐÃ HẾT</b>\n<blockquote>Yêu cầu đã tự động hủy bỏ.</blockquote>');
    }
  }, 30000);

  await render(chatId, text, null, msgId);
}

async function handleRebootConfirm(chatId, text) {
  if (!rebootConfirmPending) return false;
  const ans = text.trim().toLowerCase();
  if (ans !== 'yes' && ans !== 'no') return false;
  clearTimeout(rebootConfirmTimer);
  rebootConfirmPending = false;
  if (ans === 'no') {
    await send(chatId, '<b>ĐÃ HỦY REBOOT</b>\n<blockquote>Hệ thống tiếp tục hoạt động bình thường.</blockquote>');
    return true;
  }
  await send(chatId, '<b>ĐANG KHỞI ĐỘNG LẠI SERVER...</b>\n<blockquote>Bot sẽ tạm offline trong ~45 giây.</blockquote>');
  setTimeout(() => exec('sudo reboot'), 1500);
  return true;
}

// ─── /help (Main Dashboard) ───────────────────────────────
async function handleHelp(chatId, msgId = null) {
  const buttons = [
    [
      { text: '🖥️ Status', callback_data: 'cmd_status' },
      { text: '⚡ Top CPU/RAM', callback_data: 'cmd_top' },
      { text: '🌡️ Nhiệt độ', callback_data: 'cmd_temp' },
      { text: '⚙️ Dịch vụ', callback_data: 'cmd_services' }
    ],
    [
      { text: '📡 Tailscale', callback_data: 'cmd_ts' },
      { text: '🔍 Quét LAN', callback_data: 'cmd_devices' },
      { text: '🌐 IP & Ping', callback_data: 'cmd_ip' }
    ],
    [
      { text: '🕳️ Pi-hole', callback_data: 'cmd_pihole' },
      { text: '🏓 PC Chính', callback_data: 'cmd_ping' },
      { text: '⚡ Bật PC', callback_data: 'cmd_wol' }
    ],
    [
      { text: '📷 Camera', callback_data: 'cmd_cam' },
      { text: '🎥 Cảnh báo Cam', callback_data: 'cmd_motion' },
      { text: '🗺️ Bản đồ mưa', callback_data: 'cmd_wmap' },
      { text: '🧹 Dọn rác', callback_data: 'cmd_cleanup' }
    ],
    [
      { text: '🌅 Báo cáo ngày', callback_data: 'cmd_morning' },
      { text: '📊 Tổng kết tuần', callback_data: 'cmd_weekly' },
      { text: '🔄 Khởi động lại', callback_data: 'cmd_reboot' }
    ]
  ];

  const text =
    `<b>BẢNG ĐIỀU KHIỂN HOMELAB v2.1</b>\n` +
    `<blockquote>` +
    `▸ <b>Host:</b> <code>Laptop Server HP (N5030)</code>\n` +
    `▸ <b>Trạng thái:</b> <code>[HOẠT ĐỘNG BÌNH THƯỜNG]</code>\n` +
    `▸ <b>Giao diện:</b> Modern Card Blockquote` +
    `</blockquote>\n\n` +
    `<b>DANH MỤC ĐIỀU KHIỂN NHANH</b>\n` +
    `<blockquote>` +
    `Bấm vào các nút điều khiển bên dưới để tương tác trực tiếp:` +
    `</blockquote>\n\n` +
    `<b>AGENT AI</b>\n` +
    `<blockquote>` +
    `▸ Model đang dùng: <code>${getCurrentModel()}</code>\n` +
    `▸ <code>/agent &lt;câu hỏi&gt;</code> — Trò chuyện với AI trợ lý\n` +
    `▸ <code>/agent quota</code> — Xem quota Gemini đã dùng ước tính hôm nay\n` +
    `▸ <code>/new</code> hoặc <code>/reset</code> — Bắt đầu phiên hội thoại mới\n` +
    `▸ Lịch tuần: "thêm vào lịch thứ 4 chiều 14h họp nhóm", "xem lịch tuần này", "gửi lại file lịch", "xoá sáng thứ 7" (cần xác nhận), "xoá hết lịch tuần này" (cần xác nhận)\n` +
    `▸ Nhắc việc: "nhắc tôi 8h tối nay uống thuốc", "nhắc tôi thứ 6 hàng tuần đổ rác", "xem các nhắc việc", "huỷ nhắc ..."` +
    `</blockquote>`;

  await render(chatId, text, buttons, msgId);
}

const systemActions = {
  archiveAndResetWeek: () => schedule.archiveAndResetWeek(),
  dailyScheduleDigest: async () => {
    const text = await schedule.getTodayDigestText();
    if (text) await send(ALLOWED_CHAT, `<b>LỊCH HÔM NAY</b>\n<blockquote>${text}</blockquote>`);
  },
  weekendPlanningReminder: async () => {
    await send(ALLOWED_CHAT, '<b>NHẮC XẾP LỊCH TUẦN</b>\n<blockquote>Cuối tuần rồi — nhớ xếp lịch tuần mới nhé (dùng <code>/agent</code> để thêm việc vào lịch).</blockquote>');
  },
};

const schedulerApi = createScheduler({ send, systemActions });
schedulerApi.start();

const agentApi = createAgent({
  send, render, getSystemStatus, getPiholeStats, sendDocument,
  addReminderJob: schedulerApi.addJob,
  listReminderJobs: schedulerApi.listJobs,
  cancelReminderJob: schedulerApi.cancelJob,
  addScheduleItem: schedule.addItem,
  viewScheduleText: schedule.getWeekText,
  clearScheduleWeek: schedule.archiveAndResetWeek,
  getCurrentWeekPath: schedule.getCurrentWeekPath,
  removeScheduleItem: schedule.removeItem,
});

// ─── Callback & Message Router ────────────────────────────
async function processUpdate(update) {
  try {
    if (update.callback_query) {
      const cb = update.callback_query;
      const chatId = cb.message?.chat?.id || ALLOWED_CHAT;
      const msgId  = cb.message?.message_id;
      if (chatId !== ALLOWED_CHAT) {
        await answerCb(cb.id, 'Unauthorized');
        return;
      }
      await answerCb(cb.id);

      switch (cb.data) {
        case 'cmd_help':     await handleHelp(chatId, msgId); break;
        case 'cmd_status':   await handleStatus(chatId, msgId); break;
        case 'cmd_top':      await handleTop(chatId, msgId); break;
        case 'cmd_temp':     await handleTemp(chatId, msgId); break;
        case 'cmd_services': await handleServices(chatId, msgId); break;
        case 'cmd_ts':       await handleTailscale(chatId, msgId); break;
        case 'cmd_devices':  await handleNetscan(chatId, msgId); break;
        case 'cmd_ip':       await handleIp(chatId, msgId); break;
        case 'cmd_cleanup':  await handleCleanup(chatId, msgId); break;
        case 'cmd_ping':     await handlePing(chatId, msgId); break;
        case 'cmd_wol':      await handleWol(chatId, false, msgId); break;
        case 'cmd_cam':      await handleCam(chatId); break;
        case 'cmd_motion':   await handleMotion(chatId, [], msgId); break;
        case 'motion_on':    await handleMotion(chatId, ['on'], msgId); break;
        case 'motion_off':   await handleMotion(chatId, ['off'], msgId); break;
        case 'cmd_wmap':     await handleWmap(chatId, [], msgId); break;
        case 'wmap_vn_rain':   await handleWmap(chatId, ['vn', 'rain'], msgId); break;
        case 'wmap_vn_clouds': await handleWmap(chatId, ['vn', 'clouds'], msgId); break;
        case 'wmap_vn_wind':   await handleWmap(chatId, ['vn', 'wind'], msgId); break;
        case 'wmap_tn_rain':   await handleWmap(chatId, ['tn', 'rain'], msgId); break;
        case 'wmap_tn_temp':   await handleWmap(chatId, ['tn', 'temp'], msgId); break;
        case 'cmd_pihole':   await handlePihole(chatId, [], msgId); break;
        case 'cmd_morning':  await sendMorningReport(); break;
        case 'cmd_weekly':   await handleWeekly(chatId, msgId); break;
        case 'cmd_reboot':   await handleReboot(chatId, msgId); break;
        case 'pihole_on':    await setPiholeBlocking(true);       await render(chatId, '<b>PI-HOLE DNS</b>\n<blockquote>Đã bật lại Pi-hole thành công.</blockquote>', [[{ text: '◀ Menu chính', callback_data: 'cmd_help' }]], msgId); break;
        case 'pihole_off_0': await setPiholeBlocking(false);      await render(chatId, '<b>PI-HOLE DNS</b>\n<blockquote>Đã tắt Pi-hole.</blockquote>', [[{ text: '◀ Menu chính', callback_data: 'cmd_help' }]], msgId); break;
        case 'pihole_off_5': await setPiholeBlocking(false, 300); await render(chatId, '<b>PI-HOLE DNS</b>\n<blockquote>Đã tắt Pi-hole trong 5 phút.</blockquote>', [[{ text: '◀ Menu chính', callback_data: 'cmd_help' }]], msgId); break;
        case 'pihole_off_15':await setPiholeBlocking(false, 900); await render(chatId, '<b>PI-HOLE DNS</b>\n<blockquote>Đã tắt Pi-hole trong 15 phút.</blockquote>', [[{ text: '◀ Menu chính', callback_data: 'cmd_help' }]], msgId); break;
        case 'pihole_off_30':await setPiholeBlocking(false,1800); await render(chatId, '<b>PI-HOLE DNS</b>\n<blockquote>Đã tắt Pi-hole trong 30 phút.</blockquote>', [[{ text: '◀ Menu chính', callback_data: 'cmd_help' }]], msgId); break;
      }
      return;
    }

    const msg = update.message;
    if (!msg) return;
    const chatId = msg.chat.id;
    if (chatId !== ALLOWED_CHAT) {
      await send(chatId, '<b>TỪ CHỐI TRUY CẬP</b>\n<blockquote>Tài khoản chưa được phân quyền.</blockquote>');
      return;
    }
    if (!msg.text) {
      await send(chatId, '<b>CHƯA HỖ TRỢ</b>\n<blockquote>Bot chưa hỗ trợ nhận file/ảnh trực tiếp. Dùng <code>/agent &lt;mô tả bằng lời&gt;</code> để nhờ AI xử lý (thêm lịch, đặt nhắc việc...).</blockquote>');
      return;
    }

    const text  = msg.text.trim();
    const parts = text.split(' ');
    const cmd   = parts[0].toLowerCase();
    console.log(`[${new Date().toISOString()}] ${cmd} from ${chatId}`);

    if (await handleRebootConfirm(chatId, text)) return;
    if (await agentApi.handleConfirmReply(chatId, text)) return;

    switch (cmd) {
      case '/status':    await handleStatus(chatId); break;
      case '/top':       await handleTop(chatId); break;
      case '/temp':      await handleTemp(chatId); break;
      case '/services':
      case '/pm2':       await handleServices(chatId); break;
      case '/ts':
      case '/tailscale': await handleTailscale(chatId); break;
      case '/devices':
      case '/netscan':   await handleNetscan(chatId); break;
      case '/ip':
      case '/speedtest': await handleIp(chatId); break;
      case '/cleanup':   await handleCleanup(chatId); break;
      case '/ping':      await handlePing(chatId); break;
      case '/wol':       await handleWol(chatId, parts[1] === 'force'); break;
      case '/cam':       await handleCam(chatId); break;
      case '/motion':    await handleMotion(chatId, parts.slice(1)); break;
      case '/pihole':    await handlePihole(chatId, parts.slice(1)); break;
      case '/morning':   await sendMorningReport(); break;
      case '/weekly':    await handleWeekly(chatId); break;
      case '/wmap':      await handleWmap(chatId, parts.slice(1)); break;
      case '/reboot':    await handleReboot(chatId); break;
      case '/agent': {
        const args = parts.slice(1).join(' ');
        agentApi.handleAgent(chatId, args).catch(e => console.error('[agent error]', e.message));
        break;
      }
      case '/new':
      case '/reset':     await agentApi.resetSession(chatId); break;
      case '/start':
      case '/help':      await handleHelp(chatId); break;
      default:
        await send(chatId, '<b>LỆNH KHÔNG HỢP LỆ</b>\n<blockquote>Gõ <code>/help</code> để mở bảng điều khiển.</blockquote>');
    }
  } catch (err) {
    console.error('[processUpdate error]', err.message);
  }
}

// ─── Polling Loop ─────────────────────────────────────────
async function poll() {
  console.log('🤖 Homelab Bot Modern Card UI started');

  try {
    const initRes = await axios.get(`${API}/getUpdates`, { params: { offset: -1, timeout: 5 }, timeout: 10000 });
    const last = (initRes.data?.result || []).pop();
    if (last) {
      lastUpdateId = last.update_id;
      console.log(`[poll] Initialized offset to ${lastUpdateId}`);
    }
  } catch (e) {
    console.error('[poll init error]', e.message);
  }

  await send(ALLOWED_CHAT,
    `<b>HOMELAB BOT ĐÃ KHỞI ĐỘNG</b>\n` +
    `<blockquote>` +
    `Giao diện <b>Modern Card Blockquote</b> đã sẵn sàng.\n` +
    `Bấm <code>/help</code> để mở bảng điều khiển.` +
    `</blockquote>`
  );

  while (true) {
    if (Date.now() - lastAlertCheck > 5 * 60 * 1000) {
      lastAlertCheck = Date.now();
      checkAlerts().catch(() => {});
    }

    try {
      const res = await axios.get(`${API}/getUpdates`, {
        params: { offset: lastUpdateId + 1, timeout: 20 },
        timeout: 25000
      });
      const updates = res.data?.result || [];
      for (const u of updates) {
        lastUpdateId = u.update_id;
        await processUpdate(u);
      }
    } catch (e) {
      if (!e.message?.includes('timeout')) {
        console.error('[poll loop error]', e.message);
      }
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

poll();
module.exports = { handleWeekly };
