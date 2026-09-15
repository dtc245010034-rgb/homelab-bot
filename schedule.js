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

async function ensureCurrentWeek() {
  if (fs.existsSync(CURRENT_PATH)) return;
  const wb = await buildBlankWorkbook(mondayOf(new Date()));
  await writeWorkbookAtomic(wb, CURRENT_PATH);
}

async function addItem({ dayOfWeek, session, time, content }) {
  await ensureCurrentWeek();

  const dayIdx = DAYS.indexOf(dayOfWeek);
  const sessionIdx = SESSIONS.indexOf(session);
  if (dayIdx === -1) throw new Error(`dayOfWeek không hợp lệ: "${dayOfWeek}"`);
  if (sessionIdx === -1) throw new Error(`session không hợp lệ: "${session}"`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(CURRENT_PATH);
  const ws = wb.getWorksheet('LichTuan');

  const col = 2 + dayIdx;
  const row = 3 + sessionIdx;
  const cell = ws.getRow(row).getCell(col);
  const line = `${time} - ${content}`;
  cell.value = cell.value ? `${cell.value}\n${line}` : line;
  cell.alignment = { wrapText: true, vertical: 'top' };

  await writeWorkbookAtomic(wb, CURRENT_PATH);
  return CURRENT_PATH;
}

async function removeItem({ dayOfWeek, session }) {
  await ensureCurrentWeek();

  const dayIdx = DAYS.indexOf(dayOfWeek);
  const sessionIdx = SESSIONS.indexOf(session);
  if (dayIdx === -1) throw new Error(`dayOfWeek không hợp lệ: "${dayOfWeek}"`);
  if (sessionIdx === -1) throw new Error(`session không hợp lệ: "${session}"`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(CURRENT_PATH);
  const ws = wb.getWorksheet('LichTuan');

  const col = 2 + dayIdx;
  const row = 3 + sessionIdx;
  ws.getRow(row).getCell(col).value = '';

  await writeWorkbookAtomic(wb, CURRENT_PATH);
  return CURRENT_PATH;
}

async function getCurrentWeekPath() {
  await ensureCurrentWeek();
  return CURRENT_PATH;
}

async function readGrid() {
  await ensureCurrentWeek();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(CURRENT_PATH);
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

async function getWeekText() {
  const { titleText, grid } = await readGrid();
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
  const { grid } = await readGrid();
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
  await ensureCurrentWeek();

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const mon = mondayOf(yesterday);
  const sun = sundayOf(yesterday);
  const baseName = `${fmtDDMM(mon).replace('/', '-')}_${fmtDDMM(sun).replace('/', '-')}`;

  ensureScheduleDirs();
  // Ham nay co the bi goi >1 lan trong cung 1 tuan (job he thong T2 00h VA nguoi dung
  // chu dong xoa lich giua tuan) - tranh de rename ghi de am tham len ban archive truoc do.
  let archiveName = `${baseName}.xlsx`;
  let n = 2;
  while (fs.existsSync(path.join(ARCHIVE_DIR, archiveName))) {
    archiveName = `${baseName}_${n}.xlsx`;
    n++;
  }
  fs.renameSync(CURRENT_PATH, path.join(ARCHIVE_DIR, archiveName));

  await ensureCurrentWeek();
}

module.exports = {
  ensureCurrentWeek,
  addItem,
  removeItem,
  getCurrentWeekPath,
  getWeekText,
  getTodayDigestText,
  archiveAndResetWeek,
};
