import { z } from "zod";
import { spawnSync } from "child_process";
import { detectInkscape } from "../engine/detector.ts";

export const cropSchema = z.object({
  inputPath: z.string(),
  outputPath: z.string().optional(),
  cropArea: z.object({
    x: z.number().optional().default(0),
    y: z.number().optional().default(0),
    w: z.number().optional().default(0),
    h: z.number().optional().default(0),
  }).optional().default({ x: 0, y: 0, w: 0, h: 0 }),
  noiseRemoval: z.boolean().optional().default(false),
});

export async function cropBitmap(args: z.infer<typeof cropSchema>) {
  const detected = detectInkscape();
  const binary = detected.found ? detected.path : "inkscape";
  const outFile = args.outputPath || args.inputPath.replace(/\.(png|jpg|jpeg|bmp|gif|svg)$/i, "_cropped.svg");

  const area = args.cropArea || { x: 0, y: 0, w: 0, h: 0 };
  const useArea = (area.w > 0 && area.h > 0)
    ? `--export-area=${area.x}:${area.y}:${area.x + area.w}:${area.y + area.h}`
    : "";

  const noiseAction = args.noiseRemoval ? ";bitmap-effect.despeckle" : "";

  const actions = [
    `--file=${args.inputPath}`,
    `--export-filename=${outFile}`,
    `--export-type=svg`,
    `--actions=select-all;${useArea ? "" : ""}${noiseAction ? noiseAction : ""};export-do`,
  ].filter((a) => !a.includes("undefined") && a.length > 0);

  // 若有裁切區域，使用 --export-area 參數（更可靠）
  const cmdArgs = [
    ...(useArea ? [useArea] : []),
    `--file=${args.inputPath}`,
    `--export-filename=${outFile}`,
    `--export-type=svg`,
    ...(args.noiseRemoval ? ["--actions=select-all;bitmap-effect.despeckle"] : []),
  ].filter(Boolean);

  const result = spawnSync(binary, cmdArgs, { encoding: "utf-8", timeout: 30000 });
  const success = result.status === 0 && result.stderr.indexOf("Error") === -1;

  return {
    content: [
      {
        type: "text" as const,
        text: `Crop bitmap: ${args.inputPath} → ${outFile}\nArea: ${useArea || "full canvas"}\nNoise removal: ${args.noiseRemoval ? "ON" : "OFF"}\nStatus: ${success ? "OK" : "FAILED"}\nBinary: ${binary}\nStderr: ${result.stderr.slice(-200)}`,
      },
    ],
  };
}
