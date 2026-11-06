const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

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

function loadConfig(env = process.env) {
  const missing = ['TELEGRAM_BOT_TOKEN', 'ALLOWED_CHAT_ID'].filter(k => !env[k]);
  if (missing.length) throw new Error(`Thiếu biến môi trường bắt buộc: ${missing.join(', ')}`);

  const chatId = Number(env.ALLOWED_CHAT_ID);
  if (!Number.isInteger(chatId)) throw new Error('ALLOWED_CHAT_ID phải là số nguyên');

  const camRtsp = env.CAM_RTSP_URL || null;
  return Object.freeze({
    TOKEN: env.TELEGRAM_BOT_TOKEN,
    API: `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`,
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

module.exports = { loadConfig, deriveSubstream, hostOf, parseDevices, getLocation, broadcastOf };
