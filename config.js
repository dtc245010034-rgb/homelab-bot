const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// TIMEZONE trong .env cung la mui gio cua tien trinh: lich hen gio (scheduler) dung gio dia phuong cua Date.
if (process.env.TIMEZONE) process.env.TZ = process.env.TIMEZONE;

const MAIN_STREAM = /\/Streaming\/Channels\/101(?=$|\?)/;

function hostOf(url) {
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/]*@)?([^:/@]+)/i.exec(String(url ?? ''));
  return m ? m[1] : null;
}

// Hikvision: kenh 101 = main stream (1080p), 102 = sub stream (nhe hon nhieu, du de so sanh chuyen dong).
function deriveSubstream(url) {
  return url ? url.replace(MAIN_STREAM, '/Streaming/Channels/102') : url;
}

// "192.168.1.1=Router;192.168.1.5=NAS" -> { '192.168.1.1': 'Router', ... }
function parseDevices(s) {
  const map = {};
  for (const part of String(s || '').split(/[;\n]/)) {
    const i = part.indexOf('=');
    if (i > 0) map[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return map;
}

// Vi tri dung cho thoi tiet/ban do. Mac dinh Ha Noi neu khong cau hinh.
function getLocation(env = process.env) {
  const lat = Number(env.LOCATION_LAT), lon = Number(env.LOCATION_LON);
  const ok = env.LOCATION_LAT && env.LOCATION_LON && Number.isFinite(lat) && Number.isFinite(lon);
  return { name: env.LOCATION_NAME || (ok ? 'Vị trí của bạn' : 'Hà Nội'), lat: ok ? lat : 21.0278, lon: ok ? lon : 105.8342 };
}

// Dia chi broadcast /24 suy tu IP may chinh (192.168.1.62 -> 192.168.1.255)
function broadcastOf(ip) {
  const m = /^(\d+\.\d+\.\d+)\.\d+$/.exec(String(ip || ''));
  return m ? `${m[1]}.255` : '255.255.255.255';
}


// ─── Cai dat tuy bien (moi gia tri deu co mac dinh; .env chi can ghi de khi muon doi) ───
// So: sai/khong hop le -> dung mac dinh (khong bao gio de bot chet vi go nham 1 dong .env).
function num(v, def, { min = -Infinity, max = Infinity, int = false } = {}) {
  if (v === undefined || v === null || String(v).trim() === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return def;
  return int ? Math.trunc(n) : n;
}

// 1/true/yes/on/bat -> true; 0/false/no/off/tat -> false; con lai -> mac dinh
function bool(v, def) {
  const s = String(v ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'bat'].includes(s)) return true;
  if (['0', 'false', 'no', 'off', 'tat'].includes(s)) return false;
  return def;
}

function list(v, def = []) {
  const out = String(v ?? '').split(/[,;\n]/).map(x => x.trim()).filter(Boolean);
  return out.length ? out : def;
}

function validTimeZone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

const DOW = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, cn: 0, t2: 1, t3: 2, t4: 3, t5: 4, t6: 5, t7: 6 };

// "06:30" | "sat 07:30" | "off" -> { hour, minute, dayOfWeek?, off? }; sai dinh dang -> null (de dung mac dinh)
function parseWhen(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  if (['off', 'tat', 'no', '0', 'false'].includes(s)) return { off: true };
  const m = /^(?:([a-z0-9]+)\s+)?(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const hour = Number(m[2]), minute = Number(m[3]);
  if (hour > 23 || minute > 59) return null;
  const out = { hour, minute };
  if (m[1] !== undefined) {
    const d = DOW[m[1]] ?? (/^[0-6]$/.test(m[1]) ? Number(m[1]) : undefined);
    if (d === undefined) return null;
    out.dayOfWeek = d;
  }
  return out;
}

// "Ten|https://url|so_tin;Ten2|https://url2|3" -> [{ name, url, max }]; rong/khong hop le -> null (dung danh sach mac dinh)
function parseFeeds(v) {
  const out = [];
  for (const part of String(v ?? '').split(/[;\n]/)) {
    const [name, url, max] = part.split('|').map(x => x.trim());
    if (!name || !/^https?:\/\//i.test(url || '')) continue;
    out.push({ name, url, max: num(max, 3, { min: 1, max: 20, int: true }) });
  }
  return out.length ? out : null;
}

const DEFAULT_MODELS = ['gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite'];

function getSettings(env = process.env) {
  const tz = env.TIMEZONE || env.TZ;
  return Object.freeze({
    TIMEZONE: tz && validTimeZone(tz) ? tz : 'Asia/Ho_Chi_Minh',
    LOCALE: env.LOCALE || 'vi-VN',

    ALERTS: Object.freeze({
      enabled: bool(env.ALERTS_ENABLED, true),
      cpuPct: num(env.ALERT_CPU_PCT, 85, { min: 1, max: 100 }),
      ramPct: num(env.ALERT_RAM_PCT, 85, { min: 1, max: 100 }),
      diskPct: num(env.ALERT_DISK_PCT, 85, { min: 1, max: 100 }),
      tempC: num(env.ALERT_TEMP_C, 78, { min: 30, max: 120 }),
      cooldownMs: num(env.ALERT_COOLDOWN_MIN, 30, { min: 1, max: 1440 }) * 60_000,
      checkMs: num(env.ALERT_CHECK_INTERVAL_MIN, 5, { min: 1, max: 60 }) * 60_000,
    }),
    STATUS_WARN_PCT: num(env.STATUS_WARN_PCT, 75, { min: 1, max: 100 }),
    STATUS_CRIT_PCT: num(env.STATUS_CRIT_PCT, 85, { min: 1, max: 100 }),
    DISK_MOUNT: env.DISK_MOUNT || '/',

    PIHOLE: Object.freeze({
      url: String(env.PIHOLE_URL || 'http://localhost').replace(/\/+$/, ''),
      password: env.PIHOLE_PASSWORD || null, // khong dat thi doc tu file .pihole-secret
    }),

    // Gio chay cac tac vu he thong; 'off' de tat han
    SCHEDULES: Object.freeze({
      dailyDigest: parseWhen(env.SCHEDULE_DAILY_DIGEST),
      weekendReminder: parseWhen(env.SCHEDULE_WEEKEND_REMINDER),
      weeklyReport: parseWhen(env.SCHEDULE_WEEKLY_REPORT),
    }),

    MORNING: Object.freeze({
      sections: new Set(list(env.MORNING_SECTIONS, ['stocks', 'weather', 'news', 'map']).map(x => x.toLowerCase())),
      symbols: list(env.MORNING_SYMBOLS, ['E1VFVN30.VN']),
      mapPreset: ['vn', 'tn'].includes(env.MORNING_MAP_PRESET) ? env.MORNING_MAP_PRESET : 'vn',
      mapLayer: ['rain', 'clouds', 'wind', 'temp'].includes(env.MORNING_MAP_LAYER) ? env.MORNING_MAP_LAYER : 'rain',
    }),
    NEWS_FEEDS: parseFeeds(env.NEWS_FEEDS),
    AI_NEWS_FEEDS: parseFeeds(env.AI_NEWS_FEEDS),

    MOTION: Object.freeze({
      threshold: num(env.MOTION_THRESHOLD, 6000, { min: 1 }),
      cooldownMs: num(env.MOTION_COOLDOWN_MIN, 5, { min: 0, max: 1440 }) * 60_000,
      intervalMs: num(env.MOTION_INTERVAL_SEC, 60, { min: 5, max: 3600 }) * 1000,
      clipSeconds: num(env.MOTION_CLIP_SECONDS, 10, { min: 3, max: 60, int: true }),
      failThreshold: num(env.MOTION_FAIL_THRESHOLD, 3, { min: 1, max: 100, int: true }),
      transcode: env.MOTION_CLIP_TRANSCODE !== '0',
    }),

    AGENT: Object.freeze({
      model: env.GEMINI_MODEL || 'gemini-3.6-flash',
      fallbackModels: list(env.GEMINI_FALLBACK_MODELS, DEFAULT_MODELS),
      // Model nhe cho viec nen (hen gio, tom tat phien) - thu truoc de danh quota model manh cho hoi dap. "off" = tat.
      backgroundModel: /^off$/i.test(String(env.AGENT_BACKGROUND_MODEL || '').trim()) ? '' : (String(env.AGENT_BACKGROUND_MODEL || '').trim() || 'gemini-3.1-flash-lite'),
      summarize: bool(env.AGENT_SUMMARIZE, true),
      summaryMinTurns: num(env.AGENT_SUMMARY_MIN_TURNS, 3, { min: 1, max: 100, int: true }),
      maxToolLoops: num(env.AGENT_MAX_TOOL_LOOPS, 8, { min: 1, max: 30, int: true }),
      maxUnattendedLoops: num(env.AGENT_MAX_UNATTENDED_LOOPS, 12, { min: 1, max: 40, int: true }),
      unattendedTimeoutMs: num(env.AGENT_UNATTENDED_TIMEOUT_MIN, 5, { min: 1, max: 60 }) * 60_000,
      requestTimeoutMs: num(env.AGENT_REQUEST_TIMEOUT_SEC, 90, { min: 10, max: 600 }) * 1000,
      confirmTimeoutMs: num(env.AGENT_CONFIRM_TIMEOUT_SEC, 120, { min: 10, max: 3600 }) * 1000,
      sessionIdleMs: num(env.AGENT_SESSION_IDLE_HOURS, 48, { min: 1, max: 24 * 90 }) * 3600_000,
      historyTurns: num(env.AGENT_HISTORY_TURNS, 15, { min: 2, max: 100, int: true }),
      dailyLimitDisplay: num(env.AGENT_DAILY_LIMIT_DISPLAY, 20, { min: 1, max: 100000, int: true }),
      keepReports: num(env.AGENT_KEEP_REPORTS, 30, { min: 1, max: 1000, int: true }),
    }),

    WMAP: Object.freeze({
      watermark: env.WMAP_WATERMARK || 'homelab-bot',
      localZoom: num(env.WMAP_LOCAL_ZOOM, 9, { min: 3, max: 12, int: true }),
      localRadius: num(env.WMAP_LOCAL_RADIUS, 1, { min: 0, max: 3, int: true }),
    }),
  });
}

function loadConfig(env = process.env) {
  const missing = ['TELEGRAM_BOT_TOKEN', 'ALLOWED_CHAT_ID'].filter(k => !env[k]);
  if (missing.length) throw new Error(`Thiếu biến môi trường bắt buộc: ${missing.join(', ')}`);

  const chatId = Number(env.ALLOWED_CHAT_ID);
  if (!Number.isInteger(chatId)) throw new Error('ALLOWED_CHAT_ID phải là số nguyên');

  const camRtsp = env.CAM_RTSP_URL || null;
  return Object.freeze({
    TOKEN: env.TELEGRAM_BOT_TOKEN,
    API: `${String(env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '')}/bot${env.TELEGRAM_BOT_TOKEN}`,
    CHAT_ID: chatId,
    OWM_KEY: env.OWM_API_KEY,
    CAM_RTSP: camRtsp,
    CAM_MOTION_RTSP: env.CAM_MOTION_RTSP_URL || deriveSubstream(camRtsp),
    CAM_HOST: hostOf(camRtsp),
    MAIN_PC_IP: env.MAIN_PC_IP || null,
    MAIN_PC_MAC: env.MAIN_PC_MAC || null,
    WOL_BROADCAST: env.WOL_BROADCAST || broadcastOf(env.MAIN_PC_IP),
    KNOWN_DEVICES: parseDevices(env.KNOWN_DEVICES),
    LOCATION: getLocation(env),
  });
}

module.exports = { loadConfig, getSettings, deriveSubstream, hostOf, parseDevices, getLocation, broadcastOf, parseWhen, parseFeeds };
