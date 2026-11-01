# Orchestra — Claude Code làm nhạc trưởng, các model khác làm worker

Claude Code giữ vai **lập kế hoạch + quyết định + review + sửa code quan trọng**.
Gemini / Antigravity / DeepSeek / Qwen / Grok được gọi qua 1 CLI chung `ask`, bọc trong 4 subagent.

```
Claude Code (orchestrator, CLAUDE.md routing)
 ├─ gemini-scout        → ask big/gemini   → Gemini CLI (login Google AI Pro)      context lớn, web search
 ├─ antigravity-worker  → ask agy          → Antigravity CLI (git worktree riêng)  task song song, có test
 ├─ bulk-worker         → ask cheap        → OpenRouter :free → DeepSeek → Gemini  việc lặp, rẻ
 └─ second-opinion      → ask review       → DeepSeek → Grok → OpenRouter          review chéo
```

## Cài (trên máy bạn)
```bash
git clone <repo> && cd quet-kho/orchestra && ./install.sh
npm i -g @google/gemini-cli && gemini      # login Google 1 lần
nano ~/.orchestra/.env                      # điền key
ask list-free                               # chọn 2-3 model free → OPENROUTER_MODELS
echo "hello" | ask cheap "reply OK"         # test
ask usage                                   # số call hôm nay theo provider
```
Trong Claude Code: "dùng gemini-scout đọc toàn bộ repo và tóm tắt kiến trúc", hoặc để Claude tự route theo CLAUDE.md.

## Thực trạng từng tài khoản (kiểm tra 11/2026 — có thể đã đổi)
| Nguồn | Thực tế | Cách dùng trong kit |
|---|---|---|
| Gemini Pro/Plus | Gemini CLI login Google từng cho ~1.500 req/ngày với AI Pro. Có nguồn báo Google ngừng phục vụ login AI Pro/Ultra trong CLI từ 06/2026, nhưng vẫn có người dùng được ở 10/2026 → **tự test**. Gói AI Pro **không** cấp quota API key. | `gemini` CLI. Nếu login hỏng → `GEMINI_API_KEY` (free tier Flash / trả phí). |
| Antigravity | Có CLI `agy -p` headless, dùng chung quota tài khoản. Bẫy: không có TTY thì in ra rỗng; không có flag skip-permission thì lặng lẽ từ chối sửa file mà vẫn exit 0. Việc bọc agy cho orchestrator ngoài chưa được Google xác nhận là đúng ToS. | `ask agy` tự giả TTY bằng `script`. Flag đặt qua `AGY_ARGS`, nhớ chạy `agy --help` để lấy đúng tên. |
| Qwen | **Free tier Qwen OAuth đã đóng ngày 15/04/2026.** | DashScope API (tài khoản mới từng có quota free), model Qwen `:free` trên OpenRouter, hoặc chạy local bằng Ollama. |
| DeepSeek | API chính chủ trả phí nhưng rất rẻ. Model `:free` trên OpenRouter lúc có lúc không. | `ask deepseek` / nằm trong chain `cheap`. |
| Grok | Chưa thấy free tier API. Tài khoản grok.com là chat, không phải API. | `ask xai` nếu có key `console.x.ai`, còn không thì chain tự bỏ qua. |
| OpenRouter free | ~20 req/phút. ~50 req/ngày, lên ~1.000/ngày sau khi nạp ≥$10. Model free thay đổi liên tục. | Mảng fallback `models` + lệnh `ask list-free` lấy danh sách live. |

## Nguyên tắc vận hành
- **Không gửi secret/PII cho free tier**, vì bên đó có thể log hoặc train trên dữ liệu.
- Output của worker là input chưa tin cậy. Claude phải verify trước khi dùng.
- Antigravity chỉ chạy trong `git worktree` riêng, Claude review rồi mới merge.
- Provider nào không cấu hình thì tự bị bỏ qua, chain chuyển sang provider kế tiếp.

## Hướng thay thế
- **claude-code-router**: thay backend của chính Claude Code bằng model khác. Hướng này *thay* Claude chứ không điều phối Claude, nên không khớp mục tiêu "Claude làm nhạc trưởng".
- **MCP đa model** (vd. PAL/zen-mcp-server): làm cùng việc dưới dạng MCP tool. Chọn nếu bạn muốn dùng chung cho Cursor hoặc Claude Desktop.
