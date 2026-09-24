// Che credential truoc khi log / gui Telegram. Ket qua execFile/exec/axios thuong chua ca dong lenh
// hoac URL day du (vd rtsp://admin:PASS@host) - khong bao gio hien thi e.message tho ra ngoai.
const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)[^\s/"']*@/gi; // tham lam: an ca mat khau co chua '@'
const BOT_TOKEN       = /\/bot\d+:[A-Za-z0-9_-]+/g;

function redact(input) {
  return String(input ?? '')
    .replace(URL_CREDENTIALS, '$1***@')
    .replace(BOT_TOKEN, '/bot***');
}

module.exports = { redact };
