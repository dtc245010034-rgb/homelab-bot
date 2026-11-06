# Cấu hình chi tiết (`.env`)

Chỉ có 2 biến bắt buộc, còn lại bot chạy được với mặc định. Mọi tuỳ chọn đều nằm trong [`.env.example`](../.env.example), có chú thích từng dòng.

- Dòng bắt đầu bằng `#KEY=giá_trị` là tuỳ chọn và **giá trị ghi sẵn chính là mặc định**: bỏ dấu `#` rồi sửa là đổi được. `npm run setup` tự chép sẵn phần này vào `.env` của bạn.
- Bỏ trống hoặc xoá dòng thì dùng mặc định. Giá trị sai (chữ thay vì số, ngoài khoảng cho phép, múi giờ không tồn tại) cũng tự về mặc định, bot không chết vì gõ nhầm.
- Sửa `.env` xong cần `pm2 restart homelab-bot`.

## Cơ bản

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | có | Token từ BotFather |
| `ALLOWED_CHAT_ID` | có | Chat ID được phép điều khiển |
| `GEMINI_API_KEY` | không | Bật agent AI |
| `GEMINI_MODEL` | không | Model ưu tiên, mặc định `gemini-3.6-flash` |
| `OWM_API_KEY` | không | Thời tiết, radar mưa, bản tin sáng |
| `LOCATION_NAME`, `LOCATION_LAT`, `LOCATION_LON` | không | Khu vực của bạn cho thời tiết (mặc định Hà Nội) |
| `HOST_NAME` | không | Tên hiển thị của máy chủ (mặc định hostname thật) |
| `MAIN_PC_IP`, `MAIN_PC_MAC` | không | Bật `/ping` và `/wol` cho máy tính chính |
| `WOL_BROADCAST` | không | Mặc định suy ra `x.x.x.255` từ `MAIN_PC_IP` |
| `KNOWN_DEVICES` | không | Đặt tên thiết bị khi `/netscan`, ví dụ `192.168.1.1=Router;192.168.1.5=NAS` |
| `CAM_RTSP_URL` | không | Camera Hikvision, ví dụ `rtsp://USER:PASS@192.168.1.10:554/Streaming/Channels/101` |
| `CAM_MOTION_RTSP_URL` | không | Luồng phụ để dò chuyển động, bỏ trống = tự dùng kênh `102` |
| `PIHOLE_PASSWORD` | không | Mật khẩu web Pi-hole. Bỏ trống = đọc từ file `.pihole-secret` (một dòng, `chmod 600`) |


## Tuỳ biến nâng cao

