# Agent AI chi tiết

Gõ `/agent` kèm câu hỏi bằng tiếng Việt tự nhiên. Tổng quan và ví dụ có ở [README](../README.md#dùng-agent-ai); trang này giải thích kỹ hơn cách agent hoạt động.

## Xoay ca model Gemini

Gói Gemini miễn phí chỉ cho khoảng **20 yêu cầu mỗi ngày cho mỗi model**, và Google tính hạn mức **riêng từng model**. Thay vì dừng khi một model hết lượt, bot **tự động xoay ca** sang model kế tiếp, nên agent gần như luôn trả lời được: bốn model cộng lại cho khoảng 80 yêu cầu mỗi ngày mà bạn không phải làm gì.

```text
gemini-3.6-flash  ──(hết quota)──►  gemini-3.5-flash  ──►  gemini-3-flash-preview  ──►  gemini-3.1-flash-lite
  (ưu tiên, đổi bằng GEMINI_MODEL)
```

Cách hoạt động:

- **Chỉ xoay khi Google báo hết hạn mức ngày thật** (lỗi 429 loại `PerDay`). Bot ghi lại con số hạn mức Google trả về, đánh dấu model đó "hết quota hôm nay" và chuyển sang model kế tiếp còn lượt. Cuộc hội thoại đang dở vẫn tiếp tục bình thường vì lịch sử nằm ở bot, không nằm ở model.
- **Lỗi tạm thời không làm mất model.** Giới hạn theo phút thì đợi 7 giây rồi thử lại. Lỗi mạng hoặc lỗi 5xx thì thử lại sau 1,5 giây. Vẫn lỗi mới chuyển sang model khác.
- **Model chậm hoặc treo cũng bị xoay.** Mỗi lần gọi Gemini chờ tối đa `AGENT_GEMINI_TIMEOUT_SEC` (mặc định 25 giây, việc hẹn giờ và tóm tắt được chờ lâu hơn, tối thiểu 60 giây). Quá hạn thì bot huỷ lần gọi đó, chuyển ngay sang model kế tiếp và đẩy model vừa treo xuống cuối hàng trong 15 phút (khởi động lại bot thì xoá). Khi một yêu cầu chậm (từ 30 giây) hoặc phải đổi model, cuối câu trả lời có thêm dòng ⏱ nêu đúng model nào chậm bao lâu. Thời gian từng lần gọi cũng được ghi vào `agent-workspace/logs/agent.log` (`tool: gemini`).
- **Lỗi khác không bị xoay** (ví dụ sai định dạng yêu cầu), vì đổi model cũng không giúp gì mà chỉ đốt thêm lượt.
- **Tự đếm và tự làm mới theo ngày của Google.** Bộ đếm lưu ở `agent-workspace/logs/quota-counter.json` và đặt lại khi sang ngày theo giờ Mỹ (Pacific), tức khoảng 14:00 đến 15:00 giờ Việt Nam tuỳ mùa. Sau mốc đó model ưu tiên được dùng lại.
- **Nhìn và chọn tay:** gõ `/agent quota` hoặc bấm nút **Model Gemini** trong `/help` để xem mỗi model đã dùng bao nhiêu, model nào đang chạy (⬅️), model nào đã hết, và bấm tên model để ép bot dùng model đó. Con số không có dấu `~` là Google báo thật, còn lại là bot tự đếm ước tính.
- Nhiệm vụ định kỳ (như bản tin AI mỗi sáng) cũng dùng chung cơ chế này.

Danh sách model là `GEMINI_MODEL` cộng `GEMINI_FALLBACK_MODELS` trong `.env`. Khi Google đổi hoặc gỡ model, chỉ cần sửa hai biến đó, không phải sửa code.

## Tiết kiệm quota miễn phí

Mỗi lần agent gọi model là một "lượt" trong hạn mức ngày, và một câu hỏi có thể cần vài lượt (mỗi lần dùng công cụ thêm một lượt). Bot giảm số lượt như sau:

- **Công cụ gộp `getBriefing`**: lấy thời tiết, tin tức, lịch tuần, nhắc việc, trạng thái server trong **một** lần gọi. Câu như "tóm tắt buổi sáng" chỉ cần khoảng 2 lượt (một để gọi công cụ, một để trả lời), không phụ thuộc số nguồn.
- **Việc nền dùng model nhẹ trước**: nhiệm vụ hẹn giờ và tóm tắt phiên thử `AGENT_BACKGROUND_MODEL` (mặc định `gemini-3.1-flash-lite`) trước, để dành quota model chính cho lúc bạn hỏi trực tiếp.
- **Lịch sử gọn**: mỗi lần gọi chỉ gửi lại phần chữ hỏi-đáp của các lượt cũ, không gửi lại dữ liệu thô của công cụ (tin tức, lịch...). Ít token hơn nên cũng ít bị giới hạn theo phút.
- **Tìm lại chuyện cũ không tốn quota**: `searchHistory` tìm bằng file trên máy.
- **Đo được**: `/agent quota` hiện số lượt đã dùng hôm nay theo loại việc (hỏi đáp, hẹn giờ, tóm tắt phiên) và trung bình lượt mỗi câu hỏi, để bạn biết quota đang đổ vào đâu.

## Bộ nhớ và hội thoại

- **Bộ nhớ dài hạn** nằm ở `agent-workspace/memory/` (file Markdown, bạn đọc và sửa được). Agent tự ghi khi bạn nhờ "nhớ giúp".
- **Phiên trò chuyện** lưu ở `agent-workspace/sessions/`. Im lặng quá 48 giờ (`AGENT_SESSION_IDLE_HOURS`) hoặc gõ `/new` thì phiên được lưu trữ và bắt đầu phiên mới.
- **Tóm tắt phiên**: khi một phiên được lưu trữ, bot nhờ Gemini tóm tắt thành vài dòng (chạy nền, đúng 1 lượt gọi, chỉ với phiên từ 3 câu hỏi). Bản tóm tắt ở `agent-workspace/summaries/`. Tắt bằng `AGENT_SUMMARIZE=0`.
- **Hỏi lại chuyện cũ**: "hôm kia mình hỏi gì về router?" thì agent tìm trong phiên đang chạy, phiên đã lưu trữ và các bản tóm tắt.
- Các thư mục trên và lịch sử hội thoại **không** được đưa lên git (có thông tin cá nhân).

## Việc hẹn giờ

- **Nhắc việc**: đến giờ chỉ gửi đúng đoạn chữ bạn đặt và ghim lại. Không chạy AI.
- **Nhiệm vụ định kỳ**: đến giờ agent tự tìm tin, đọc bài, tóm tắt (hoặc làm báo cáo Word) rồi gửi kết quả. Mỗi lần chạy tốn vài lượt Gemini, nên hãy đặt ít thôi.

## An toàn

- Mọi thao tác thay đổi dữ liệu (xoá lịch, đặt nhắc, ghi nhớ...) đều hiện nút **Xác nhận / Huỷ** trước khi thực hiện.
- Nội dung từ web, tin tức, ảnh và hội thoại cũ được coi là **dữ liệu, không phải chỉ dẫn**. Sau khi agent đọc chúng, mọi thao tác có tác động phải được bạn xác nhận, để trang web độc hại không điều khiển được bot.
- Công cụ đọc web chặn địa chỉ nội bộ (LAN, localhost) và mọi địa chỉ nằm trong dải mạng của các giao diện trên chính máy (kể cả IPv6 toàn cầu), nên không bị lợi dụng để truy cập router, camera hay dịch vụ trên máy của bạn. Hạn chế đã biết: không phát hiện được truy cập qua IP công cộng của router khi router có chuyển tiếp cổng ra ngoài (NAT hairpin).
- Nhiệm vụ chạy tự động chỉ được dùng công cụ đọc-và-báo-cáo: không xoá hay sửa gì, không đọc được bộ nhớ cá nhân, lịch hay hội thoại cũ (`getBriefing` ở chế độ này chỉ lấy thời tiết và tin), và chỉ được mở những link xuất hiện trong kết quả tin tức/tìm kiếm của chính lần chạy đó (chống bắt bot gửi dữ liệu ra ngoài qua URL).
- Trong hội thoại, nếu agent muốn mở một link lạ sau khi đã đọc nội dung web, bot hỏi xác nhận trước.
- Agent không chạy được lệnh hệ thống tự do.
- Gói Gemini miễn phí: theo điều khoản của Google, nội dung gửi lên có thể được dùng để cải thiện sản phẩm của họ. Đừng nhờ agent xử lý thông tin bạn không muốn chia sẻ.

## Đọc bảng tính Google Sheets

Link Google Sheets (`docs.google.com/spreadsheets/d/<id>`) được `fetchUrl` tự đổi sang bản xuất CSV của đúng tab (theo `gid` trong link), gọn và đầy đủ hơn trang HTML. Bảng phải được chia sẻ "bất kỳ ai có link đều xem được". Trang thường được đọc tối đa 12.000 ký tự, CSV của Google Sheets tối đa 40.000. Nếu kết quả có `truncated: true` nghĩa là agent chưa thấy hết nội dung; agent được dặn không tự thêm hay sửa lịch dựa trên phần thiếu mà phải báo bạn.

## Đọc trang cần JavaScript (`renderUrl`)

`fetchUrl` chỉ tải HTML thô nên không đọc được trang chỉ hiện nội dung sau khi chạy JavaScript (thường chỉ thấy chữ "Please wait..."). Khi đó agent gọi `renderUrl`:

- **Trang thường:** mở Chrome chạy ngầm trên máy (cần `google-chrome-stable`), đọc chữ trang hiển thị rồi đóng Chrome ngay khi xong. Không đăng nhập, không lưu cookie, không tải ảnh/video/font, không cho trang tải file về máy.
- **TikTok:** không mở Chrome. Bot dùng đường oEmbed công khai chính thức của TikTok: link hồ sơ (`tiktok.com/@tên`) cho tên kênh; link một video (`tiktok.com/@tên/video/<số>`) cho thêm tiêu đề, người đăng. Không có lượt xem, like hay danh sách video. Link rút gọn (`vm.tiktok.com`) chưa hỗ trợ.
- **Trang chặn truy cập tự động** (CAPTCHA, "Just a moment", HTTP 403/429...): bot báo là trang chặn và **không thử cách khác để vượt**.
- **An toàn:** mọi kết nối của Chrome đi qua một proxy riêng của bot chặn địa chỉ nội bộ (LAN, `127.0.0.1`), kể cả khi trang chuyển hướng hoặc nhúng tài nguyên tới đó. Chrome chạy trong giới hạn tài nguyên của `systemd` (RAM tối đa 600 MB, không dùng swap, CPU tối đa khoảng 1,5 nhân, ưu tiên thấp); không đặt được giới hạn này thì bot từ chối chạy thay vì chạy không giới hạn. Kết quả bị coi là dữ liệu không đáng tin, và công cụ này không dùng được trong nhiệm vụ hẹn giờ tự chạy.
- **Giới hạn:** 1 lần mở Chrome cùng lúc, 1 lần `renderUrl` mỗi yêu cầu agent, tối đa 10 lần mỗi giờ (`RENDER_MAX_PER_HOUR`). Thời gian tối đa 60 giây (`RENDER_TIMEOUT_SEC`, 20–90), nhưng không vượt phần thời gian còn lại của yêu cầu (`AGENT_REQUEST_TIMEOUT_SEC`, mặc định 90 giây); muốn dùng đủ 90 giây thì tăng cả hai. Chrome khởi động mất vài giây trên máy yếu.

## Công cụ của agent

`getBriefing`, `getSystemStatus`, `getPiholeStats`, `getWeather`, `getNews`, `getAiNews`, `searchNews`, `fetchUrl`, `renderUrl`, `viewSchedule`, `addScheduleItem`, `editScheduleItem`, `removeScheduleItem`, `clearSchedule`, `sendScheduleFile`, `setReminder`, `scheduleAgentTask`, `listReminders`, `cancelReminder`, `createReport`, `remember`, `recall`, `forget`, `searchHistory`.
