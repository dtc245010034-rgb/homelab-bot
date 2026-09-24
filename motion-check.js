const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const axios = require('axios');
const FormData = require('form-data');
const { loadConfig } = require('./config');
const { captureSnapshot, recordClip } = require('./lib/camera');
const { parseRmse, shouldAlert, createHealthTracker } = require('./lib/motion');
const { redact } = require('./lib/redact');

const { API, CHAT_ID, CAM_RTSP, CAM_MOTION_RTSP } = loadConfig();

const THRESHOLD     = 6000;
const COOLDOWN_MS   = 5 * 60 * 1000;
const INTERVAL_MS   = 60 * 1000;
const CLIP_SECONDS  = 10;
const TRANSCODE     = process.env.MOTION_CLIP_TRANSCODE !== '0';
const STATE_FILE    = path.join(__dirname, '.motion-state');
const COOLDOWN_FILE = '/tmp/motion-last-alert';
const PREV = '/tmp/cam_prev.jpg';
const CURR = '/tmp/cam_curr.jpg';
const DIFF = '/tmp/cam_diff.jpg';

const health = createHealthTracker({ failThreshold: 3 });
let busy = false; // chong chay chong lan neu 1 vong mat hon INTERVAL_MS

async function notify(text) {
  try {
    await axios.post(`${API}/sendMessage`, { chat_id: CHAT_ID, text, parse_mode: 'HTML' }, { timeout: 10000 });
  } catch (e) {
    console.error('[motion] notify error:', redact(e.message));
  }
}

function compareImages(a, b) {
  return new Promise((resolve) => {
    // compare thoat ma 1 khi 2 anh khac nhau (binh thuong) - chi doc stderr
    execFile('compare', ['-metric', 'RMSE', a, b, DIFF], { timeout: 30_000 }, (_err, _out, stderr) => resolve(parseRmse(stderr)));
  });
}

function readLastAlert() {
  try { return parseInt(fs.readFileSync(COOLDOWN_FILE, 'utf8'), 10) || 0; } catch { return 0; }
}

async function sendAlert(rmse) {
  const clipPath = `/tmp/motion_clip_${Date.now()}.mp4`;
  const timeStr  = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const caption  = `🚨 <b>Phát hiện chuyển động!</b>\n📅 ${timeStr}\n📊 RMSE: ${rmse.toFixed(0)}`;
  let videoSent = false;

  try {
    console.log(`[motion] Recording ${CLIP_SECONDS}s clip (transcode=${TRANSCODE})...`);
    await recordClip(CAM_RTSP, clipPath, CLIP_SECONDS, { transcode: TRANSCODE });
    const form = new FormData();
    form.append('chat_id', CHAT_ID);
    form.append('video', fs.createReadStream(clipPath));
    form.append('caption', caption);
    form.append('parse_mode', 'HTML');
    form.append('supports_streaming', 'true');
    await axios.post(`${API}/sendVideo`, form, { headers: form.getHeaders(), timeout: 60_000 });
    videoSent = true;
    console.log('[motion] Video alert sent!');
  } catch (e) {
    console.error('[motion] Video error:', redact(e.detail || e.message));
  } finally {
    fs.rmSync(clipPath, { force: true });
  }

  if (!videoSent && fs.existsSync(CURR)) {
    try {
      const form = new FormData();
      form.append('chat_id', CHAT_ID);
      form.append('photo', fs.createReadStream(CURR));
      form.append('caption', caption);
      form.append('parse_mode', 'HTML');
      await axios.post(`${API}/sendPhoto`, form, { headers: form.getHeaders(), timeout: 20_000 });
      console.log('[motion] Photo fallback alert sent!');
    } catch (e) {
      console.error('[motion] Photo fallback error:', redact(e.message));
    }
  }
}

async function checkMotion() {
  if (!fs.existsSync(STATE_FILE)) return; // tat thi thoat ngay, khong ton CPU
  if (busy) return;
  busy = true;
  try {
    try {
      await captureSnapshot(CAM_MOTION_RTSP, CURR);
    } catch (e) {
      console.error('[motion] camera error:', e.message, '|', e.detail || '');
      if (health.recordFailure() === 'down') {
        await notify(`<b>CAMERA MẤT KẾT NỐI</b>\n<blockquote>${e.message}\nGiám sát chuyển động tạm thời không hoạt động. Sẽ báo lại khi camera kết nối lại.</blockquote>`);
      }
      return;
    }

    if (health.recordSuccess() === 'up') {
      fs.rmSync(PREV, { force: true }); // anh cu qua xa, so sanh se bao dong gia
      await notify('<b>CAMERA ĐÃ KẾT NỐI LẠI</b>\n<blockquote>Giám sát chuyển động hoạt động trở lại.</blockquote>');
    }

    if (!fs.existsSync(PREV)) { fs.copyFileSync(CURR, PREV); return; }

    const rmse = await compareImages(PREV, CURR);
    if (rmse == null) console.error('[motion] Khong doc duoc RMSE tu compare');
    else console.log(`[motion] RMSE: ${rmse.toFixed(0)}`);

    if (shouldAlert({ rmse, threshold: THRESHOLD, lastAlertAt: readLastAlert(), now: Date.now(), cooldownMs: COOLDOWN_MS })) {
      fs.writeFileSync(COOLDOWN_FILE, Date.now().toString());
      await sendAlert(rmse);
    } else if (rmse > THRESHOLD) {
      console.log('[motion] Trong cooldown, bỏ qua alert');
    }

    fs.copyFileSync(CURR, PREV);
  } catch (e) {
    console.error('[motion] Error:', redact(e.message));
  } finally {
    busy = false;
  }
}

checkMotion();
setInterval(checkMotion, INTERVAL_MS);
console.log('[motion-check] daemon started, checking every 60s');
