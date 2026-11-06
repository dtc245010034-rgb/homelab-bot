const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, deriveSubstream, hostOf } = require('../config');

const MAIN = 'rtsp://u:p@192.168.1.68:554/Streaming/Channels/101';
const base = { TELEGRAM_BOT_TOKEN: '123:abc', ALLOWED_CHAT_ID: '42', CAM_RTSP_URL: MAIN, OWM_API_KEY: 'k' };

test('thieu TELEGRAM_BOT_TOKEN -> throw', () => {
  assert.throws(() => loadConfig({ ...base, TELEGRAM_BOT_TOKEN: '' }), /TELEGRAM_BOT_TOKEN/);
});

test('thieu ALLOWED_CHAT_ID -> throw', () => {
  const { ALLOWED_CHAT_ID, ...rest } = base;
  assert.throws(() => loadConfig(rest), /ALLOWED_CHAT_ID/);
});

test('ALLOWED_CHAT_ID khong phai so nguyen -> throw', () => {
  assert.throws(() => loadConfig({ ...base, ALLOWED_CHAT_ID: 'abc' }), /ALLOWED_CHAT_ID/);
});

test('gia tri hop le: API, CHAT_ID dang so, OWM_KEY', () => {
  const c = loadConfig(base);
  assert.equal(c.API, 'https://api.telegram.org/bot123:abc');
  assert.equal(c.CHAT_ID, 42);
  assert.equal(c.OWM_KEY, 'k');
});

test('CAM_HOST va CAM_MOTION_RTSP (sub-stream 102) suy ra tu URL chinh', () => {
  const c = loadConfig(base);
  assert.equal(c.CAM_RTSP, MAIN);
  assert.equal(c.CAM_HOST, '192.168.1.68');
  assert.equal(c.CAM_MOTION_RTSP, 'rtsp://u:p@192.168.1.68:554/Streaming/Channels/102');
});

test('CAM_MOTION_RTSP_URL ghi de gia tri suy ra', () => {
  const c = loadConfig({ ...base, CAM_MOTION_RTSP_URL: 'rtsp://x/y' });
  assert.equal(c.CAM_MOTION_RTSP, 'rtsp://x/y');
});

test('khong co camera -> cac truong CAM_* la null', () => {
  const { CAM_RTSP_URL, ...rest } = base;
  const c = loadConfig(rest);
  assert.equal(c.CAM_RTSP, null);
  assert.equal(c.CAM_MOTION_RTSP, null);
  assert.equal(c.CAM_HOST, null);
});

test('deriveSubstream: URL khong phai kenh 101 giu nguyen', () => {
  assert.equal(deriveSubstream('rtsp://h/other'), 'rtsp://h/other');
  assert.equal(deriveSubstream(null), null);
});

test('hostOf: co/khong userinfo, cong, va gia tri rac', () => {
  assert.equal(hostOf('rtsp://192.168.1.68:554/x'), '192.168.1.68');
  assert.equal(hostOf('rtsp://a:b@cam.local/x'), 'cam.local');
  assert.equal(hostOf('rtsp://a:p@ss@10.0.0.5:554/x'), '10.0.0.5');
  assert.equal(hostOf('khong-phai-url'), null);
  assert.equal(hostOf(undefined), null);
});

test('config tra ve object dong bang', () => {
  assert.ok(Object.isFrozen(loadConfig(base)));
});

test('KNOWN_DEVICES, MAIN_PC va broadcast duoc doc tu env', () => {
  const { parseDevices, broadcastOf, getLocation } = require('../config');
  assert.deepEqual(parseDevices('192.168.1.1=Router;192.168.1.5= NAS '), { '192.168.1.1': 'Router', '192.168.1.5': 'NAS' });
  assert.equal(broadcastOf('192.168.1.62'), '192.168.1.255');
  assert.equal(broadcastOf(undefined), '255.255.255.255');
  const c = loadConfig({ TELEGRAM_BOT_TOKEN: 't', ALLOWED_CHAT_ID: '1', MAIN_PC_IP: '10.0.0.7', MAIN_PC_MAC: 'AA:BB:CC:DD:EE:FF' });
  assert.equal(c.WOL_BROADCAST, '10.0.0.255');
  assert.equal(c.MAIN_PC_MAC, 'AA:BB:CC:DD:EE:FF');
  assert.deepEqual(getLocation({}), { name: 'Hà Nội', lat: 21.0278, lon: 105.8342 });
  assert.deepEqual(getLocation({ LOCATION_NAME: 'Huế', LOCATION_LAT: '16.46', LOCATION_LON: '107.59' }), { name: 'Huế', lat: 16.46, lon: 107.59 });
  assert.equal(getLocation({ LOCATION_LAT: 'abc', LOCATION_LON: '1' }).name, 'Hà Nội');
});

