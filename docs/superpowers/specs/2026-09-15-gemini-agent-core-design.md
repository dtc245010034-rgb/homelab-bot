# Gemini Agent Core + Memory Workspace — Design Spec

> Sub-project đầu tiên trong chuỗi "tích hợp Gemini Agent vào homelab-bot". Các mảnh khác (nhắc lịch, tải video, xếp lịch Excel, tool chạy lệnh hệ thống tự do) là các sub-project riêng, brainstorm/duyệt sau, KHÔNG nằm trong phạm vi spec này.

## Bối cảnh & mục tiêu

`homelab-bot` (Node.js, chạy PM2 trên `dog-HP`) hiện có 21 lệnh cố định, không có AI. Mục tiêu sub-project này: thêm 1 agent hội thoại (`/agent <yêu cầu>`) dùng Gemini API, có khả năng gọi lại các hàm đọc dữ liệu đã có (status, pihole...) qua function calling, có bộ nhớ dài hạn tự tích lũy qua thời gian, và có khung xác nhận an toàn cho các hành động có tác động — làm nền tảng để gắn thêm các tool khác sau này.

**Không thuộc phạm vi (deferred, sub-project riêng):**
- Tool chạy lệnh hệ thống tự do (shell exec) — rủi ro cao nhất, cố tình để dành duyệt riêng.
- Tải video, xếp lịch Excel, nhắc lịch/thông báo theo giờ.
- Cơ chế giới hạn chi phí ($) cứng — chưa cần vì đang dùng free tier.
- Giữ trạng thái "đang chờ xác nhận yes/no" qua restart PM2 — cửa sổ chờ chỉ 30s, không đáng thêm phức tạp.

## Kiến trúc

**Cách tiếp cận:** tích hợp trực tiếp vào bot Node hiện có — module mới `agent.js`, `require()` từ `bot.js` giống `morning.js`/`wmap.js`. Dùng SDK chính thức `@google/genai` (thay thế `@google/generative-ai` đã deprecated), hỗ trợ function calling native. Không thêm runtime/tiến trình mới — vẫn chạy trong process PM2 `dog-bot` hiện tại.

*Lý do không chọn hướng khác:* tách agent thành tiến trình Python riêng (kiểu LangChain/Google ADK) là phức tạp hoá không cần thiết cho 1 bot cá nhân 100% Node.js. Dùng code-execution built-in của Gemini không phù hợp vì nó chạy trong sandbox của Google, không chạm được máy `dog-HP`.

## Cấu trúc thư mục

```
homelab-bot/
└── agent-workspace/
    ├── GEMINI.md              # INDEX bộ nhớ dài hạn — mỗi dòng 1 chủ đề, cap ~200 dòng
    ├── memory/
    │   └── <topic-slug>.md    # nội dung chi tiết từng chủ đề, load on-demand
    ├── sessions/
    │   ├── <chatId>.json      # lịch sử hội thoại hiện tại, format = Gemini API `contents`
    │   └── archive/           # session cũ được archive khi /new hoặc auto-archive
    └── logs/
        ├── agent.log          # audit trail: mọi tool đã gọi, tham số, kết quả
        └── quota-counter.json # đếm số request/ngày (ước tính, xem mục Quota)
```

## Bộ nhớ dài hạn — GEMINI.md (index) + memory/*.md (nội dung)

Mirror đúng kiến trúc bộ nhớ mà Claude Code đang dùng cho chính session này: index nhỏ luôn nằm trong context, nội dung chi tiết tách file riêng, chỉ load khi cần.

- `GEMINI.md`: mỗi dòng `- [topic-slug](memory/topic-slug.md) — mô tả ngắn`. Luôn gửi kèm mỗi lần gọi Gemini. Giới hạn ~150-200 dòng; vượt ngưỡng, dòng cũ nhất rơi khỏi index (file `memory/*.md` tương ứng vẫn còn, chỉ mất "con trỏ" — chấp nhận được cho v1).
- `memory/<topic>.md`: nội dung chi tiết, agent tự quyết định đọc qua tool `recall(topic)` khi thấy liên quan — không tự động nhét hết vào mỗi request.
- Tool `remember(topic, note)`: chủ đề mới → tạo file + thêm dòng index; chủ đề cũ → chỉ append (có timestamp) vào file con, index không phình thêm.

## Hội thoại & session

- Trigger: lệnh riêng `/agent <yêu cầu>` — các lệnh cũ (`/status`, `/wol`...) không đổi, không bị AI can thiệp.
- Multi-turn: giữ ngữ cảnh giữa các lần `/agent` trong 1 phiên. `/new` archive phiên hiện tại (rename vào `sessions/archive/`, không xoá) và bắt đầu trắng.
- **Lưu file, không lưu RAM** (để không mất ngữ cảnh khi mất điện/PM2 restart): mỗi bước — tin nhắn user, từng function_call/function_response, câu trả lời cuối — ghi **write-through** vào `sessions/<chatId>.json` ngay khi xảy ra, không đợi cả vòng lặp xong.
- Khi gọi Gemini, chỉ gửi **N lượt gần nhất** (cắt bớt phần cũ) để không phình token theo thời gian dùng lâu dài — phần cũ vẫn còn nguyên trong file.
- **Auto-archive khi im lặng quá lâu**: nếu phiên không có tin nhắn mới sau ~48h, lần `/agent` tiếp theo tự archive phiên cũ + bắt đầu mới, kèm thông báo rõ cho user biết đã tự làm việc này.

