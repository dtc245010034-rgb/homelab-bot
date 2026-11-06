// Tool tra ve noi dung tu web (RSS): coi la DU LIEU, khong phai chi dan. Neu request hien tai da doc
// noi dung do, moi tool co tac dong (them lich, dat nhac, ghi nho) phai duoc user xac nhan truoc.
const UNTRUSTED_TOOLS = new Set(['getNews', 'getAiNews', 'searchNews', 'fetchUrl']);

// Nhiem vu dinh ky (agentTask) chay luc khong co nguoi bam Xac nhan: chi cho tool DOC va tao bao cao,
// tuyet doi khong co tool sua lich / dat-huy nhac viec / ghi nho.
// Khong co `recall`: da doc web ma con doc duoc bo nho ca nhan thi 1 trang doc hai co the lay du lieu do ra ngoai qua URL.
const UNATTENDED_TOOLS = new Set(['getNews', 'getAiNews', 'searchNews', 'fetchUrl', 'getWeather', 'createReport']);

// Chong tuồn du lieu ra ngoai qua fetchUrl (URL do model/trang web tu dat, vd https://evil.example/?d=<bi mat>):
// chi duoc doc cac URL da xuat hien san trong tin nhan cua nguoi dung / ket qua tin tuc & tim kiem cua chinh lan chay nay.
const URL_SOURCES = new Set(['getNews', 'getAiNews', 'searchNews']);

function extractUrls(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return (text.match(/https?:\/\/[^\s"'<>\\]+/g) || []).map(u => u.replace(/[.,;:!?)\]]+$/, ''));
}

function normalizeUrl(u) {
  try { return new URL(String(u)).href; } catch { return null; }
}

const makeSeen = (...values) => new Set(values.flatMap(extractUrls).map(normalizeUrl).filter(Boolean));

function isKnownUrl(url, seen) {
  const n = normalizeUrl(url);
  return Boolean(n && seen.has(n));
}

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

module.exports = { UNTRUSTED_TOOLS, UNATTENDED_TOOLS, URL_SOURCES, extractUrls, makeSeen, isKnownUrl, hasUntrustedResult, callsIncludeUntrusted, needsConfirm, clampIndex };
