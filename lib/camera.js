const fs = require('fs');
const { execFile } = require('child_process');
const { redact } = require('./redact');

const DEFAULT_TIMEOUT_MS = 20_000;
const SOCKET_TIMEOUT_US  = 10_000_000; // -stimeout cua ffmpeg RTSP tinh bang micro-giay

// message: an toan de hien thi cho user. detail: stderr da redact, chi de ghi log.
class CameraError extends Error {
  constructor(message, detail = '') {
    super(message);
    this.name = 'CameraError';
    this.detail = redact(detail).slice(-500);
  }
}

function classifyFfmpegError(stderr = '') {
  const s = String(stderr);
  if (/401 Unauthorized|Unauthorized|authentication/i.test(s)) return 'Sai tài khoản/mật khẩu camera';
  if (/No route to host|Network is unreachable/i.test(s))       return 'Không tới được camera (sai IP, camera tắt hoặc đã đổi IP)';
  if (/Connection refused/i.test(s))                            return 'Camera từ chối kết nối (sai cổng hoặc RTSP đang tắt)';
  if (/timed out/i.test(s))                                     return 'Camera không phản hồi (hết thời gian chờ)';
  return 'Lỗi không xác định khi đọc luồng camera';
}

function inputArgs(url) {
  return ['-rtsp_transport', 'tcp', '-stimeout', String(SOCKET_TIMEOUT_US), '-i', url];
}

function snapshotArgs(url, outPath) {
  return ['-y', '-loglevel', 'error', ...inputArgs(url), '-frames:v', '1', outPath];
}

// Luong camera la HEVC; Telegram thuong chi phat inline H.264 -> mac dinh ma hoa lai (ha 1280 rong cho nhe).
function clipArgs(url, outPath, seconds, { transcode = true } = {}) {
  const video = transcode
    ? ['-vf', 'scale=1280:-2', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-pix_fmt', 'yuv420p']
    : ['-c:v', 'copy'];
  return ['-y', '-loglevel', 'error', ...inputArgs(url), '-t', String(seconds), ...video, '-an', outPath];
}

function runFfmpeg(args, { timeoutMs = DEFAULT_TIMEOUT_MS, exec = execFile } = {}) {
  return new Promise((resolve, reject) => {
    exec('ffmpeg', args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, _stdout, stderr) => {
      if (!err) return resolve();
      const timedOut = err.killed === true || err.signal === 'SIGTERM';
      const message = timedOut ? 'Camera không phản hồi (quá thời gian chờ)' : classifyFfmpegError(stderr);
      // KHONG dua err.message vao: no chua nguyen dong lenh, gom ca URL co mat khau.
      reject(new CameraError(message, stderr));
    });
  });
}

function assertHasOutput(p) {
  let size = 0;
  try { size = fs.statSync(p).size; } catch { /* khong co file */ }
  if (size === 0) throw new CameraError('Camera không trả về hình ảnh');
}

async function captureSnapshot(url, outPath, opts = {}) {
  fs.rmSync(outPath, { force: true }); // tranh gui nham anh cu neu lan nay ffmpeg khong ghi gi
  await runFfmpeg(snapshotArgs(url, outPath), opts);
  assertHasOutput(outPath);
  return outPath;
}

async function recordClip(url, outPath, seconds, { transcode, ...opts } = {}) {
  fs.rmSync(outPath, { force: true });
  await runFfmpeg(clipArgs(url, outPath, seconds, { transcode }), { timeoutMs: (seconds + 25) * 1000, ...opts });
  assertHasOutput(outPath);
  return outPath;
}

module.exports = { CameraError, classifyFfmpegError, snapshotArgs, clipArgs, captureSnapshot, recordClip };
