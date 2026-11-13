# renderUrl (Chrome ngầm + oEmbed TikTok) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm công cụ `renderUrl` cho agent: đọc chữ của trang cần JavaScript bằng Chrome chạy ngầm trong trần tài nguyên, và đọc thông tin công khai của TikTok qua oEmbed.

**Architecture:** `renderUrl` kiểm URL bằng `assertPublicUrl`; link TikTok đi đường oEmbed (không mở Chrome); trang khác chạy Chrome trong `systemd-run --user --scope`, mọi lưu lượng đi qua proxy cục bộ chặn IP nội bộ, nói chuyện CDP qua pipe. Kết quả bị coi là dữ liệu không tin cậy; trang chặn bot thì trả `blocked`, không thử lại.

**Tech Stack:** Node 20 CommonJS, `axios`, `node:test`, `google-chrome-stable` 152, `systemd-run`. Không thêm thư viện (dự phòng: `ws`, đã có trong `node_modules`).

**Spec:** `docs/superpowers/specs/2026-11-13-render-url-design.md` (đọc kèm; mục 9 là các điều cần kiểm chứng ở Task 1).

## Global Constraints

- Node `>=20.4.0`, CommonJS (`require`), test bằng `node --test test/` (`npm test`). Không thêm phụ thuộc mới nếu pipe chạy được.
- Quy ước repo: tên test và comment ASCII không dấu; chuỗi gửi người dùng/model có dấu tiếng Việt.
- Chrome: `--headless=new`, hồ sơ tạm `/tmp`, **không** đổi User-Agent, **không** cờ ẩn dấu tự động hóa, không cookie/đăng nhập, không tải ảnh/video/font.
- Scope: `MemoryMax=600M`, `MemoryHigh=450M`, `MemorySwapMax=0`, `CPUQuota=150%`, `CPUWeight=20`, `oom_score_adj=1000` (ghi `/proc/self/oom_score_adj` trong scope). Không đặt được scope thì **từ chối chạy**.
- 1 Chrome cùng lúc; `RENDER_MAX_PER_HOUR` mặc định 10; 1 lần `renderUrl` mỗi yêu cầu agent; tối đa 8 MB tải; chữ trả về 12.000 ký tự.
- `RENDER_TIMEOUT_SEC`: mặc định 60, min 20, max 90. Thời gian thật = `min(trần, thời gian còn lại của yêu cầu − 15000 ms)`. Không đổi `AGENT_REQUEST_TIMEOUT_SEC`.
- Bị chặn khi: HTTP 401/403/429/503, hoặc chữ < 80 ký tự, hoặc dấu hiệu CAPTCHA/kiểm tra bot. Lời nhắn: "Trang này chặn truy cập tự động. Hãy báo người dùng; không thử cách khác để vượt."
- oEmbed: `https://www.tiktok.com/oembed?url=<url>`, User-Agent `USER_AGENT` của `lib/rss.js`, timeout 10000 ms, `maxContentLength` 65536, không bao giờ trả trường `html`.
- `renderUrl` thuộc `UNTRUSTED_TOOLS`; **không** thuộc `UNATTENDED_TOOLS` và `URL_SOURCES`.
- Mỗi task một commit trên nhánh `feat/render-url`; không `git add -A`; không push lên GitHub (kho công khai) và không restart `dog-bot` khi chủ máy chưa đồng ý.

## Review Focus

1. Link TikTok rút gọn (`vm.tiktok.com/XXXX`): phải báo "chưa hỗ trợ link rút gọn", không mở Chrome (Task 3, 7).
2. Trang công khai chuyển hướng hoặc nhúng tài nguyên tới `127.0.0.1`/LAN: proxy chặn, máy chủ nội bộ không nhận được request nào (Task 5, 6).
3. Không có Chrome, `systemd-run` lỗi hoặc Chrome chết giữa chừng: báo lỗi rõ, nhả khoá, không treo, không sót tiến trình/thư mục tạm (Task 6, 7).
4. Hai lần gọi chồng nhau, hoặc lần thứ 11 trong một giờ: từ chối ngay, không chạy Chrome thứ hai (Task 4, 7).
5. URL lạ (`http://[::1]/`, `file:///etc/passwd`, `user:pass@host`, trang trả về vài MB chữ): bị chặn trước khi tới Chrome hoặc cắt còn 12.000 ký tự với `truncated: true` (Task 7).

