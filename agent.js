const fs = require('fs');
const path = require('path');
const { GoogleGenAI, createPartFromFunctionResponse } = require('@google/genai');
const fsutil = require('./fsutil');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Danh sach model du phong, uu tien tu tren xuong - da test that ngay 2026-09-15, con dung duoc.
// Cac model cu (gemini-2.5-flash, gemini-2.5-flash-lite, gemini-2.0-flash) da 404 "no longer
// available to new users" - KHONG dua vao danh sach nay. Quota free tier tinh RIENG theo tung
// model (quotaId co "PerModel"), nen het quota 1 model van con dung duoc model khac.
const MODEL_CANDIDATES = [...new Set([
  process.env.GEMINI_MODEL || 'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite',
])];

const WORKSPACE_DIR = path.join(__dirname, 'agent-workspace');
const GEMINI_MD      = path.join(WORKSPACE_DIR, 'GEMINI.md');
const MEMORY_DIR     = path.join(WORKSPACE_DIR, 'memory');
const SESSIONS_DIR   = path.join(WORKSPACE_DIR, 'sessions');
const ARCHIVE_DIR    = path.join(SESSIONS_DIR, 'archive');
const LOGS_DIR       = path.join(WORKSPACE_DIR, 'logs');
const AGENT_LOG      = path.join(LOGS_DIR, 'agent.log');
const QUOTA_FILE     = path.join(LOGS_DIR, 'quota-counter.json');

// ─── Tunables ─────────────────────────────────────────────
const MAX_TOOL_LOOPS          = 8;
const REQUEST_TIMEOUT_MS      = 90_000;
const STALL_NOTICE_MS         = 12_000;
const CONFIRM_TIMEOUT_MS      = 30_000;
const SESSION_IDLE_ARCHIVE_MS = 48 * 3600 * 1000;
const TRIM_LAST_TURNS         = 15; // so luot user-text gan nhat giu lai khi goi API, phan cu van con nguyen trong file session
const INDEX_MAX_LINES         = 200;
const AGENT_LOG_MAX_BYTES     = 5 * 1024 * 1024;

const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

// ─── Filesystem helpers (primitive dung chung nam trong fsutil.js) ──
function ensureDirs() {
  fsutil.ensureDirs([WORKSPACE_DIR, MEMORY_DIR, SESSIONS_DIR, ARCHIVE_DIR, LOGS_DIR]);
}

function writeJsonAtomic(filePath, obj) {
  ensureDirs();
  fsutil.writeJsonAtomic(filePath, obj);
}

const readJsonSafe = fsutil.readJsonSafe;

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Session file (luu file, khong luu RAM, de song sot qua mat dien/PM2 restart) ──
function sessionPath(chatId) {
  return path.join(SESSIONS_DIR, `${chatId}.json`);
}

function freshSession() {
  const now = new Date().toISOString();
  return { meta: { createdAt: now, lastActivityAt: now }, contents: [] };
}

function archiveSessionFile(chatId, reason) {
  ensureDirs();
  const p = sessionPath(chatId);
  if (!fs.existsSync(p)) return;
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  try {
    fs.renameSync(p, path.join(ARCHIVE_DIR, `${chatId}-${ts}-${reason}.json`));
  } catch (e) { /* best effort, khong lam gian doan flow chinh */ }
}

function loadSession(chatId) {
  const p = sessionPath(chatId);
  const raw = fs.existsSync(p) ? readJsonSafe(p, null) : freshSession();
  if (!raw || !raw.meta || !Array.isArray(raw.contents)) {
    // file hong/corrupt -> archive de khong mat du lieu, bat dau phien trang
    archiveSessionFile(chatId, 'corrupt');
    return freshSession();
  }
  return raw;
}

function saveSession(chatId, session) {
  session.meta.lastActivityAt = new Date().toISOString();
  writeJsonAtomic(sessionPath(chatId), session);
}

