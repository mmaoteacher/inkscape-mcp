# inkscape-mcp

MIT licensed MCP server for Inkscape. Enables AI agents to call vector editing, bitmap tracing (`trace_bitmap`), and visual preview (`render_preview`).

## Quick start
```bash
npx -y inkscape-mcp
```

## Claude Desktop config
```json
{
  "mcpServers": {
    "inkscape": {
      "command": "npx",
      "args": ["-y", "inkscape-mcp"]
    }
  }
}
```

## Architecture
MCP Protocol → Tool Layer → Inkscape Engine (`cli-batch` stateless, `shell-daemon` future).
