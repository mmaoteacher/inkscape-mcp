import { z } from "zod";
import { spawnSync } from "child_process";
import { readFileSync, existsSync } from "fs";
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
  let base64Data = "";
  if (result.status === 0 && existsSync(outFile)) {
    base64Data = readFileSync(outFile).toString("base64");
  } else {
    base64Data = Buffer.from("(preview generation failed: " + result.stderr.slice(0, 200) + ")").toString("base64");
  }
  return {
    content: [
      { type: "text" as const, text: `Rendered preview for ${args.filePath} using binary: ${binary} (status=${result.status})` },
      { type: "image" as const, data: base64Data, mimeType: "image/png" },
    ],
  };
}
