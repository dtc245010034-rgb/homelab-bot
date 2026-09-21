# Lên lịch trước tối đa 4 tuần — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chuyển `schedule.js` từ mô hình 1 file `current.xlsx` duy nhất sang cửa sổ trượt 4 file (tuần này + 3 tuần kế tiếp), địa chỉ ô theo ngày tuyệt đối thay vì "thứ mấy trong tuần ngầm định" — sửa đúng bug thật đã gặp (thêm lịch cho tuần sau bị ghi nhầm vào tuần này).

**Architecture:** `WEEK_PATHS[0..3]` thay cho `CURRENT_PATH` đơn lẻ. Tool `addScheduleItem`/`removeScheduleItem` nhận `date` (YYYY-MM-DD) thay vì `dayOfWeek`, code tự quy đổi ra đúng file+ô. Job hệ thống rollover Thứ 2 00:00 dịch chuyển cả 4 file; tool `clearSchedule` dùng hàm MỚI `clearWeekSlot` tách riêng khỏi rollover (bug đã phát hiện lúc thiết kế: 2 việc này trước đây dùng nhầm chung 1 hàm).

**Tech Stack:** Node.js, `exceljs` (đọc/ghi `.xlsx`), Gemini function-calling (`@google/genai`), PM2.

**Spec:** `/home/dog/homelab-bot/docs/superpowers/specs/2026-09-17-schedule-4-week-window-design.md` — plan này lập luận dựa trên spec đó, đọc cả 2 file. Người thực thi từng task chỉ thấy đúng task của mình, nên mọi code cần thiết đã được chép đầy đủ vào từng task dưới đây, không cần mở lại spec để lấy code.

## Global Constraints

- **KHÔNG commit git ở bất kỳ bước nào** trừ khi user yêu cầu rõ ràng — bỏ qua hoàn toàn các bước "Commit" trong template chuẩn của skill này; thay bằng "Task hoàn tất, KHÔNG commit — chờ user yêu cầu".
- **Không có framework test** (không jest/mocha) — "test" trong plan này là script Node độc lập chạy bằng `node <file>.js`, tự in `PASS`/`FAIL` qua `console.log`, không có runner riêng.
- **Backup trước khi test trên dữ liệu thật**: mọi test đụng vào `/home/dog/homelab-bot/schedule/` (đọc/ghi file thật) PHẢI backup trước, restore lại đúng nguyên trạng sau — dùng thư mục `/tmp/schedule-plan-backup/` (tạo mới đầu Task 2, giữ nguyên tới hết Task 5, không xoá giữa các task).
- Sau khi sửa code trong 1 file: luôn `node -c <file>.js` kiểm tra cú pháp trước khi chạy test.
- `date` trong toàn bộ hệ thống dùng định dạng `YYYY-MM-DD` (ISO, không có giờ/timezone).
- `weekOffset`: số nguyên 0-3 (0 = tuần này, 1-3 = tuần kế tiếp) — dùng xuyên suốt mọi hàm/tool liên quan tuần.

---

## Task 1: `schedule.js` — Helper tính ngày/tuần thuần (pure functions)

**Files:**
- Modify: `/home/dog/homelab-bot/schedule.js` (thêm hàm mới, chưa đổi `addItem`/`removeItem`/các hàm khác)
- Test: `/tmp/schedule-plan-backup/test-task1-date-helpers.js`

**Interfaces:**
- Produces: `assertValidWeekOffset(weekOffset)` (throw nếu sai, không return gì khi hợp lệ), `weekStartDate(weekOffset, now = new Date())` → `Date`, `parseISODate(dateStr)` → `Date`, `resolveWeekSlot(dateStr, now = new Date())` → `{ weekOffset: number, dayIdx: number }`, `weekRangeLabel(weekOffset, now = new Date())` → `string` dạng `"dd/mm-dd/mm"`. Cả 5 hàm này Task 2/3 sẽ dùng lại.
- Lưu ý: spec ghi `resolveWeekSlot` "không cần export" nhưng file này đã có tiền lệ export 1 hàm thuần chỉ để test độc lập (`scheduler.js` export `computeNextFireAt` với đúng lý do này) — làm theo đúng tiền lệ đó, **export cả `resolveWeekSlot`**.

- [ ] **Step 1: Viết test trước (sẽ fail vì hàm chưa tồn tại)**

Tạo file `/tmp/schedule-plan-backup/test-task1-date-helpers.js`:

```js
const schedule = require('/home/dog/homelab-bot/schedule.js');

function assertThrows(fn, label) {
  try { fn(); console.log(`FAIL (khong throw): ${label}`); }
  catch (e) { console.log(`PASS (throw dung): ${label} -> ${e.message}`); }
}

// Co dinh "now" de test lap lai duoc: gia su hom nay la Thu 4, 2026-09-16 (Monday cua tuan nay = 2026-09-14)
const NOW = new Date(2026, 8, 16); // thang 8 = Thang 9 (0-indexed)

console.log('=== assertValidWeekOffset ===');
assertThrows(() => schedule.resolveWeekSlot === undefined, 'placeholder'); // xoa dong nay neu resolveWeekSlot da ton tai
try {
  schedule.weekStartDate ? schedule.weekStartDate(0, NOW) : (() => { throw new Error('weekStartDate chua duoc export'); })();
  console.log('PASS: weekStartDate(0) khong throw');
} catch (e) { console.log('FAIL: weekStartDate(0) throw nham -', e.message); }

console.log('\n=== weekStartDate ===');
const w0 = schedule.weekStartDate(0, NOW);
console.log('weekOffset 0 start:', w0.toDateString());
console.log(w0.getDate() === 14 && w0.getMonth() === 8 ? 'PASS: weekOffset 0 la 14/09' : 'FAIL: sai ngay');
const w3 = schedule.weekStartDate(3, NOW);
console.log('weekOffset 3 start:', w3.toDateString());
console.log(w3.getDate() === 5 && w3.getMonth() === 9 ? 'PASS: weekOffset 3 la 05/10' : 'FAIL: sai ngay');

console.log('\n=== parseISODate ===');
const d = schedule.parseISODate('2026-09-24');
console.log(d.getFullYear() === 2026 && d.getMonth() === 8 && d.getDate() === 24 ? 'PASS: parse dung' : 'FAIL: parse sai');

console.log('\n=== resolveWeekSlot ===');
// 2026-09-24 la Thu 5 tuan sau (tuan nay 14-20/09, tuan sau 21-27/09)
const r1 = schedule.resolveWeekSlot('2026-09-24', NOW);
console.log('resolveWeekSlot(24/09):', JSON.stringify(r1));
console.log(r1.weekOffset === 1 && r1.dayIdx === 3 ? 'PASS: 24/09 -> weekOffset 1, dayIdx 3 (Thu 5)' : 'FAIL');

// 2026-09-17 la Thu 5 TUAN NAY
const r2 = schedule.resolveWeekSlot('2026-09-17', NOW);
console.log('resolveWeekSlot(17/09):', JSON.stringify(r2));
console.log(r2.weekOffset === 0 && r2.dayIdx === 3 ? 'PASS: 17/09 -> weekOffset 0, dayIdx 3' : 'FAIL');

// bien tuan thu 3 (Chu nhat cuoi cung con hop le: tuan nay 14-20, +3 tuan = 05/10-11/10 -> CN la 11/10)
const r3 = schedule.resolveWeekSlot('2026-10-11', NOW);
console.log('resolveWeekSlot(11/10, bien xa nhat):', JSON.stringify(r3));
console.log(r3.weekOffset === 3 ? 'PASS: dung bien weekOffset 3' : 'FAIL');

console.log('\n=== resolveWeekSlot - ngoai pham vi phai throw ===');
assertThrows(() => schedule.resolveWeekSlot('2026-10-12', NOW), 'ngay 12/10 (tuan thu 5) phai throw');
assertThrows(() => schedule.resolveWeekSlot('2026-09-07', NOW), 'ngay tuan truoc phai throw');
assertThrows(() => schedule.resolveWeekSlot('16-09-2026', NOW), 'sai format phai throw');
assertThrows(() => schedule.assertValidWeekOffset(4), 'weekOffset 4 phai throw');
assertThrows(() => schedule.assertValidWeekOffset(-1), 'weekOffset -1 phai throw');
assertThrows(() => schedule.assertValidWeekOffset(1.5), 'weekOffset 1.5 phai throw');
assertThrows(() => schedule.assertValidWeekOffset('2'), 'weekOffset string "2" phai throw');

console.log('\n=== weekRangeLabel ===');
console.log('weekRangeLabel(0):', schedule.weekRangeLabel(0, NOW));
console.log('weekRangeLabel(1):', schedule.weekRangeLabel(1, NOW));
console.log(schedule.weekRangeLabel(0, NOW) === '14/09-20/09' ? 'PASS' : 'FAIL: nhan dung 14/09-20/09');

console.log('\nDONE');
```

