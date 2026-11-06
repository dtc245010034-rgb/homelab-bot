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
- Công cụ đọc web chặn địa chỉ nội bộ (LAN, localhost), nên không bị lợi dụng để truy cập router hay camera của bạn.
- Nhiệm vụ chạy tự động chỉ được dùng công cụ đọc-và-báo-cáo: không xoá hay sửa gì, không đọc được bộ nhớ cá nhân, lịch hay hội thoại cũ (`getBriefing` ở chế độ này chỉ lấy thời tiết và tin), và chỉ được mở những link xuất hiện trong kết quả tin tức/tìm kiếm của chính lần chạy đó (chống bắt bot gửi dữ liệu ra ngoài qua URL).
- Trong hội thoại, nếu agent muốn mở một link lạ sau khi đã đọc nội dung web, bot hỏi xác nhận trước.
- Agent không chạy được lệnh hệ thống tự do.
- Gói Gemini miễn phí: theo điều khoản của Google, nội dung gửi lên có thể được dùng để cải thiện sản phẩm của họ. Đừng nhờ agent xử lý thông tin bạn không muốn chia sẻ.

## Công cụ của agent

`getBriefing`, `getSystemStatus`, `getPiholeStats`, `getWeather`, `getNews`, `getAiNews`, `searchNews`, `fetchUrl`, `viewSchedule`, `addScheduleItem`, `editScheduleItem`, `removeScheduleItem`, `clearSchedule`, `sendScheduleFile`, `setReminder`, `scheduleAgentTask`, `listReminders`, `cancelReminder`, `createReport`, `remember`, `recall`, `forget`, `searchHistory`.
