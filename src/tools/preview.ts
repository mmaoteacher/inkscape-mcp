import { z } from "zod";

export const previewSchema = z.object({
  filePath: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
});

export async function renderPreview(args: z.infer<typeof previewSchema>) {
  const base64Mock = Buffer.from(`preview:${args.filePath}:${args.width ?? 800}x${args.height ?? 600}`).toString("base64");
  return {
    content: [
      { type: "text" as const, text: `Rendered preview for ${args.filePath}` },
      { type: "image" as const, data: base64Mock, mimeType: "image/png" },
    ],
  };
}