// Ghi write-through: goi ngay sau moi buoc (tin nhan user / moi luot model / moi function response)
function appendContents(chatId, session, newContents) {
  session.contents.push(...newContents);
  saveSession(chatId, session);
}

// Cat bot lich su gui len Gemini nhung KHONG cat giua 1 cap function-call/response -
// chi cat tai ranh gioi 1 luot user go text that (khong phai luot function response),
// vi Gemini se bao loi neu thay 1 functionResponse ma khong co functionCall truoc do trong contents gui len.
function trimForApi(contents) {
  let userTextTurns = 0;
  for (let i = contents.length - 1; i >= 0; i--) {
    const c = contents[i];
    const isUserText = c.role === 'user' && (c.parts || []).some(p => typeof p.text === 'string');
    if (isUserText) {
      userTextTurns++;
      if (userTextTurns > TRIM_LAST_TURNS) return contents.slice(i + 1);
    }
  }
  return contents;
}

// ─── GEMINI.md (index) + memory/*.md (noi dung chi tiet theo chu de) ──
function readIndex() {
  ensureDirs();
  return fs.existsSync(GEMINI_MD) ? fs.readFileSync(GEMINI_MD, 'utf8') : '';
}

function slugify(topic) {
  return (
    String(topic)
      .normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '') // bo dau tieng Viet
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'chu-de'
  );
}

function memoryPath(slug) {
  return path.join(MEMORY_DIR, `${slug}.md`);
}

function appendIndexLine(slug, description) {
  const lines = readIndex().split('\n');
  const marker = `(memory/${slug}.md)`;
  if (lines.some(l => l.includes(marker))) return; // da co pointer, khong them trung
  const topicLineIdx = (arr) => arr.findIndex(l => l.trim().startsWith('- ['));
  const topicCount = lines.filter(l => l.trim().startsWith('- [')).length;
  if (topicCount + 1 > INDEX_MAX_LINES) {
    const idx = topicLineIdx(lines);
    if (idx !== -1) lines.splice(idx, 1); // rot dong index cu nhat, file memory/*.md tuong ung van con
  }
  lines.push(`- [${slug}](memory/${slug}.md) — ${description}`);
  ensureDirs();
  fs.writeFileSync(GEMINI_MD, lines.join('\n'));
}

function removeIndexLine(slug) {
  const marker = `(memory/${slug}.md)`;
  const lines = readIndex().split('\n').filter(l => !l.includes(marker));
  ensureDirs();
  fs.writeFileSync(GEMINI_MD, lines.join('\n'));
}

async function rememberImpl({ topic, note }) {
  const slug = slugify(topic);
  const mp = memoryPath(slug);
  ensureDirs();
  const ts = new Date().toISOString();
  if (!fs.existsSync(mp)) {
    fs.writeFileSync(mp, `# ${topic}\n\n- [${ts}] ${note}\n`);
    appendIndexLine(slug, String(topic).slice(0, 80));
  } else {
    fs.appendFileSync(mp, `- [${ts}] ${note}\n`);
  }
  return { ok: true, slug };
}

async function recallImpl({ topic }) {
  const slug = slugify(topic);
  const mp = memoryPath(slug);
  if (!fs.existsSync(mp)) return { found: false };
  let content = fs.readFileSync(mp, 'utf8');
  const CAP = 8000;
  if (content.length > CAP) content = content.slice(-CAP); // giu phan moi nhat, tranh phinh context
  return { found: true, slug, content };
}

async function forgetImpl({ topic }) {
  const slug = slugify(topic);
  try { fs.unlinkSync(memoryPath(slug)); } catch (e) { /* khong sao neu chua ton tai */ }
  removeIndexLine(slug);
  return { ok: true, slug };
}

// ─── Quota counter uoc tinh (khong co API chinh thuc tu Google de hoi so that) ──
function getPacificDateString() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
}

function freshQuotaState(today) {
  return { date: today, currentModel: MODEL_CANDIDATES[0], exhaustedModels: [], byModel: {}, limits: {} };
}