| Nhóm | Biến (mặc định) | Tác dụng |
|---|---|---|
| Múi giờ, ngôn ngữ | `TIMEZONE` (`Asia/Ho_Chi_Minh`), `LOCALE` (`vi-VN`) | Giờ hiển thị, lịch hẹn giờ và định dạng ngày/số theo đây. Ví dụ `Europe/Paris`, `en-US` |
| Cảnh báo tài nguyên | `ALERTS_ENABLED` (`1`), `ALERT_CPU_PCT` (`85`), `ALERT_RAM_PCT` (`85`), `ALERT_DISK_PCT` (`85`), `ALERT_TEMP_C` (`78`) | Ngưỡng gửi cảnh báo. `ALERTS_ENABLED=0` tắt hẳn |
| | `ALERT_COOLDOWN_MIN` (`30`), `ALERT_CHECK_INTERVAL_MIN` (`5`) | Mỗi loại cảnh báo tối đa một lần trong khoảng này; tần suất kiểm tra |
| | `DISK_MOUNT` (`/`), `STATUS_WARN_PCT` (`75`), `STATUS_CRIT_PCT` (`85`) | Ổ cứng cần theo dõi; ngưỡng nhãn `[CẢNH BÁO]` và `[NGUY HIỂM]` trong `/status` |
| Pi-hole | `PIHOLE_URL` (`http://localhost`) | Địa chỉ Pi-hole, ví dụ `http://192.168.1.2:8080` |
| Giờ chạy tác vụ hệ thống | `SCHEDULE_DAILY_DIGEST` (`06:30`), `SCHEDULE_WEEKEND_REMINDER` (`sat 07:30`), `SCHEDULE_WEEKLY_REPORT` (`mon 08:00`) | Dạng `HH:MM` hoặc `thứ HH:MM` (`mon`..`sun`, `t2`..`t7`, `cn`). `off` để tắt |
| Bản tin sáng | `MORNING_SECTIONS` (`stocks,weather,news,map`), `MORNING_SYMBOLS` (`E1VFVN30.VN`) | Chọn các mục có trong bản tin; mã chứng khoán/ETF theo Yahoo Finance, cách nhau bằng dấu phẩy |
| | `MORNING_MAP_PRESET` (`vn`), `MORNING_MAP_LAYER` (`rain`) | Bản đồ đính kèm: `vn` hoặc `tn` (khu vực của bạn); lớp `rain`, `clouds`, `wind`, `temp` |
| Nguồn tin RSS | `NEWS_FEEDS`, `AI_NEWS_FEEDS` | Thay hẳn danh sách mặc định. Dạng `Tên\|url\|số_tin;Tên 2\|url 2\|số_tin` |
| Camera | `MOTION_THRESHOLD` (`6000`), `MOTION_COOLDOWN_MIN` (`5`), `MOTION_INTERVAL_SEC` (`60`) | Độ nhạy (số nhỏ = nhạy hơn), thời gian nghỉ sau cảnh báo, chu kỳ so sánh |
| | `MOTION_CLIP_SECONDS` (`10`), `MOTION_FAIL_THRESHOLD` (`3`), `MOTION_CLIP_TRANSCODE` (`1`) | Độ dài clip; số lần camera lỗi liên tiếp mới báo mất kết nối; mã hoá H.264 |
| Agent: model | `GEMINI_FALLBACK_MODELS` (`gemini-3.5-flash,gemini-3-flash-preview,gemini-3.1-flash-lite`) | Chuỗi [xoay ca model](AGENT.md#xoay-ca-model-gemini) sau `GEMINI_MODEL`. Sửa để thêm model mới hoặc đổi thứ tự |
| | `AGENT_DAILY_LIMIT_DISPLAY` (`20`) | Hạn mức/ngày hiển thị trong `/agent quota` cho model chưa từng bị 429 (chỉ để hiển thị) |
| | `AGENT_BACKGROUND_MODEL` (`gemini-3.1-flash-lite`) | Model nhẹ thử trước cho nhiệm vụ hẹn giờ và tóm tắt phiên. Phải nằm trong chuỗi model ở trên; `off` để tắt |
| | `AGENT_SUMMARIZE` (`1`), `AGENT_SUMMARY_MIN_TURNS` (`3`) | Tóm tắt phiên khi lưu trữ; chỉ tóm tắt phiên có ít nhất số câu hỏi này |
| Agent: giới hạn | `AGENT_MAX_TOOL_LOOPS` (`8`), `AGENT_MAX_UNATTENDED_LOOPS` (`12`), `AGENT_UNATTENDED_TIMEOUT_MIN` (`5`) | Số lượt gọi công cụ tối đa mỗi câu hỏi; mỗi tác vụ hẹn giờ; thời gian tối đa của tác vụ hẹn giờ |
| | `AGENT_REQUEST_TIMEOUT_SEC` (`90`), `AGENT_CONFIRM_TIMEOUT_SEC` (`120`) | Chờ Gemini trả lời; chờ bạn bấm Đồng ý/Huỷ |
| | `AGENT_SESSION_IDLE_HOURS` (`48`), `AGENT_HISTORY_TURNS` (`15`), `AGENT_KEEP_REPORTS` (`30`) | Nghỉ bao lâu thì cắt phiên trò chuyện; số lượt gần nhất gửi kèm mỗi lần gọi; số báo cáo Word giữ lại |
| Bản đồ `/wmap` | `WMAP_WATERMARK` (`homelab-bot`), `WMAP_LOCAL_ZOOM` (`9`), `WMAP_LOCAL_RADIUS` (`1`) | Chữ in ở góc ảnh; độ zoom và độ rộng bản đồ khu vực |
| Telegram | `TELEGRAM_API_BASE` (`https://api.telegram.org`) | Đổi khi dùng proxy hoặc máy chủ Bot API cục bộ |

Không có trong `.env`: giờ chạy `morning.js` và `pihole-log.js` do `cron` quyết định (xem `scripts/crontab.example`), còn giờ "reset tuần" (thứ Hai 00:00) cố định vì gắn với lịch tuần.
