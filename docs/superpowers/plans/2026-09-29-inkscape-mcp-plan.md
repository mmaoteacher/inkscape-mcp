# inkscape-mcp 實作計畫

- 基於 spec：`2026-09-29-inkscape-mcp-design.md`
- Branch：`feature/inkscape-mcp`

## 任務清單（依四步順序）

### Step 1：環境探測與偵錯（detector.ts）
- [ ] 建立 `src/engine/detector.ts`：檢查 `inkscape --version`、回傳路徑提示。
- [ ] 錯誤處理：未安裝時提示 macOS (`brew install inkscape`)、Ubuntu (`apt install inkscape`)、Windows 路徑。

### Step 2：Stateless CLI 引擎（cli-batch.ts）
- [ ] 建立 `src/engine/types.ts`：定義 `InkscapeEngine` 抽象介面、`ExecutionContext`、`ExecutionResult`。
- [ ] 建立 `src/engine/cli-batch.ts`：用 `child_process.spawn` 包裝 `inkscape --actions="..."`，捕獲 stdout/stderr/durationMs。
- [ ] 建立 `src/engine/index.ts`：匯出引擎實例（MVP 用 `CliBatchEngine`）。

### Step 3：落地前兩個核心 Tools
- [ ] `src/tools/trace.ts`：`inkscape_trace_bitmap`（點陣轉向量，Potrace）。
- [ ] `src/tools/preview.ts`：`inkscape_render_preview`（產生縮圖回傳 Base64，MCP 多模態格式 text + image）。
- [ ] `src/tools/index.ts`：註冊所有工具，綁定 `McpServer`。

### Step 4：README 與啟動入口
- [ ] `bin/inkscape-mcp.js`：CLI 啟動腳本（`#!/usr/bin/env node`）。
- [ ] `package.json`：`bin` 入口、`MIT` 授權、相依套件（`@modelcontextprotocol/sdk`、`zod` 等）。
- [ ] `README.md`：包含 Claude Desktop 配置範例、展示圖說明、四步實作順序摘要。
- [ ] `tsconfig.json`：TypeScript 設定。

## 依賴順序
```
detector → types → cli-batch → trace/preview → index (server) → bin/README/package
```

## 驗收點
- `node bin/inkscape-mcp.js` 可啟動（即使沒有 inkscape 也應給出清晰提示）。
- `trace` 與 `preview` 工具結構完整（Zod Schema + Mock Engine 可驗證回傳格式）。
