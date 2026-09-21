const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const fsutil = require('./fsutil');

const SCHEDULE_DIR  = path.join(__dirname, 'schedule');
const ARCHIVE_DIR   = path.join(SCHEDULE_DIR, 'archive');
const CURRENT_PATH  = path.join(SCHEDULE_DIR, 'current.xlsx');

const DAYS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật']; // cot B..H
const SESSIONS = ['Sáng', 'Chiều', 'Tối']; // dong 3..5
// Date.getDay(): 0=Chu nhat..6=Thu 7. Map sang chi so trong mang DAYS (Thu2=0..CN=6).
const JS_DOW_TO_DAYS_INDEX = [6, 0, 1, 2, 3, 4, 5];

function ensureScheduleDirs() {
  fsutil.ensureDirs([SCHEDULE_DIR, ARCHIVE_DIR]);
}

function mondayOf(date) {
  const x = new Date(date);
  const dow = x.getDay(); // 0=CN..6=T7
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  x.setDate(x.getDate() + diffToMonday);
  x.setHours(0, 0, 0, 0);
  return x;
}

function sundayOf(date) {
  const mon = mondayOf(date);
  const sun = new Date(mon);
  sun.setDate(sun.getDate() + 6);
  return sun;
}

function fmtDDMM(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

const UPCOMING_PATHS = [1, 2, 3].map(n => path.join(SCHEDULE_DIR, `upcoming-${n}.xlsx`));
const WEEK_PATHS      = [CURRENT_PATH, ...UPCOMING_PATHS]; // index = weekOffset 0..3
const ROLLOVER_MARKER = path.join(SCHEDULE_DIR, '.rollover-in-progress');

function assertValidWeekOffset(weekOffset) {
  if (!Number.isInteger(weekOffset) || weekOffset < 0 || weekOffset > 3) {
    throw new Error(`weekOffset không hợp lệ (chỉ 0-3): ${weekOffset}`);
  }
}

// 1 nguon tinh Monday cho 1 weekOffset - moi noi can "tuan nao" deu goi qua day, nhan `now`
// tu ngoai (khong tu goi new Date() rieng) de tranh 2 buoc tinh trong CUNG 1 thao tac bi lech
// nhau neu vo tinh vat qua dung ranh gioi nua dem Thu 2 - dung convention da co san o
// scheduler.js (computeNextFireAt(schedule, now)).
function weekStartDate(weekOffset, now = new Date()) {
  assertValidWeekOffset(weekOffset);
  return new Date(mondayOf(now).getTime() + weekOffset * 7 * 24 * 3600 * 1000);
}

function parseISODate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr).trim());
  if (!m) throw new Error(`date không hợp lệ, cần dạng YYYY-MM-DD: "${dateStr}"`);
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])); // local time, tranh lech ngay do UTC
  d.setHours(0, 0, 0, 0);
  return d;
}

function resolveWeekSlot(dateStr, now = new Date()) {
  const target = parseISODate(dateStr);
  const todayMonday = mondayOf(now);
  const targetMonday = mondayOf(target);
  const weekOffset = Math.round((targetMonday - todayMonday) / (7 * 24 * 3600 * 1000));
  if (weekOffset < 0 || weekOffset > 3) {
    const maxSunday = sundayOf(weekStartDate(3, now));
    throw new Error(`Ngày "${dateStr}" ngoài phạm vi hỗ trợ (chỉ từ ${fmtDDMM(todayMonday)} đến ${fmtDDMM(maxSunday)}).`);
  }
  return { weekOffset, dayIdx: JS_DOW_TO_DAYS_INDEX[target.getDay()] };
}

function weekRangeLabel(weekOffset, now = new Date()) {
  const start = weekStartDate(weekOffset, now);
  const end = new Date(start.getTime() + 6 * 24 * 3600 * 1000);
  return `${fmtDDMM(start)}-${fmtDDMM(end)}`;
}