- [ ] **Step 2: Chạy test, xác nhận FAIL (vì `assertValidWeekOffset`/`weekStartDate`/`parseISODate`/`resolveWeekSlot`/`weekRangeLabel` chưa được export từ `schedule.js`)**

Run: `node /tmp/schedule-plan-backup/test-task1-date-helpers.js`
Expected: lỗi `TypeError: schedule.weekStartDate is not a function` (hoặc tương tự) ngay từ đầu script.

- [ ] **Step 3: Thêm 5 hàm mới vào `schedule.js`**

Mở `/home/dog/homelab-bot/schedule.js`. Ngay sau khối `fmtDDMM` (giữ nguyên `ensureScheduleDirs`, `mondayOf`, `sundayOf`, `fmtDDMM` y hệt cũ), chèn thêm:

```js
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
```

Thêm `CURRENT_PATH` giữ nguyên vị trí cũ (không xoá — `WEEK_PATHS` tham chiếu tới nó).

Tạm thời thêm các hàm này vào cuối `module.exports` hiện có (KHÔNG xoá export cũ nào ở bước này — `addItem`/`removeItem` cũ vẫn còn nguyên, Task 2 mới sửa):
```js
module.exports = {
  ensureCurrentWeek,
  addItem,
  removeItem,
  getCurrentWeekPath,
  getWeekText,
  getTodayDigestText,
  archiveAndResetWeek,
  // moi them cho Task 1:
  assertValidWeekOffset,
  weekStartDate,
  parseISODate,
  resolveWeekSlot,
  weekRangeLabel,
};
```

- [ ] **Step 4: Kiểm tra cú pháp**

Run: `node -c /home/dog/homelab-bot/schedule.js`
Expected: không có output (tức không lỗi).

- [ ] **Step 5: Chạy lại test, xác nhận PASS toàn bộ**

Run: `node /tmp/schedule-plan-backup/test-task1-date-helpers.js`
Expected: mọi dòng đều in `PASS...`, không dòng nào `FAIL`. Nếu có `FAIL`, đọc kỹ thông điệp, sửa lại hàm tương ứng (không sửa test — test đã đúng theo spec).

- [ ] **Task hoàn tất, KHÔNG commit** — chờ sang Task 2.

---

## Task 2: `schedule.js` — Multi-week `addItem`/`removeItem`/`getWeekPath`/`getWeekText`

**Files:**
- Modify: `/home/dog/homelab-bot/schedule.js`
- Test: `/tmp/schedule-plan-backup/test-task2-multiweek-crud.js`

**Interfaces:**
- Consumes: `resolveWeekSlot(dateStr, now)`, `weekStartDate(weekOffset, now)`, `assertValidWeekOffset(weekOffset)` từ Task 1.
- Produces: `ensureWeekFile(weekOffset, now = new Date())` (async, không return gì có ý nghĩa), `addItem({date, session, time, content})` → `Promise<string>` (file path), `removeItem({date, session})` → `Promise<string>`, `getWeekPath(weekOffset = 0)` → `Promise<string>`, `getWeekText(weekOffset = 0)` → `Promise<string>`. Task 3/4/5 dùng lại các tên này y hệt.

- [ ] **Step 1: Backup dữ liệu thật trước khi test (test sẽ đọc/ghi file thật trong `schedule/`)**

Run:
```bash
mkdir -p /tmp/schedule-plan-backup
cp -r /home/dog/homelab-bot/schedule /tmp/schedule-plan-backup/schedule-original
```
Expected: thư mục `/tmp/schedule-plan-backup/schedule-original` chứa bản sao y hệt `current.xlsx` + `archive/` hiện tại.

- [ ] **Step 2: Viết test trước (sẽ fail vì `addItem`/`removeItem` chưa nhận `date`, `getWeekPath`/`getWeekText` chưa nhận `weekOffset`)**

Tạo `/tmp/schedule-plan-backup/test-task2-multiweek-crud.js`:

