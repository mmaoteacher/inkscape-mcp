# inkscape-mcp

MIT licensed MCP server for [Inkscape](https://inkscape.org). Lets an AI agent trace bitmaps to
real vector paths, edit SVG geometry, and verify results visually.

Every tool shells out to a real Inkscape binary (auto-detected on `PATH` or at
`/Applications/Inkscape.app`) and **validates its own output** — a tool reports `FAILED` rather than
`OK` when Inkscape silently skipped work, which is a failure mode Inkscape itself does not signal
(it often exits `0` after rejecting part of an action chain).

## Quick start

```bash
npx -y inkscape-mcp
```

### opencode

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "inkscape": { "type": "local", "command": ["npx", "-y", "inkscape-mcp"], "enabled": true }
  }
}
```

### Claude Desktop

```json
{ "mcpServers": { "inkscape": { "command": "npx", "args": ["-y", "inkscape-mcp"] } } }
```

## Tools

| Tool | Purpose |
|---|---|
| `inkscape_trace_bitmap` | Raster → real vector `<path>` outlines via potrace. Two-pass export removes the leftover embedded bitmap. `colorCount` (2–8) sets colour layers, `binary` collapses to pure `#000000`/`#ffffff`, `smoothing` optimises corners, `threshold` drives speckle removal. |
| `inkscape_render_preview` | Renders an SVG to PNG and returns it inline as base64. Use it to confirm an edit actually changed the geometry. |
| `inkscape_crop_bitmap` | Crops a region and optionally despeckles first. `cropArea` is `{x,y,w,h}` in **source image pixels** — converted internally to Inkscape document units and exported at matching DPI so output dimensions are exact. |
| `inkscape_raw_actions` | Escape hatch: run any semicolon-separated Inkscape action chain (`"select-all;object-stroke-to-path;path-simplify"`). Supports `exportWidth`, `exportDpi`, `exportArea`. |
| `inkscape_boolean_op` | `union` / `difference` / `intersection` / `division` / `exclusion` / `combine` on paths, optionally targeting `objectIds`. Verifies the object count actually dropped, so non-overlapping shapes are reported as `FAILED`. |
| `inkscape_text_to_path` | Converts live `<text>` into vector outlines, optionally for specific `objectIds` and with `simplify`. Fails loudly if any `<text>` survives. |

### Listing available actions

`inkscape_raw_actions` can call any Inkscape action. To discover them:

```bash
/Applications/Inkscape.app/Contents/MacOS/inkscape --shell
# then: action-list
# then: quit
```

## Important: call tools sequentially

The MCP SDK dispatches `tools/call` requests **concurrently and out of order**. Tool execution is
serialised internally so two Inkscape processes never clash, but a tool that consumes another
tool's output must be sent **after** that tool's response arrives. Pipelining dependent calls
produces spurious `input not found` failures.

## Transports

- `stdio` (default) — set `MCP_TRANSPORT=stdio`
- Streamable HTTP — set `MCP_TRANSPORT=http`, optional `MCP_PORT` (default `3000`).
  Endpoints: `POST /mcp`, plus `GET /health` for liveness. Uses Node's built-in `node:http`;
  there is no web framework dependency.

## Architecture

```
MCP Protocol (src/index.ts, serialised tool queue)
  → Tool Layer (src/tools/*.ts — zod schema, reporting, output validation)
    → Engine (src/engine/runner.ts — one-shot Inkscape action batch)
      → Inkscape binary (src/engine/detector.ts resolves the path)
```

Helpers: `src/engine/raster-size.ts` reads PNG/JPEG/GIF/BMP pixel dimensions straight from the
file header, so `crop` can convert source pixels into document units without a round trip.

## Development

```bash
npm run dev         # run the server
npm run typecheck   # tsc --noEmit
npm run build       # type-check gate
```

Sources are executed directly via `tsx`, so there is no build output; `build` is a type-check gate.