async function buildBlankWorkbook(weekStart) {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('LichTuan');

  ws.mergeCells('A1:H1');
  const title = ws.getCell('A1');
  title.value = `Tuần: ${fmtDDMM(weekStart)}-${fmtDDMM(weekEnd)}`;
  title.font = { bold: true };
  title.alignment = { horizontal: 'center' };

  ws.getRow(2).values = ['Buổi', ...DAYS];
  ws.getRow(2).font = { bold: true };

  SESSIONS.forEach((s, i) => {
    ws.getRow(3 + i).getCell(1).value = s;
  });

  ws.getColumn(1).width = 10;
  for (let c = 2; c <= 8; c++) ws.getColumn(c).width = 22;
  for (let r = 3; r <= 5; r++) {
    for (let c = 2; c <= 8; c++) {
      ws.getRow(r).getCell(c).alignment = { wrapText: true, vertical: 'top' };
    }
  }

  return wb;
}

async function writeWorkbookAtomic(wb, filePath) {
  ensureScheduleDirs();
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await wb.xlsx.writeFile(tmp);
  fs.renameSync(tmp, filePath);
}

async function ensureWeekFile(weekOffset, now = new Date()) {
  assertValidWeekOffset(weekOffset); // goi truoc tien, khong dua vao weekStartDate() vi ham do
                                      // chi chay khi file CHUA ton tai - truong hop pho bien
                                      // nhat (file da co san) se lot qua neu khong kiem tra o day.
  const p = WEEK_PATHS[weekOffset];
  if (fs.existsSync(p)) return;
  const wb = await buildBlankWorkbook(weekStartDate(weekOffset, now));
  await writeWorkbookAtomic(wb, p);
}

async function addItem({ date, session, time, content }) {
  const now = new Date();
  const { weekOffset, dayIdx } = resolveWeekSlot(date, now);
  const sessionIdx = SESSIONS.indexOf(session);
  if (sessionIdx === -1) throw new Error(`session không hợp lệ: "${session}"`);

  await ensureWeekFile(weekOffset, now);
  const filePath = WEEK_PATHS[weekOffset];

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.getWorksheet('LichTuan');

  const col = 2 + dayIdx;
  const row = 3 + sessionIdx;
  const cell = ws.getRow(row).getCell(col);
  const line = `${time} - ${content}`;
  cell.value = cell.value ? `${cell.value}\n${line}` : line;
  cell.alignment = { wrapText: true, vertical: 'top' };

  await writeWorkbookAtomic(wb, filePath);
  return filePath;
}

async function removeItem({ date, session }) {
  const now = new Date();
  const { weekOffset, dayIdx } = resolveWeekSlot(date, now);
  const sessionIdx = SESSIONS.indexOf(session);
  if (sessionIdx === -1) throw new Error(`session không hợp lệ: "${session}"`);

  await ensureWeekFile(weekOffset, now);
  const filePath = WEEK_PATHS[weekOffset];

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.getWorksheet('LichTuan');

  const col = 2 + dayIdx;
  const row = 3 + sessionIdx;
  ws.getRow(row).getCell(col).value = '';

  await writeWorkbookAtomic(wb, filePath);
  return filePath;
}

async function getWeekPath(weekOffset = 0) {
  await ensureWeekFile(weekOffset);
  return WEEK_PATHS[weekOffset];
}

async function readGrid(weekOffset = 0) {
  await ensureWeekFile(weekOffset);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(WEEK_PATHS[weekOffset]);
  const ws = wb.getWorksheet('LichTuan');
  const titleText = ws.getCell('A1').value;
  const grid = {};
  DAYS.forEach((day, di) => {
    grid[day] = {};
    SESSIONS.forEach((s, si) => {
      const v = ws.getRow(3 + si).getCell(2 + di).value;
      grid[day][s] = v ? String(v) : '';
    });
  });
  return { titleText, grid };
}

async function getWeekText(weekOffset = 0) {
  const { titleText, grid } = await readGrid(weekOffset);
  const lines = [titleText];
  for (const day of DAYS) {
    for (const s of SESSIONS) {
      const v = grid[day][s];
      if (v) lines.push(`${day} - ${s}: ${v}`);
    }
  }
  if (lines.length === 1) lines.push('(chưa có lịch nào trong tuần này)');
  return lines.join('\n');
}

