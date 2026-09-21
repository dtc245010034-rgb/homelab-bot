# Thiết kế: Lên lịch trước tối đa 4 tuần (cửa sổ trượt)

## Context

Bug thật vừa gặp (2026-09-17): user nhờ agent thêm lịch "CodeGym offline... (24/09)" — 24/09 là Thứ 5 **tuần sau**, nhưng hệ thống ghi vào ô Thứ 5 **tuần này** (17/09, hôm nay). Root cause xác nhận qua bằng chứng thật (`agent.log` + đọc lại `current.xlsx`): `schedule.js` chỉ có **đúng 1 file** `current.xlsx` đại diện "tuần hiện tại" — tool `addScheduleItem` chỉ nhận `dayOfWeek` (Thứ 2..CN), không có khái niệm "tuần nào". Không phải chọn nhầm — hệ thống chưa từng có chỗ nào để ghi đúng cho tuần sau. Đã dọn sạch dữ liệu bị ghi nhầm trước khi viết spec này.

User xác nhận muốn lên lịch trước tối đa **4 tuần** (tuần này + 3 tuần kế tiếp), không cần xa hơn.

## Approach đã chọn

Giữ nguyên định dạng lưới Excel theo tuần đang chạy tốt (không đổi trải nghiệm người dùng khi tải file). Mở rộng từ 1 file thành **cửa sổ trượt 4 file cố định**, và đổi cách tool xác định ô từ "thứ mấy trong tuần ngầm định" sang **ngày tháng tuyệt đối** — để code tự tính đúng tuần/cột thay vì bắt Gemini tự nhẩm, loại bỏ hẳn nhóm lỗi vừa gặp.

## Thiết kế chi tiết — `schedule.js`

**File constants:**
```js
const CURRENT_PATH   = path.join(SCHEDULE_DIR, 'current.xlsx');
const UPCOMING_PATHS = [1, 2, 3].map(n => path.join(SCHEDULE_DIR, `upcoming-${n}.xlsx`));
const WEEK_PATHS     = [CURRENT_PATH, ...UPCOMING_PATHS]; // index = weekOffset 0..3
const ROLLOVER_MARKER = path.join(SCHEDULE_DIR, '.rollover-in-progress'); // co danh dau chuoi rename dang giua chung

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
```

**Hàm mới — quy đổi ngày tuyệt đối sang (weekOffset, dayIdx):**
```js
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
```

**Hàm helper tổng quát hoá (thay `ensureCurrentWeek`):**
```js
async function ensureWeekFile(weekOffset, now = new Date()) {
  assertValidWeekOffset(weekOffset); // goi truoc TIEN, khong dua vao weekStartDate() vi ham do
                                      // chi chay khi file CHUA ton tai - truong hop pho bien
                                      // nhat (file da co san) se lot qua neu khong kiem tra o day.
  const p = WEEK_PATHS[weekOffset];
  if (fs.existsSync(p)) return;
  const wb = await buildBlankWorkbook(weekStartDate(weekOffset, now));
  await writeWorkbookAtomic(wb, p);
}

function weekRangeLabel(weekOffset, now = new Date()) {
  const start = weekStartDate(weekOffset, now);
  const end = new Date(start.getTime() + 6 * 24 * 3600 * 1000);
  return `${fmtDDMM(start)}-${fmtDDMM(end)}`;
}
```

**Sửa `addItem`/`removeItem`:** nhận `date` thay vì `dayOfWeek`. Lấy 1 mốc `const now = new Date();` DUY NHẤT ở đầu hàm, truyền chung cho cả `resolveWeekSlot(date, now)` và `ensureWeekFile(weekOffset, now)` — đảm bảo 2 bước tính toán trong CÙNG 1 request luôn đồng nhất, không lệch nhau kể cả khi chạy đúng ranh giới nửa đêm. Logic tìm ô/nối-thêm/xoá-ô giữ nguyên 100%.