// ─── getSettings: moi gia tri tuy bien co mac dinh, sai dinh dang thi dung mac dinh ───
const { getSettings, parseWhen, parseFeeds } = require('../config');

test('getSettings: khong cau hinh gi -> mac dinh nhu truoc khi co tuy bien', () => {
  const s = getSettings({});
  assert.equal(s.TIMEZONE, 'Asia/Ho_Chi_Minh');
  assert.equal(s.LOCALE, 'vi-VN');
  assert.deepEqual([s.ALERTS.cpuPct, s.ALERTS.ramPct, s.ALERTS.diskPct, s.ALERTS.tempC], [85, 85, 85, 78]);
  assert.equal(s.ALERTS.cooldownMs, 30 * 60_000);
  assert.equal(s.ALERTS.checkMs, 5 * 60_000);
  assert.equal(s.MOTION.threshold, 6000);
  assert.equal(s.MOTION.cooldownMs, 5 * 60_000);
  assert.equal(s.MOTION.clipSeconds, 10);
  assert.equal(s.AGENT.maxToolLoops, 8);
  assert.equal(s.AGENT.requestTimeoutMs, 90_000);
  assert.equal(s.AGENT.sessionIdleMs, 48 * 3600_000);
  assert.equal(s.AGENT.backgroundModel, 'gemini-3.1-flash-lite');
  assert.equal(s.AGENT.summarize, true);
  assert.equal(s.AGENT.summaryMinTurns, 3);
  assert.equal(s.PIHOLE.url, 'http://localhost');
  assert.equal(s.DISK_MOUNT, '/');
  assert.deepEqual([...s.MORNING.sections].sort(), ['map', 'news', 'stocks', 'weather']);
  assert.deepEqual(s.MORNING.symbols, ['E1VFVN30.VN']);
  assert.equal(s.NEWS_FEEDS, null);
});

test('getSettings: doc gia tri tu env', () => {
  const s = getSettings({
    TIMEZONE: 'Europe/Paris', ALERT_CPU_PCT: '90', ALERT_COOLDOWN_MIN: '10', ALERTS_ENABLED: 'off',
    PIHOLE_URL: 'http://192.168.1.2:8080/', MOTION_THRESHOLD: '9000', AGENT_MAX_TOOL_LOOPS: '4',
    GEMINI_MODEL: 'm1', GEMINI_FALLBACK_MODELS: 'm2, m3', MORNING_SECTIONS: 'weather,news', MORNING_SYMBOLS: 'VNM.VN;FPT.VN',
  });
  assert.equal(s.TIMEZONE, 'Europe/Paris');
  assert.equal(s.ALERTS.cpuPct, 90);
  assert.equal(s.ALERTS.cooldownMs, 10 * 60_000);
  assert.equal(s.ALERTS.enabled, false);
  assert.equal(s.PIHOLE.url, 'http://192.168.1.2:8080');
  assert.equal(s.MOTION.threshold, 9000);
  assert.equal(s.AGENT.maxToolLoops, 4);
  assert.equal(s.AGENT.model, 'm1');
  assert.deepEqual(s.AGENT.fallbackModels, ['m2', 'm3']);
  assert.equal(s.MORNING.sections.has('stocks'), false);
  assert.deepEqual(s.MORNING.symbols, ['VNM.VN', 'FPT.VN']);
});

test('getSettings: gia tri sai (chu, ngoai khoang, mui gio la) -> mac dinh, khong nem loi', () => {
  const s = getSettings({ TIMEZONE: 'Khong/Co', ALERT_CPU_PCT: 'abc', ALERT_TEMP_C: '500', MOTION_INTERVAL_SEC: '0', AGENT_MAX_TOOL_LOOPS: '-3', MORNING_MAP_PRESET: 'xx' });
  assert.equal(s.TIMEZONE, 'Asia/Ho_Chi_Minh');
  assert.equal(s.ALERTS.cpuPct, 85);
  assert.equal(s.ALERTS.tempC, 78);
  assert.equal(s.MOTION.intervalMs, 60_000);
  assert.equal(s.AGENT.maxToolLoops, 8);
  assert.equal(s.MORNING.mapPreset, 'vn');
});