```js
const fs = require('fs');
const schedule = require('/home/dog/homelab-bot/schedule.js');
const WEEK_PATHS_FOR_TEST = [
  '/home/dog/homelab-bot/schedule/current.xlsx',
  '/home/dog/homelab-bot/schedule/upcoming-1.xlsx',
  '/home/dog/homelab-bot/schedule/upcoming-2.xlsx',
  '/home/dog/homelab-bot/schedule/upcoming-3.xlsx',
];

// Xoa het 4 file de bat dau tu trang thai sach cho test nay (se restore lai o cuoi)
for (const p of WEEK_PATHS_FOR_TEST) { if (fs.existsSync(p)) fs.unlinkSync(p); }

(async () => {
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);

  console.log('=== them lich vao ca 4 tuan (weekOffset 0..3), moi tuan 1 muc ===');
  for (let wo = 0; wo <= 3; wo++) {
    const target = schedule.weekStartDate(wo, today); // lay dung Thu 2 cua tuan do, roi +1 ngay de chac chan la Thu 3 (tranh dinh ngay hom nay cu the)
    target.setDate(target.getDate() + 1);
    const filePath = await schedule.addItem({ date: iso(target), session: 'Sáng', time: '9h', content: `Test tuan offset ${wo}` });
    console.log(`weekOffset ${wo} -> ghi vao file:`, filePath);
    console.log(filePath === WEEK_PATHS_FOR_TEST[wo] ? `PASS: dung file cho weekOffset ${wo}` : `FAIL: sai file`);
  }

  console.log('\n=== xac nhan MOI file chi co dung 1 muc cua chinh no, khong lan sang file khac ===');
  for (let wo = 0; wo <= 3; wo++) {
    const text = await schedule.getWeekText(wo);
    console.log(`--- weekOffset ${wo} ---\n${text}`);
    const hasOwn = text.includes(`Test tuan offset ${wo}`);
    const hasOthers = [0, 1, 2, 3].filter(x => x !== wo).some(x => text.includes(`Test tuan offset ${x}`));
    console.log(hasOwn && !hasOthers ? `PASS: weekOffset ${wo} chi co dung muc cua no` : `FAIL: lan du lieu`);
  }

  console.log('\n=== xoa dung 1 muc o weekOffset 2, khong dung file khac ===');
  const target2 = schedule.weekStartDate(2, today);
  target2.setDate(target2.getDate() + 1);
  await schedule.removeItem({ date: iso(target2), session: 'Sáng' });
  const textAfterRemove = await schedule.getWeekText(2);
  console.log('weekOffset 2 sau khi xoa:', textAfterRemove);
  console.log(!textAfterRemove.includes('Test tuan offset 2') ? 'PASS: da xoa dung' : 'FAIL: chua xoa');
  const text0Unchanged = await schedule.getWeekText(0);
  console.log(text0Unchanged.includes('Test tuan offset 0') ? 'PASS: weekOffset 0 khong bi anh huong' : 'FAIL: weekOffset 0 bi doi nham');

  console.log('\n=== getWeekPath tra dung path cho tung weekOffset ===');
  for (let wo = 0; wo <= 3; wo++) {
    const p = await schedule.getWeekPath(wo);
    console.log(p === WEEK_PATHS_FOR_TEST[wo] ? `PASS: getWeekPath(${wo}) dung` : `FAIL: getWeekPath(${wo}) sai -> ${p}`);
  }

  console.log('\nDONE');
})().catch(e => { console.error('THREW:', e); process.exit(1); })
  .finally(() => {
    // Don sach 4 file test tao ra, restore lai dung file goc that
    for (const p of WEEK_PATHS_FOR_TEST) { if (fs.existsSync(p)) fs.unlinkSync(p); }
    fs.copyFileSync('/tmp/schedule-plan-backup/schedule-original/current.xlsx', '/home/dog/homelab-bot/schedule/current.xlsx');
    console.log('\n(da khoi phuc schedule/current.xlsx that ve nguyen trang; cac file upcoming-*/archive test tao ra da xoa)');
  });
```

- [ ] **Step 3: Chạy test, xác nhận FAIL**

Run: `node /tmp/schedule-plan-backup/test-task2-multiweek-crud.js`
Expected: throw lỗi (vì `addItem` cũ nhận `dayOfWeek` không phải `date`, sẽ báo `dayOfWeek không hợp lệ: "undefined"` hoặc tương tự — chứng tỏ đúng là code cũ chưa hỗ trợ).

- [ ] **Step 4: Sửa `ensureCurrentWeek` → `ensureWeekFile`, sửa `addItem`/`removeItem`/`getCurrentWeekPath` → `getWeekPath`/`getWeekText`**

Trong `/home/dog/homelab-bot/schedule.js`, **xoá hoàn toàn** hàm `ensureCurrentWeek` cũ:
```js
async function ensureCurrentWeek() {
  if (fs.existsSync(CURRENT_PATH)) return;
  const wb = await buildBlankWorkbook(mondayOf(new Date()));
  await writeWorkbookAtomic(wb, CURRENT_PATH);
}
```
Thay bằng:
```js
async function ensureWeekFile(weekOffset, now = new Date()) {
  assertValidWeekOffset(weekOffset); // goi truoc tien, khong dua vao weekStartDate() vi ham do
                                      // chi chay khi file CHUA ton tai - truong hop pho bien
                                      // nhat (file da co san) se lot qua neu khong kiem tra o day.
  const p = WEEK_PATHS[weekOffset];
  if (fs.existsSync(p)) return;
  const wb = await buildBlankWorkbook(weekStartDate(weekOffset, now));
  await writeWorkbookAtomic(wb, p);
}
```

Thay toàn bộ hàm `addItem` cũ:
```js
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
```
Bằng:
```js
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
```

Thay toàn bộ hàm `removeItem` cũ:
```js
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
```
Bằng:
```js
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
```

Thay hàm `getCurrentWeekPath`:
```js
async function getCurrentWeekPath() {
  await ensureCurrentWeek();
  return CURRENT_PATH;
}
```
Bằng (đổi tên):
```js
async function getWeekPath(weekOffset = 0) {
  await ensureWeekFile(weekOffset);
  return WEEK_PATHS[weekOffset];
}
```

Thay hàm `readGrid`:
```js
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
```
Bằng:
```js
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
```

Thay hàm `getWeekText`:
```js
async function getWeekText() {
  const { titleText, grid } = await readGrid();
  ...
}
```
Bằng:
```js
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
```

Sửa `getTodayDigestText` để gọi `readGrid(0)` tường minh (không đổi hành vi, chỉ truyền rõ tham số):
```js
async function getTodayDigestText() {
  const { grid } = await readGrid(0);
  ...
}
```

Cập nhật `module.exports` — bỏ `ensureCurrentWeek`/`getCurrentWeekPath`, thêm `ensureWeekFile`/`getWeekPath`:
```js
module.exports = {
  ensureWeekFile,
  addItem,
  removeItem,
  getWeekPath,
  getWeekText,
  getTodayDigestText,
  archiveAndResetWeek,
  assertValidWeekOffset,
  weekStartDate,
  parseISODate,
  resolveWeekSlot,
  weekRangeLabel,
};
```
*(`archiveAndResetWeek` giữ nguyên nội dung CŨ ở bước này — Task 3 mới sửa. `clearWeekSlot` chưa tồn tại — Task 3 thêm.)*

