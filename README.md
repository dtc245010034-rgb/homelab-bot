# homelab-bot

Bot Telegram để **giám sát và điều khiển máy chủ homelab Linux** từ điện thoại, kèm một **trợ lý AI (Gemini)** biết đọc tin, quản lý lịch tuần, đặt nhắc việc và tự làm báo cáo Word.

> English summary: a self-hosted Telegram bot for Linux homelabs (system status, Pi-hole, Wake-on-LAN, camera motion alerts, weather radar) with a Gemini-powered agent (weekly schedule, reminders, scheduled AI news digests, Word reports). Vietnamese UI. Node.js 20+, MIT license. Highlight: automatic Gemini model rotation, so the free-tier daily quota of one model never stops the agent.

## Tính năng

| Nhóm | Làm được gì |
|---|---|
| **Giám sát máy chủ** | `/status` CPU/RAM/ổ đĩa, `/top` tiến trình nặng, `/temp` nhiệt độ, `/services` trạng thái pm2, `/ts` Tailscale, `/netscan` thiết bị trong LAN, `/ip` IP công cộng. Tự cảnh báo khi CPU/RAM/ổ đĩa > 85% hoặc nhiệt độ > 78°C |
| **Pi-hole** | `/pihole` xem thống kê, `on` / `off [phút]` bật tắt chặn quảng cáo, tổng kết tuần |
| **Máy tính chính** | `/ping` kiểm tra bật/tắt, `/wol` bật máy bằng Wake-on-LAN |
| **Camera Hikvision** | `/cam` chụp ảnh, `/motion on|off` cảnh báo chuyển động kèm ảnh và clip 10 giây |
| **Thời tiết** | `/morning` báo cáo ngày (thời tiết, tin tức, giá ETF), `/wmap` bản đồ radar mưa |
| **Agent AI** | **tự xoay ca 4 model Gemini khi hết quota**. `/agent <câu hỏi>`: tìm tin, đọc link, ghi nhớ dài hạn, quản lý lịch tuần, nhắc việc, làm file Word, đặt nhiệm vụ tự động hằng ngày |
| **Bảo trì** | `/cleanup` dọn rác, `/reboot` khởi động lại (có xác nhận) |

Gõ `/help` trong Telegram để mở bảng điều khiển có nút bấm.

## Điểm nổi bật: xoay ca model Gemini

Gói Gemini miễn phí chỉ cho khoảng **20 yêu cầu mỗi ngày cho mỗi model**, và Google tính hạn mức **riêng từng model**. Thay vì dừng khi một model hết lượt, bot **tự động xoay ca** sang model kế tiếp, nên agent gần như luôn trả lời được: bốn model cộng lại cho khoảng 80 yêu cầu mỗi ngày mà bạn không phải làm gì.

```text
gemini-3.6-flash  ──(hết quota)──►  gemini-3.5-flash  ──►  gemini-3-flash-preview  ──►  gemini-3.1-flash-lite
  (ưu tiên, đổi bằng GEMINI_MODEL)
```

Cách hoạt động:

- **Chỉ xoay khi Google báo hết hạn mức ngày thật** (lỗi 429 loại `PerDay`). Bot ghi lại con số hạn mức Google trả về, đánh dấu model đó "hết quota hôm nay" và chuyển sang model kế tiếp còn lượt. Cuộc hội thoại đang dở vẫn tiếp tục bình thường vì lịch sử nằm ở bot, không nằm ở model.
- **Lỗi tạm thời không làm mất model.** Giới hạn theo phút thì đợi 7 giây rồi thử lại. Lỗi mạng hoặc lỗi 5xx thì thử lại sau 1,5 giây. Vẫn lỗi mới chuyển sang model khác.
- **Lỗi khác không bị xoay** (ví dụ sai định dạng yêu cầu), vì đổi model cũng không giúp gì mà chỉ đốt thêm lượt.
- **Tự đếm và tự làm mới theo ngày của Google.** Bộ đếm lưu ở `agent-workspace/logs/quota-counter.json` và đặt lại khi sang ngày theo giờ Mỹ (Pacific), tức khoảng 14:00 đến 15:00 giờ Việt Nam tuỳ mùa. Sau mốc đó model ưu tiên được dùng lại.
- **Nhìn và chọn tay:** gõ `/agent quota` hoặc bấm nút **Model Gemini** trong `/help` để xem mỗi model đã dùng bao nhiêu, model nào đang chạy (⬅️), model nào đã hết, và bấm tên model để ép bot dùng model đó. Con số không có dấu `~` là Google báo thật, còn lại là bot tự đếm ước tính.
- Nhiệm vụ định kỳ (như bản tin AI mỗi sáng) cũng dùng chung cơ chế này.

