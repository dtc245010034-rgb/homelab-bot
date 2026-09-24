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
  });
}

module.exports = { loadConfig, deriveSubstream, hostOf };
