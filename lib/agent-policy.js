// Tool tra ve noi dung tu web (RSS): coi la DU LIEU, khong phai chi dan. Neu request hien tai da doc
// noi dung do, moi tool co tac dong (them lich, dat nhac, ghi nho) phai duoc user xac nhan truoc.
const UNTRUSTED_TOOLS = new Set(['getNews']);

const isUserTextTurn = (c) => c.role === 'user' && (c.parts || []).some(p => typeof p.text === 'string');

function hasUntrustedResult(contents) {
  for (let i = contents.length - 1; i >= 0; i--) {
    const c = contents[i];
    if (isUserTextTurn(c)) return false; // toi day la dau request hien tai
    if (c.role === 'user' && (c.parts || []).some(p => p.functionResponse && UNTRUSTED_TOOLS.has(p.functionResponse.name))) {
      return true;
    }
  }
  return false;
}

function callsIncludeUntrusted(calls) {
  return (calls || []).some(c => UNTRUSTED_TOOLS.has(c.name));
}

function needsConfirm(tool, tainted) {
  return Boolean(tool.requiresConfirm || (tainted && tool.sideEffect));
}

// GEMINI.md duoc gui kem MOI request: gioi han kich thuoc, uu tien dong index moi nhat (o cuoi file).
function clampIndex(text, maxChars = 6000) {
  if (text.length <= maxChars) return text;
  const tail = text.slice(-maxChars);
  const nl = tail.indexOf('\n');
  return '(…index cũ đã bị cắt bớt…)\n' + (nl === -1 ? tail : tail.slice(nl + 1));
}

module.exports = { UNTRUSTED_TOOLS, hasUntrustedResult, callsIncludeUntrusted, needsConfirm, clampIndex };