- [ ] **Step 5: Kiểm tra cú pháp**

Run: `node -c /home/dog/homelab-bot/schedule.js`
Expected: không lỗi.

- [ ] **Step 6: Grep xác nhận `ensureCurrentWeek`/`getCurrentWeekPath` không còn bị dùng ở đâu khác ngoài `schedule.js` (phòng trường hợp `bot.js` gọi trực tiếp thay vì qua wiring)**

Run: `grep -rn "ensureCurrentWeek\|getCurrentWeekPath" /home/dog/homelab-bot --include="*.js" | grep -v node_modules`
Expected: chỉ còn dòng trong `bot.js` (`getCurrentWeekPath: schedule.getCurrentWeekPath,` — sẽ sửa ở Task 5) — nếu thấy chỗ nào khác dùng trực tiếp, dừng lại báo cho reviewer trước khi tiếp tục.

- [ ] **Step 7: Chạy lại test, xác nhận PASS toàn bộ**

Run: `node /tmp/schedule-plan-backup/test-task2-multiweek-crud.js`
Expected: mọi dòng `PASS`.

- [ ] **Step 8: Xác nhận dữ liệu thật không bị hỏng**

Run:
```bash
diff /home/dog/homelab-bot/schedule/current.xlsx /tmp/schedule-plan-backup/schedule-original/current.xlsx && echo "current.xlsx khong doi, dung"
ls /home/dog/homelab-bot/schedule/upcoming-*.xlsx 2>&1  # phai bao "No such file" - test da tu don
```
Expected: `current.xlsx khong doi, dung` in ra, và không có file `upcoming-*.xlsx` nào sót lại.

- [ ] **Task hoàn tất, KHÔNG commit** — chờ sang Task 3.

---

## Task 3: `schedule.js` — `clearWeekSlot` (mới) + `archiveAndResetWeek` dịch chuyển 4 file

**Files:**
- Modify: `/home/dog/homelab-bot/schedule.js`
- Test: `/tmp/schedule-plan-backup/test-task3-rollover-clear.js`

**Interfaces:**
- Consumes: `ensureWeekFile(weekOffset, now)`, `weekStartDate(weekOffset, now)` từ Task 1/2, `WEEK_PATHS`, `ROLLOVER_MARKER` (module-scope, từ Task 1).
- Produces: `clearWeekSlot(weekOffset)` → `Promise<string>` (file path đã reset), `archiveAndResetWeek()` → `Promise<void>` (chữ ký giữ nguyên tên cũ, KHÔNG nhận tham số — dùng cho job hệ thống). Task 4/5 dùng `clearWeekSlot` cho tool `clearSchedule`; `archiveAndResetWeek` tiếp tục được gọi nguyên như cũ từ `bot.js`'s `systemActions`.

- [ ] **Step 1: Viết test trước**

Tạo `/tmp/schedule-plan-backup/test-task3-rollover-clear.js`:

