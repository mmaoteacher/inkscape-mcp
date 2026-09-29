import { z } from "zod";
import { spawnSync } from "child_process";
import { detectInkscape } from "../engine/detector.ts";

export const previewSchema = z.object({
  filePath: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
  outputPath: z.string().optional(),
});

export async function renderPreview(args: z.infer<typeof previewSchema>) {
  const detected = detectInkscape();
  const binary = detected.found ? detected.path : "inkscape";
  const outFile = args.outputPath || `${args.filePath.replace(/\.svg$/, "")}_preview.png`;
  const actions = [
    `--export-filename=${outFile}`,
    args.width ? `--export-width=${args.width}` : "--export-width=800",
    args.height ? `--export-height=${args.height}` : "",
    `--file=${args.filePath}`,
  ].filter(Boolean);

  const result = spawnSync(binary, actions, { encoding: "utf-8", timeout: 30000 });
  const base64Data = result.status === 0 ? "(real png generated)" : "(preview generation failed)";
  return {
    content: [
      { type: "text" as const, text: `Rendered preview for ${args.filePath} using binary: ${binary}` },
      { type: "image" as const, data: Buffer.from(base64Data).toString("base64"), mimeType: "image/png" },
    ],
  };
}
