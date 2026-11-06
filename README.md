# homelab-bot

Bot Telegram để **giám sát và điều khiển máy chủ homelab Linux** từ điện thoại, kèm một **trợ lý AI (Gemini)** biết đọc tin, quản lý lịch tuần, đặt nhắc việc và tự làm báo cáo Word. Chạy hoàn toàn trên gói Gemini **miễn phí**.

> English: a self-hosted Telegram bot for Linux homelabs (system status, Pi-hole, Wake-on-LAN, camera motion alerts, weather radar) with a Gemini-powered agent (weekly schedule, reminders, scheduled AI news digests, Word reports). Built for the Gemini free tier: automatic model rotation, cheap background jobs, local history search. Vietnamese UI, Node.js 20+, MIT.

## Tính năng

| Nhóm | Làm được gì |
|---|---|
| **Giám sát máy chủ** | `/status` CPU/RAM/ổ đĩa, `/top`, `/temp`, `/services` (pm2), `/ts` (Tailscale), `/netscan` thiết bị trong LAN, `/ip`. Tự cảnh báo khi CPU/RAM/ổ đĩa quá ngưỡng |
| **Pi-hole** | `/pihole` xem thống kê, bật/tắt chặn quảng cáo, tổng kết tuần |
| **Máy tính chính** | `/ping` kiểm tra bật/tắt, `/wol` bật máy bằng Wake-on-LAN |
| **Camera Hikvision** | `/cam` chụp ảnh, `/motion on\|off` cảnh báo chuyển động kèm ảnh và clip |
| **Thời tiết** | `/morning` bản tin sáng (thời tiết, tin, giá ETF), `/wmap` radar mưa |
| **Agent AI** | `/agent <câu hỏi>`: tìm tin, đọc link, ghi nhớ, quản lý lịch tuần, nhắc việc, làm file Word, đặt nhiệm vụ tự động hằng ngày |
| **Bảo trì** | `/cleanup` dọn rác, `/reboot` khởi động lại (có xác nhận) |

Gõ `/help` trong Telegram để mở bảng điều khiển có nút bấm.

## Điểm nổi bật: sống khoẻ với Gemini miễn phí

Gói miễn phí chỉ cho khoảng **20 lượt gọi mỗi ngày cho mỗi model**. Bot được thiết kế quanh giới hạn đó:

- **Tự xoay ca 4 model** khi một model hết quota ngày, nên agent gần như luôn trả lời được (khoảng 80 lượt/ngày cộng lại).
- **Việc nền dùng model nhẹ trước**: nhiệm vụ hẹn giờ và tóm tắt phiên không ăn vào quota model chính.
- **Gộp bước**: công cụ `getBriefing` lấy thời tiết, tin, lịch, nhắc việc trong một lượt; lịch sử gửi lên được rút gọn.
- **Nhớ lại không tốn quota**: "hôm kia mình hỏi gì về router?" được tìm bằng file trên máy.
- **Nhìn thấy quota**: `/agent quota` cho biết mỗi model đã dùng bao nhiêu và lượt gọi đổ vào hỏi đáp hay việc hẹn giờ.

Chi tiết: [docs/AGENT.md](docs/AGENT.md).

## Cài đặt

Cần: máy Linux chạy liên tục (Debian, Ubuntu, Raspberry Pi OS), **Node.js 20.4+** (`node -v`) và một tài khoản Telegram.

```bash
git clone https://github.com/dtc245010034-rgb/homelab-bot.git
cd homelab-bot
./install.sh
```

Script kiểm tra Node, cài thư viện rồi hỏi từng bước để tạo `.env` (token, chat id, key Gemini...). Xong chạy thử:

```bash
npm start
```