```js
const fs = require('fs');
const path = require('path');
const schedule = require('/home/dog/homelab-bot/schedule.js');

const SCHEDULE_DIR = '/home/dog/homelab-bot/schedule';
const ARCHIVE_DIR  = path.join(SCHEDULE_DIR, 'archive');
const WEEK_PATHS = [0,1,2,3].map(i => i === 0 ? path.join(SCHEDULE_DIR, 'current.xlsx') : path.join(SCHEDULE_DIR, `upcoming-${i}.xlsx`));
const MARKER = path.join(SCHEDULE_DIR, '.rollover-in-progress');

// don sach truoc khi test (backup that da luu o Task 2 Step 1, van con nguyen o /tmp/schedule-plan-backup/schedule-original)
for (const p of WEEK_PATHS) if (fs.existsSync(p)) fs.unlinkSync(p);
if (fs.existsSync(MARKER)) fs.unlinkSync(MARKER);
const archiveFilesBefore = fs.existsSync(ARCHIVE_DIR) ? fs.readdirSync(ARCHIVE_DIR) : [];

(async () => {
  console.log('=== 1. tao 4 tuan co noi dung khac nhau, goi archiveAndResetWeek 1 lan, kiem tra dich chuyen dung ===');
  for (let i = 0; i <= 3; i++) {
    await schedule.ensureWeekFile(i);
    const filePath = WEEK_PATHS[i];
    // ghi danh dau rieng vao tung file qua addItem gian tiep khong tien loi (can dung date that) -
    // don gian hon: doc lai text tuan i de xac nhan dung file, dung title lam danh dau la du
  }
  const textBefore0 = await schedule.getWeekText(0);
  const textBefore1 = await schedule.getWeekText(1);
  console.log('Truoc rollover - tuan 0:', textBefore0.split('\n')[0]);
  console.log('Truoc rollover - tuan 1:', textBefore1.split('\n')[0]);

  await schedule.archiveAndResetWeek();

  const archiveFilesAfter = fs.readdirSync(ARCHIVE_DIR);
  const newArchiveFile = archiveFilesAfter.filter(f => !archiveFilesBefore.includes(f));
  console.log('File archive moi tao:', newArchiveFile);
  console.log(newArchiveFile.length === 1 ? 'PASS: archive dung 1 file' : 'FAIL: so file archive sai');

  const textAfter0 = await schedule.getWeekText(0);
  console.log('Sau rollover - tuan 0 (phai la tieu de cua tuan 1 cu):', textAfter0.split('\n')[0]);
  console.log(textAfter0.split('\n')[0] === textBefore1.split('\n')[0] ? 'PASS: upcoming-1 da thang cap thanh current' : 'FAIL: dich chuyen sai');

  console.log(fs.existsSync(WEEK_PATHS[3]) ? 'PASS: co file moi o vi tri xa nhat' : 'FAIL: thieu file weekOffset 3');
  const text3 = await schedule.getWeekText(3);
  console.log(text3.includes('chưa có lịch nào') ? 'PASS: file weekOffset 3 moi la trong' : 'FAIL: file moi khong trong');
  console.log(!fs.existsSync(MARKER) ? 'PASS: marker da duoc xoa sau khi xong' : 'FAIL: marker con sot lai');

  console.log('\n=== 2. gia lap crash giua chung: tao marker + dua 4 file ve trang thai "da archive buoc 1, chua dich chuyen", goi lai archiveAndResetWeek ===');
  // Xoa het, tao lai tu dau cho sach
  for (const p of WEEK_PATHS) if (fs.existsSync(p)) fs.unlinkSync(p);
  for (let i = 0; i <= 3; i++) await schedule.ensureWeekFile(i);
  const textW1BeforeCrashSim = await schedule.getWeekText(1);
  // gia lap: buoc 1 (archive WEEK_PATHS[0]) da xong that su bang cach tu goi archiveAndResetWeek 1 lan binh thuong
  // roi CHEN marker + xoa WEEK_PATHS[0] gia (dua upcoming-1 vao dung vi tri) NHUNG dung lai truoc buoc dich chuyen 2,3
  // -> mo phong don gian hon: goi truc tiep cac buoc nhu code that se lam den giua chung
  fs.renameSync(WEEK_PATHS[1], WEEK_PATHS[0]); // gia lap da xong buoc dich chuyen dau tien
  fs.writeFileSync(MARKER, ''); // danh dau dang giua chung (mo phong: archive that + shift dau da xong)
  // luc nay WEEK_PATHS[1] khong con ton tai (da bi rename di), WEEK_PATHS[2] va [3] van con nguyen tu cu

  await schedule.archiveAndResetWeek(); // goi lai - phai TIEP TUC dich chuyen, KHONG archive lai WEEK_PATHS[0] (vi no gio la noi dung cua "upcoming-1" cu, khong phai noi dung "current" that su ban dau)

  console.log(!fs.existsSync(MARKER) ? 'PASS: marker da xoa sau khi chay lai xong' : 'FAIL: marker con sot');
  const archiveFilesAfterCrashTest = fs.readdirSync(ARCHIVE_DIR);
  console.log(archiveFilesAfterCrashTest.length === archiveFilesAfter.length ? 'PASS: khong archive them lan nao nua (dung du lieu da promote)' : 'FAIL: archive nham them 1 lan nua, mat du lieu');

  console.log('\nDONE');
})().catch(e => { console.error('THREW:', e); process.exit(1); })
  .finally(() => {
    for (const p of WEEK_PATHS) if (fs.existsSync(p)) fs.unlinkSync(p);
    if (fs.existsSync(MARKER)) fs.unlinkSync(MARKER);
    // don sach cac file archive do TEST nay tao ra (khong phai archive that cua user)
    const archiveFilesFinal = fs.readdirSync(ARCHIVE_DIR);
    for (const f of archiveFilesFinal) {
      if (!archiveFilesBefore.includes(f)) fs.unlinkSync(path.join(ARCHIVE_DIR, f));
    }
    fs.copyFileSync('/tmp/schedule-plan-backup/schedule-original/current.xlsx', '/home/dog/homelab-bot/schedule/current.xlsx');
    console.log('\n(da don sach file test tao ra + khoi phuc current.xlsx that)');
  });
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `node /tmp/schedule-plan-backup/test-task3-rollover-clear.js`
Expected: throw lỗi (vì `WEEK_PATHS`/`ensureWeekFile` đã export từ Task 1/2 nhưng `archiveAndResetWeek` hiện tại vẫn còn logic cũ 1-file, sẽ không dịch chuyển 4 file như test mong đợi — phần "PASS: upcoming-1 đã thăng cấp" sẽ `FAIL`).

- [ ] **Step 3: Thêm `clearWeekSlot`, sửa `archiveAndResetWeek`**

Trong `/home/dog/homelab-bot/schedule.js`, thay toàn bộ hàm `archiveAndResetWeek` cũ:
```js
async function archiveAndResetWeek() {
  await ensureCurrentWeek();

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const mon = mondayOf(yesterday);
  const sun = sundayOf(yesterday);
  const baseName = `${fmtDDMM(mon).replace('/', '-')}_${fmtDDMM(sun).replace('/', '-')}`;

  ensureScheduleDirs();
  let archiveName = `${baseName}.xlsx`;
  let n = 2;
  while (fs.existsSync(path.join(ARCHIVE_DIR, archiveName))) {
    archiveName = `${baseName}_${n}.xlsx`;
    n++;
  }
  fs.renameSync(CURRENT_PATH, path.join(ARCHIVE_DIR, archiveName));

  await ensureCurrentWeek();
}
```
Bằng:
```js
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
```

Cập nhật `module.exports` — thêm `clearWeekSlot`:
```js
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
```

- [ ] **Step 4: Kiểm tra cú pháp**

Run: `node -c /home/dog/homelab-bot/schedule.js`
Expected: không lỗi.

- [ ] **Step 5: Chạy lại test, xác nhận PASS toàn bộ**

Run: `node /tmp/schedule-plan-backup/test-task3-rollover-clear.js`
Expected: mọi dòng `PASS`.

- [ ] **Step 6: Thêm phần test riêng cho `clearWeekSlot` — chỉ đụng đúng 1 slot**

Thêm vào cuối file test (trước dòng `console.log('\nDONE');` cuối cùng, hoặc chạy như 1 script riêng `/tmp/schedule-plan-backup/test-task3b-clearweekslot.js`):

```js
const fs = require('fs');
const schedule = require('/home/dog/homelab-bot/schedule.js');
const WEEK_PATHS = [
  '/home/dog/homelab-bot/schedule/current.xlsx',
  '/home/dog/homelab-bot/schedule/upcoming-1.xlsx',
  '/home/dog/homelab-bot/schedule/upcoming-2.xlsx',
  '/home/dog/homelab-bot/schedule/upcoming-3.xlsx',
];
for (const p of WEEK_PATHS) if (fs.existsSync(p)) fs.unlinkSync(p);

(async () => {
  for (let i = 0; i <= 3; i++) await schedule.ensureWeekFile(i);
  const mtimesBefore = WEEK_PATHS.map(p => fs.statSync(p).mtimeMs);

  await schedule.clearWeekSlot(2);

  const mtimesAfter = WEEK_PATHS.map(p => fs.statSync(p).mtimeMs);
  console.log('mtime truoc:', mtimesBefore);
  console.log('mtime sau:', mtimesAfter);
  console.log(mtimesAfter[0] === mtimesBefore[0] ? 'PASS: slot 0 khong doi' : 'FAIL: slot 0 bi dung nham');
  console.log(mtimesAfter[1] === mtimesBefore[1] ? 'PASS: slot 1 khong doi' : 'FAIL: slot 1 bi dung nham');
  console.log(mtimesAfter[2] !== mtimesBefore[2] ? 'PASS: slot 2 da bi thay doi (dung, day la slot bi clear)' : 'FAIL: slot 2 khong doi');
  console.log(mtimesAfter[3] === mtimesBefore[3] ? 'PASS: slot 3 khong doi' : 'FAIL: slot 3 bi dung nham');
  console.log('\nDONE');
})().catch(e => { console.error('THREW:', e); process.exit(1); })
  .finally(() => {
    for (const p of WEEK_PATHS) if (fs.existsSync(p)) fs.unlinkSync(p);
    fs.copyFileSync('/tmp/schedule-plan-backup/schedule-original/current.xlsx', '/home/dog/homelab-bot/schedule/current.xlsx');
  });
