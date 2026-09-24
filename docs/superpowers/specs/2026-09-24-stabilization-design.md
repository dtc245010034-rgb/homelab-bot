# homelab-bot Stabilization — Design Spec

> Nguồn: audit ngày 2026-09-24 (đọc toàn bộ code, log PM2, cron, trạng thái chạy thật). Mọi mục dưới đây đều có bằng chứng, không phải suy đoán.

## Mục tiêu

Sửa các lỗi đang làm bot chạy sai/không an toàn, thêm unit test cho logic thuần để các lần sửa sau kiểm soát được, và giảm các điểm tốn tài nguyên không cần thiết — **không thêm tính năng mới**.

## Phạm vi

| # | Vấn đề (bằng chứng) | Cách xử lý |
|---|---|---|
| S1 | `.env` trỏ camera `192.168.1.69`, camera thật ở `.68` → `/cam` lỗi | Sửa `.env` (IP cố định qua router: **làm sau**, ngoài phạm vi) |
| S2 | `handleCam` gửi `e.message` của `exec` (chứa `rtsp://user:PASS@…`) vào Telegram; mật khẩu còn nằm trong 3 file log | `lib/redact.js` + `render()` luôn redact; log cũ được scrub; **user tự đổi mật khẩu camera** |
| S3 | `ffmpeg` gọi bằng shell string, không timeout → 1 lần camera treo là cả vòng poll đứng | `lib/camera.js`: `execFile` + mảng tham số + timeout + `-stimeout` + lỗi đã phân loại/che credential |
| S4 | `motion-check` chết im lặng khi camera mất kết nối; clip HEVC copy có thể không phát trên Telegram; chụp 1080p mỗi 60s tốn CPU | `lib/motion.js` (health tracker, parse RMSE), báo Telegram khi down/up, dùng sub-stream 102 để so sánh, clip H.264 |
| S5 | `weekly.js` `require('./bot')` → mỗi thứ Hai 8:00 sinh 1 bot thứ hai chạy mãi (41.405 lỗi 409, 13 MB `weekly.log`, `scheduler` chạy đôi, state xác nhận bị tách) | Chuyển báo cáo tuần thành system action `weeklyReport` của `scheduler.js`; xoá `weekly.js` + dòng cron |
| S6 | `checkAlerts` gửi lại cảnh báo mỗi 5 phút khi điều kiện còn đúng | `lib/alerts.js`: hàm thuần + cooldown 30 phút/khoá |
| S7 | `await` tuần tự trong vòng poll: lệnh chậm chặn mọi lệnh khác | `lib/detach.js`: chạy nền có khoá chống chạy trùng cho `/cam`, `/morning`, `/cleanup`, `/wmap` |
| S8 | `getNews` đưa nội dung web vào Gemini trong khi `setReminder`/`remember`/`addScheduleItem` không cần xác nhận (prompt-injection) | `lib/agent-policy.js`: trong request đã đọc tin từ web, các tool có tác động đều phải xác nhận; ghi rõ trong system prompt |
| S9 | `GEMINI.md` (index bộ nhớ, gửi kèm **mọi** request Gemini) chứa nguyên khối "Karpathy guidelines" 70+ dòng — đã nằm trong commit đầu tiên; file có tên chủ đề cá nhân lại được git track | Làm sạch header, `git rm --cached`, thêm vào `.gitignore`, giữ `GEMINI.template.md`; `clampIndex` giới hạn kích thước gửi đi |
| S10 | Log cron (`morning.log`, `pihole-log.log`, `motion.log`) không xoay vòng | `logrotate` chạy bằng cron của user (không cần sudo) |
| S11 | `CHAT_ID`/token/IP lặp ở 3 file | `config.js` một nguồn + `.env.example`; `CHAT_ID` chuyển sang `.env` |
| S12 | Nhãn "CPU TB/RAM TB" trong báo cáo tuần thực ra là giá trị tức thời | Đổi nhãn thành "lúc này" |

## Ngoài phạm vi (cố ý)

- **Router**: DHCP reservation cho camera/server, trỏ DNS về Pi-hole (user tự làm sau khi xong các giai đoạn). Trong lúc chờ, mục "PI-HOLE 7 NGÀY" của báo cáo tuần vẫn hiển thị số liệu chưa có ý nghĩa — cần quyết định bỏ hay giữ sau khi có DNS.
- **Tách `bot.js` (1089 dòng) thành module**: chỉ làm sau khi có test bao phủ; chưa đáng công lúc này.
- Giám sát chuyển động hiện **TẮT** (`.motion-state` không tồn tại) — user tự bật sau, không tự bật.

## Quyết định của user (2026-09-24)

- `dailyScheduleDigest` chuyển từ 00:01 sang **06:30**. Vì `scheduler.start()` cũ chỉ "thêm nếu thiếu", job đã có trong `jobs.json` sẽ không đổi giờ → thêm `reconcileSeeds` (hàm thuần, có test) để cập nhật lịch của seed đã tồn tại.
- Mật khẩu camera: user tự đổi sau; không nhắc lại.
- Thực thi inline (không subagent).
- MAC/IP LAN hardcode trong `bot.js` — độ nhạy cảm thấp, để dành khi open-source repo.
- Quota Gemini free tier (~20 req/ngày/model) — theo dõi, không đổi kiến trúc.

## Kiến trúc & quyết định

- **Test runner**: `node:test` có sẵn trong Node 20 (`node --test test/`) — **không thêm dependency**.
- **Nguyên tắc tách**: logic thuần (parse, quyết định, chính sách) đặt trong `lib/*.js` với dependency được tiêm (`exec`, `now`) để test không cần ffmpeg/mạng/đồng hồ thật. Phần dính I/O (`bot.js`, `motion-check.js`) chỉ còn "keo dán" mỏng.
- **Không guard `require.main` trong `bot.js`**: gốc lỗi là `weekly.js` import `bot.js`; loại bỏ bên import an toàn hơn là phụ thuộc hành vi `require.main` dưới PM2.
- **Đổi nhánh, không worktree**: `.env`, `node_modules`, dữ liệu runtime đều untracked trong thư mục chính nên worktree sẽ thiếu chúng. Làm trên nhánh `stabilize/2026-09-24`, chưa merge/push khi chưa được duyệt.
- **Camera**: so sánh chuyển động trên sub-stream (`/Streaming/Channels/102`, đã kiểm chứng hoạt động: HEVC 768×432); ghi clip và `/cam` dùng main-stream (101). Có thể ghi đè bằng `CAM_MOTION_RTSP_URL`.

## Tiêu chí hoàn thành

1. `npm test` xanh (tất cả test mới).
2. Gọi `captureSnapshot` thật vào camera `.68` thành công; gọi vào IP sai cho ra thông báo sạch, **không chứa mật khẩu**.
3. Sau restart PM2: `dog-bot` gửi tin khởi động, **không** có lỗi 409 mới, không có tiến trình `weekly.js`.
4. `grep` mật khẩu camera trong `~/.pm2/logs` → 0 kết quả.
5. Cron không còn dòng `weekly.js`; có dòng `logrotate`; `scheduler/jobs.json` có job `weeklyReport`.