---

### Task 1: Spike kiểm chứng (không đổi code bot)

**Files:**
- Create (ngoài repo): `~/test-phan-mem/spikes/render-pipe/probe.js`
- Modify: `docs/superpowers/specs/2026-11-13-render-url-design.md` (mục 9: ghi kết quả)

**Interfaces:** Produces: ba kết luận ghi vào mục 9 mà Task 6 dựa vào: (a) pipe có đi qua `systemd-run --user --scope` không; (b) `--proxy-bypass-list=<-loopback>` có buộc cả `127.0.0.1` đi qua proxy không; (c) oEmbed trả gì cho link một video và link rút gọn.

- [ ] **Step 1:** `git switch -c feat/render-url` trong `~/homelab-bot`.
- [ ] **Step 2:** Viết `probe.js` (Node 20) làm các việc sau rồi in kết quả: (a) `spawn('systemd-run', [...scopeArgs, 'bash','-c','echo 1000 > /proc/self/oom_score_adj; exec "$@"','_', 'google-chrome-stable', '--headless=new','--remote-debugging-pipe', ...], { stdio:['ignore','ignore','ignore','pipe','pipe'] })`, gửi `Target.getTargets` (JSON kết thúc bằng `\0`) vào `child.stdio[3]`, đọc `child.stdio[4]`, kỳ vọng có phản hồi; (b) dựng một máy chủ HTTP đếm số request trên `127.0.0.1:A` (trang đích) và một proxy HTTP tối giản đếm số request trên `127.0.0.1:B`; chạy Chrome với `--proxy-server=http://127.0.0.1:B --proxy-bypass-list=<-loopback>` mở `http://127.0.0.1:A/`, kỳ vọng proxy đếm 1 và máy chủ trực tiếp đếm 0 (đối chứng: bỏ cờ bypass, xem số đếm đổi thế nào).
- [ ] **Step 3:** Chạy `node ~/test-phan-mem/spikes/render-pipe/probe.js`. Kỳ vọng: in rõ PASS/FAIL cho (a) và (b); sau khi chạy không còn tiến trình Chrome (`pgrep -f spike` rỗng). (c) Hỏi chủ máy một link video TikTok công khai của kênh `@dogvanvat`; gọi oEmbed bằng `curl -A 'homelab-bot/1.0 (+personal rss reader)'` cho link đó và cho một link `vm.tiktok.com` nếu có; chưa có link thì ghi "chưa kiểm chứng".
- [ ] **Step 4:** Ghi ba kết luận vào mục 9 của tài liệu thiết kế. Nếu (a) FAIL: ghi "dùng `--remote-debugging-port=0` + `ws`" và thêm `"ws"` vào `dependencies` của `package.json` với đúng phiên bản trong `node_modules` (xem `node_modules/ws/package.json`). Nếu (b) FAIL: dừng, báo chủ máy trước khi làm tiếp (thiết kế chống SSRF phụ thuộc điểm này).
- [ ] **Step 5:** Commit: `git add docs/superpowers/specs/2026-11-13-render-url-design.md docs/superpowers/plans/2026-11-13-render-url.md` (và `package.json` nếu đổi) rồi `git commit -m "docs: ket qua spike pipe + loopback cho renderUrl"`.

### Task 2: Cấu hình `RENDER_*`

**Files:**
- Modify: `config.js` (thêm khối sau `AGENT`, cùng cấp), `.env.example`
- Test: `test/config.test.js`

**Interfaces:** Produces: `getSettings().RENDER = { enabled: boolean, chromePath: string, timeoutMs: number, maxPerHour: number }`.

- [ ] **Step 1: Viết test lỗi** trong `test/config.test.js` (dùng `base` có sẵn): không đặt biến nào → `RENDER` bằng `{ enabled: true, chromePath: 'google-chrome-stable', timeoutMs: 60000, maxPerHour: 10 }`; `RENDER_TIMEOUT_SEC` = `'500'` và `'1'` đều cho `timeoutMs` nằm trong `[20000, 90000]`; `RENDER_ENABLED='0'` → `enabled === false`; `RENDER_MAX_PER_HOUR='3'` → `3`.
- [ ] **Step 2:** `node --test test/config.test.js` → FAIL (`RENDER` là `undefined`).
- [ ] **Step 3:** Thêm khối `RENDER: Object.freeze({...})` dùng `bool`, `num` (min 20, max 90 cho giây; `maxPerHour` min 1, max 120, int) và `String(env.RENDER_CHROME_PATH || '').trim() || 'google-chrome-stable'`. Thêm 4 dòng chú thích vào `.env.example` (`#RENDER_ENABLED=1`, `#RENDER_CHROME_PATH=`, `#RENDER_TIMEOUT_SEC=60`, `#RENDER_MAX_PER_HOUR=10`), mỗi dòng có giải thích ngắn như các dòng `AGENT_*`.
- [ ] **Step 4:** `node --test test/config.test.js` → PASS.
- [ ] **Step 5:** `git add config.js .env.example test/config.test.js && git commit -m "feat(render): cau hinh RENDER_*"`.

