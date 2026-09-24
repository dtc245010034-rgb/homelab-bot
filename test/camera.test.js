const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  CameraError, classifyFfmpegError, snapshotArgs, clipArgs, captureSnapshot, recordClip,
} = require('../lib/camera');

const URL_WITH_PW = 'rtsp://admin:TopSecret99@192.168.1.68:554/Streaming/Channels/101';
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cam-')), 'out.bin');

// exec gia: (file, args, opts, cb). `behavior` quyet dinh ket qua.
const fakeExec = (behavior) => (file, args, opts, cb) => { behavior({ file, args, opts, cb }); return {}; };

test('classifyFfmpegError phan loai cac loi pho bien', () => {
  assert.match(classifyFfmpegError('Connection to tcp://x failed: No route to host'), /Không tới được camera/);
  assert.match(classifyFfmpegError('method DESCRIBE failed: 401 Unauthorized'), /Sai tài khoản/);
  assert.match(classifyFfmpegError('Connection refused'), /từ chối/);
  assert.match(classifyFfmpegError('Connection timed out'), /không phản hồi/);
  assert.match(classifyFfmpegError('gi do la'), /không xác định/);
  assert.match(classifyFfmpegError(undefined), /không xác định/);
});

test('snapshotArgs: URL la 1 phan tu argv rieng (khong qua shell), co stimeout va -frames:v 1', () => {
  const a = snapshotArgs(URL_WITH_PW, '/tmp/x.jpg');
  assert.ok(a.includes(URL_WITH_PW));
  assert.equal(a[a.indexOf('-i') + 1], URL_WITH_PW);
  assert.equal(a[a.indexOf('-stimeout') + 1], '10000000');
  assert.equal(a[a.indexOf('-frames:v') + 1], '1');
  assert.equal(a[a.length - 1], '/tmp/x.jpg');
});

test('clipArgs: transcode -> libx264 yuv420p; khong transcode -> copy; luon -an va -t', () => {
  const t = clipArgs('rtsp://h/x', '/tmp/c.mp4', 10, { transcode: true });
  assert.ok(t.includes('libx264') && t.includes('yuv420p') && t.includes('-an'));
  assert.equal(t[t.indexOf('-t') + 1], '10');
  const c = clipArgs('rtsp://h/x', '/tmp/c.mp4', 10, { transcode: false });
  assert.equal(c[c.indexOf('-c:v') + 1], 'copy');
  assert.ok(!c.includes('libx264'));
  assert.ok(clipArgs('rtsp://h/x', '/tmp/c.mp4', 10).includes('libx264')); // mac dinh: transcode
});

test('captureSnapshot thanh cong khi ffmpeg thanh cong va file co du lieu', async () => {
  const out = tmp();
  const exec = fakeExec(({ args, cb }) => { fs.writeFileSync(args[args.length - 1], 'jpeg-data'); cb(null, '', ''); });
  assert.equal(await captureSnapshot(URL_WITH_PW, out, { exec }), out);
});

test('captureSnapshot xoa file cu truoc khi chay (khong gui anh cu khi lan nay hong)', async () => {
  const out = tmp();
  fs.writeFileSync(out, 'anh-cu');
  const exec = fakeExec(({ cb }) => cb(null, '', '')); // ffmpeg "thanh cong" nhung khong ghi file
  await assert.rejects(captureSnapshot(URL_WITH_PW, out, { exec }), CameraError);
  assert.equal(fs.existsSync(out), false);
});

test('loi ffmpeg: message da phan loai, KHONG lo mat khau o message lan detail', async () => {
  const err = Object.assign(new Error(`Command failed: ffmpeg -i "${URL_WITH_PW}" out.jpg`), { code: 1 });
  const stderr = `[tcp @ 0x1] Connection to tcp://192.168.1.68:554 failed: No route to host\n${URL_WITH_PW}: No route to host`;
  const exec = fakeExec(({ cb }) => cb(err, '', stderr));
  await assert.rejects(captureSnapshot(URL_WITH_PW, tmp(), { exec }), (e) => {
    assert.ok(e instanceof CameraError);
    assert.match(e.message, /Không tới được camera/);
    assert.ok(!e.message.includes('TopSecret99'));
    assert.ok(!e.detail.includes('TopSecret99'));
    assert.match(e.detail, /No route to host/);
    return true;
  });
});

test('bi kill do timeout -> thong bao qua thoi gian, khong lo mat khau', async () => {
  const err = Object.assign(new Error(`Command failed: ffmpeg ${URL_WITH_PW}`), { killed: true, signal: 'SIGTERM' });
  const exec = fakeExec(({ cb }) => cb(err, '', ''));
  await assert.rejects(captureSnapshot(URL_WITH_PW, tmp(), { exec }), (e) => {
    assert.match(e.message, /quá thời gian/);
    assert.ok(!e.message.includes('TopSecret99'));
    return true;
  });
});

test('goi ffmpeg bang execFile voi timeout duoc truyen xuong', async () => {
  const out = tmp();
  let seen;
  const exec = fakeExec(({ file, args, opts, cb }) => { seen = { file, opts }; fs.writeFileSync(args[args.length - 1], 'x'); cb(null, '', ''); });
  await captureSnapshot(URL_WITH_PW, out, { exec, timeoutMs: 5000 });
  assert.equal(seen.file, 'ffmpeg');
  assert.equal(seen.opts.timeout, 5000);
});

test('recordClip: timeout = do dai clip + 25s va dung transcode theo tuy chon', async () => {
  const out = tmp();
  let seen;
  const exec = fakeExec(({ args, opts, cb }) => { seen = { args, opts }; fs.writeFileSync(args[args.length - 1], 'mp4'); cb(null, '', ''); });
  await recordClip(URL_WITH_PW, out, 10, { exec, transcode: false });
  assert.equal(seen.opts.timeout, 35000);
  assert.equal(seen.args[seen.args.indexOf('-c:v') + 1], 'copy');
});
