# inkscape-mcp：Inkscape MCP Server 設計規格

- 票：使用者提供藍圖（命名、授權 MIT、架構、四步實作順序）
- 日期：2026-09-29
- Branch：main（從現有 workspace 繼續）

## 背景與問題
為 Inkscape 建立 MCP Server，讓 AI Agent（Claude Desktop、Cursor、Cline）能透過標準 MCP 協議呼叫 Inkscape 的向量編輯、點陣轉向量、布林運算與視覺預覽功能。需要極低採用門檻（MIT 授權）與高度可擴展的分層架構。

## 目標
- 建立 `inkscape-mcp` 專案（npm package `inkscape-mcp`）。
- 授權：MIT（與 Inkscape GPL-3.0 獨立，透過 subprocess 溝通，不受 GPL 傳染）。
- 分層架構：MCP Protocol → Tool Layer → Inkscape Engine（抽象介面），支援 CLI Batch 與未來 Shell Daemon。
- MVP 實作順序：環境探測 → CLI 引擎 → `trace_bitmap` / `render_preview` 兩個核心 Tools → README。

## 非目標
- 不寫直接載入 Inkscape 內部的 Python 外掛（若未來需要，該腳本單獨採 GPL-3.0）。
- 不在 MVP 階段實作 `--shell` 常駐進程（留作 Phase 2）。
- 不產出二進位檔（僅 HTML/JS/TypeScript 工具）。

## 現況分析
- Workspace 只有 `LICENSE`（MIT 已設定），`.git` 已初始化。
- 尚無 `package.json`、`src/`、`docs/` 結構。

## 方案設計
- 命名：`inkscape-mcp`（repo / npm package）。
- 授權：MIT（商業與社群摩擦最低）。
- 架構：三層分離（Protocol / Tool / Engine），`engine/types.ts` 定義抽象介面，未來可無縫切換 `cli-batch` 與 `shell-daemon`。
- 工具定義：`tools/` 包含 `trace.ts`、`preview.ts`、`boolean.ts`、`text.ts`、`export.ts`、`raw.ts`。
- 視覺反饋：`preview.ts` 回傳 MCP 多模態結構（text + image base64）。

## 決策紀錄
| 決策 | 考慮過的選項 | 最終決定 | 理由 |
|---|---|---|---|
| 授權 | MIT / Apache-2.0 / GPL | MIT | 最低摩擦，與 Inkscape 獨立溝通不受 GPL 傳染 |
| 命名 | inkscape-mcp / mcp-server-inkscape | inkscape-mcp | 最直觀、搜尋友善、適合 Claude Desktop 設定檔 |
| 引擎實作順序 | 直接 --shell / 先 --actions | 先 --actions (Stateless) | 穩健容錯、無狀態、零污染，Phase 2 再做 --shell |
| 核心 Tools MVP | 全 6 個 / 只做 2 個 | trace + preview | 打通核心能力與多模態反饋閉環，吸引力最高 |

## 影響範圍
- 會動到：`package.json`、`tsconfig.json`、`src/index.ts`、`src/server.ts`、`src/tools/`、`src/engine/`、`README.md`、`docs/superpowers/specs/`。
- 不影響現有 `LICENSE`（MIT 已確定）。

## 驗收計畫
### 靜態驗收
- 目錄結構完整（`bin/`、`src/`、`docs/`）。
- `package.json` 包含 `bin` 入口與 MIT 授權宣告。
- TypeScript 編譯無錯誤（`src/` 結構完整）。

### 實機驗收
- `npx -y inkscape-mcp` 可啟動（或 `node bin/inkscape-mcp.js`）。
- `inkscape_trace_bitmap` 與 `inkscape_render_preview` 工具可註冊並回應（可用 mock engine 驗證結構）。
- `README.md` 包含 Claude Desktop 配置範例與展示圖說明。

## 風險與未決事項
- 系統未安裝 `inkscape` 時，`detector.ts` 需提供清晰安裝提示（macOS `brew`、Ubuntu `apt`、Windows 路徑）。
- `--shell` 常駐進程為 Phase 2，不在本次 MVP 範圍。
- 知識庫 `$LAWSNOTE_KNOWLEDGE_BASE` 未設定，無相關歷史記錄可參考。