### Task 3: oEmbed cho TikTok

**Files:**
- Create: `lib/oembed.js`
- Test: `test/oembed.test.js`

**Interfaces:**
- Consumes: `USER_AGENT` từ `lib/rss.js`.
- Produces: `isTiktokHost(rawUrl: string): boolean` (host là `tiktok.com` hoặc `*.tiktok.com`); `fetchOembed(rawUrl: string, { http = axios }): Promise<{ source: 'oembed', url: string, title: string, authorName: string, authorUrl: string, thumbnailUrl?: string }>`.

- [ ] **Step 1: Viết test lỗi:** (a) `isTiktokHost` đúng cho `https://www.tiktok.com/@dogvanvat`, `https://vm.tiktok.com/ZM1/`, sai cho `https://nottiktok.com/` và `https://tiktok.com.evil.example/`. (b) `fetchOembed('https://www.tiktok.com/@dogvanvat', { http })` với `http.get` giả trả `{ data: { title: "dogvạnvật's Creator Profile", author_name: 'dogvạnvật', author_url: 'https://www.tiktok.com/@dogvanvat', html: '<script>x</script>' } }` → kết quả có `authorName === 'dogvạnvật'`, **không có** khoá `html`, và `http.get` được gọi với URL `https://www.tiktok.com/oembed`, `params: { url: ... }`, header `User-Agent === USER_AGENT`, `timeout: 10000`, `maxContentLength: 65536`. (c) Link một video `https://www.tiktok.com/@dogvanvat/video/7000000000000000000` được chấp nhận và `thumbnailUrl` lấy từ `thumbnail_url`. (d) `https://vm.tiktok.com/ZM1/` và `https://www.tiktok.com/` → reject với thông báo khớp `/rút gọn|chưa hỗ trợ/` và `http.get` **không** được gọi. (e) `http.get` ném lỗi mạng → reject có chữ `oEmbed`.
- [ ] **Step 2:** `node --test test/oembed.test.js` → FAIL (thiếu module).
- [ ] **Step 3:** Cài đặt hai hàm trong `lib/oembed.js`; đường dẫn hợp lệ chỉ `/@<tên>` hoặc `/@<tên>/video/<chữ số>` (regex), còn lại reject. Lấy `thumbnail_url` nếu là chuỗi `https://`.
- [ ] **Step 4:** `node --test test/oembed.test.js` → PASS.
- [ ] **Step 5:** `git add lib/oembed.js test/oembed.test.js && git commit -m "feat(render): oEmbed cho TikTok"`.

### Task 4: Phát hiện bị chặn và bộ giới hạn

**Files:**
- Create: `lib/render-guard.js`
- Test: `test/render-guard.test.js`

**Interfaces:** Produces: `detectBlocked({ status: number|null, text: string }): { blocked: boolean, reason?: string }`; `createRenderLimiter({ maxPerHour: number, now = Date.now }): { tryAcquire(): { ok: true, release(): void } | { ok: false, reason: 'busy' | 'rate' } }`; hằng `BLOCKED_NOTE` (lời nhắn trong Global Constraints, nguyên văn).