Danh sách model nằm ở `MODEL_CANDIDATES` trong `agent.js`. Khi Google đổi hoặc gỡ model, chỉ cần sửa danh sách đó.

## Yêu cầu

- Máy Linux chạy liên tục (Debian, Ubuntu, Raspberry Pi OS đều được). Mình chỉ kiểm tra trên Ubuntu.
- **Node.js 20.4 trở lên** (kiểm tra bằng `node -v`).
- Một tài khoản Telegram.
- Tuỳ tính năng bạn dùng, cài thêm công cụ:

| Công cụ | Dùng cho | Cài |
|---|---|---|
| `ffmpeg` | `/cam`, cảnh báo chuyển động | `sudo apt install ffmpeg` |
| `imagemagick` | `/wmap`, so sánh ảnh chuyển động | `sudo apt install imagemagick` |
| `lm-sensors` | `/temp` | `sudo apt install lm-sensors` |
| `iproute2` | `/netscan` | thường có sẵn |
| `pm2` | `/services`, chạy nền | `sudo npm install -g pm2` |
| Tailscale, Pi-hole | `/ts`, `/pihole` | tuỳ chọn, chỉ khi bạn dùng |

Thiếu công cụ nào thì chỉ lệnh tương ứng báo lỗi, phần còn lại vẫn chạy.

## Cài đặt nhanh

```bash
git clone https://github.com/dtc245010034-rgb/homelab-bot.git
cd homelab-bot
./install.sh
```

Script sẽ kiểm tra Node, cài thư viện, rồi hỏi từng bước để tạo file `.env` (token, chat id, key Gemini...). Xong chạy thử:

```bash
npm start
```

