# Thiết kế: công cụ `renderUrl` (đọc trang cần JavaScript) + oEmbed cho TikTok

Ngày: 2026-11-13. Trạng thái: **bản nháp chờ chủ máy duyệt**. Chưa có code nào được viết.

## 1. Mục đích và lý do

Ngày 11/11 chủ máy nhờ bot kiểm tra `tiktok.com/@dogvanvat`. Công cụ `fetchUrl` chỉ tải HTML thô nên nhận về đúng chữ `Please wait...`, và bot trả lời chung chung dựa trên câu hỏi của người dùng thay vì nội dung trang.

Chủ máy muốn bot đọc được các trang cần chạy JavaScript mới hiện nội dung, và muốn bot đọc được TikTok của mình (kênh `@dogvanvat`, dùng để test quy trình làm video).

## 2. Mục tiêu, không-mục-tiêu, điều không được xảy ra

**Mục tiêu**
- Bot đọc được chữ của một trang web công khai cần JavaScript, qua Chrome chạy ngầm có sẵn trên máy.
- Với link TikTok, bot lấy được thông tin công khai chính thức (tên kênh; với link một video thì thêm tiêu đề, người đăng, ảnh bìa) qua đường oEmbed.
- Khi trang chặn truy cập tự động, bot nói rõ "trang này chặn" thay vì đoán nội dung.

**Không-mục-tiêu**
- Không đăng nhập, không giữ cookie, không chụp màn hình, không tải ảnh/video/font.
- Không dùng trong nhiệm vụ hẹn giờ tự chạy (`UNATTENDED_TOOLS`).
- Không đọc số liệu (lượt xem, like) hay danh sách video của TikTok. Việc đó cần API chính thức, thuộc một dự án khác.
- Không tôn trọng/đọc `robots.txt` (giống `fetchUrl` hiện tại, vì bot chỉ đọc link do chủ máy gửi).

**Điều không được xảy ra (kể cả khi tính năng "chạy được")**
- Né hoặc vượt kiểm tra bot: không giả User-Agent, không cờ ẩn dấu tự động hóa, không thử lại bằng cách khác khi bị chặn, không giải CAPTCHA.
- Trang lạ chạm tới dịch vụ trong LAN hoặc trên `127.0.0.1` (camera, router, Pi-hole, Netdata, NoMachine, Uptime Kuma...).
- Chrome làm `dog-bot`, Pi-hole hoặc Uptime Kuma chậm hay chết.
- Token/khóa/nội dung `.env` xuất hiện trong log hay đi vào Chrome.

## 3. Các hướng đã cân nhắc

| Hướng | Ưu | Nhược | Kết quả |
|---|---|---|---|
| **A. Chrome ngầm trên máy, đi qua proxy kiểm soát** | Kiểm soát đầy đủ, không gửi link cho bên thứ ba, tái dùng chặn SSRF sẵn có | Tốn RAM/CPU lúc chạy; vẫn có trang chặn | **Chủ máy chọn** |
| B. Dịch vụ đọc trang bên thứ ba | Không tốn RAM | Link đi qua công ty khác, không kiểm soát được, có giới hạn lượt | Loại |
| C. Cửa nhỏ riêng từng trang (oEmbed) | Nhẹ, ổn định | Chỉ phủ được vài trang | **Dùng kèm cho TikTok** |

Chủ máy chọn A và nhờ làm thêm oEmbed cho TikTok. Cỡ việc: **một dự án nhỏ** (khoảng 400–500 dòng gồm test, nhiều module).

## 4. Số liệu đo thực tế (spike bỏ đi ngày 2026-11-13, máy dog-HP)

Chrome 152 chạy ngầm trong trần 600 MB RAM, không swap, CPU 150%:
- Trang trống: RAM thật đỉnh khoảng 163 MB, tốn 8–14 giây (khởi động Chrome chiếm phần lớn).
- `tiktok.com/@dogvanvat`: **hết giờ cả ở 25 giây lẫn 55 giây**, không có nội dung, RAM thật tăng tới 411 MB và chạm mức cảnh báo mềm 450 MB. Bằng chứng này là lý do TikTok đi đường oEmbed, không đi đường Chrome.
- `systemd-run --user --scope` đặt được trần RAM/CPU **không cần root**; `OOMScoreAdjust` không dùng được cho scope, không dùng được cho scope (xem mục 9, điểm 5, về cách thay thế).
- `dog-bot` có sẵn `XDG_RUNTIME_DIR` và `DBUS_SESSION_BUS_ADDRESS`; `Linger=yes` nên phiên người dùng luôn sẵn sàng sau khi khởi động lại máy.
- oEmbed `https://www.tiktok.com/oembed?url=https://www.tiktok.com/@dogvanvat` với User-Agent của bot (`homelab-bot/1.0 (+personal rss reader)`) trả `HTTP 200`, `title` "dogvạnvật's Creator Profile", `author_name`, `author_url`.