- [ ] **Step 1: Viết test lỗi:** `detectBlocked`: status 403/429/503/401 → blocked; text 20 ký tự → blocked (`reason` nhắc "trống"); `"Please wait..."` và `"Just a moment..."` → blocked; text dài 3000 ký tự có chứa chữ "captcha" → **không** blocked (chỉ xét dấu hiệu khi chữ ngắn dưới 1500 ký tự); text bình thường 500 ký tự, status 200 → không blocked. Limiter (đồng hồ giả): lần 1 ok; lần 2 khi chưa `release` → `{ ok:false, reason:'busy' }`; sau `release` lại ok; với `maxPerHour: 3` lần thứ 4 trong cùng giờ → `'rate'`; tăng `now` thêm 3600001 ms → ok trở lại; `release` gọi hai lần không làm hỏng trạng thái.
- [ ] **Step 2:** `node --test test/render-guard.test.js` → FAIL.
- [ ] **Step 3:** Cài đặt; giới hạn tần suất dùng cửa sổ trượt (mảng mốc thời gian), tính ngay lúc `tryAcquire` thành công.
- [ ] **Step 4:** `node --test test/render-guard.test.js` → PASS.
- [ ] **Step 5:** `git add lib/render-guard.js test/render-guard.test.js && git commit -m "feat(render): phat hien trang chan bot va gioi han tan suat"`.

### Task 5: Proxy chặn địa chỉ nội bộ

**Files:**
- Create: `lib/render-proxy.js`
- Test: `test/render-proxy.test.js`

**Interfaces:**
- Consumes: `isPrivateIp` từ `lib/web-tools.js`.
- Produces: `createRenderProxy({ lookup = (h) => dns.promises.lookup(h, { all: true }), isPrivate = isPrivateIp, connect = net.connect, maxBytes = 8 * 1024 * 1024 }): { start(): Promise<number> /* cổng, nghe 127.0.0.1 */, stop(): Promise<void>, stats(): { bytes: number, exceeded: boolean, blockedHosts: string[] } }`.

- [ ] **Step 1: Viết test lỗi** (dùng socket thật tới proxy): (a) gửi `CONNECT intranet.test:443` với `lookup` giả trả `192.168.1.5` → phản hồi bắt đầu bằng `HTTP/1.1 403`, `connect` không được gọi, `blockedHosts` chứa `intranet.test`; (b) `CONNECT 127.0.0.1:8080` (host là IP literal) → 403; (c) host phân giải ra hai IP, một công khai một nội bộ → 403; (d) host công khai (`lookup` trả `93.184.216.34`) → `connect` được gọi đúng với `host: '93.184.216.34'` (ghim IP, không phân giải lại) và phản hồi bắt đầu `HTTP/1.1 200`, dữ liệu hai chiều chạy qua (dùng cặp `net.Socket` giả); (e) yêu cầu HTTP thường tới `http://intranet.test/` (dạng absolute-URI) → 403; (f) vượt `maxBytes: 100` → `stats().exceeded === true` và kết nối bị đóng; (g) `stop()` đóng cổng, kết nối lại bị từ chối.
- [ ] **Step 2:** `node --test test/render-proxy.test.js` → FAIL.
- [ ] **Step 3:** Cài đặt bằng `http.createServer` (có `'connect'` event cho HTTPS, và xử lý request thường bằng `http.request` tới IP đã ghim kèm header `Host`). Phân giải mọi địa chỉ bằng `lookup`, chặn nếu bất kỳ địa chỉ nào `isPrivate`. Chỉ nghe `127.0.0.1` cổng `0`.
- [ ] **Step 4:** `node --test test/render-proxy.test.js` → PASS.
- [ ] **Step 5:** `git add lib/render-proxy.js test/render-proxy.test.js && git commit -m "feat(render): proxy chan dia chi noi bo cho Chrome"`.

### Task 6: Bộ nói chuyện CDP và chạy Chrome trong scope

**Files:**
- Create: `lib/render-chrome.js`
- Test: `test/render-chrome.test.js`

**Interfaces:**
- Consumes: `createRenderProxy` (Task 5); kết luận transport từ Task 1 (mặc định pipe).
- Produces: `createCdpClient(input: Readable, output: Writable): { send(method: string, params?: object, sessionId?: string): Promise<object>, on(event: string, fn: (params: object, sessionId?: string) => void): void }` (khung tin nhắn: JSON kết thúc bằng `\0`); `buildScopeArgs({ unit: string }): string[]` (argv của `systemd-run`, theo Global Constraints); `buildChromeArgs({ profileDir: string, proxyPort: number }): string[]`; `renderWithChrome(url: string, { timeoutMs: number, chromePath: string, proxyPort: number, spawn = child_process.spawn }): Promise<{ status: number|null, title: string, text: string }>`.