**Sửa `getWeekPath`/`getWeekText`:** thêm tham số `weekOffset = 0`, gọi `assertValidWeekOffset(weekOffset)` trước, đọc đúng `WEEK_PATHS[weekOffset]`.

**`getTodayDigestText()`:** không đổi — luôn đọc `weekOffset=0` (hôm nay chắc chắn thuộc tuần 0).

**`archiveAndResetWeek()` (CHỈ dùng cho job hệ thống rollover mỗi Thứ 2 00:00) — thêm bước dịch chuyển dây chuyền, viết theo kiểu CHỊU ĐƯỢC crash giữa chừng (mỗi bước tự kiểm tra đã làm chưa trước khi làm lại, để chạy lại toàn bộ hàm sau khi PM2 restart giữa chừng là an toàn, không double-archive hay mất dữ liệu vừa promote):**
```js
async function archiveAndResetWeek() {
  const now = new Date();
  for (let i = 0; i < 4; i++) await ensureWeekFile(i, now);

  // Buoc 1: archive dung file weekOffset=0 - CHI archive neu WEEK_PATHS[0] con ton tai.
  // Neu buoc nay da chay xong roi crash o buoc sau, lan chay lai se thay WEEK_PATHS[0]
  // (luc nay da la noi dung cu tu upcoming-1, do buoc 2 da/chua chay) - can phan biet
  // "chua archive lan nao" vs "da archive, dang o giua chuoi dich chuyen": dung 1 file
  // danh dau tien trinh nho (vd .rollover-in-progress) thay vi doan qua trang thai file.
  if (!fs.existsSync(ROLLOVER_MARKER)) {
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const baseName = `${fmtDDMM(mondayOf(yesterday)).replace('/', '-')}_${fmtDDMM(sundayOf(yesterday)).replace('/', '-')}`;
    ensureScheduleDirs();
    let archiveName = `${baseName}.xlsx`, n = 2;
    while (fs.existsSync(path.join(ARCHIVE_DIR, archiveName))) { archiveName = `${baseName}_${n}.xlsx`; n++; }
    fs.renameSync(WEEK_PATHS[0], path.join(ARCHIVE_DIR, archiveName));
    fs.writeFileSync(ROLLOVER_MARKER, ''); // danh dau: da archive xong, tu day chi con buoc dich chuyen (idempotent)
  }

  // Buoc 2: dich chuyen day chuyen - MOI buoc chi rename neu nguon con ton tai (bo qua neu
  // da lam roi tu lan chay truoc bi ngat giua chung) - lam ca chuoi an toan de chay lai nhieu lan.
  if (fs.existsSync(WEEK_PATHS[1])) fs.renameSync(WEEK_PATHS[1], WEEK_PATHS[0]);
  if (fs.existsSync(WEEK_PATHS[2])) fs.renameSync(WEEK_PATHS[2], WEEK_PATHS[1]);
  if (fs.existsSync(WEEK_PATHS[3])) fs.renameSync(WEEK_PATHS[3], WEEK_PATHS[2]);

  await ensureWeekFile(3, now); // tao trong cho vi tri xa nhat - ensureWeekFile da tu kiem tra exists
  fs.unlinkSync(ROLLOVER_MARKER); // xong toan bo, xoa marker
}
```
*(File marker `scheduler/.rollover-in-progress` (rỗng, chỉ dùng như cờ) — nếu tồn tại lúc hàm bắt đầu chạy nghĩa là lần trước bị ngắt SAU khi đã archive xong nhưng CHƯA xong dịch chuyển, nên bỏ qua bước archive (tránh archive nhầm nội dung đã dịch chuyển 1 phần) và chỉ tiếp tục dịch chuyển. Nếu không tồn tại, coi như bắt đầu mới hoàn toàn. `for i in 0..4 ensureWeekFile(i)` ở đầu đảm bảo cả 4 file luôn tồn tại trước khi rename — phòng trường hợp `upcoming-2`/`upcoming-3` chưa từng được tạo.)*

