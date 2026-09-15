require('dotenv').config({ path: __dirname + '/.env' });
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

const CAM_RTSP = process.env.CAM_RTSP_URL;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = 8915208045;
const API = `https://api.telegram.org/bot${TOKEN}`;
const THRESHOLD = 6000;
const COOLDOWN_FILE = '/tmp/motion-last-alert';
const COOLDOWN_MS = 5 * 60 * 1000;
const STATE_FILE = path.join(__dirname, '.motion-state');

async function snap(targetPath) {
  await execAsync(`ffmpeg -y -rtsp_transport tcp -i "${CAM_RTSP}" -vframes 1 ${targetPath} 2>/dev/null`);
}

async function checkMotion() {
  if (!fs.existsSync(STATE_FILE)) return; // tắt thì thoát ngay, không tốn CPU
  try {
    if (!fs.existsSync('/tmp/cam_prev.jpg')) {
      await snap('/tmp/cam_prev.jpg');
      return;
    }

    await snap('/tmp/cam_curr.jpg');

    let stderr = '';
    try {
      await execAsync('compare -metric RMSE /tmp/cam_prev.jpg /tmp/cam_curr.jpg /tmp/cam_diff.jpg');
    } catch (e) {
      stderr = e.stderr || e.message;
    }

    const match = stderr.match(/\(([\d.]+)\)/);
    const rmse = match ? parseFloat(match[1]) * 65535 : 0;

    console.log(`[motion] RMSE: ${rmse.toFixed(0)}`);

    if (rmse > THRESHOLD) {
      const lastAlert = fs.existsSync(COOLDOWN_FILE)
        ? parseInt(fs.readFileSync(COOLDOWN_FILE, 'utf8'), 10)
        : 0;

      if (Date.now() - lastAlert > COOLDOWN_MS) {
        fs.writeFileSync(COOLDOWN_FILE, Date.now().toString());

        const clipPath = `/tmp/motion_clip_${Date.now()}.mp4`;
        const timeStr = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
        const caption = `🚨 <b>Phát hiện chuyển động!</b>\n📅 ${timeStr}\n📊 RMSE: ${rmse.toFixed(0)}`;
        let videoSent = false;

        try {
          console.log('[motion] Recording 10s video clip...');
          // Record 10s directly copying stream (negligible CPU usage)
          await execAsync(`ffmpeg -y -rtsp_transport tcp -i "${CAM_RTSP}" -t 10 -c:v copy -an "${clipPath}" 2>/dev/null`);

          if (fs.existsSync(clipPath) && fs.statSync(clipPath).size > 0) {
            const form = new FormData();
            form.append('chat_id', CHAT_ID);
            form.append('video', fs.createReadStream(clipPath));
            form.append('caption', caption);
            form.append('parse_mode', 'HTML');
            await axios.post(`${API}/sendVideo`, form, { headers: form.getHeaders(), timeout: 30000 });
            videoSent = true;
            console.log('[motion] Video alert sent!');
          }
        } catch (vErr) {
          console.error('[motion] Video send error:', vErr.message);
        } finally {
          if (fs.existsSync(clipPath)) {
            try { fs.unlinkSync(clipPath); } catch {}
          }
        }

        // Fallback to photo if video failed
        if (!videoSent && fs.existsSync('/tmp/cam_curr.jpg')) {
          const form = new FormData();
          form.append('chat_id', CHAT_ID);
          form.append('photo', fs.createReadStream('/tmp/cam_curr.jpg'));
          form.append('caption', caption);
          form.append('parse_mode', 'HTML');
          await axios.post(`${API}/sendPhoto`, form, { headers: form.getHeaders() });
          console.log('[motion] Photo fallback alert sent!');
        }
      } else {
        console.log('[motion] Trong cooldown, bỏ qua alert');
      }
    }

    fs.copyFileSync('/tmp/cam_curr.jpg', '/tmp/cam_prev.jpg');
  } catch (e) {
    console.error('[motion] Error:', e.message);
  }
}

checkMotion();
setInterval(checkMotion, 60 * 1000);
console.log("[motion-check] daemon started, checking every 60s");
