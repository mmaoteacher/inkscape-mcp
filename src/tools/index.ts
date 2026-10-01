import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { traceSchema, traceBitmap, traceDescription } from "./trace.ts";
import { previewSchema, renderPreview, previewDescription } from "./preview.ts";
import { cropSchema, cropBitmap, cropDescription } from "./crop.ts";
import { rawActionsSchema, runRawActions, rawActionsDescription } from "./raw-actions.ts";
import { booleanOpSchema, runBooleanOp, booleanOpDescription } from "./boolean-op.ts";
import { textToPathSchema, runTextToPath, textToPathDescription } from "./text-to-path.ts";
import { createDocumentSchema, runCreateDocument, createDocumentDescription } from "./create-document.ts";
import { addShapeSchema, runAddShape, addShapeDescription } from "./add-shape.ts";
import { addTextSchema, runAddText, addTextDescription } from "./add-text.ts";
import { listObjectsSchema, runListObjects, listObjectsDescription } from "./list-objects.ts";

export interface McpTool {
  name: string;
  description?: string;
  schema: z.ZodTypeAny;
  handler: (args: any) => Promise<CallToolResult>;
}

export const tools: McpTool[] = [
  { name: "inkscape_create_document", description: createDocumentDescription, schema: createDocumentSchema, handler: runCreateDocument },
  { name: "inkscape_add_shape", description: addShapeDescription, schema: addShapeSchema, handler: runAddShape },
  { name: "inkscape_add_text", description: addTextDescription, schema: addTextSchema, handler: runAddText },
  { name: "inkscape_list_objects", description: listObjectsDescription, schema: listObjectsSchema, handler: runListObjects },
  { name: "inkscape_trace_bitmap", description: traceDescription, schema: traceSchema, handler: traceBitmap },
  { name: "inkscape_render_preview", description: previewDescription, schema: previewSchema, handler: renderPreview },
  { name: "inkscape_crop_bitmap", description: cropDescription, schema: cropSchema, handler: cropBitmap },
  { name: "inkscape_raw_actions", description: rawActionsDescription, schema: rawActionsSchema, handler: runRawActions },
  { name: "inkscape_boolean_op", description: booleanOpDescription, schema: booleanOpSchema, handler: runBooleanOp },
  { name: "inkscape_text_to_path", description: textToPathDescription, schema: textToPathSchema, handler: runTextToPath },
];