function readQuota() {
  const today = getPacificDateString();
  const q = readJsonSafe(QUOTA_FILE, null);
  if (!q || q.date !== today) return freshQuotaState(today);
  // dien bu field neu file cu (truoc khi co multi-model) hoac thieu field
  if (!q.byModel) q.byModel = {};
  if (!q.exhaustedModels) q.exhaustedModels = [];
  if (!q.limits) q.limits = {};
  if (!q.currentModel || !MODEL_CANDIDATES.includes(q.currentModel)) q.currentModel = MODEL_CANDIDATES[0];
  if (q.exhaustedModels.includes(q.currentModel)) {
    q.currentModel = MODEL_CANDIDATES.find(m => !q.exhaustedModels.includes(m)) || q.currentModel;
  }
  return q;
}

function incrementQuota(model) {
  const q = readQuota();
  q.byModel[model] = (q.byModel[model] || 0) + 1;
  writeJsonAtomic(QUOTA_FILE, q);
}

function markModelExhausted(model, limitValue) {
  const q = readQuota();
  if (!q.exhaustedModels.includes(model)) q.exhaustedModels.push(model);
  if (limitValue != null) q.limits[model] = limitValue;
  const next = MODEL_CANDIDATES.find(m => !q.exhaustedModels.includes(m));
  if (next) q.currentModel = next;
  writeJsonAtomic(QUOTA_FILE, q);
}

// ─── Log rotation trong code (khong dung logrotate vi khong co sudo passwordless) ──
function logToolCall(entry) {
  ensureDirs();
  try {
    if (fs.existsSync(AGENT_LOG) && fs.statSync(AGENT_LOG).size > AGENT_LOG_MAX_BYTES) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      fs.renameSync(AGENT_LOG, `${AGENT_LOG}.${ts}`);
    }
  } catch (e) { /* best effort */ }
  fs.appendFileSync(AGENT_LOG, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
}

function isPerMinuteRateLimit(e) {
  return /PerMinute/i.test(e?.message || '');
}

// Doc quotaValue THAT tu response loi 429 cua Google (khong doan) - format da xac nhan qua test that:
// e.message la JSON chua error.details[].violations[].quotaValue khi loai PerDay.
function extractDailyQuotaValue(e) {
  try {
    const parsed = JSON.parse(e.message);
    const details = parsed?.error?.details || [];
    for (const d of details) {
      for (const v of d.violations || []) {
        if (/PerDay/i.test(v.quotaId || '') && v.quotaValue) {
          const n = parseInt(v.quotaValue, 10);
          if (!isNaN(n)) return n;
        }
      }
    }
  } catch (e2) { /* e.message khong phai JSON hop le - bo qua, dung fallback */ }
  return null;
}

// ─── Gemini call voi retry 1 lan cho loi mang/5xx/rate-limit-phut, + fallback sang model khac
// khi 1 model dinh 429 "het quota ngay" that (quotaId co "PerDay") ──
// Da xac nhan qua test that (2026-09-15): quota free tier tinh RIENG theo tung model
// (quotaId co "PerModel"), nen het quota model nay van con dung duoc model khac trong MODEL_CANDIDATES.
async function callGeminiWithRetry(payloadBase) {
  const state = readQuota();
  const startIdx = Math.max(0, MODEL_CANDIDATES.indexOf(state.currentModel));
  const ordered = [...MODEL_CANDIDATES.slice(startIdx), ...MODEL_CANDIDATES.slice(0, startIdx)]
    .filter(m => !state.exhaustedModels.includes(m));
  if (ordered.length === 0) ordered.push(state.currentModel || MODEL_CANDIDATES[0]);

  let lastError;
  for (const model of ordered) {
    const payload = { ...payloadBase, model };
    try {
      incrementQuota(model);
      return await ai.models.generateContent(payload);
    } catch (e) {
      const status = e?.status || e?.response?.status;
      const perMinute = status === 429 && isPerMinuteRateLimit(e);

      if (!status || (status >= 500 && status < 600) || perMinute) {
        await new Promise(r => setTimeout(r, perMinute ? 7000 : 1500));
        try {
          incrementQuota(model);
          return await ai.models.generateContent(payload);
        } catch (e2) {
          lastError = e2;
          continue; // thu model tiep theo neu retry van fail
        }
      }

      if (status === 429) {
        markModelExhausted(model, extractDailyQuotaValue(e));
        lastError = e;
        continue; // het quota ngay that - thu model tiep theo
      }

      throw e; // loi khac (vd sai schema) khong lien quan quota - khong co ich gi khi doi model
    }
  }
  throw lastError || new Error('Tất cả model Gemini trong danh sách đều không khả dụng hôm nay.');
}