```

Run: `node /tmp/schedule-plan-backup/test-task3b-clearweekslot.js`
Expected: 4 dòng `PASS`.

- [ ] **Step 7: Xác nhận dữ liệu thật không bị hỏng sau toàn bộ Task 3**

Run:
```bash
diff /home/dog/homelab-bot/schedule/current.xlsx /tmp/schedule-plan-backup/schedule-original/current.xlsx && echo "current.xlsx khong doi, dung"
diff <(ls /home/dog/homelab-bot/schedule/archive/) <(ls /tmp/schedule-plan-backup/schedule-original/archive/) && echo "thu muc archive khong doi, dung"
```
Expected: cả 2 dòng "không đổi, đúng" đều in ra.

- [ ] **Task hoàn tất, KHÔNG commit** — chờ sang Task 4.

---

## Task 4: `agent.js` — Cập nhật 5 TOOLS dùng `date`/`weekOffset`

**Files:**
- Modify: `/home/dog/homelab-bot/agent.js`
- Test: `/tmp/schedule-plan-backup/test-task4-agent-tools.js`

**Interfaces:**
- Consumes: `addScheduleItem` (dep, = `schedule.addItem` từ Task 2), `removeScheduleItem` (dep, = `schedule.removeItem`), `clearScheduleWeek` (dep, SẼ = `schedule.clearWeekSlot` — Task 5 mới sửa wiring, Task 4 chỉ đổi CÁCH agent.js GỌI dep này, chưa sửa bot.js), `getCurrentWeekPath` (dep, SẼ = `schedule.getWeekPath`), `viewScheduleText` (dep, = `schedule.getWeekText`), `weekRangeLabel` (dep MỚI, = `schedule.weekRangeLabel`).
- Produces: `TOOLS.addScheduleItem`/`removeScheduleItem`/`clearSchedule`/`viewSchedule`/`sendScheduleFile` với schema/handler mới. Task 5 (bot.js) chỉ cần đúng tên dep khớp với những gì `createAgent(deps)` destructure ở đây.

**Lưu ý quan trọng:** test task này KHÔNG gọi Gemini API thật (không tốn quota) — chỉ mock toàn bộ `deps` khi gọi `createAgent({...})`, gọi `dispatchTool` gián tiếp qua cách kiểm tra hành vi thật của `handler` (vì `dispatchTool` không export, ta kiểm tra qua việc mock `addScheduleItem`/`removeScheduleItem`/`clearScheduleWeek` deps rồi verify chúng được GỌI ĐÚNG THAM SỐ khi lẽ ra Gemini sẽ gọi — do không gọi được `TOOLS` object trực tiếp (không export), cách khả thi nhất là verify qua code review + syntax check + test tích hợp thật ở Task 5. Task này tập trung đảm bảo code không lỗi cú pháp/logic rõ ràng khi đọc, và 1 test nhỏ xác nhận `createAgent` với deps mới không throw lúc khởi tạo).

- [ ] **Step 1: Viết test trước (xác nhận `createAgent` chấp nhận dep mới `weekRangeLabel` không throw, và các dep cũ vẫn được destructure đúng tên)**

Tạo `/tmp/schedule-plan-backup/test-task4-agent-tools.js`:

```js
const { createAgent } = require('/home/dog/homelab-bot/agent.js');

const calls = { addScheduleItem: [], removeScheduleItem: [], clearScheduleWeek: [], getCurrentWeekPath: [], viewScheduleText: [], weekRangeLabel: [] };

const agentApi = createAgent({
  send: async () => {}, render: async () => {}, sendDocument: async () => {},
  getSystemStatus: async () => ({}), getPiholeStats: async () => ({}), getWeather: async () => '', getNews: async () => '',
  addReminderJob: () => ({}), listReminderJobs: () => [], cancelReminderJob: () => false,
  addScheduleItem: async (args) => { calls.addScheduleItem.push(args); return '/fake/path.xlsx'; },
  removeScheduleItem: async (args) => { calls.removeScheduleItem.push(args); return '/fake/path.xlsx'; },
  viewScheduleText: async (weekOffset) => { calls.viewScheduleText.push(weekOffset); return 'fake text'; },
  clearScheduleWeek: async (weekOffset) => { calls.clearScheduleWeek.push(weekOffset); },
  getCurrentWeekPath: async (weekOffset) => { calls.getCurrentWeekPath.push(weekOffset); return '/fake/path.xlsx'; },
  weekRangeLabel: (weekOffset) => { calls.weekRangeLabel.push(weekOffset); return '14/09-20/09'; },
  removeScheduleItem: async (args) => { calls.removeScheduleItem.push(args); return '/fake/path.xlsx'; },
});

console.log(typeof agentApi.handleAgent === 'function' ? 'PASS: createAgent khong throw voi dep moi weekRangeLabel, handleAgent ton tai' : 'FAIL');
console.log('\nDONE (test nay chi kiem tra khoi tao - hanh vi tool that se kiem tra qua Telegram that o Task 5)');
```

- [ ] **Step 2: Chạy test, xác nhận FAIL (vì `weekRangeLabel` chưa được `createAgent` destructure, dùng thử trong `describeAction` sẽ throw `weekRangeLabel is not defined` khi Gemini gọi — nhưng ở mức khởi tạo này `createAgent` KHÔNG throw ngay vì destructure thiếu field chỉ tạo `undefined`, không lỗi cú pháp. Để test có ý nghĩa fail thật, kiểm tra bằng grep thay vì run test)**

Run: `grep -n "weekRangeLabel" /home/dog/homelab-bot/agent.js`
Expected: không có kết quả nào (chưa được thêm).

- [ ] **Step 3: Sửa `agent.js` — destructure dep mới `weekRangeLabel`**

Tìm dòng (trong `createAgent(deps)`):
```js
    addScheduleItem, viewScheduleText, clearScheduleWeek, getCurrentWeekPath,
    removeScheduleItem,
```
Sửa thành:
```js
    addScheduleItem, viewScheduleText, clearScheduleWeek, getCurrentWeekPath,
    removeScheduleItem, weekRangeLabel,
```

- [ ] **Step 4: Sửa tool `addScheduleItem` trong `TOOLS`**

Tìm khối:
```js
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
```
Thay bằng:
```js
    addScheduleItem: {
      requiresConfirm: false,
      description: 'Thêm 1 việc vào lịch (không ghi đè, tự nối thêm nếu ô đã có việc khác). Hỗ trợ lên lịch trước tối đa 3 tuần kể từ hôm nay.',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          date:    { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Ngày dạng YYYY-MM-DD, tối đa 3 tuần kể từ hôm nay (tính từ ngày hiện tại trong system instruction)' },
          session: { type: 'string', enum: ['Sáng', 'Chiều', 'Tối'] },
          time:    { type: 'string', description: 'Giờ cụ thể dạng "14h" hoặc "14:00"' },
          content: { type: 'string' },
        },
        required: ['date', 'session', 'time', 'content'],
      },
      handler: async (args, chatId) => {
        const filePath = await addScheduleItem(args);
        pendingScheduleFile.set(chatId, filePath);
        return { ok: true };
      },
    },