- [ ] **Step 1: Viết test lỗi:** (a) `createCdpClient` với hai `PassThrough`: `send('A.b', {x:1})` ghi ra đúng `{"id":1,"method":"A.b","params":{"x":1}}\0`; đẩy vào `{"id":1,"result":{"ok":true}}\0` → promise resolve `{ok:true}`; đẩy `{"id":2,"error":{"message":"boom"}}\0` → promise reject chứa `boom`; một sự kiện `{"method":"Page.loadEventFired","params":{}}\0` gọi đúng handler đã `on`; hai khung dính nhau trong một chunk vẫn tách đúng. (b) `buildChromeArgs` chứa `--headless=new`, `--remote-debugging-pipe`, `--proxy-server=http://127.0.0.1:<port>`, `--proxy-bypass-list=<-loopback>`, `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`, `--blink-settings=imagesEnabled=false`, `--user-data-dir=<dir>` và **không** chứa chuỗi `user-agent` hay `AutomationControlled`. (c) `buildScopeArgs` chứa đủ `MemoryMax=600M`, `MemoryHigh=450M`, `MemorySwapMax=0`, `CPUQuota=150%`, `CPUWeight=20`. (d) `renderWithChrome` với `spawn` giả ném lỗi `ENOENT` → reject với thông báo tiếng Việt nhắc không tìm thấy Chrome và thư mục hồ sơ tạm đã bị xóa. (e) **Kiểm tích hợp (tự bỏ qua bằng `t.skip` nếu không có `google-chrome-stable` hoặc `systemd-run --user` lỗi):** dựng máy chủ HTTP trên `127.0.0.1` phục vụ trang có `<script>document.body.textContent='xin chao tu js'</script>`; chạy `createRenderProxy({ isPrivate: () => false })`, gọi `renderWithChrome(url, {...})` → `text` chứa `xin chao tu js`; sau khi xong không còn tiến trình có `user-data-dir=/tmp/` của lần chạy. (f) **Tích hợp SSRF (cùng điều kiện bỏ qua):** dùng proxy **mặc định** (chặn loopback) với cùng máy chủ → `renderWithChrome` reject (không mở được trang), máy chủ nhận **0** request, `proxy.stats().blockedHosts` chứa `127.0.0.1`.
- [ ] **Step 2:** `node --test test/render-chrome.test.js` → FAIL.
- [ ] **Step 3:** Cài đặt. `renderWithChrome`: tạo hồ sơ `mkdtemp`; spawn `systemd-run` kèm `bash -c 'echo 1000 > /proc/self/oom_score_adj; exec "$@"'` và Chrome với `stdio: ['ignore','ignore','ignore','pipe','pipe']`; qua CDP: `Target.createTarget` → `Target.attachToTarget({ flatten: true })`, `Network.enable`, `Network.setBlockedURLs` cho đuôi font/media, `Page.enable`; ghi `status` từ `Network.responseReceived` loại `Document` của khung chính; `Page.navigate` (nếu kết quả có `errorText` thì ném lỗi "Không mở được trang"); chờ `Page.loadEventFired`, rồi chờ thêm tối đa 4 giây tới khi `document.body.innerText` ổn định hai lần liên tiếp (mỗi 500 ms); lấy `document.title` và `innerText` bằng `Runtime.evaluate`. Hết `timeoutMs` thì ném lỗi "quá thời gian". `finally`: `systemctl --user stop <unit>.scope`, kill tiến trình con, xóa hồ sơ tạm. Nếu Task 1 kết luận pipe hỏng thì thay phần truyền bằng `ws` theo ghi chú ở mục 9.
- [ ] **Step 4:** `node --test test/render-chrome.test.js` → PASS (các ca tích hợp có thể báo skip nếu máy thiếu điều kiện; trên máy này phải chạy thật, không skip).
- [ ] **Step 5:** `git add lib/render-chrome.js test/render-chrome.test.js && git commit -m "feat(render): chay Chrome ngam trong scope, noi chuyen CDP qua pipe"`.

### Task 7: Hàm điều phối `renderUrl`

**Files:**
- Create: `lib/render-url.js`
- Test: `test/render-url.test.js`

