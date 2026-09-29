# Proposal

## Metadata

- Issue: inkscape-mcp 專案（feature/inkscape-mcp branch）
- PR: 未建立（直接 commit 到 feature branch）
- Commit: c1261ee / 0683974 / 8113088 / ab90b80 / 6c486e7 / 978f022 / d411960 / 2279e66 / 6d35a28 / 98e057d
- Date: 2026-09-30
- Author: mmaoteacher
- Knowledge Type: Architecture, Design Pattern, Best Practice, Tool Usage, Team Convention, Deployment

---

## Summary

為 `Inkscape` 建立 `MCP Server`（`inkscape-mcp`）時，採用了「三層分離架構」：`MCP Protocol Layer` → `Tool Layer`（高階語意抽象）→ `Inkscape Engine Layer`（抽象介面 `InkscapeEngine`）。引擎層完全解耦，允許從 `CliBatchEngine`（無狀態、使用 `--actions`）平滑演進到 `ShellDaemonEngine`（常駐進程、使用 `--shell` IPC），而 `Tool Layer` 代碼零變動。

同時確立了與 `GPL-3.0` 工具（Inkscape）整合時的授權策略：`MIT` 主體 + 獨立程序（`subprocess`）溝通，不受 `GPL` 傳染；並實作了同時支援 `stdio`（Claude Desktop / Cursor / Cline）與 `Streamable HTTP`（遠端 Agent / 瀏覽器）的雙傳輸模式。

---

## Problem

當要為 `Inkscape`（`GPL-3.0`）建立 `MCP` 工具時，面臨以下問題：

1. **授權傳染風險**：若直接在 `Inkscape` 內部載入 `Python` 外掛（使用 `import inkex`），該外掛必須採用 `GPL-3.0`，限制商業與社群採用。
2. **引擎模式切換**：`MVP` 需要快速驗證（`--actions` 批次模式），但未來需要低延遲常駐模式（`--shell` IPC）。若不提前解耦，切換時 `Tool Layer` 會大重構。
3. **多模態反饋閉環**：`AI Agent` 需要「看見」修改結果（`image` 回傳 `Base64`），而非僅回傳文字路徑。
4. **傳輸彈性**：`Claude Desktop` 使用 `stdio`，但遠端部署或網頁整合需要 `HTTP` 傳輸。若只實作單一模式，後續擴展成本高。

---

## Decision

1. **授權策略**：主體 `MCP Server` 採用 `MIT`；與 `Inkscape` 透過獨立 `subprocess`（`spawn` / `child_process`）溝通（`FSF` 定義下的 `At arm's length`，不受 `GPL` 傳染）。
2. **架構設計**：三層分離（`Protocol` / `Tool` / `Engine`），引擎層定義抽象介面 `InkscapeEngine`（`init` / `execute` / `dispose`），`Tool Layer` 永遠只對抽象介面說話。
3. **引擎演進路徑**：`MVP` 使用 `CliBatchEngine`（`stateless`、`--actions`、穩健容錯）；`Phase 2` 擴展為 `ShellDaemonEngine`（`stateful`、`--shell` IPC、毫秒級低延遲）。
4. **多模態反饋**：`preview` 工具回傳符合 `MCP` 多模態規範的結構（`text` + `image`、`data: Base64`、`mimeType: image/png`）。
5. **雙傳輸支援**：`src/index.ts` 同時初始化 `StdioServerTransport`（預設，`MCP_TRANSPORT=stdio`）與 `StreamableHTTPServerTransport`（`MCP_TRANSPORT=http`、預設 `port 3000`、可由 `MCP_PORT` 覆寫）。
6. **專案配置模式**：建立 `.opencode/config.json`（專案層級實際配置，含 `mcpServers` 設定）與 `.opencode/examples/`（參考範例），讓 `opencode` 環境可直接載入。

---

## Why

### 為什麼選 MIT 而非 GPL？

