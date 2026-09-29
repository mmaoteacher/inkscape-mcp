import { z } from "zod";
import { spawnSync } from "child_process";
import { detectInkscape } from "../engine/detector.ts";

export const traceSchema = z.object({
  inputPath: z.string(),
  outputPath: z.string().optional(),
  brightnessSteps: z.number().optional().default(3),
  threshold: z.number().optional().default(0.45),
});

export async function traceBitmap(args: z.infer<typeof traceSchema>) {
  const detected = detectInkscape();
  const binary = detected.found ? detected.path : "inkscape";
  const outFile = args.outputPath || args.inputPath.replace(/\.(png|jpg|jpeg|bmp|gif)$/i, "_traced.svg");

  // 使用 inkscape --actions 執行：開啟位圖 → 選取全部 → 執行 object-trace（點陣轉向量）→ 匯出為 SVG
  const actions = [
    `--file=${args.inputPath}`,
    `--export-filename=${outFile}`,
    `--export-type=svg`,
    `--actions=select-all;object-trace:${args.brightnessSteps},true,false,false;object-to-path`,
  ];

  const result = spawnSync(binary, actions, { encoding: "utf-8", timeout: 30000 });
  const success = result.status === 0 && result.stderr.indexOf("Error") === -1;

  return {
    content: [
      {
        type: "text" as const,
        text: `Trace bitmap: ${args.inputPath} → ${outFile}\nBinary: ${binary}\nStatus: ${success ? "OK" : "FAILED"}\nStdout: ${result.stdout.slice(-200)}\nStderr: ${result.stderr.slice(-200)}`,
      },
    ],
  };
}
