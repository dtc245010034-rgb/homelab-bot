const { redact } = require('./redact');

// Chay tac vu cham o nen de vong poll Telegram khong bi chan; moi `key` chi chay 1 ban tai 1 thoi diem
// (bam nut 2 lan khong sinh 2 ffmpeg/2 lan don rac).
function createDetacher(onError = (key, e) => console.error(`[detached:${key}]`, redact(e?.message))) {
  const running = new Set();
  return function run(key, fn) {
    if (running.has(key)) return false;
    running.add(key);
    Promise.resolve()
      .then(fn)
      .catch(e => onError(key, e))
      .finally(() => running.delete(key));
    return true;
  };
}

module.exports = { createDetacher };