**Interfaces:**
- Consumes: `assertPublicUrl` (`lib/web-tools.js`); `isTiktokHost`, `fetchOembed` (Task 3); `detectBlocked`, `BLOCKED_NOTE`, `createRenderLimiter` (Task 4); `createRenderProxy` (Task 5); `renderWithChrome` (Task 6).
- Produces: `effectiveTimeoutMs({ configuredMs: number, remainingMs: number, marginMs = 15000 }): number` (trả `0` nếu `remainingMs - marginMs < 15000`); `renderUrl(rawUrl: string, { cfg: RENDER, limiter, remainingMs = Infinity, http, lookup, render = renderWithChrome, createProxy = createRenderProxy }): Promise<{ source: 'oembed'|'chrome', url: string, title?: string, text?: string, truncated?: boolean, blocked?: boolean, reason?: string, note?: string, authorName?: string, authorUrl?: string, thumbnailUrl?: string }>` (lỗi ném `Error` tiếng Việt).

- [ ] **Step 1: Viết test lỗi** (mọi phụ thuộc là giả): (a) `effectiveTimeoutMs`: `(60000, Infinity)` → 60000; `(60000, 80000)` → 60000 vì `80000-15000=65000`; `(90000, 70000)` → 55000; `(60000, 20000)` → 0. (b) URL `https://www.tiktok.com/@dogvanvat` → gọi `fetchOembed`, **không** gọi `render` và **không** `tryAcquire`; trả `source: 'oembed'`. (c) `https://vm.tiktok.com/ZM1/` → reject `/rút gọn|chưa hỗ trợ/`, `render` không được gọi. (d) `http://[::1]/`, `file:///etc/passwd`, `http://u:p@example.com/` → reject trước khi `render` (từ `assertPublicUrl`). (e) `cfg.enabled === false` → reject `/đang tắt/`. (f) `limiter` trả `busy` → reject `/bận/`; trả `rate` → reject nhắc "mỗi giờ"; trong cả hai trường hợp `render` không được gọi. (g) `remainingMs: 20000` → reject nhắc không đủ thời gian và đã `release` nếu có acquire. (h) `render` trả chữ bình thường dài 20.000 ký tự → `text.length === 12000`, `truncated: true`. (i) `render` trả `{ status: 403, text: 'x' }` → kết quả có `blocked: true` và `note === BLOCKED_NOTE`, **không** gọi `render` lần thứ hai. (j) `render` ném lỗi → reject, `release` vẫn được gọi và `proxy.stop` vẫn được gọi (kiểm cả đường lỗi).
- [ ] **Step 2:** `node --test test/render-url.test.js` → FAIL.
- [ ] **Step 3:** Cài đặt theo luồng mục 5.1 của thiết kế; `proxy.start()` trước `render`, `proxy.stop()` và `release()` trong `finally`; giới hạn chữ 12.000 ký tự.
- [ ] **Step 4:** `node --test test/render-url.test.js` → PASS.
- [ ] **Step 5:** `git add lib/render-url.js test/render-url.test.js && git commit -m "feat(render): ham dieu phoi renderUrl (oEmbed truoc, Chrome sau)"`.

### Task 8: Nối vào agent

**Files:**
- Modify: `lib/agent-policy.js`; `agent.js` (khai báo công cụ trong `TOOLS` gần `fetchUrl`; `dispatchTool` khoảng dòng 885–925; chỗ tạo `prov` trong `handleAgent` khoảng dòng 1020–1026; system prompt khoảng dòng 825–830; phần giải cấu trúc `deps` đầu `createAgent`)
- Test: `test/agent-policy.test.js`

**Interfaces:**
- Consumes: `renderUrl`, `createRenderLimiter`, `getSettings().RENDER`.
- Produces: trong `agent-policy.js`: `takeRenderSlot(prov: { renderUsed?: boolean } | null): boolean` (lần đầu `true` rồi đánh dấu, lần sau `false`; `null` → `true`); `remainingMs(prov: { deadline?: number } | null, now = Date.now()): number` (`Infinity` nếu không có `deadline`). Handler công cụ nhận `ctx.remainingMs` ở tham số thứ ba (cạnh `unattended`).