Nhắn `/help` cho bot. Nếu bot trả lời là xong. Muốn chạy nền và tự bật lại khi khởi động máy: xem [Chạy nền](#chạy-nền).

Cài thủ công: `npm install --omit=dev`, `cp .env.example .env`, điền giá trị, `chmod 600 .env`.

**Công cụ tuỳ chọn** (thiếu cái nào thì chỉ lệnh tương ứng báo lỗi, phần còn lại vẫn chạy):

| Công cụ | Dùng cho | Cài |
|---|---|---|
| `ffmpeg` | `/cam`, cảnh báo chuyển động | `sudo apt install ffmpeg` |
| `imagemagick` | `/wmap`, so sánh ảnh chuyển động | `sudo apt install imagemagick` |
| `lm-sensors` | `/temp` | `sudo apt install lm-sensors` |
| `pm2` | `/services`, chạy nền | `sudo npm install -g pm2` |

## Lấy các khoá cần thiết

| Khoá | Bắt buộc | Cách lấy |
|---|---|---|
| **Telegram bot token** | có | Nhắn **@BotFather**, gõ `/newbot`, đặt tên. Giữ kín token trả về |
| **Chat ID** | có | Nhắn một tin cho bot rồi chạy `npm run setup` (tự dò ra), hoặc hỏi **@userinfobot**. Bot **chỉ nghe đúng chat ID này** |
| **Gemini API key** | cho agent | https://aistudio.google.com/apikey, tạo key miễn phí |
| **OpenWeatherMap key** | cho thời tiết | https://openweathermap.org/api, gói miễn phí (key mới có thể mất vài giờ mới dùng được) |

## Cấu hình

Chỉ `TELEGRAM_BOT_TOKEN` và `ALLOWED_CHAT_ID` là bắt buộc. Các biến thường dùng:

| Biến | Ý nghĩa |
|---|---|
| `GEMINI_API_KEY` | Bật agent AI |
| `OWM_API_KEY`, `LOCATION_NAME`, `LOCATION_LAT`, `LOCATION_LON` | Thời tiết và khu vực của bạn (mặc định Hà Nội) |
| `MAIN_PC_IP`, `MAIN_PC_MAC` | Bật `/ping` và `/wol` |
| `CAM_RTSP_URL` | Camera Hikvision, ví dụ `rtsp://USER:PASS@192.168.1.10:554/Streaming/Channels/101` |
| `TIMEZONE` | Múi giờ (mặc định `Asia/Ho_Chi_Minh`), ảnh hưởng cả giờ hẹn việc |

Còn lại (ngưỡng cảnh báo, giờ chạy tác vụ, nguồn tin RSS, độ nhạy camera, model và giới hạn của agent...) đều có mặc định hợp lý và đổi được trong `.env`. Giá trị sai tự về mặc định, bot không chết vì gõ nhầm. Xem **[docs/CAU-HINH.md](docs/CAU-HINH.md)** và [`.env.example`](.env.example). Sửa `.env` xong cần `pm2 restart homelab-bot`.

## Dùng agent AI

Gõ `/agent` kèm câu hỏi bằng tiếng Việt tự nhiên:

```text
/agent thêm vào lịch thứ 4 chiều 14h họp nhóm
/agent xem lịch tuần này
/agent nhắc tôi 8h tối nay uống thuốc
/agent tóm tắt buổi sáng cho mình: thời tiết, tin tức, lịch hôm nay
/agent có tin gì mới về AI không
/agent làm báo cáo Word về 5 tin AI nổi bật, có link nguồn
/agent mỗi ngày 10h sáng tìm tin AI, tóm tắt và gửi cho tôi
/agent hôm kia mình hỏi gì về router?
```

Gửi **kèm ảnh** thời khoá biểu với caption `/agent ...` để agent đọc ảnh và thêm lịch. Lệnh khác: `/agent quota` xem quota Gemini, `/new` bắt đầu cuộc hội thoại mới.

**An toàn:** mọi thao tác thay đổi dữ liệu đều hiện nút **Xác nhận / Huỷ**; nội dung từ web và tin tức chỉ được coi là dữ liệu, không thể ra lệnh cho bot; công cụ đọc web chặn địa chỉ nội bộ; nhiệm vụ chạy tự động chỉ được đọc và báo cáo. Gói miễn phí của Google có thể dùng nội dung gửi lên để cải thiện sản phẩm của họ, nên đừng nhờ agent xử lý thứ bạn muốn giữ riêng. Chi tiết: [docs/AGENT.md](docs/AGENT.md#an-toàn).

## Tác vụ tự chạy

Bot tự lên lịch các việc sau. Đổi giờ hoặc tắt bằng `SCHEDULE_*` trong `.env` (xem [docs/CAU-HINH.md](docs/CAU-HINH.md)):

| Giờ | Việc |
|---|---|
| Thứ Hai 00:00 | Lưu trữ và làm mới lịch tuần |
| Hằng ngày 06:30 | Tóm tắt lịch hôm nay |
| Thứ Bảy 07:30 | Nhắc lên kế hoạch cuối tuần |
| Thứ Hai 08:00 | Tổng kết tuần |

Bản tin sáng (`morning.js`) và thống kê Pi-hole (`pihole-log.js`) chạy bằng cron, dùng file mẫu:

```bash
cp scripts/crontab.example /tmp/homelab.cron
sed -i "s#__DIR__#$(pwd)#g" /tmp/homelab.cron
crontab -l 2>/dev/null | cat - /tmp/homelab.cron | crontab -
```

## Chạy nền

```bash
sudo npm install -g pm2
./install.sh --pm2        # hoặc: pm2 start ecosystem.config.js
pm2 save
pm2 startup               # chạy lệnh sudo mà nó in ra để tự bật lại khi khởi động máy
```

Xem log: `pm2 logs homelab-bot`. Nếu có camera, `ecosystem.config.js` tự chạy thêm tiến trình `motion-check`.

## Cập nhật

```bash
cd homelab-bot && git pull && npm install --omit=dev && pm2 restart all
```

`.env`, lịch tuần, bộ nhớ agent và lịch sử là dữ liệu cục bộ, `git pull` không đụng tới.

## Bảo mật

- `.env` chứa token và key: quyền `600`, **không bao giờ commit hay gửi cho ai**. Nghi bị lộ token thì vào @BotFather gõ `/revoke`.
- Bot chỉ phục vụ đúng `ALLOWED_CHAT_ID`, và chỉ gọi ra ngoài (long-polling) nên **không cần mở cổng nào** ra Internet.
- `/reboot` và `/pihole` dùng `sudo`. Nếu bot không chạy bằng root, cấp quyền không cần mật khẩu cho đúng các lệnh đó bằng `sudo visudo -f /etc/sudoers.d/homelab-bot`, ví dụ: `youruser ALL=(root) NOPASSWD: /sbin/reboot, /usr/bin/pihole`
- Thông tin đăng nhập camera trong URL RTSP được che khỏi log và tin nhắn lỗi.

## Xử lý sự cố

| Triệu chứng | Cách xử lý |
|---|---|
| Bot không trả lời | `pm2 logs homelab-bot`. Đúng `ALLOWED_CHAT_ID` chưa? Token còn hiệu lực không? |
| `Thiếu biến môi trường bắt buộc` | Thiếu `TELEGRAM_BOT_TOKEN` hoặc `ALLOWED_CHAT_ID` trong `.env` |
| `/agent` báo hết quota | Cả bốn model đã hết lượt ngày, thử lại sau khoảng 14:00 đến 15:00 giờ Việt Nam. Xem `/agent quota` |
| `/agent` báo giới hạn tốc độ | Gửi quá nhanh, đợi vài giây |
| `/cam`, `/wmap` lỗi | Chưa cài `ffmpeg` hoặc `imagemagick` |
| `/ping`, `/wol` báo chưa cấu hình | Điền `MAIN_PC_IP`, `MAIN_PC_MAC` |
| `/temp` trống | `sudo sensors-detect`, cài `lm-sensors` |
| Đổi `.env` không có tác dụng | `pm2 restart homelab-bot` |
| Giờ hiển thị hoặc giờ hẹn bị lệch | Đặt `TIMEZONE` đúng múi giờ rồi restart |

## Cấu trúc và phát triển

```text
bot.js            vòng lặp Telegram và các lệnh
agent.js          agent Gemini, công cụ, nhiệm vụ tự động
scheduler.js      lịch nhắc việc và tác vụ định kỳ
schedule.js       lịch tuần (file Excel trong schedule/)
morning.js        bản tin sáng (cron)         wmap.js   radar mưa
motion-check.js   dò chuyển động camera       lib/      RSS, đọc web an toàn, báo cáo Word, tìm lịch sử...
config.js         đọc và kiểm tra cấu hình    docs/     tài liệu chi tiết
```

```bash
npm install
npm test        # node --test
```

Đóng góp được chào đón: mở issue hoặc pull request. Giấy phép [MIT](LICENSE).