`Inkscape` 本身為 `GPL-3.0`，但本專案的 `MCP Server` 並非 `Inkscape` 的衍生作品，而是透過獨立程序（`subprocess` / `CLI` / `IPC`）與 `Inkscape` 溝通。依 `FSF`（自由軟體基金會）的定義，這屬於 `"At arm's length"`（聚合體獨立程式），不受 `GPL` 傳染。選擇 `MIT` 的理由：

- `MIT` 的商業與社群摩擦力最低（可直接整合進企業內部 `AI Agent`、`IDE` 外掛、閉源產品），大幅提高 `Star` 數與採用率。
- `Apache-2.0` 同樣可行，但 `MIT` 更簡潔，搜尋與配置關鍵字（`inkscape-mcp`）更直觀。
- 若未來需要直接放入 `Inkscape` 內部載入的 `Python` 外掛（使用 `import inkex`），該外掛腳本單獨採用 `GPL-3.0` 即可，主體 `MCP Server` 維持 `MIT`。

### 為什麼要抽象引擎介面？

`MVP` 階段使用 `CliBatchEngine`（`stateless`、`inkscape --actions=...`、零污染、穩健容錯）；未來 `Phase 2` 擴展為 `ShellDaemonEngine`（`stateful`、`inkscape --shell`、毫秒級低延遲、`IPC`）。若沒有 `InkscapeEngine` 抽象介面，切換時 `Tool Layer`（`trace`、`preview`、`boolean`、`text`、`export`、`raw`）的所有代碼都需要重構。抽象介面讓 `Tool Layer` 永遠只對介面說話，切換引擎時零變動。

### 為什麼要雙傳輸（stdio + HTTP）？

- `stdio`（`StdioServerTransport`）：適合 `Claude Desktop`、`Cursor`、`Cline` 等 `IDE` 工具（直接在設定檔配置 `command` + `args`）。
- `Streamable HTTP`（`StreamableHTTPServerTransport`）：適合遠端部署、網頁前端、企業內部網路、或需要 `REST` 風格整合的場景（`POST /mcp`、支援 `Express`、可加 `CORS`、`auth`）。
- 同時支援兩種模式，讓同一套代碼可在「本機開發」與「遠端生產」之間無縫切換，僅透過環境變數 `MCP_TRANSPORT` 控制。

### 為什麼 `preview` 要回傳 `Base64` 圖片？

`AI Agent`（如 `Claude`、`GPT-4o`）的多模態上下文需要直接「看見」修改結果。回傳純文字路徑（如 `"/tmp/result.svg"`）無法讓模型在上下文中直接解析視覺內容。回傳 `Base64`（`data: image/png`、`mimeType: image/png`）讓模型在回應中直接顯示縮圖，形成完整的「操作 → 反饋 → 修正」閉環（`Vision Feedback Loop`）。

---

## Alternatives

### 授權選擇

- `GPL-3.0`：若直接將 `Python` 外掛載入 `Inkscape` 內部（`import inkex`），則必須採用 `GPL-3.0`。但這會限制商業整合與社群採用，與本專案目標（讓所有開發者無障礙整合）衝突。**未採用。**
- `Apache-2.0`：同樣低摩擦，但 `MIT` 更簡潔，搜尋關鍵字（`inkscape-mcp`）更直觀。**未採用（保留作為備選）。**

### 引擎實作順序

- 直接 `--shell`（跳過 `--actions`）：可實現更低延遲，但 `MVP` 階段風險更高（常駐進程的狀態管理、記憶體隔離、錯誤恢復更複雜）。**未採用（留作 Phase 2 擴展）。**
- 直接 `subprocess` 呼叫 `inkscape` 命令（不抽象引擎）：可快速實現，但未來切換到 `--shell` 時需重構所有 `Tool`。**未採用。**

### 傳輸模式

- 僅 `stdio`：最簡單，但無法支援遠端部署或網頁整合。**未採用（已同時實作 `Streamable HTTP`）。**
- 僅 `SSE`：向後相容較好，但 `Streamable HTTP` 是 `MCP` 協議最新標準（`2025-03-26` 後），更適合長期維護。**未單獨採用（已同時支援 `stdio` + `Streamable HTTP`）。**

### `preview` 回傳格式