## 5. Thiết kế

### 5.1 Hai công cụ, một điểm vào
Thêm công cụ `renderUrl(url)` cho agent. Mô tả của nó nói: dùng khi `fetchUrl` trả về trang rỗng hoặc chữ kiểu "Please wait"/"enable JavaScript". Không đổi hành vi của `fetchUrl`.

Luồng của `renderUrl`:
1. Kiểm tra URL bằng `assertPublicUrl` (hàm sẵn có).
2. Nếu host là TikTok (`tiktok.com`, `www.tiktok.com`): gọi oEmbed, trả kết quả, **không mở Chrome**. Nếu oEmbed lỗi hoặc không có dữ liệu thì báo "không đọc được", không rơi xuống Chrome (đã đo: Chrome vô ích với TikTok và tốn tài nguyên).
3. Các host khác: mở Chrome ngầm, tải trang, lấy chữ, phát hiện bị chặn (5.4), trả kết quả.

### 5.2 oEmbed (`lib/oembed.js`)
- Danh sách cho phép gọn: chỉ TikTok lúc này; cấu trúc cho phép thêm nhà cung cấp sau.
- Gọi `https://www.tiktok.com/oembed?url=<url>` bằng `axios`, User-Agent của bot, timeout 10 giây, giới hạn dung lượng nhỏ (64 KB), chỉ nhận JSON.
- Chỉ nhận URL dạng `tiktok.com/@<tên>` hoặc `tiktok.com/@<tên>/video/<số>`. Link rút gọn (`vm.tiktok.com`...) hiện **chưa hỗ trợ**; trả lời rõ "chưa hỗ trợ link rút gọn". (Cần kiểm chứng sau xem oEmbed có nhận link rút gọn không.)
- Trả về `{ source: 'oembed', title, authorName, authorUrl, thumbnailUrl? }`. Không bao giờ trả khối `html` của oEmbed (có thẻ script).

### 5.3 Chrome ngầm (`lib/render-page.js`)
- **Mở Chrome**: `systemd-run --user --scope` với `MemoryMax=600M`, `MemoryHigh=450M`, `MemorySwapMax=0`, `CPUQuota=150%`, `CPUWeight=20`; chạy `google-chrome-stable --headless=new` với hồ sơ tạm trong `/tmp` (xoá sau mỗi lần), không extension, không GPU, không tải ảnh. **Không** có cờ ẩn dấu tự động hóa, **không** đổi User-Agent.
- **Fail-closed**: nếu không đặt được scope (thiếu `XDG_RUNTIME_DIR`, `systemd-run` lỗi) thì từ chối chạy và báo lỗi, không chạy không giới hạn.
- **Giao tiếp**: ưu tiên `--remote-debugging-pipe` (không mở cổng mạng, không cần thư viện thêm) với một bộ nói chuyện CDP tối giản tự viết. Nếu pipe không đi qua được `systemd-run --scope`, dùng cổng gỡ lỗi ngẫu nhiên chỉ nghe `127.0.0.1` với thư viện `ws` (đã có trong `node_modules`, khai báo thành phụ thuộc trực tiếp). **Không cài `puppeteer-core`.**
- **Chống SSRF**: mọi lưu lượng của Chrome đi qua proxy cục bộ của bot (cờ `--proxy-server` và `--proxy-bypass-list=<-loopback>` để cả `127.0.0.1` cũng buộc đi qua proxy). Proxy tự phân giải tên miền, kiểm tra mọi địa chỉ bằng `isPrivateIp` (sẵn có), rồi mới nối tới đúng IP đã kiểm (ghim IP, chống DNS rebinding). Hỗ trợ `CONNECT` cho HTTPS. Từ chối mọi đích nội bộ bằng `403`. Mỗi lần render dựng một proxy riêng chỉ nghe `127.0.0.1` trên cổng ngẫu nhiên và đóng ngay khi xong. Thêm `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`. Chỉ cho `http:`/`https:`.
- **Lấy nội dung**: chờ sự kiện tải trang rồi chờ thêm tối đa vài giây cho nội dung ổn định, lấy `document.title` và `document.body.innerText`, cắt 12.000 ký tự (như `fetchUrl`, đặt cờ `truncated`).

