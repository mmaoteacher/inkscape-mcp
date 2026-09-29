import { traceSchema, traceBitmap } from "./trace.ts";
import { previewSchema, renderPreview } from "./preview.ts";

export const tools = [
  { name: "inkscape_trace_bitmap", schema: traceSchema, handler: traceBitmap },
  { name: "inkscape_render_preview", schema: previewSchema, handler: renderPreview },
];