```

- [ ] **Step 5: Sửa tool `removeScheduleItem`**

Tìm khối:
```js
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
```
Thay bằng:
```js
    removeScheduleItem: {
      requiresConfirm: true,
      description: 'Xoá nội dung 1 ô cụ thể trong lịch (theo date + session), không đụng các ô khác - không thể hoàn tác qua chat, cần xác nhận trước. Nếu người dùng muốn xoá nhiều ô, gọi tool này nhiều lần (mỗi lần 1 ô).',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          date:    { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Ngày dạng YYYY-MM-DD' },
          session: { type: 'string', enum: ['Sáng', 'Chiều', 'Tối'] },
        },
        required: ['date', 'session'],
      },
      describeAction: (args) => `Xoá nội dung ô lịch ngày "${escapeHtml(args.date)} - ${escapeHtml(args.session)}".`,
      handler: async (args, chatId) => {
        const filePath = await removeScheduleItem(args);
        pendingScheduleFile.set(chatId, filePath);
        return { ok: true };
      },
    },
```

- [ ] **Step 6: Sửa tool `clearSchedule`**

Tìm khối:
```js
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
```
Thay bằng:
```js
    clearSchedule: {
      requiresConfirm: true,
      description: 'Xoá toàn bộ lịch 1 tuần cụ thể (mọi việc đã thêm) và tạo lịch trống mới cho tuần đó - không thể hoàn tác qua chat, cần xác nhận trước.',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          weekOffset: { type: 'integer', enum: [0, 1, 2, 3], description: '0 = tuần này (mặc định), 1-3 = các tuần kế tiếp' },
        },
      },
      describeAction: (args) => {
        const weekOffset = args.weekOffset ?? 0;
        return `Xoá toàn bộ lịch tuần ${weekRangeLabel(weekOffset)} (bản cũ vẫn được lưu trữ trên server, không mất hẳn) và tạo lịch trống mới cho tuần đó.`;
      },
      handler: async (args, chatId) => {
        const weekOffset = args.weekOffset ?? 0;
        await clearScheduleWeek(weekOffset);
        const filePath = await getCurrentWeekPath(weekOffset);
        pendingScheduleFile.set(chatId, filePath);
        return { ok: true };
      },
    },
```

- [ ] **Step 7: Sửa tool `viewSchedule`**

Tìm khối:
```js
    viewSchedule: {
      requiresConfirm: false,
      description: 'Xem toàn bộ lịch tuần hiện tại dạng text.',
      parametersJsonSchema: { type: 'object', properties: {} },
      handler: async () => ({ text: await viewScheduleText() }),
    },
```
Thay bằng:
```js
    viewSchedule: {
      requiresConfirm: false,
      description: 'Xem toàn bộ lịch 1 tuần cụ thể dạng text.',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          weekOffset: { type: 'integer', enum: [0, 1, 2, 3], description: '0 = tuần này (mặc định), 1-3 = các tuần kế tiếp' },
        },
      },
      handler: async (args) => ({ text: await viewScheduleText(args.weekOffset ?? 0) }),
    },
```

- [ ] **Step 8: Sửa tool `sendScheduleFile`**

Tìm khối:
```js
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
```
Thay bằng:
```js
    sendScheduleFile: {
      requiresConfirm: false,
      description: 'Gửi lại file Excel của 1 tuần cụ thể cho người dùng, không thêm/sửa/xoá gì cả.',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          weekOffset: { type: 'integer', enum: [0, 1, 2, 3], description: '0 = tuần này (mặc định), 1-3 = các tuần kế tiếp' },
        },
      },
      handler: async (args, chatId) => {
        const filePath = await getCurrentWeekPath(args.weekOffset ?? 0);
        pendingScheduleFile.set(chatId, filePath);
        return { ok: true };
      },
    },