### 5.4 Phát hiện bị chặn
Nếu mã HTTP của trang chính là 401/403/429/503, hoặc chữ lấy được ngắn dưới ~80 ký tự, hoặc khớp các dấu hiệu như "captcha", "verify you are human", "unusual traffic", "just a moment", "Please wait", thì trả `{ blocked: true, reason }` kèm lời nhắn cho model: "Trang này chặn truy cập tự động. Hãy báo người dùng; không thử cách khác để vượt." **Không thử lại.**

### 5.5 Giới hạn và vận hành
| Mục | Giá trị mặc định | Cấu hình |
|---|---|---|
| Số Chrome cùng lúc | 1; đang bận thì trả "đang bận" ngay | cố định |
| Tần suất | 10 lần mỗi giờ (cửa sổ trượt trong RAM) | `RENDER_MAX_PER_HOUR` |
| Trần thời gian một lần | **90 giây** là mức tối đa (chủ máy quyết 2026-11-13); mặc định 60 giây; chỉ là trần: **xong việc là đóng Chrome ngay**, không chờ hết giờ. Trần thật được kẹp theo thời gian còn lại của yêu cầu agent (mục 5.5.1) | `RENDER_TIMEOUT_SEC` (min 20, max 90) |
| Số lần `renderUrl` mỗi yêu cầu agent | 1 (lần thứ hai trả lỗi "đã dùng trong yêu cầu này") | cố định |
| Tổng dữ liệu tải | 8 MB | cố định |
| Chữ trả về | 12.000 ký tự | cố định |
| Bật/tắt | Bật nếu có `google-chrome-stable` | `RENDER_ENABLED` |

#### 5.5.1 Trần thời gian phải kẹp theo yêu cầu agent
`handleAgent` có thời hạn chung 90 giây (`AGENT_REQUEST_TIMEOUT_SEC`), chỉ kiểm ở đầu mỗi vòng gọi model (`agent.js:1032`). Nếu một lần render chạy 90 giây sau khi model đã mất vài giây, đến vòng kế tiếp thời hạn đã qua: bot báo "QUÁ THỜI GIAN XỬ LÝ" và **vứt kết quả render**. Vì vậy thời gian thật của một lần render = `min(RENDER_TIMEOUT_SEC, thời gian còn lại của yêu cầu − 15 giây dành cho lần gọi model cuối)`. `dispatchTool` nhận thời gian còn lại qua đối tượng `prov`. Với mặc định hiện nay (yêu cầu 90 giây) trần thật khoảng 60–65 giây; muốn dùng đủ 90 giây thì chủ máy phải tăng `AGENT_REQUEST_TIMEOUT_SEC` lên khoảng 150 (ảnh hưởng mọi yêu cầu agent, không tự đổi).

Các khoá `RENDER_*` được thêm vào một khối mới trong `config.js` (theo mẫu khối `AGENT`, có giới hạn min/max) và vào `.env.example` dạng chú thích.

Hết giờ hoặc xong việc thì dừng cả scope (kill toàn bộ tiến trình Chrome) và xoá hồ sơ tạm. Lúc bot khởi động dọn nốt thư mục tạm sót lại.

### 5.6 Chính sách của agent (`lib/agent-policy.js`, `agent.js`)
- Thêm `renderUrl` vào `UNTRUSTED_TOOLS` (kết quả là dữ liệu không tin cậy, nên các công cụ có tác dụng phụ phải hỏi xác nhận).
- **Không** thêm vào `UNATTENDED_TOOLS` và `URL_SOURCES`.
- Mở rộng kiểm tra "chỉ đọc link đã có trong tin nhắn/kết quả tin tức" ở `dispatchTool` (hiện chỉ áp cho `fetchUrl`) sang cả `renderUrl`.
- Cập nhật system prompt (đoạn nói về nội dung không đáng tin) và `docs/AGENT.md`.

## 6. Tiêu chí chấp nhận
1. Gửi link TikTok profile cho bot: bot trả tên kênh đúng từ oEmbed, không mở Chrome, không bịa nội dung video.
2. Trang cần JavaScript (một trang thử đơn giản): `renderUrl` trả đúng chữ mà `fetchUrl` không thấy.
3. Link tới `127.0.0.1`, `192.168.x.x` hoặc tên miền trỏ về IP nội bộ: bị từ chối, kể cả khi trang công khai chuyển hướng hoặc nhúng tài nguyên tới đó (có test).
4. Trang chặn bot: bot báo "chặn", không thử lại, không đoán.
5. Xong việc thì Chrome đóng ngay (trang đơn giản kết thúc trong vài chục giây, không chờ hết trần). Quá giới hạn thời gian hoặc RAM: Chrome bị dừng sạch, không sót tiến trình/thư mục tạm, `dog-bot` vẫn chạy.
6. Không đặt được trần RAM: công cụ từ chối chạy.
7. Gọi liên tục: lần thứ 11 trong một giờ và lần gọi chồng lên nhau bị từ chối.
8. `npm test` xanh; tiến trình Chrome và `dog-bot` không thay đổi RAM đáng kể sau 20 lần gọi liên tiếp (kiểm bằng tay).