Nhắn `/help` cho bot. Nếu bot trả lời, bạn đã xong. Để bot chạy nền và tự bật lại sau khi khởi động máy, xem mục [Chạy nền](#chạy-nền-lâu-dài).

Muốn cài thủ công: `npm install --omit=dev`, `cp .env.example .env`, điền các giá trị rồi `chmod 600 .env`.

## Lấy các khoá cần thiết

### 1. Telegram bot token (bắt buộc)
1. Mở Telegram, tìm **@BotFather**, gõ `/newbot`.
2. Đặt tên và username (kết thúc bằng `bot`).
3. BotFather trả về token dạng `123456789:AAH...`. Giữ kín token này.

### 2. Chat ID (bắt buộc)
Bot **chỉ nghe lệnh từ đúng chat ID này**, người khác nhắn bot sẽ bị bỏ qua.
- Cách dễ nhất: nhắn một tin bất kỳ cho bot của bạn rồi chạy `npm run setup`, trình cài đặt tự dò ra.
- Hoặc nhắn **@userinfobot** để biết ID của bạn.

### 3. Gemini API key (tuỳ chọn, cho agent AI)
Vào https://aistudio.google.com/apikey, tạo key miễn phí. Gói miễn phí giới hạn khoảng **20 yêu cầu mỗi ngày cho mỗi model** (reset khoảng 14:00 đến 15:00 giờ Việt Nam). Bot tự [xoay ca sang model dự phòng](#điểm-nổi-bật-xoay-ca-model-gemini) khi một model hết quota. Gõ `/agent quota` để xem đã dùng bao nhiêu.

### 4. OpenWeatherMap key (tuỳ chọn, cho thời tiết)
Đăng ký tại https://openweathermap.org/api, dùng gói miễn phí. Key mới có thể mất vài giờ mới kích hoạt.

## Cấu hình (`.env`)

Chỉ có 2 biến bắt buộc, còn lại bot chạy được với mặc định. Mọi tuỳ chọn đều nằm trong [`.env.example`](.env.example), có chú thích từng dòng. Dòng nào bắt đầu bằng `#KEY=giá_trị` là tuỳ chọn và **giá trị ghi sẵn chính là mặc định**: bỏ dấu `#` rồi sửa là đổi được. Trình cài đặt (`npm run setup`) tự chép sẵn phần này vào `.env` của bạn.

Quy tắc chung: bỏ trống hoặc xoá dòng thì dùng mặc định; giá trị sai (chữ thay vì số, ngoài khoảng cho phép, múi giờ không tồn tại) cũng tự về mặc định, bot không chết vì gõ nhầm. Sửa `.env` xong cần `pm2 restart homelab-bot`.

### Cơ bản

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

### Tuỳ biến nâng cao

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
| Agent: model | `GEMINI_FALLBACK_MODELS` (`gemini-3.5-flash,gemini-3-flash-preview,gemini-3.1-flash-lite`) | Chuỗi [xoay ca model](#điểm-nổi-bật-xoay-ca-model-gemini) sau `GEMINI_MODEL`. Sửa để thêm model mới hoặc đổi thứ tự |
| | `AGENT_DAILY_LIMIT_DISPLAY` (`20`) | Hạn mức/ngày hiển thị trong `/agent quota` cho model chưa từng bị 429 (chỉ để hiển thị) |
| Agent: giới hạn | `AGENT_MAX_TOOL_LOOPS` (`8`), `AGENT_MAX_UNATTENDED_LOOPS` (`12`), `AGENT_UNATTENDED_TIMEOUT_MIN` (`5`) | Số lượt gọi công cụ tối đa mỗi câu hỏi; mỗi tác vụ hẹn giờ; thời gian tối đa của tác vụ hẹn giờ |
| | `AGENT_REQUEST_TIMEOUT_SEC` (`90`), `AGENT_CONFIRM_TIMEOUT_SEC` (`120`) | Chờ Gemini trả lời; chờ bạn bấm Đồng ý/Huỷ |
| | `AGENT_SESSION_IDLE_HOURS` (`48`), `AGENT_HISTORY_TURNS` (`15`), `AGENT_KEEP_REPORTS` (`30`) | Nghỉ bao lâu thì cắt phiên trò chuyện; số lượt gần nhất gửi kèm mỗi lần gọi; số báo cáo Word giữ lại |
| Bản đồ `/wmap` | `WMAP_WATERMARK` (`homelab-bot`), `WMAP_LOCAL_ZOOM` (`9`), `WMAP_LOCAL_RADIUS` (`1`) | Chữ in ở góc ảnh; độ zoom và độ rộng bản đồ khu vực |
| Telegram | `TELEGRAM_API_BASE` (`https://api.telegram.org`) | Đổi khi dùng proxy hoặc máy chủ Bot API cục bộ |

Không có trong `.env`: giờ chạy `morning.js` và `pihole-log.js` do `cron` quyết định (xem `scripts/crontab.example`), còn giờ "reset tuần" (thứ Hai 00:00) cố định vì gắn với lịch tuần.

## Dùng agent AI

Gõ `/agent` kèm câu hỏi bằng tiếng Việt tự nhiên:

```text
/agent thêm vào lịch thứ 4 chiều 14h họp nhóm
/agent xem lịch tuần này
/agent nhắc tôi 8h tối nay uống thuốc
/agent nhắc tôi thứ 6 hàng tuần đổ rác
/agent có tin gì mới về AI không
/agent làm báo cáo Word về 5 tin AI nổi bật, có link nguồn
/agent mỗi ngày 10h sáng tìm tin AI, tóm tắt và gửi cho tôi
```

Gửi **kèm ảnh** thời khoá biểu với caption `/agent ...` để agent đọc ảnh và thêm lịch.

Các lệnh khác: `/agent quota` xem quota Gemini, `/new` bắt đầu cuộc hội thoại mới.

**Hai loại việc hẹn giờ**
- **Nhắc việc**: đến giờ chỉ gửi đúng đoạn chữ bạn đặt và ghim lại. Không chạy AI.
- **Nhiệm vụ định kỳ**: đến giờ agent tự tìm tin, đọc bài, tóm tắt rồi gửi kết quả. Mỗi lần chạy tốn vài đến chục yêu cầu Gemini nên hãy đặt ít thôi.

**An toàn của agent**
- Mọi thao tác thay đổi dữ liệu (xoá lịch, đặt nhắc, ghi nhớ...) đều hiện nút **Xác nhận / Huỷ** trước khi thực hiện.
- Sau khi đọc nội dung web, agent bị buộc xác nhận trước mọi thao tác có tác động, để trang web độc hại không điều khiển được bot.
- Công cụ đọc web chặn địa chỉ nội bộ (LAN, localhost), nên không bị lợi dụng để truy cập router hay camera của bạn.
- Nhiệm vụ chạy tự động chỉ được dùng một danh sách công cụ đọc-và-báo-cáo, không thể xoá hay sửa gì, không đọc được bộ nhớ cá nhân, và chỉ được mở những link xuất hiện trong kết quả tin tức/tìm kiếm của chính lần chạy đó (chống trang web độc hại bắt bot gửi dữ liệu ra ngoài qua URL).
- Trong hội thoại, nếu agent muốn mở một link lạ sau khi đã đọc nội dung web, bot hỏi xác nhận trước.
- Agent không chạy được lệnh hệ thống tự do.

**Bộ nhớ dài hạn** nằm ở `agent-workspace/memory/` (file Markdown, bạn đọc và sửa được). Thư mục này và lịch sử hội thoại **không** được đưa lên git.

## Tác vụ định kỳ có sẵn

Bot tự lên lịch các việc sau. Đổi giờ hoặc tắt bằng `SCHEDULE_DAILY_DIGEST`, `SCHEDULE_WEEKEND_REMINDER`, `SCHEDULE_WEEKLY_REPORT` trong `.env` (ví dụ `SCHEDULE_WEEKLY_REPORT=sun 20:00`, hoặc `off`), rồi `pm2 restart homelab-bot`:

| Giờ | Việc |
|---|---|
| Thứ Hai 00:00 | Lưu trữ và làm mới lịch tuần |
| Hằng ngày 06:30 | Tóm tắt lịch hôm nay |
| Thứ Bảy 07:30 | Nhắc lên kế hoạch cuối tuần |
| Thứ Hai 08:00 | Tổng kết tuần |

Báo cáo ngày (`morning.js`) và ảnh chụp thống kê Pi-hole (`pihole-log.js`) chạy bằng cron. Dùng file mẫu:

```bash
cp scripts/crontab.example /tmp/homelab.cron
sed -i "s#__DIR__#$(pwd)#g" /tmp/homelab.cron
crontab -l 2>/dev/null | cat - /tmp/homelab.cron | crontab -
```

## Chạy nền lâu dài

Dùng pm2 (khuyên dùng):

```bash
sudo npm install -g pm2
./install.sh --pm2        # hoặc: pm2 start ecosystem.config.js
pm2 save
pm2 startup               # chạy lệnh sudo mà nó in ra để tự bật lại khi khởi động máy
```

Xem log: `pm2 logs homelab-bot`. Dừng: `pm2 stop homelab-bot`. Nếu bạn có camera, `ecosystem.config.js` tự chạy thêm tiến trình `motion-check`.

## Cập nhật

```bash
cd homelab-bot
git pull
npm install --omit=dev
pm2 restart all
```

File `.env`, lịch tuần, bộ nhớ agent và lịch sử đều là dữ liệu cục bộ, `git pull` không đụng tới.

## Bảo mật

- `.env` chứa token và key: để quyền `600`, **không bao giờ commit hay gửi cho ai**. Trình cài đặt tự đặt quyền này.
- Bot chỉ phục vụ đúng `ALLOWED_CHAT_ID`. Nếu nghi token bị lộ, vào @BotFather gõ `/revoke` rồi cập nhật `.env`.
- `/reboot` và `/pihole` dùng `sudo`. Nếu bot không chạy bằng root, cấp quyền không cần mật khẩu cho đúng các lệnh đó bằng `sudo visudo -f /etc/sudoers.d/homelab-bot`, ví dụ:
  `youruser ALL=(root) NOPASSWD: /sbin/reboot, /usr/bin/pihole`
- Thông tin đăng nhập camera trong URL RTSP được che khỏi log và tin nhắn lỗi.
- Đừng mở cổng nào ra Internet cho bot: bot chỉ gọi ra ngoài (long-polling), không cần cổng vào.

## Xử lý sự cố

| Triệu chứng | Cách xử lý |
|---|---|
| Bot không trả lời | Kiểm tra `pm2 logs homelab-bot`. Đúng `ALLOWED_CHAT_ID` chưa? Token còn hiệu lực không? |
| `Thiếu biến môi trường bắt buộc` | Thiếu `TELEGRAM_BOT_TOKEN` hoặc `ALLOWED_CHAT_ID` trong `.env` |
| `/agent` báo hết quota | Cả bốn model đều hết lượt ngày, thử lại sau khoảng 14:00 đến 15:00 giờ Việt Nam. Xem `/agent quota` |
| `/agent` báo giới hạn tốc độ | Gửi quá nhanh, đợi vài giây |
| `/cam` hoặc `/wmap` lỗi | Chưa cài `ffmpeg` hoặc `imagemagick` |
| `/ping`, `/wol` báo chưa cấu hình | Điền `MAIN_PC_IP`, `MAIN_PC_MAC` trong `.env` |
| `/temp` trống | Chạy `sudo sensors-detect` rồi cài `lm-sensors` |
| Một nguồn tin RSS lỗi | Bình thường, bot tự bỏ qua nguồn đó và ghi chú |
| Đổi `.env` mà không có tác dụng | `pm2 restart homelab-bot` |
| Giờ trong tin nhắn hoặc giờ hẹn bị lệch | Đặt `TIMEZONE` đúng múi giờ của bạn (ví dụ `Asia/Bangkok`) rồi `pm2 restart homelab-bot` |

## Cấu trúc thư mục

```text
bot.js            vòng lặp Telegram và các lệnh
agent.js          agent Gemini, công cụ, nhiệm vụ tự động
scheduler.js      lịch nhắc việc và tác vụ định kỳ
schedule.js       lịch tuần (file Excel trong schedule/)
morning.js        báo cáo ngày (chạy bằng cron)
motion-check.js   dò chuyển động camera (tiến trình riêng)
wmap.js           bản đồ radar mưa
lib/              RSS, đọc web an toàn, báo cáo Word, chuyển đổi định dạng Telegram...
scripts/setup.js  trình cài đặt cấu hình
test/             bộ kiểm thử
```

## Phát triển

```bash
npm install
npm test        # chạy toàn bộ kiểm thử (node --test)
```

Đóng góp được chào đón: mở issue hoặc pull request.

## Giấy phép

[MIT](LICENSE)
