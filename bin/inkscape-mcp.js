#!/usr/bin/env node
// 啟動實際的 McpServer（stdio 模式預設，支援 MCP_TRANSPORT=http 切換 Streamable HTTP）
import { spawnSync } from "child_process";

const mode = process.env.MCP_TRANSPORT || "stdio";
console.log(`inkscape-mcp 啟動模式: ${mode}`);

if (mode === "http" || mode === "streamable") {
  console.log("使用 Streamable HTTP 傳輸，預設 port 3000（可由 MCP_PORT 設定）");
}

// 實際執行 src/index.ts（使用 tsx 以支援 TypeScript 模組直接執行）
const result = spawnSync("npx", ["tsx", "src/index.ts"], {
  stdio: "inherit",
  env: { ...process.env, MCP_TRANSPORT: mode },
  shell: false,
});
process.exit(result.status ?? 1);
