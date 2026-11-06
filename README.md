# homelab-bot

Bot Telegram để **giám sát và điều khiển máy chủ homelab Linux** từ điện thoại, kèm một **trợ lý AI (Gemini)** biết đọc tin, quản lý lịch tuần, đặt nhắc việc và tự làm báo cáo Word.

> English summary: a self-hosted Telegram bot for Linux homelabs (system status, Pi-hole, Wake-on-LAN, camera motion alerts, weather radar) with a Gemini-powered agent (weekly schedule, reminders, scheduled AI news digests, Word reports). Vietnamese UI. Node.js 20+, MIT license.

## Tính năng

| Nhóm | Làm được gì |
|---|---|
| **Giám sát máy chủ** | `/status` CPU/RAM/ổ đĩa, `/top` tiến trình nặng, `/temp` nhiệt độ, `/services` trạng thái pm2, `/ts` Tailscale, `/netscan` thiết bị trong LAN, `/ip` IP công cộng. Tự cảnh báo khi CPU/RAM/ổ đĩa > 85% hoặc nhiệt độ > 78°C |
| **Pi-hole** | `/pihole` xem thống kê, `on` / `off [phút]` bật tắt chặn quảng cáo, tổng kết tuần |
| **Máy tính chính** | `/ping` kiểm tra bật/tắt, `/wol` bật máy bằng Wake-on-LAN |
| **Camera Hikvision** | `/cam` chụp ảnh, `/motion on|off` cảnh báo chuyển động kèm ảnh và clip 10 giây |
| **Thời tiết** | `/morning` báo cáo ngày (thời tiết, tin tức, giá ETF), `/wmap` bản đồ radar mưa |
| **Agent AI** | `/agent <câu hỏi>`: tìm tin, đọc link, ghi nhớ dài hạn, quản lý lịch tuần, nhắc việc, làm file Word, đặt nhiệm vụ tự động hằng ngày |
| **Bảo trì** | `/cleanup` dọn rác, `/reboot` khởi động lại (có xác nhận) |

Gõ `/help` trong Telegram để mở bảng điều khiển có nút bấm.

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
Vào https://aistudio.google.com/apikey, tạo key miễn phí. Gói miễn phí giới hạn khoảng **20 yêu cầu mỗi ngày cho mỗi model** (reset khoảng 14:00 giờ Việt Nam). Bot tự chuyển sang model dự phòng khi một model hết quota. Gõ `/agent quota` để xem đã dùng bao nhiêu.

### 4. OpenWeatherMap key (tuỳ chọn, cho thời tiết)
Đăng ký tại https://openweathermap.org/api, dùng gói miễn phí. Key mới có thể mất vài giờ mới kích hoạt.

## Cấu hình (`.env`)

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
| `KNOWN_DEVICES` | không | Đặt tên cho thiết bị khi `/netscan`, ví dụ `192.168.1.1=Router;192.168.1.5=NAS` |
| `CAM_RTSP_URL` | không | Camera Hikvision, ví dụ `rtsp://USER:PASS@192.168.1.10:554/Streaming/Channels/101` |
| `CAM_MOTION_RTSP_URL` | không | Luồng phụ để dò chuyển động, bỏ trống = tự dùng kênh `102` |
| `MOTION_CLIP_TRANSCODE` | không | `1` (mặc định) mã hoá clip H.264 để Telegram phát được |

Pi-hole: đặt mật khẩu web của Pi-hole vào file `.pihole-secret` (một dòng, `chmod 600 .pihole-secret`). File này đã nằm trong `.gitignore`.

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

Bot tự lên lịch các việc sau (sửa giờ trong `scheduler.js`, mục `SYSTEM_SEEDS`):

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
| `/agent` báo hết quota | Gói miễn phí Gemini hết lượt, thử lại sau 14:00 giờ Việt Nam hoặc đổi `GEMINI_MODEL` |
| `/agent` báo giới hạn tốc độ | Gửi quá nhanh, đợi vài giây |
| `/cam` hoặc `/wmap` lỗi | Chưa cài `ffmpeg` hoặc `imagemagick` |
| `/ping`, `/wol` báo chưa cấu hình | Điền `MAIN_PC_IP`, `MAIN_PC_MAC` trong `.env` |
| `/temp` trống | Chạy `sudo sensors-detect` rồi cài `lm-sensors` |
| Một nguồn tin RSS lỗi | Bình thường, bot tự bỏ qua nguồn đó và ghi chú |
| Đổi `.env` mà không có tác dụng | `pm2 restart homelab-bot` |

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