```

- [ ] **Step 9: Kiểm tra cú pháp**

Run: `node -c /home/dog/homelab-bot/agent.js`
Expected: không lỗi.

- [ ] **Step 10: Chạy lại test khởi tạo, xác nhận PASS**

Run: `node /tmp/schedule-plan-backup/test-task4-agent-tools.js`
Expected: dòng `PASS: createAgent khong throw...` xuất hiện.

- [ ] **Task hoàn tất, KHÔNG commit** — chờ sang Task 5.

---

## Task 5: `bot.js` — Sửa wiring + deploy + verify thật

**Files:**
- Modify: `/home/dog/homelab-bot/bot.js`

**Interfaces:**
- Consumes: `schedule.clearWeekSlot`, `schedule.getWeekPath`, `schedule.weekRangeLabel` (từ Task 2/3), `agent.js`'s `createAgent(deps)` yêu cầu đúng tên dep (`clearScheduleWeek`, `getCurrentWeekPath`, `weekRangeLabel`) từ Task 4.
- Đây là task cuối — không có task nào sau dùng lại gì từ đây.

- [ ] **Step 1: Sửa wiring `createAgent({...})` trong `bot.js`**

Tìm khối (có 2 dòng cần sửa + thêm 1 dòng mới):
```js
  addScheduleItem: schedule.addItem,
  viewScheduleText: schedule.getWeekText,
  clearScheduleWeek: schedule.archiveAndResetWeek,
  getCurrentWeekPath: schedule.getCurrentWeekPath,
  removeScheduleItem: schedule.removeItem,
});
```
Thay bằng:
```js
  addScheduleItem: schedule.addItem,
  viewScheduleText: schedule.getWeekText,
  clearScheduleWeek: schedule.clearWeekSlot,
  getCurrentWeekPath: schedule.getWeekPath,
  removeScheduleItem: schedule.removeItem,
  weekRangeLabel: schedule.weekRangeLabel,
});
```

- [ ] **Step 2: Kiểm tra cú pháp cả 3 file đã sửa**

Run:
```bash
node -c /home/dog/homelab-bot/schedule.js && \
node -c /home/dog/homelab-bot/agent.js && \
node -c /home/dog/homelab-bot/bot.js && \
echo "CA 3 FILE SYNTAX OK"
```
Expected: `CA 3 FILE SYNTAX OK`.

- [ ] **Step 3: Grep xác nhận không còn tham chiếu tên hàm/tham số cũ nào sót lại**

Run:
```bash
grep -n "dayOfWeek" /home/dog/homelab-bot/agent.js /home/dog/homelab-bot/schedule.js
grep -n "ensureCurrentWeek\|getCurrentWeekPath\b" /home/dog/homelab-bot/schedule.js /home/dog/homelab-bot/bot.js
```
Expected: dòng 1 KHÔNG có kết quả nào (đã đổi hết `dayOfWeek` → `date`). Dòng 2 chỉ được phép còn đúng 1 chỗ — biến/property TÊN `getCurrentWeekPath` dùng làm KEY trong object truyền vào `createAgent({...})` ở `bot.js` (đây là tên dependency-key giữ nguyên theo thiết kế, không phải tên hàm `schedule.js` — không cần đổi tên key này, chỉ giá trị đã đổi từ `schedule.getCurrentWeekPath` sang `schedule.getWeekPath`). Nếu thấy `ensureCurrentWeek` xuất hiện ở bất kỳ đâu, dừng lại sửa trước khi tiếp tục.

- [ ] **Step 4: Chạy lại toàn bộ test cô lập của Task 1-4 một lượt cuối trước khi restart PM2**

Run:
```bash
node /tmp/schedule-plan-backup/test-task1-date-helpers.js | tail -5
node /tmp/schedule-plan-backup/test-task2-multiweek-crud.js | tail -5
node /tmp/schedule-plan-backup/test-task3-rollover-clear.js | tail -5
node /tmp/schedule-plan-backup/test-task3b-clearweekslot.js | tail -5
node /tmp/schedule-plan-backup/test-task4-agent-tools.js | tail -5
```
Expected: không dòng nào có chữ `FAIL` trong bất kỳ output nào.

- [ ] **Step 5: Backup dữ liệu thật lần cuối trước khi restart production**

Run:
```bash
diff /home/dog/homelab-bot/schedule/current.xlsx /tmp/schedule-plan-backup/schedule-original/current.xlsx && echo "current.xlsx van dung nguyen ban that, an toan de restart"
```
Expected: dòng xác nhận in ra. Nếu KHÁC (diff báo có khác biệt), DỪNG LẠI — có nghĩa 1 trong các test ở Task 1-4 đã không restore đúng, phải điều tra trước khi restart production.

- [ ] **Step 6: Restart PM2**

Run: `pm2 restart dog-bot`
Expected: PM2 báo `online`, không lỗi.

- [ ] **Step 7: Theo dõi log 5 giây đầu sau restart**

Run: `sleep 3 && pm2 logs dog-bot --lines 10 --nostream --err 2>&1 | tail -10`
Expected: không có dòng lỗi mới nào liên quan `schedule.js`/`agent.js`/`bot.js` (require lỗi, TypeError khi khởi động...). Dòng "🤖 Homelab Bot Modern Card UI started" xuất hiện là dấu hiệu khởi động thành công.

- [ ] **Step 8: Test thật qua Telegram (thủ công, báo lại kết quả cho reviewer)**

Gửi các câu lệnh sau qua Telegram tới bot, xác nhận từng cái:
1. `/agent thêm vào lịch tuần sau thứ 5 lúc 13h30 học CodeGym offline tại LAB-302-C7` — xác nhận file Excel gửi về đúng là lịch TUẦN SAU (kiểm tra dòng "Tuần: dd/mm-dd/mm" trong file khớp tuần kế tiếp, không phải tuần hiện tại).
2. `/agent xem lịch tuần sau` — xác nhận đúng mục vừa thêm hiện ra.
3. `/agent xem lịch tuần này` — xác nhận KHÔNG có mục "CodeGym offline" nào lẫn vào (phải tách biệt hoàn toàn khỏi tuần sau).
4. Thử ngày ngoài phạm vi: `/agent thêm vào lịch ngày 20/12 lúc 8h họp abc` (giả sử xa hơn 4 tuần từ hôm nay) — xác nhận agent trả lời báo lỗi/từ chối rõ ràng, KHÔNG âm thầm ghi vào tuần hiện tại.
5. `/agent xoá hết lịch tuần sau` (xác nhận yes) — xác nhận chỉ tuần sau bị xoá, tuần này không đổi.

- [ ] **Task hoàn tất, KHÔNG commit.** Báo cáo tổng kết cho user: tất cả test cô lập + test thật đã pass, dữ liệu `schedule/current.xlsx` gốc không bị ảnh hưởng trong suốt quá trình, hỏi user có muốn commit không (theo Global Constraints — không tự ý commit).

---

## Self-Review (đã tự soát trước khi đưa cho user)

**1. Spec coverage:** đối chiếu từng mục trong spec `2026-09-17-schedule-4-week-window-design.md`:
- File constants + `assertValidWeekOffset`/`weekStartDate` → Task 1 ✓.
- `parseISODate`/`resolveWeekSlot`/`weekRangeLabel` → Task 1 ✓.
- `ensureWeekFile` thay `ensureCurrentWeek`, `addItem`/`removeItem` nhận `date`, `getWeekPath`/`getWeekText` thêm `weekOffset` → Task 2 ✓.
- `archiveAndResetWeek` dịch chuyển + chịu crash (marker), `clearWeekSlot` mới → Task 3 ✓.
- 5 TOOLS trong `agent.js` → Task 4 ✓.
- 2 dòng wiring `bot.js` (`clearScheduleWeek`, `getCurrentWeekPath`) + dep mới `weekRangeLabel` → Task 5 ✓.
- Phần "Testing" 8 mục trong spec → phủ đủ qua Task 1 Step 1 (mục 1), Task 2 Step 2 (mục 2), Task 3 Step 1+6 (mục 3,4), Task 3 Step 1 phần 2 (mục 5 - crash), Task 1 Step 1 (mục 6 - assertValidWeekOffset), Task 5 Step 8 (mục 7 - test thật), toàn bộ các task đều backup/restore (mục 8).
- Phần "Rủi ro chấp nhận không sửa" → không cần task, chỉ là ghi chú, đã không tạo task thừa cho nó (đúng ý spec).

**2. Placeholder scan:** không còn "TBD"/"tương tự Task N"/mô tả suông không kèm code — mọi step code đều là code đầy đủ chép nguyên từ spec đã duyệt.

**3. Type/tên nhất quán:** `clearScheduleWeek` (tên dep trong `agent.js`/`bot.js`) luôn nhận `weekOffset` xuyên suốt Task 4 Step 6 và Task 5 Step 1 — khớp. `getCurrentWeekPath` (tên dep, KHÔNG đổi tên key dù hàm `schedule.js` đã đổi thành `getWeekPath`) nhất quán giữa Task 4 và Task 5. `weekRangeLabel` xuất hiện đồng bộ ở Task 1 (định nghĩa), Task 4 Step 3+6 (destructure + dùng), Task 5 Step 1 (wiring) — khớp tên xuyên suốt.