test('parseWhen: gio, thu + gio, off, sai dinh dang', () => {
  assert.deepEqual(parseWhen('06:30'), { hour: 6, minute: 30 });
  assert.deepEqual(parseWhen('sat 07:30'), { hour: 7, minute: 30, dayOfWeek: 6 });
  assert.deepEqual(parseWhen('CN 9:05'), { hour: 9, minute: 5, dayOfWeek: 0 });
  assert.deepEqual(parseWhen('off'), { off: true });
  assert.equal(parseWhen('25:00'), null);
  assert.equal(parseWhen('abc'), null);
  assert.equal(parseWhen(''), null);
});

test('parseFeeds: "Ten|url|max;..." bo muc sai, rong -> null', () => {
  assert.deepEqual(parseFeeds('A|https://a.com/rss|2;B|https://b.com/x'), [
    { name: 'A', url: 'https://a.com/rss', max: 2 },
    { name: 'B', url: 'https://b.com/x', max: 3 },
  ]);
  assert.equal(parseFeeds('khong hop le;javascript:alert(1)'), null);
  assert.equal(parseFeeds(''), null);
});

test('loadConfig: TELEGRAM_API_BASE doi duoc may chu API (proxy / Bot API cuc bo)', () => {
  const base = { TELEGRAM_BOT_TOKEN: '1:abc', ALLOWED_CHAT_ID: '5' };
  assert.equal(loadConfig(base).API, 'https://api.telegram.org/bot1:abc');
  assert.equal(loadConfig({ ...base, TELEGRAM_API_BASE: 'http://127.0.0.1:8081/' }).API, 'http://127.0.0.1:8081/bot1:abc');
});

// .env.example khong duoc noi doi voi code: gia tri ghi san trong cac dong "#KEY=..." phai dung bang mac dinh that.
test('.env.example: bo dau # cac dong tuy chon -> cai dat khong doi so voi mac dinh', () => {
  const fs = require('fs');
  const path = require('path');
  const dotenv = require('dotenv');
  const text = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
  const uncommented = text.replace(/^#([A-Z][A-Z0-9_]*=)/gm, '$1');
  const env = dotenv.parse(uncommented);
  // dong "Bat buoc" de trong, con model/vi tri co gia tri that: chi so cac nhom tuy bien
  const pick = (s) => JSON.stringify({ ...s, MORNING: { ...s.MORNING, sections: [...s.MORNING.sections].sort() } },
    (k, v) => (['SCHEDULES', 'NEWS_FEEDS', 'AI_NEWS_FEEDS'].includes(k) ? undefined : v));
  assert.equal(pick(getSettings(env)), pick(getSettings({})));

  // Gio tac vu he thong ghi trong file mau = gio mac dinh trong SYSTEM_SEEDS
  const { SYSTEM_SEEDS, buildSystemSeeds } = require('../scheduler');
  assert.deepEqual(buildSystemSeeds(getSettings(env).SCHEDULES), SYSTEM_SEEDS);
  // Nguon tin mau doc duoc
  assert.ok(getSettings(env).NEWS_FEEDS.length >= 2);
  assert.ok(getSettings(env).AI_NEWS_FEEDS.length >= 1);
});

test('moi bien getSettings doc deu co mat trong .env.example (khong sot bien nao)', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'config.js'), 'utf8');
  const used = [...src.matchAll(/env\.([A-Z][A-Z0-9_]+)/g)].map(m => m[1]);
  const example = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
  const missing = [...new Set(used)].filter(k => k !== 'TZ' && !new RegExp(`^#?${k}=`, 'm').test(example));
  assert.deepEqual(missing, []);
});

test('getSettings: AGENT_BACKGROUND_MODEL doi duoc, "off" tat, AGENT_SUMMARIZE=0 tat tom tat', () => {
  assert.equal(getSettings({ AGENT_BACKGROUND_MODEL: 'm9' }).AGENT.backgroundModel, 'm9');
  assert.equal(getSettings({ AGENT_BACKGROUND_MODEL: 'OFF' }).AGENT.backgroundModel, '');
  assert.equal(getSettings({ AGENT_BACKGROUND_MODEL: '  ' }).AGENT.backgroundModel, 'gemini-3.1-flash-lite');
  const s = getSettings({ AGENT_SUMMARIZE: '0', AGENT_SUMMARY_MIN_TURNS: '5' });
  assert.equal(s.AGENT.summarize, false);
  assert.equal(s.AGENT.summaryMinTurns, 5);
});