async function getTodayDigestText() {
  const { grid } = await readGrid(0);
  const dayIdx = JS_DOW_TO_DAYS_INDEX[new Date().getDay()];
  const day = DAYS[dayIdx];
  const lines = [];
  for (const s of SESSIONS) {
    const v = grid[day][s];
    if (v) lines.push(`${s}: ${v}`);
  }
  if (lines.length === 0) return null;
  return `${day}:\n${lines.join('\n')}`;
}

async function archiveAndResetWeek() {
  const now = new Date();
  for (let i = 0; i < 4; i++) await ensureWeekFile(i, now);

  // Buoc 1: archive dung file weekOffset=0 - CHI archive neu chua co marker (chua tung bat dau,
  // hoac lan truoc da hoan tat). Neu co marker nghia la lan truoc bi ngat SAU khi archive xong
  // nhung TRUOC khi dich chuyen xong - bo qua archive de tranh archive nham du lieu da promote.
  if (!fs.existsSync(ROLLOVER_MARKER)) {
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const baseName = `${fmtDDMM(mondayOf(yesterday)).replace('/', '-')}_${fmtDDMM(sundayOf(yesterday)).replace('/', '-')}`;
    ensureScheduleDirs();
    let archiveName = `${baseName}.xlsx`, n = 2;
    while (fs.existsSync(path.join(ARCHIVE_DIR, archiveName))) { archiveName = `${baseName}_${n}.xlsx`; n++; }
    fs.renameSync(WEEK_PATHS[0], path.join(ARCHIVE_DIR, archiveName));
    fs.writeFileSync(ROLLOVER_MARKER, '');
  }

  // Buoc 2: dich chuyen day chuyen - MOI buoc chi rename neu nguon con ton tai (bo qua neu
  // da lam roi tu lan chay truoc bi ngat giua chung) - toan chuoi an toan de chay lai nhieu lan.
  if (fs.existsSync(WEEK_PATHS[1])) fs.renameSync(WEEK_PATHS[1], WEEK_PATHS[0]);
  if (fs.existsSync(WEEK_PATHS[2])) fs.renameSync(WEEK_PATHS[2], WEEK_PATHS[1]);
  if (fs.existsSync(WEEK_PATHS[3])) fs.renameSync(WEEK_PATHS[3], WEEK_PATHS[2]);

  await ensureWeekFile(3, now);
  fs.unlinkSync(ROLLOVER_MARKER);
}

async function clearWeekSlot(weekOffset) {
  const now = new Date();
  await ensureWeekFile(weekOffset, now);
  const start = weekStartDate(weekOffset, now);
  const end = new Date(start.getTime() + 6 * 24 * 3600 * 1000);
  // KHONG dung weekRangeLabel() truc tiep lam ten file - chuoi do co 2 dau "/" (vd "17/09-23/09"),
  // .replace('/','-') khong co co g chi thay dau dau tien, con lai 1 dau "/" se bi hieu nham la
  // thu muc con khi fs.renameSync - phai tach rieng tung nua DDMM roi replace nhu ham nay lam.
  const baseName = `${fmtDDMM(start).replace('/', '-')}_${fmtDDMM(end).replace('/', '-')}`;
  ensureScheduleDirs();
  let archiveName = `${baseName}.xlsx`, n = 2;
  while (fs.existsSync(path.join(ARCHIVE_DIR, archiveName))) { archiveName = `${baseName}_${n}.xlsx`; n++; }
  fs.renameSync(WEEK_PATHS[weekOffset], path.join(ARCHIVE_DIR, archiveName));
  await ensureWeekFile(weekOffset, now);
  return WEEK_PATHS[weekOffset];
}

module.exports = {
  ensureWeekFile,
  addItem,
  removeItem,
  getWeekPath,
  getWeekText,
  getTodayDigestText,
  archiveAndResetWeek,
  clearWeekSlot,
  assertValidWeekOffset,
  weekStartDate,
  parseISODate,
  resolveWeekSlot,
  weekRangeLabel,
};
