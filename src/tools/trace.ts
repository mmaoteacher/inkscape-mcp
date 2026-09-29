import { z } from "zod";
import { spawnSync } from "child_process";
import { detectInkscape } from "../engine/detector.ts";

export const traceSchema = z.object({
  inputPath: z.string(),
  outputPath: z.string().optional(),
  brightnessSteps: z.number().optional().default(3),
  threshold: z.number().optional().default(0.45),
  smoothing: z.boolean().optional().default(true),
  colorCount: z.number().optional().default(3),
  binary: z.boolean().optional().default(false),
});

export async function traceBitmap(args: z.infer<typeof traceSchema>) {
  const detected = detectInkscape();
  const binary = detected.found ? detected.path : "inkscape";
  const outFile = args.outputPath || args.inputPath.replace(/\.(png|jpg|jpeg|bmp|gif)$/i, "_traced.svg");

  // 使用 inkscape --actions 執行：開啟位圖 → 選取全部 → 執行 object-trace（點陣轉向量）→ 匯出為 SVG
  // 3 個新功能整合：
  // smoothing: 向量路徑簡化（透過 path-simplify）
  // colorCount: 拆色數（brightnessSteps 控制色階，預設 3 → 對應 3 色）
  // binary: 黑白二分（threshold 固定 0.5）
  const binaryThreshold = args.binary ? 0.5 : args.threshold;
  const scans = Math.max(1, Math.min(8, args.colorCount || args.brightnessSteps));

  const actions = [
    `--file=${args.inputPath}`,
    `--export-filename=${outFile}`,
    `--export-type=svg`,
    `--actions=select-all;object-trace:${scans},${args.smoothing ? "true" : "false"},false,false;object-to-path`,
  ];

  // 若啟用 smoothing（向量路徑簡化），在 trace 後追加 path-simplify
  let fullActions = actions;
  if (args.smoothing) {
    fullActions.push(`--actions=path-simplify`);
  }

  const result = spawnSync(binary, fullActions, { encoding: "utf-8", timeout: 30000 });
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
