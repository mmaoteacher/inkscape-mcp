import { traceSchema, traceBitmap } from "./trace.ts";
import { previewSchema, renderPreview } from "./preview.ts";
import { cropSchema, cropBitmap } from "./crop.ts";

export const tools = [
  { name: "inkscape_trace_bitmap", schema: traceSchema, handler: traceBitmap },
  { name: "inkscape_render_preview", schema: previewSchema, handler: renderPreview },
  { name: "inkscape_crop_bitmap", schema: cropSchema, handler: cropBitmap },
];
