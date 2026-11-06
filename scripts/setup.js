#!/usr/bin/env node
// Trinh cai dat tung buoc: hoi cac gia tri can thiet, kiem tra token that, tu do chat id, ghi .env (chmod 600).
const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');
const axios = require('axios');

const ENV_PATH = path.join(__dirname, '..', '.env');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q, def = '') => ((await rl.question(def ? `${q} [${def}]: ` : `${q}: `)).trim() || def);
const yes = async (q, def = true) => /^(y|yes|c|co|có)$/i.test(await ask(`${q} (y/n)`, def ? 'y' : 'n'));

async function telegram(token, method, params = {}) {
  const { data } = await axios.get(`https://api.telegram.org/bot${token}/${method}`, { params, timeout: 15000 });
  return data.result;
}

// Bat ky tin nhan nao gui cho bot deu cho ra chat id.
async function detectChatId(token) {
  const updates = await telegram(token, 'getUpdates', { timeout: 0, allowed_updates: JSON.stringify(['message']) });
  const last = [...updates].reverse().find(u => u.message?.chat?.id);
  return last ? { id: String(last.message.chat.id), name: last.message.from?.first_name || '' } : null;
}

(async () => {
  console.log('\n=== Cài đặt homelab-bot ===\n');
  if (fs.existsSync(ENV_PATH) && !(await yes('Đã có file .env. Ghi đè?', false))) {
    console.log('Giữ nguyên .env. Thoát.');
    return rl.close();
  }

  const env = {};

  console.log('\n1) Telegram bot token: mở Telegram, nhắn @BotFather, gõ /newbot và làm theo hướng dẫn.');
  for (;;) {
    env.TELEGRAM_BOT_TOKEN = await ask('Dán token');
    try {
      const me = await telegram(env.TELEGRAM_BOT_TOKEN, 'getMe');
      console.log(`   OK: bot @${me.username}`);
      break;
    } catch { console.log('   Token không hợp lệ hoặc không có mạng. Thử lại.'); }
  }

  console.log('\n2) Chat ID: hãy nhắn một tin bất kỳ (ví dụ "hi") cho bot vừa tạo, rồi nhấn Enter.');
  await ask('Đã nhắn xong? Enter để dò');
  const found = await detectChatId(env.TELEGRAM_BOT_TOKEN).catch(() => null);
  if (found && await yes(`Tìm thấy chat ${found.id}${found.name ? ` (${found.name})` : ''}. Dùng chat này?`)) env.ALLOWED_CHAT_ID = found.id;
  else env.ALLOWED_CHAT_ID = await ask('Nhập chat id (số) thủ công');
  if (!/^-?\d+$/.test(env.ALLOWED_CHAT_ID)) throw new Error('Chat id phải là số.');

  console.log('\n3) Agent AI Gemini (tùy chọn): lấy key miễn phí tại https://aistudio.google.com/apikey');
  env.GEMINI_API_KEY = await ask('GEMINI_API_KEY (Enter để bỏ qua)');
  if (env.GEMINI_API_KEY) env.GEMINI_MODEL = await ask('Model', 'gemini-3.6-flash');

  console.log('\n4) Thời tiết & bản tin sáng (tùy chọn): key miễn phí tại https://openweathermap.org/api');
  env.OWM_API_KEY = await ask('OWM_API_KEY (Enter để bỏ qua)');
  if (env.OWM_API_KEY) {
    env.LOCATION_NAME = await ask('Tên khu vực', 'Hà Nội');
    env.LOCATION_LAT = await ask('Vĩ độ', '21.0278');
    env.LOCATION_LON = await ask('Kinh độ', '105.8342');
  }

  if (await yes('\n5) Có máy tính chính trong LAN để dùng /ping và Wake-on-LAN?', false)) {
    env.MAIN_PC_IP = await ask('IP máy chính (vd 192.168.1.62)');
    env.MAIN_PC_MAC = await ask('MAC máy chính (vd AA:BB:CC:DD:EE:FF)');
  }

  if (await yes('6) Có camera Hikvision (RTSP) để dùng /cam và cảnh báo chuyển động?', false)) {
    env.CAM_RTSP_URL = await ask('RTSP URL (rtsp://USER:PASS@IP:554/Streaming/Channels/101)');
  }

  const lines = Object.entries(env).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(ENV_PATH, `# Tạo bởi npm run setup\n${lines.join('\n')}\n`, { mode: 0o600 });
  fs.chmodSync(ENV_PATH, 0o600);
  console.log(`\nĐã ghi ${ENV_PATH} (quyền 600).`);
  console.log('Chạy thử:  npm start      |  chạy nền lâu dài: xem README mục "Chạy nền".\n');
  rl.close();
})().catch(e => { console.error('Lỗi:', e.message); rl.close(); process.exit(1); });