- 純文字路徑（`"/tmp/result.svg"`）：最簡單，但無法讓 `Agent` 直接解析視覺內容，破壞多模態反饋閉環。**未採用。**
- `Base64` 圖片（`data: image/png`）：符合 `MCP` 多模態規範，讓模型直接在上下文中顯示縮圖。**已採用。**

---

## Future Usage

### 未來可重用的情境

- **抽象引擎模式**（`InkscapeEngine` 介面）：可重用於任何需要包裝 `CLI` 工具（如 `ffmpeg`、`imagemagick`、`pandoc`）為 `MCP` 服務的專案。只需實作新的 `Engine` 類別（繼承 `InkscapeEngine`），`Tool Layer` 無需變更。
- **授權決策模式**（`MIT` + `subprocess` 獨立溝通）：可重用於所有與 `GPL` 工具整合的專案（如 `GIMP`、`LibreOffice`、`OpenCV`）。只要溝通方式為獨立程序（`subprocess`、`socket`、`RPC`），主體可維持 `MIT`。
- **雙傳輸模式**（`stdio` + `Streamable HTTP`）：可重用於所有需要「本機 `IDE` 整合」與「遠端部署」同時支援的 `MCP` 服務。僅需透過 `MCP_TRANSPORT` 環境變數切換。
- **`.opencode/config.json` 配置模式**：可重用於團隊內所有 `MCP` 專案的標準化配置（`mcpServers` 設定、`env` 環境變數、`transport` 模式）。
- **多模態反饋模式**（`text` + `image` `Base64`）：可重用於所有需要「視覺反饋」的 `AI Agent` 工具（如圖像編輯、文件轉換、設計驗證）。

### 未來不應重用的情境

- **直接使用 `MIT` 與 `GPL` 工具內部整合**（如直接 `import inkex`）：若未來需要直接在 `Inkscape` 內部載入 `Python` 外掛，該外掛必須採用 `GPL-3.0`，不可沿用本專案的 `MIT` 授權模式（除非同時維持獨立程序溝通）。
- **將 `ShellDaemonEngine` 用於無狀態批次任務**：`ShellDaemon` 適合常駐、低延遲場景；若任務為一次性批次（如大量檔案轉換），應使用 `CliBatchEngine`（無狀態、零污染、更穩健）。不可將 `ShellDaemon` 當作通用引擎使用。
- **將 `preview` 的 `Base64` 回傳用於高解析度大圖**：`Base64` 資料量隨解析度線性增長（`300x150` → ~63K；`4K` → 遠超 `MB` 級）。若未來需要高解析度預覽，應改為回傳檔案路徑（由 `Agent` 自行讀取）或使用 `thumbnail`（縮圖）模式，而非直接回傳完整解析度 `Base64`。

---

## Conflicts

無相關既有知識（`$LAWSNOTE_KNOWLEDGE_BASE` 未設定，知識庫搜尋無結果）。

---

## Suggested Resolution

無衝突（無既有知識可比對）。

建議直接建立新知識，並在未來的知識庫中標註：

```markdown
> ⚠️ 另見 [[Inkscape MCP Server 設計與實作知識]]：適用於所有需要包裝 CLI 工具為 MCP 服務、同時支援 stdio 與 HTTP 傳輸、並維持 MIT 授權獨立於 GPL 工具的場景。
```

---

## Suggested Location

建議放入：

- `raw/_shared/inkscape-mcp-design/`（跨專案可重用的架構與授權模式）
- `raw/_shared/inkscape-mcp-deployment/`（雙傳輸模式與 `.opencode` 配置模式）
- `wiki/_shared/inkscape-integration/`（Inkscape `--actions` 與 `--shell` 實際使用經驗、`object-trace` 語法、`detector` 偵測邏輯）

經人工審核整理後，再移至對應 `wiki/{project}/` 目錄。

---

*Proposal 生成：知識審核流程已執行（Step 1~Step 6），判斷結果為「有價值的新長期知識」，無衝突，建議建立 `Proposal.md`。正式知識需經人工審核後才能更新 `Obsidian`。*