## Tool-calling & xác nhận an toàn

- **Tool registry — 1 nguồn chân lý**: object `{ tên_tool: { schema, handler, requiresConfirm } }` trong `agent.js`, dùng chung để build tool declarations gửi Gemini VÀ để dispatch khi có function_call — tránh lệch giữa tool được khai báo và handler thực tế.
- **Tool đọc (tự chạy ngay)**: bọc lại data từ các hàm đã có (`getSystemStatus()` từ logic của `handleStatus`, `getPiholeStats()`...), cộng `remember()`/`recall()`.
- **Tool có tác động** (ghi file ngoài workspace / chạy lệnh hệ thống — thuộc sub-project sau): bắt buộc xác nhận, tái dùng đúng pattern `yes/no` + timeout 30s đã có ở `/reboot`. Hiển thị rõ hành động sắp làm trước khi hỏi.
- **Giới hạn vòng lặp**: cap 8 vòng tool-call/1 request — vượt thì dừng + báo lỗi, tránh lặp vô hạn tốn quota.
- Mọi lần gọi tool (kể cả bị từ chối) ghi vào `logs/agent.log`.

## System prompt

Agent luôn nhận 1 system instruction cố định: trả lời bằng tiếng Việt, biết rõ giới hạn quyền hạn hiện tại (chỉ thao tác trong `agent-workspace/` + các tool đọc đã khai — KHÔNG có quyền chạy lệnh hệ thống tự do ở giai đoạn này), giữ tông giọng nhất quán với phần còn lại của bot.

## Độ tin cậy & vận hành

- **Timeout tổng ~90s/request** + gửi "đang xử lý..." nếu xử lý lâu.
- **Retry 1 lần** (có backoff ngắn) khi lỗi mạng/5xx từ Gemini trước khi báo lỗi hẳn cho user.
- **Tự xoay vòng log trong code** (không dùng `logrotate` vì không có sudo passwordless): `agent.log` vượt ~5MB thì archive + tạo file mới.
- **Reply dùng lại `render()`/format HTML blockquote** sẵn có trong `bot.js` — đồng bộ giao diện với các lệnh khác.
- **Error handling**: lỗi API/tool đều try/catch, log, trả lời thân thiện — không crash PM2 process, đúng pattern các `handle*` khác.

## Quota (free tier) — không có API chính thức để hỏi số liệu

Đã xác nhận: Gemini Developer API free tier **không có endpoint trả về "quota còn lại"** — chỉ xem thủ công trên AI Studio dashboard. Giải pháp: bộ đếm ước tính tự quản lý.

- `logs/quota-counter.json`: agent tự đếm số request gửi trong ngày, reset lúc 00:00 Pacific Time (giả định theo thông lệ reset quota phổ biến của Google — có thể lệch với thực tế, hiển thị rõ đây là **ước tính**, không phải số liệu chính thức).
- Lệnh `/agent quota` xem số đã dùng ước tính hôm nay.
- Khi thật sự dính lỗi 429 → bắt lỗi, báo rõ ràng cho user, đồng thời đồng bộ lại bộ đếm = mức giới hạn.
- **Lưu ý quan trọng**: nếu API key này dùng chung cho project khác (vd site portfolio cũng định dùng Gemini free tier), số đếm sẽ sai vì không thấy request từ nơi khác → khuyến nghị dùng **API key riêng cho agent này**.

## Cấu hình `.env` thêm

```
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
```

**Việc người dùng cần tự làm**: tạo API key miễn phí tại Google AI Studio (aistudio.google.com) — cần đăng nhập tài khoản cá nhân, Claude Code không tạo hộ được.

**Lưu ý riêng tư (free tier)**: dữ liệu gửi lên (bao gồm nội dung status server, memory tích luỹ) có thể bị Google dùng để cải thiện sản phẩm ở free tier. Chấp nhận được cho giai đoạn thử nghiệm, cần biết trước.

## Testing (thủ công qua Telegram — project hiện không có test suite tự động)

1. Tool đọc chạy được, trả lời đúng dữ liệu thật.
2. Tool có `requiresConfirm` → gõ `no` → không thực thi.
3. Tool có `requiresConfirm` → gõ `yes` → thực thi đúng.
4. Không phản hồi trong 30s → tự huỷ yêu cầu xác nhận.
5. Ngữ cảnh multi-turn giữ đúng qua ≥3 lần `/agent` liên tiếp.
6. `/new` archive đúng session cũ, bắt đầu phiên trắng.
7. Tắt/bật lại PM2 giữa phiên → session phục hồi đúng từ file, không mất ngữ cảnh.
8. Không nhắn gì >48h → lần `/agent` kế tiếp tự archive + báo cho biết.
9. `remember()`/`recall()` hoạt động đúng: chủ đề mới tạo file + index, chủ đề cũ chỉ append.
10. `/agent quota` hiển thị số ước tính hợp lý; giả lập lỗi 429 → báo rõ ràng, không crash.