- [ ] **Step 1: Viết test lỗi** trong `test/agent-policy.test.js`: `UNTRUSTED_TOOLS.has('renderUrl')` đúng; `UNATTENDED_TOOLS.has('renderUrl')` và `URL_SOURCES.has('renderUrl')` sai; `takeRenderSlot` hai lần liên tiếp trên cùng `prov` → `true` rồi `false`; `takeRenderSlot(null) === true`; `remainingMs({ deadline: 5000 }, 2000) === 3000`; `remainingMs({}) === Infinity`.
- [ ] **Step 2:** `node --test test/agent-policy.test.js` → FAIL.
- [ ] **Step 3:** Cài đặt: (a) thêm `renderUrl` vào `UNTRUSTED_TOOLS`, thêm hai hàm và export. (b) `agent.js`: thêm `renderUrl = renderUrlLib.renderUrl` vào `deps` mặc định; tạo `renderLimiter` một lần trong `createAgent`; thêm `TOOLS.renderUrl` (`requiresConfirm: false`, `parametersJsonSchema` có `url`, mô tả nói dùng **sau khi** `fetchUrl` trả trang rỗng hoặc "Please wait", nội dung là dữ liệu không đáng tin, và nếu kết quả có `blocked` thì chỉ báo lại người dùng); handler gọi `renderUrl(args.url, { cfg: RENDER, limiter: renderLimiter, remainingMs: ctx.remainingMs })`. (c) `dispatchTool`: mở rộng điều kiện kiểm link đã biết (`call.name === 'fetchUrl'`) sang cả `renderUrl`; ngay trước `tool.handler(...)`, nếu `call.name === 'renderUrl'` và `!takeRenderSlot(prov)` thì trả `{ error: 'Đã dùng renderUrl một lần trong yêu cầu này.' }`; truyền `remainingMs: remainingMs(prov)` vào đối số thứ ba. (d) `handleAgent`: sau khi có `deadline`, gán `prov.deadline = deadline`. (e) Thêm `renderUrl` vào câu "KHÔNG đáng tin" trong system prompt.
- [ ] **Step 4:** `npm test` → toàn bộ PASS.
- [ ] **Step 5:** `git add lib/agent-policy.js agent.js test/agent-policy.test.js && git commit -m "feat(agent): cong cu renderUrl, gioi han 1 lan/yeu cau, kep theo thoi gian con lai"`.

### Task 9: Tài liệu

**Files:** Modify: `docs/AGENT.md` (danh sách công cụ + mục "Đọc trang cần JavaScript": khi nào dùng, giới hạn, TikTok chỉ qua oEmbed, trang chặn bot thì bot báo "chặn"), `docs/CAU-HINH.md` (bảng `RENDER_*`), `README.md` (một dòng trong bảng tính năng nhóm Agent AI).

- [ ] **Step 1:** Viết ba phần trên bằng tiếng Việt, số liệu khớp Global Constraints (60 giây mặc định, trần 90, 10 lần/giờ, 600 MB).
- [ ] **Step 2:** `grep -n "renderUrl\|RENDER_" docs/AGENT.md docs/CAU-HINH.md README.md` → có kết quả ở cả ba file.
- [ ] **Step 3:** `git add docs/AGENT.md docs/CAU-HINH.md README.md && git commit -m "docs: renderUrl va cau hinh RENDER_*"`.

### Task 10: Kiểm tra cuối và triển khai (cần chủ máy)

**Files:** không đổi code, trừ khi phát hiện lỗi.

- [ ] **Step 1:** `npm test` → PASS toàn bộ, không có ca tích hợp nào bị skip trên máy này.
- [ ] **Step 2:** Kiểm oEmbed thật bằng `node -e "require('./lib/oembed').fetchOembed('https://www.tiktok.com/@dogvanvat').then(r=>console.log(r.authorName))"` → in `dogvạnvật`.
- [ ] **Step 3:** Kiểm 20 lần render liên tiếp trên trang cục bộ bằng script bỏ đi trong `~/test-phan-mem/` (script truyền `limiter` riêng với `maxPerHour` lớn để không chạm giới hạn 10 lần/giờ); sau đó `pgrep -f 'user-data-dir=/tmp/'` rỗng, không còn thư mục tạm của lần chạy trong `/tmp`, RAM `free -m` không tăng đáng kể, `pm2 ls` vẫn `online` và 0 lần restart.
- [ ] **Step 4:** Báo chủ máy kết quả và xin phép: (a) `pm2 restart dog-bot` (tên thật của tiến trình, không phải `homelab-bot`); (b) sau khi restart, chủ máy tự nhắn bot thử một link TikTok và một trang cần JavaScript; (c) merge nhánh `feat/render-url` vào `master` và push. **Không làm (a)–(c) khi chưa có đồng ý.**
- [ ] **Step 5:** Nếu có lỗi ở bước thử thật, sửa trên nhánh kèm test, commit rồi báo lại.