## 7. Triển khai
Làm trên một nhánh git, kiểm thử bằng bản chạy riêng (không dùng `dog-bot` đang chạy). Chỉ khởi động lại `dog-bot` bằng PM2 khi chủ máy đồng ý (ghi chú: `ecosystem.config.js` đặt tên `homelab-bot` nhưng tiến trình thật tên `dog-bot`, khởi động lại theo tên thật). Không đẩy lên GitHub cho tới khi chủ máy nói.

## 8. Điều tôi tự quyết (chủ máy có thể bác)
- **Thời gian**: chủ máy quyết trần tối đa 90 giây (thay cho 25 giây ban đầu, vì Chrome mất 8–14 giây chỉ để khởi động trên CPU này). Mặc định 60 giây và việc kẹp theo thời gian còn lại của yêu cầu là quyết định của tôi.
- TikTok chỉ đi đường oEmbed, không có Chrome dự phòng.
- Giao tiếp Chrome qua pipe, không cài `puppeteer-core`.
- Chưa hỗ trợ link TikTok rút gọn.
- `renderUrl` tách riêng khỏi `fetchUrl`, không tự động dự phòng bên trong `fetchUrl`.

## 9. Kết quả kiểm chứng (spike 2026-11-13, Chrome 152, máy dog-HP)
1. **Pipe: ĐẠT.** `--remote-debugging-pipe` đi qua `systemd-run --user --scope ... bash -c 'echo 1000 > /proc/self/oom_score_adj; exec "$@"' _ google-chrome-stable ...` với `stdio: ['ignore','ignore','ignore','pipe','pipe']` (fd 3 ghi lệnh, fd 4 đọc phản hồi, khung JSON kết thúc `\0`). Chrome khởi động tới lúc trả lời `Target.getTargets` mất khoảng 3 giây ở lần đo ấm; lần đầu (nguội) lâu hơn 2,5 giây, nên bộ chạy phải **thăm dò chờ tối đa vài chục giây** chứ không chờ cố định. Chưa cần `ws`.
2. **Loopback qua proxy: ĐẠT.** Với `--proxy-server=http://127.0.0.1:<cổng> --proxy-bypass-list=<-loopback>`, Chrome mở `http://127.0.0.1:<cổng đích>/x` thì proxy nhận request, máy chủ đích nhận 0 request trực tiếp. Đối chứng không có cờ bypass: máy chủ đích nhận 2 request trực tiếp. Ghi chú: Chrome còn tự gọi `clients2.google.com` (đồng bộ giờ) qua proxy; đó là IP công khai nên proxy cho qua.
3. **oEmbed cho link một video và link rút gọn: CHƯA KIỂM CHỨNG** (chưa có link video công khai của kênh để thử). Code theo thiết kế: link rút gọn bị từ chối rõ ràng; link video được chấp nhận theo dạng `/@tên/video/<số>`; cần chủ máy đưa một link thật để thử ở Task 10.
4. **Thời gian toàn luồng so với `AGENT_REQUEST_TIMEOUT_SEC`:** đã kiểm trong code (`agent.js:1032`), thời hạn chỉ kiểm ở đầu mỗi vòng gọi model; vì vậy trần render bị kẹp theo thời gian còn lại (mục 5.5.1) và giới hạn 1 lần mỗi yêu cầu. Cần đo thời gian thật cả luồng ở Task 10.
5. **`oom_score_adj` (đã kiểm ở Task 6): thừa hưởng KHÔNG bền.** Đặt `1000` trước khi chạy Chrome có hiệu lực với bash, nhưng Chrome tự đặt lại tiến trình chính về 0 và tiến trình con về 200/300. Cách làm đã chọn: **sau khi Chrome khởi động** (và lần nữa sau khi tải trang), nâng `oom_score_adj` của mọi tiến trình trong cgroup của scope lên 1000 (nâng điểm không cần root; tiến trình sinh sau có thể vẫn 200/300). Đây chỉ là lớp phụ (best-effort); lớp bảo vệ thật là trần `MemoryMax=600M`, `MemorySwapMax=0` của scope. `systemd-run --scope` thực thi lệnh ngay trong cùng PID nên `child.pid` là tiến trình Chrome chính.