**Hàm MỚI `clearWeekSlot(weekOffset)` (dùng cho tool `clearSchedule` thủ công — KHÁC với `archiveAndResetWeek`, không dịch chuyển dây chuyền, chỉ archive+làm trống đúng 1 slot):**
```js
async function clearWeekSlot(weekOffset) {
  const now = new Date();
  await ensureWeekFile(weekOffset, now);
  const start = weekStartDate(weekOffset, now);
  const end = new Date(start.getTime() + 6 * 24 * 3600 * 1000);
  // KHONG dung weekRangeLabel() truc tiep lam ten file - chuoi do co 2 dau "/" (vd "17/09-23/09"),
  // .replace('/','-') khong co co g chi thay dau dau tien, con lai 1 dau "/" se bi hieu nham la
  // thu muc con khi fs.renameSync - phai tach rieng tung nua DDMM roi replace nhu ham goc da lam.
  const baseName = `${fmtDDMM(start).replace('/', '-')}_${fmtDDMM(end).replace('/', '-')}`;
  ensureScheduleDirs();
  let archiveName = `${baseName}.xlsx`, n = 2;
  while (fs.existsSync(path.join(ARCHIVE_DIR, archiveName))) { archiveName = `${baseName}_${n}.xlsx`; n++; }
  fs.renameSync(WEEK_PATHS[weekOffset], path.join(ARCHIVE_DIR, archiveName));
  await ensureWeekFile(weekOffset, now);
  return WEEK_PATHS[weekOffset];
}
```
*(`weekRangeLabel()` chỉ dùng để hiển thị cho người đọc trong `describeAction` — không dùng để tạo tên file.)*

**Export:** thêm `resolveWeekSlot` không cần export (nội bộ), export `clearWeekSlot`, `weekRangeLabel`; đổi chữ ký `getWeekPath`/`getWeekText` (thêm tham số); giữ `getTodayDigestText`, `archiveAndResetWeek` như cũ (đúng tên, đổi nội dung).

## Thiết kế chi tiết — `agent.js` (TOOLS)

- `addScheduleItem`: tham số `dayOfWeek` (enum) → `date` (`{ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD, tối đa 3 tuần kể từ hôm nay — tính từ ngày hiện tại trong system instruction' }`).
- `removeScheduleItem`: tương tự, `dayOfWeek` → `date`.
- `clearSchedule`: thêm tham số optional `weekOffset` (`{ type: 'integer', enum: [0,1,2,3], description: '0 = tuần này (mặc định), 1-3 = các tuần kế tiếp' }`). `describeAction` gọi `weekRangeLabel(weekOffset)` để hiện rõ đang xoá đúng tuần nào trong lời xác nhận yes/no.
- `viewSchedule`: thêm tham số optional `weekOffset` (cùng `enum: [0,1,2,3]`, mặc định 0).
- `sendScheduleFile`: thêm tham số optional `weekOffset` (cùng `enum: [0,1,2,3]`, mặc định 0).
- Thêm `enum`/`pattern` vào JSON schema (không chỉ mô tả bằng lời) để Gemini gần như không bao giờ gửi giá trị sai phạm vi ngay từ đầu — đỡ tốn 1 vòng gọi lại API khi lỡ sai (quota hạn hẹp). Lỗi ngày/tuần ngoài phạm vi (nếu vẫn lọt qua) từ `resolveWeekSlot`/`assertValidWeekOffset` (throw Error) tự động được `dispatchTool`'s try/catch hiện có bắt và trả `{error: e.message}` cho Gemini — không cần code catch riêng, đây là lớp phòng thủ thứ 2.

## Thiết kế chi tiết — `bot.js`

Chỉ đổi đúng 2 dòng wiring trong `createAgent({...})`:
```js
clearScheduleWeek: schedule.clearWeekSlot,   // truoc day tro sai vao schedule.archiveAndResetWeek (ham rollover he thong)
getCurrentWeekPath: schedule.getWeekPath,    // doi ten + gio nhan them weekOffset
```
*(Phát hiện quan trọng lúc thiết kế: tool `clearSchedule` trước đây tái dùng NHẦM đúng hàm `archiveAndResetWeek` mà job hệ thống Thứ 2 00:00 cũng dùng — vô hại khi chỉ có 1 file, nhưng nếu không tách ra bây giờ, một lần xoá tay tuần bất kỳ sẽ vô tình kích hoạt luôn cơ chế dịch chuyển dây chuyền 4 file, sai hoàn toàn. Bắt buộc phải tách thành `clearWeekSlot` riêng.)*