// ─── Factory chinh - nhan dependency tu bot.js, KHONG require('./bot') nguoc lai ──
function createAgent(deps) {
  const {
    send, render, getSystemStatus, getPiholeStats, sendDocument,
    addReminderJob, listReminderJobs, cancelReminderJob,
    addScheduleItem, viewScheduleText, clearScheduleWeek, getCurrentWeekPath,
    removeScheduleItem,
  } = deps;

  const busyByChat    = new Map(); // chatId -> true khi dang chay tool-loop (bao gom ca luc cho xac nhan)
  const confirmByChat = new Map(); // chatId -> { resolve } khi dang cho yes/no cho 1 tool co tac dong
  // chatId -> filePath lich tuan can gui. Tool addScheduleItem/clearSchedule chi "dang ky" vao day
  // thay vi tu goi sendDocument ngay - tranh 1 request /agent goi tool nhieu lan (vd them 6 buoi hoc
  // cung luc) lai gui 6 file Telegram rieng le. Gui gop dung 1 lan sau khi ca tool-loop cua request xong.
  const pendingScheduleFile = new Map();

  async function flushPendingScheduleFile(chatId) {
    const filePath = pendingScheduleFile.get(chatId);
    if (!filePath) return;
    pendingScheduleFile.delete(chatId);
    try {
      await sendDocument(chatId, filePath, 'Lịch tuần đã cập nhật');
    } catch (e) {
      logToolCall({ chatId, tool: 'sendDocument', ok: false, error: e.message });
    }
  }

  const TOOLS = {
    getSystemStatus: {
      requiresConfirm: false,
      description: 'Lay trang thai phan cung hien tai cua server (CPU, RAM, disk, nhiet do, uptime).',
      parametersJsonSchema: { type: 'object', properties: {} },
      handler: async () => getSystemStatus(),
    },
    getPiholeStats: {
      requiresConfirm: false,
      description: 'Lay thong ke Pi-hole hien tai (so query, so bi chan, trang thai bat/tat DNS).',
      parametersJsonSchema: { type: 'object', properties: {} },
      handler: async () => getPiholeStats(),
    },
    remember: {
      requiresConfirm: false,
      description: 'Ghi nho lau dai 1 thong tin/bai hoc theo chu de - dung khi phat hien quy tac, loi, hoac dieu can nho cho lan sau.',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'Ten chu de ngan gon, vi du "pihole-quirks"' },
          note:  { type: 'string', description: 'Noi dung can ghi nho' },
        },
        required: ['topic', 'note'],
      },
      handler: rememberImpl,
    },
    recall: {
      requiresConfirm: false,
      description: 'Doc lai noi dung chi tiet da tung ghi nho ve 1 chu de.',
      parametersJsonSchema: {
        type: 'object',
        properties: { topic: { type: 'string' } },
        required: ['topic'],
      },
      handler: recallImpl,
    },
    forget: {
      requiresConfirm: true,
      description: 'Xoa vinh vien bo nho ve 1 chu de (khong the hoan tac) - can xac nhan truoc khi thuc thi.',
      parametersJsonSchema: {
        type: 'object',
        properties: { topic: { type: 'string' } },
        required: ['topic'],
      },
      describeAction: (args) => `Xoá vĩnh viễn bộ nhớ chủ đề "${escapeHtml(args.topic)}" (file memory/${slugify(args.topic)}.md + dòng index trong GEMINI.md).`,
      handler: forgetImpl,
    },
    addScheduleItem: {
      requiresConfirm: false,
      description: 'Thêm 1 việc vào lịch tuần hiện tại (không ghi đè, tự nối thêm nếu ô đã có việc khác).',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          dayOfWeek: { type: 'string', enum: ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'] },
          session:   { type: 'string', enum: ['Sáng', 'Chiều', 'Tối'] },
          time:      { type: 'string', description: 'Giờ cụ thể dạng "14h" hoặc "14:00"' },
          content:   { type: 'string' },
        },
        required: ['dayOfWeek', 'session', 'time', 'content'],
      },
      handler: async (args, chatId) => {
        const filePath = await addScheduleItem(args);
        pendingScheduleFile.set(chatId, filePath);
        return { ok: true };
      },
    },
    viewSchedule: {
      requiresConfirm: false,
      description: 'Xem toàn bộ lịch tuần hiện tại dạng text.',
      parametersJsonSchema: { type: 'object', properties: {} },
      handler: async () => ({ text: await viewScheduleText() }),
    },
    clearSchedule: {
      requiresConfirm: true,
      description: 'Xoá toàn bộ lịch tuần hiện tại (mọi việc đã thêm) và tạo lịch trống mới cho tuần này - không thể hoàn tác qua chat, cần xác nhận trước.',
      parametersJsonSchema: { type: 'object', properties: {} },
      describeAction: () => 'Xoá toàn bộ lịch tuần hiện tại (bản cũ vẫn được lưu trữ trên server, không mất hẳn) và tạo lịch trống mới cho tuần này.',
      handler: async (_args, chatId) => {
        await clearScheduleWeek();
        const filePath = await getCurrentWeekPath();
        pendingScheduleFile.set(chatId, filePath);
        return { ok: true };
      },
    },
    removeScheduleItem: {
      requiresConfirm: true,
      description: 'Xoá nội dung 1 ô cụ thể trong lịch tuần (theo dayOfWeek + session), không đụng các ô khác - không thể hoàn tác qua chat, cần xác nhận trước. Nếu người dùng muốn xoá nhiều ô, gọi tool này nhiều lần (mỗi lần 1 ô).',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          dayOfWeek: { type: 'string', enum: ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'] },
          session:   { type: 'string', enum: ['Sáng', 'Chiều', 'Tối'] },
        },
        required: ['dayOfWeek', 'session'],
      },
      describeAction: (args) => `Xoá nội dung ô lịch "${escapeHtml(args.dayOfWeek)} - ${escapeHtml(args.session)}".`,
      handler: async (args, chatId) => {
        const filePath = await removeScheduleItem(args);
        pendingScheduleFile.set(chatId, filePath);
        return { ok: true };
      },
    },
    sendScheduleFile: {
      requiresConfirm: false,
      description: 'Gửi lại file Excel lịch tuần hiện tại cho người dùng, không thêm/sửa/xoá gì cả.',
      parametersJsonSchema: { type: 'object', properties: {} },
      handler: async (_args, chatId) => {
        const filePath = await getCurrentWeekPath();
        pendingScheduleFile.set(chatId, filePath);
        return { ok: true };
      },
    },
    setReminder: {
      requiresConfirm: false,
      description: 'Đặt nhắc việc 1 lần (once), hàng ngày (daily), hoặc hàng tuần (weekly).',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          scheduleType: { type: 'string', enum: ['once', 'daily', 'weekly'] },
          atISO:     { type: 'string', description: 'Bắt buộc nếu once - ISO 8601 tuyệt đối, tự tính từ giờ hiện tại trong system instruction' },
          hour:      { type: 'integer', description: 'Bắt buộc nếu daily/weekly' },
          minute:    { type: 'integer', description: 'Bắt buộc nếu daily/weekly' },
          dayOfWeek: { type: 'integer', description: '0=Chủ nhật..6=Thứ 7, bắt buộc nếu weekly' },
          message:   { type: 'string' },
        },
        required: ['scheduleType', 'message'],
      },
      handler: async (args, chatId) => {
        let schedule;
        if (args.scheduleType === 'once') {
          if (!args.atISO) return { error: 'Thiếu atISO cho nhắc 1 lần.' };
          schedule = { kind: 'once', atISO: args.atISO };
        } else if (args.scheduleType === 'daily') {
          if (args.hour == null || args.minute == null) return { error: 'Thiếu hour/minute cho nhắc hàng ngày.' };
          schedule = { kind: 'daily', hour: args.hour, minute: args.minute };
        } else if (args.scheduleType === 'weekly') {
          if (args.dayOfWeek == null || args.hour == null || args.minute == null) {
            return { error: 'Thiếu dayOfWeek/hour/minute cho nhắc hàng tuần.' };
          }
          schedule = { kind: 'weekly', dayOfWeek: args.dayOfWeek, hour: args.hour, minute: args.minute };
        } else {
          return { error: `scheduleType không hợp lệ: "${args.scheduleType}"` };
        }
        const job = addReminderJob({ chatId, type: 'message', message: args.message, schedule });
        return { ok: true, id: job.id, nextFireAt: job.nextFireAt };
      },
    },
    listReminders: {
      requiresConfirm: false,
      description: 'Liệt kê các nhắc việc đang hoạt động của người dùng này.',
      parametersJsonSchema: { type: 'object', properties: {} },
      handler: async (_args, chatId) => ({ jobs: listReminderJobs(chatId) }),
    },
    cancelReminder: {
      requiresConfirm: true,
      description: 'Huỷ 1 nhắc việc theo id (không thể hoàn tác) - cần xác nhận trước.',
      parametersJsonSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      describeAction: (args) => `Huỷ nhắc việc id "${escapeHtml(args.id)}".`,
      handler: async (args) => ({ ok: cancelReminderJob(args.id) }),
    },
  };

  const functionDeclarations = Object.entries(TOOLS).map(([name, t]) => ({
    name,
    description: t.description,
    parametersJsonSchema: t.parametersJsonSchema,
  }));

  const SYSTEM_INSTRUCTION_BASE =
    'Bạn là trợ lý AI cho homelab-bot trên máy dog-HP. Luôn trả lời bằng tiếng Việt, ngắn gọn, rõ ràng. ' +
    'Bạn CHỈ được phép thao tác qua các tool đã khai báo - không được bịa ra hành động khác, ' +
    'và KHÔNG có quyền chạy lệnh hệ thống tự do ở giai đoạn này. Nếu không chắc chắn, hãy hỏi lại người dùng thay vì tự đoán.';

  function buildSystemInstruction() {
    const now = new Date();
    const nowVN = now.toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh', weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    const timeNote =
      `Thời điểm hiện tại: ${now.toISOString()} (ISO, UTC) — tức ${nowVN} giờ Việt Nam (UTC+7). ` +
      `Khi tính atISO tuyệt đối cho lời nhắc 'once', LUÔN cộng/trừ từ mốc này, và trả atISO ở định dạng ISO 8601 có offset +07:00.`;
    return `${SYSTEM_INSTRUCTION_BASE}\n\n${timeNote}\n\n--- BỘ NHỚ DÀI HẠN (index) ---\n${readIndex()}`;
  }

  // Tong quat hoa pattern rebootConfirmPending/timer (san co trong bot.js) thanh Map theo chatId
  function requestConfirm(chatId, toolName, args, describeAction) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        confirmByChat.delete(chatId);
        resolve('timeout');
      }, CONFIRM_TIMEOUT_MS);
      confirmByChat.set(chatId, {
        resolve: (ans) => { clearTimeout(timer); confirmByChat.delete(chatId); resolve(ans); },
      });
      const desc = describeAction ? describeAction(args || {}) : `Thực thi tool "${toolName}"`;
      render(chatId,
        `<b>XÁC NHẬN HÀNH ĐỘNG</b>\n<blockquote>${desc}\nGõ <b>yes</b> để xác nhận | <b>no</b> để huỷ.\n⏱️ Tự huỷ sau 30 giây.</blockquote>`
      );
    });
  }

  async function handleConfirmReply(chatId, text) {
    const pending = confirmByChat.get(chatId);
    if (!pending) return false;
    const ans = text.trim().toLowerCase();
    if (ans !== 'yes' && ans !== 'no') return false;
    pending.resolve(ans);
    return true;
  }

  async function dispatchTool(chatId, call) {
    const tool = TOOLS[call.name];
    if (!tool) {
      logToolCall({ chatId, tool: call.name, ok: false, error: 'unknown tool' });
      return { error: `Tool "${call.name}" không tồn tại.` };
    }
    if (tool.requiresConfirm) {
      const ans = await requestConfirm(chatId, call.name, call.args, tool.describeAction);
      if (ans !== 'yes') {
        logToolCall({ chatId, tool: call.name, args: call.args, ok: false, confirmed: false, reason: ans });
        if (ans === 'timeout') {
          await send(chatId, '<b>THỜI GIAN XÁC NHẬN ĐÃ HẾT</b>\n<blockquote>Yêu cầu đã tự huỷ.</blockquote>');
        }
        return { cancelled: true, reason: ans };
      }
    }
    try {
      const result = await tool.handler(call.args || {}, chatId);
      logToolCall({ chatId, tool: call.name, args: call.args, ok: true, confirmed: !!tool.requiresConfirm });
      return result;
    } catch (e) {
      logToolCall({ chatId, tool: call.name, args: call.args, ok: false, error: e.message });
      return { error: e.message };
    }
  }

  async function handleAgent(chatId, rawText) {
    const userText = (rawText || '').trim();

    if (userText.toLowerCase() === 'quota') {
      const q = readQuota();
      const lines = MODEL_CANDIDATES.map(m => {
        const used = q.byModel[m] || 0;
        const limit = q.limits[m];
        const exhausted = q.exhaustedModels.includes(m);
        const marker = m === q.currentModel ? ' ⬅️ đang dùng' : '';
        const limitStr = limit != null ? `/${limit}` : '';
        return `▸ <code>${m}</code>: ${used}${limitStr}${exhausted ? ' (hết quota hôm nay)' : ''}${marker}`;
      }).join('\n');
      await send(chatId,
        `<b>QUOTA GEMINI (ƯỚC TÍNH)</b>\n<blockquote>${lines}\nSố lần bot tự đếm, KHÔNG phải số liệu chính thức từ Google (trừ số sau dấu "/" khi đã từng dính hết quota - đó là số Google báo thật).</blockquote>`
      );
      return;
    }
    if (!userText) {
      await send(chatId, '<b>AGENT</b>\n<blockquote>Dùng: <code>/agent &lt;câu hỏi&gt;</code></blockquote>');
      return;
    }
    if (!ai) {
      await send(chatId, '<b>AGENT CHƯA SẴN SÀNG</b>\n<blockquote><code>GEMINI_API_KEY</code> chưa được cấu hình trong <code>.env</code>.</blockquote>');
      return;
    }
    if (busyByChat.get(chatId)) {
      await send(chatId, '<blockquote>Đang xử lý yêu cầu trước, chờ chút...</blockquote>');
      return;
    }

    busyByChat.set(chatId, true);
    let stallTimer = null;
    try {
      let session = loadSession(chatId);

      if (session.contents.length > 0 &&
          Date.now() - new Date(session.meta.lastActivityAt).getTime() > SESSION_IDLE_ARCHIVE_MS) {
        archiveSessionFile(chatId, 'idle48h');
        session = freshSession();
        await send(chatId, '<blockquote>Đã im lặng quá 48h - bắt đầu phiên hội thoại mới (phiên cũ đã được lưu lại).</blockquote>');
      }

      appendContents(chatId, session, [{ role: 'user', parts: [{ text: userText }] }]);

      stallTimer = setTimeout(() => {
        send(chatId, '<blockquote>Đang xử lý yêu cầu, vui lòng đợi...</blockquote>').catch(() => {});
      }, STALL_NOTICE_MS);

      const systemInstruction = buildSystemInstruction();
      const deadline = Date.now() + REQUEST_TIMEOUT_MS;

      let finalText = null;
      let timedOut = false;

      for (let i = 0; i < MAX_TOOL_LOOPS; i++) {
        if (Date.now() > deadline) { timedOut = true; break; }

        const response = await callGeminiWithRetry({
          contents: trimForApi(session.contents),
          config: { systemInstruction, tools: [{ functionDeclarations }] },
        });

        const modelParts = response.candidates?.[0]?.content?.parts || [{ text: response.text || '' }];
        appendContents(chatId, session, [{ role: 'model', parts: modelParts }]);

        const calls = response.functionCalls;
        if (!calls || calls.length === 0) {
          finalText = response.text || '(không có phản hồi)';
          break;
        }

        const responseParts = [];
        for (const call of calls) {
          const result = await dispatchTool(chatId, call);
          responseParts.push(createPartFromFunctionResponse(call.id || call.name, call.name, result));
        }
        appendContents(chatId, session, [{ role: 'user', parts: responseParts }]);

        if (i === MAX_TOOL_LOOPS - 1 && !finalText) {
          finalText = 'Yêu cầu cần quá nhiều bước xử lý, đã dừng lại để tránh lặp vô hạn.';
        }
      }

      clearTimeout(stallTimer);

      if (timedOut) {
        await send(chatId, '<b>QUÁ THỜI GIAN XỬ LÝ</b>\n<blockquote>Yêu cầu mất quá lâu (&gt;90s), đã huỷ.</blockquote>');
      } else {
        await send(chatId, `<b>AGENT</b>\n<blockquote>${escapeHtml(finalText)}</blockquote>`);
      }
    } catch (e) {
      clearTimeout(stallTimer);
      console.error('[agent error]', e.message);
      const status = e?.status || e?.response?.status;
      if (status === 429 && isPerMinuteRateLimit(e)) {
        await send(chatId, '<b>ĐANG BỊ GIỚI HẠN TỐC ĐỘ</b>\n<blockquote>Gemini API giới hạn số request/phút, vừa gửi hơi nhanh (đã tự thử lại 1 lần vẫn còn giới hạn). Thử lại sau ít giây.</blockquote>');
      } else if (status === 429) {
        await send(chatId, '<b>HẾT QUOTA MIỄN PHÍ HÔM NAY</b>\n<blockquote>Gemini API báo đã vượt giới hạn free tier. Thử lại sau.</blockquote>');
      } else {
        await send(chatId, `<b>LỖI AGENT</b>\n<blockquote><code>${escapeHtml(e.message)}</code></blockquote>`);
      }
    } finally {
      await flushPendingScheduleFile(chatId);
      busyByChat.delete(chatId);
    }
  }

  async function resetSession(chatId) {
    archiveSessionFile(chatId, 'manual');
    await send(chatId, '<b>PHIÊN MỚI</b>\n<blockquote>Đã lưu lại phiên cũ, bắt đầu hội thoại mới.</blockquote>');
  }

  return { handleAgent, handleConfirmReply, resetSession };
}

function getCurrentModel() {
  return readQuota().currentModel;
}

module.exports = { createAgent, getCurrentModel };
