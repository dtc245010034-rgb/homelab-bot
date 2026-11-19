// Goi Gemini co GIOI HAN THOI GIAN tung lan + xoay model. Truoc day 1 lan goi treo (model qua tai phia Google)
// lam ca yeu cau doi vo han vi han 90s chi duoc kiem tra GIUA cac lan goi. Gio:
//   - moi lan goi co timeout; qua han -> huy yeu cau va sang model ke tiep NGAY (khong thu lai model dang treo)
//   - loi mang/5xx/429-theo-phut: thu lai 1 lan cung model roi moi sang model khac (nhu cu)
//   - onModelFailed(model, loi): goi khi bo 1 model vi treo, hoac vi hong ca 2 lan (de cho ben goi tam ne model do)
//   - 429 het quota ngay: danh dau het, sang model ke tiep (nhu cu)
//   - loi khac (vd sai schema): nem ngay, doi model cung khong giup gi
class GeminiTimeoutError extends Error {
  constructor(model, timeoutMs) {
    super(`Gemini (${model}) không phản hồi trong ${Math.round(timeoutMs / 1000)}s`);
    this.name = 'GeminiTimeoutError';
    this.isTimeout = true;
    this.model = model;
    this.timeoutMs = timeoutMs;
  }
}

const defaultSleep = (ms) => new Promise(r => setTimeout(r, ms));

// Chay generate({model, signal}) toi da timeoutMs; qua han thi abort + GeminiTimeoutError.
function runWithTimeout(generate, model, timeoutMs) {
  const ctrl = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { ctrl.abort(); reject(new GeminiTimeoutError(model, timeoutMs)); }, timeoutMs);
  });
  return Promise.race([Promise.resolve().then(() => generate({ model, signal: ctrl.signal })), timeout])
    .finally(() => clearTimeout(timer));
}

async function callWithFallback({
  models, generate, timeoutMs, isPerMinute = () => false,
  retryDelayMs = 1500, perMinuteDelayMs = 7000, sleep = defaultSleep,
  onAttempt = () => {}, onDailyExhausted = () => {}, onModelFailed = () => {}, record = () => {},
}) {
  let lastError;

  async function attempt(model) {
    onAttempt(model);
    const t = Date.now();
    try {
      const r = await runWithTimeout(generate, model, timeoutMs);
      record({ model, ms: Date.now() - t, outcome: 'ok' });
      return r;
    } catch (e) {
      record({ model, ms: Date.now() - t, outcome: e.isTimeout ? 'timeout' : (e?.status === 429 ? 'quota' : 'error') });
      throw e;
    }
  }

  for (const model of models) {
    try {
      return await attempt(model);
    } catch (e) {
      if (e.isTimeout) { onModelFailed(model, e); lastError = e; continue; }
      const status = e?.status || e?.response?.status;
      const perMinute = status === 429 && isPerMinute(e);

      if (!status || (status >= 500 && status < 600) || perMinute) {
        await sleep(perMinute ? perMinuteDelayMs : retryDelayMs);
        try {
          return await attempt(model);
        } catch (e2) {
          onModelFailed(model, e2); // loi le (503 roi thu lai duoc) thi khong toi day; hong ca hai lan = model dang qua tai
          lastError = e2;
          continue;
        }
      }
      if (status === 429) {
        onDailyExhausted(model, e);
        lastError = e;
        continue;
      }
      throw e;
    }
  }
  throw lastError || new Error('Tất cả model Gemini trong danh sách đều không khả dụng hôm nay.');
}

const SLOW_TOTAL_MS = 30_000; // tong thoi gian tu day tro len thi giai thich ro la cham o dau
const sec = (ms) => `${Math.round(ms / 1000)}s`;

// Dong su that gan vao cuoi cau tra loi khi yeu cau cham hoac phai doi model. Rong neu khong co gi dang noi.
// attempts: [{model, ms, outcome}] cua cac lan goi Gemini trong 1 yeu cau.
function formatSlowNote(attempts, totalMs) {
  const timeouts = attempts.filter(a => a.outcome === 'timeout');
  const slow = totalMs >= SLOW_TOTAL_MS;
  if (!timeouts.length && !slow) return '';
  const parts = [];
  if (timeouts.length) {
    const t = timeouts.map(a => `${a.model} (không phản hồi sau ${sec(a.ms)})`).join(', ');
    const ok = attempts.filter(a => a.outcome === 'ok').pop();
    parts.push(`Gemini chậm: ${t}${ok ? `, đã chuyển sang ${ok.model} (${sec(ok.ms)})` : ''}`);
  } else {
    const worst = attempts.reduce((w, a) => (a.ms > (w?.ms || 0) ? a : w), null);
    if (worst) parts.push(`Gemini chậm: ${worst.model} mất ${sec(worst.ms)}`);
  }
  parts.push(`tổng ${sec(totalMs)}`);
  return `⏱ ${parts.join('; ')}.`;
}

module.exports = { GeminiTimeoutError, callWithFallback, formatSlowNote, SLOW_TOTAL_MS };