`systemActions.archiveAndResetWeek` giữ nguyên gọi `schedule.archiveAndResetWeek()` — không đổi.

## Testing

1. Cô lập `resolveWeekSlot`: ngày trong tuần này (offset 0), đúng biên tuần thứ 3 (offset 3, ngày Chủ nhật cuối cùng còn hợp lệ), ngày tuần thứ 5 (phải throw), ngày tuần trước (phải throw), format sai (phải throw).
2. Cô lập `addItem`/`removeItem` với `date` rơi vào cả 4 slot — xác nhận đúng file, đúng ô, không đụng file khác.
3. Cô lập `archiveAndResetWeek`: giả lập 4 file có nội dung khác nhau, gọi 1 lần, xác nhận dịch chuyển đúng thứ tự + file mới trống đúng vị trí xa nhất + archive đúng file cũ.
4. Cô lập `clearWeekSlot(2)`: xác nhận CHỈ slot 2 bị archive+reset, 3 file còn lại (0,1,3) không đổi.
5. Cô lập crash-resumability: giả lập `archiveAndResetWeek()` bị ngắt giữa chừng (tạo sẵn `ROLLOVER_MARKER` + đưa 4 file về trạng thái "đã archive xong bước 1, chưa dịch chuyển"), gọi hàm lại — xác nhận KHÔNG archive lần 2 (bỏ qua vì marker tồn tại), chỉ tiếp tục dịch chuyển đúng, kết thúc sạch (marker bị xoá, không mất dữ liệu).
6. Cô lập `assertValidWeekOffset`: gọi `ensureWeekFile`/`clearWeekSlot` với `weekOffset` = -1, 4, 1.5, "2" (string) — xác nhận throw rõ ràng thay vì lỗi khó hiểu từ `WEEK_PATHS[undefined]`.
7. Test thật qua Telegram: thêm lịch cho ngày tuần sau → xác nhận đúng file `upcoming-1.xlsx`, không lẫn vào `current.xlsx`. Thử ngày ngoài phạm vi (5 tuần sau) → xác nhận agent báo lỗi rõ ràng thay vì ghi sai.
8. Backup toàn bộ `schedule/` trước khi test trên dữ liệu thật, khôi phục sau khi xong (đúng pattern đã dùng suốt phiên này).

## Rủi ro đã cân nhắc, chấp nhận không sửa

**Race condition giữa `clearWeekSlot()` (thủ công) và `archiveAndResetWeek()` (job hệ thống Thứ 2 00:00):** nếu 2 hàm này chạy chồng lên nhau đúng lúc (chỉ có thể trong cửa sổ ~1-2 giây tại đúng nửa đêm Thứ 2, khi user vừa lúc đó chủ động xoá 1 tuần qua chat), chuỗi rename của cả 2 có thể chen lẫn gây sai lệch. Xác suất cực thấp với bot 1 người dùng — **cố tình không thêm mutex/khoá** để tránh over-engineer cho rủi ro gần như không bao giờ xảy ra trong thực tế. Nếu sau này phát hiện đã xảy ra thật, quay lại thêm khoá đơn giản (in-memory promise chain) lúc đó.

## Việc KHÔNG làm (out of scope, tránh over-engineer)

- Không hỗ trợ N tuần tuỳ ý / lịch cả tháng-quý — đúng theo yêu cầu chỉ 4 tuần.
- Không đổi định dạng lưới Excel hay cách hiển thị — chỉ đổi cách chọn file/ô.
- Không đổi `dailyScheduleDigest`/`weekendPlanningReminder` — không liên quan tới cửa sổ nhiều tuần.
