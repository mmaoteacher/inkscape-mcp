import { z } from "zod";
import { spawnSync } from "child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
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

export const traceDescription = [
  "Trace a raster image (PNG/JPG/etc.) into real vector paths with Inkscape.",
  "Requires a two-pass export: pass 1 runs object-trace (potrace) and object-to-path,",
  "pass 2 removes the leftover embedded <image> element so the result is pure vector.",
  "Params: colorCount = number of colour layers to trace (scans, clamped to 2-8),",
  "binary = collapse all traced layers onto a pure #000000/#ffffff two-tone ramp,",
  "smoothing = potrace corner optimisation,",
  "threshold = speckle removal strength (0-1).",
].join(" ");

interface TraceValidation {
  ok: boolean;
  pathCount: number;
  hasEmbeddedImage: boolean;
  hasBase64: boolean;
  sizeBytes: number;
  collapsedFills?: number;
  reason?: string;
}

function runInkscape(binary: string, argv: string[]) {
  return spawnSync(binary, argv, { encoding: "utf-8", timeout: 120000 });
}

function validateSvg(filePath: string): TraceValidation {
  if (!existsSync(filePath)) {
    return {
      ok: false,
      pathCount: 0,
      hasEmbeddedImage: false,
      hasBase64: false,
      sizeBytes: 0,
      reason: "output file was not created",
    };
  }

  const svg = readFileSync(filePath, "utf-8");
  const pathCount = (svg.match(/<path[\s>]/g) || []).length;
  const hasEmbeddedImage = /<image[\s>]/.test(svg);
  const hasBase64 = /data:image\/[a-z+]+;base64/.test(svg);
  const sizeBytes = Buffer.byteLength(svg);

  let reason: string | undefined;
  if (pathCount === 0) reason = "no <path> elements found - tracing did not produce vectors";
  else if (hasEmbeddedImage || hasBase64) reason = "embedded raster image still present in output";

  return { ok: reason === undefined, pathCount, hasEmbeddedImage, hasBase64, sizeBytes, reason };
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * Collapse every traced fill onto a pure black/white two-tone ramp.
 * potrace emits one stacked path per colour layer, so mapping each layer by relative
 * luminance preserves the artwork's stacking order while guaranteeing exactly two colours.
 */
function collapseToTwoTone(filePath: string): number {
  const svg = readFileSync(filePath, "utf-8");
  const fills = Array.from(svg.matchAll(/fill:(#[0-9a-fA-F]{3,8})/g)).map((m) => m[1]);
  if (fills.length === 0) return 0;

  const luminances = fills.map(relativeLuminance);
  const darkest = Math.min(...luminances);
  const lightest = Math.max(...luminances);
  const span = lightest - darkest;

  const mapping = new Map<string, string>();
  fills.forEach((fill, i) => {
    if (span < 1e-6) {
      mapping.set(fill, "#000000");
      return;
    }
    const t = (luminances[i] - darkest) / span;
    mapping.set(fill, t < 0.5 ? "#000000" : "#ffffff");
  });

  let collapsed = 0;
  const out = svg.replace(/fill:(#[0-9a-fA-F]{3,8})/g, (match, fill: string) => {
    const next = mapping.get(fill);
    if (!next || next === fill) return match;
    collapsed += 1;
    return `fill:${next}`;
  });

  writeFileSync(filePath, out);
  return collapsed;
}

export async function traceBitmap(rawArgs: z.infer<typeof traceSchema>) {
  // Parse defensively so the tool behaves identically whether it is reached through
  // the MCP schema layer or called directly (defaults must never leak through as NaN).
  const args = traceSchema.parse(rawArgs);

  const detected = detectInkscape();
  const binary = detected.found ? detected.path : "inkscape";
  const outFile =
    args.outputPath || args.inputPath.replace(/\.(png|jpg|jpeg|bmp|gif|tiff?)$/i, "_traced.svg");

  // Potrace `scans` = number of colour layers to trace. At least 2 are always required:
  // scanning with 1 level degenerates into a single flat rectangle.
  // `binary` is applied afterwards as a pure black/white two-tone collapse.
  const scans = Math.max(2, Math.min(8, Math.round(args.colorCount || args.brightnessSteps || 3)));
  const smooth = args.smoothing ? "true" : "false";
  // Stacking produces cleaner layered colour output for multi-colour traces.
  const stack = scans > 1 ? "true" : "false";
  const removeBackground = "false";
  // threshold (0-1) drives how aggressively isolated specks are dropped.
  const speckles = String(Math.max(0, Math.min(10, Math.round(args.threshold * 10))));
  const smoothCorners = "1";
  const optimize = "1";

  const workDir = mkdtempSync(join(tmpdir(), "inkscape-trace-"));
  const tracedFile = join(workDir, "traced.svg");

  const traceArgv = [
    `--file=${args.inputPath}`,
    "--export-type=svg",
    `--export-filename=${tracedFile}`,
    "--export-overwrite",
    `--actions=select-all;object-trace:${scans},${smooth},${stack},${removeBackground},${speckles},${smoothCorners},${optimize};object-to-path`,
  ];

  const cleanArgv = [
    `--file=${tracedFile}`,
    "--export-type=svg",
    `--export-filename=${outFile}`,
    "--export-overwrite",
    "--actions=select-by-element:image;delete",
  ];

  const traceRun = runInkscape(binary, traceArgv);
  let cleanRun: ReturnType<typeof runInkscape> | null = null;
  let validation = validateSvg(tracedFile);

  // Pass 2 only makes sense once pass 1 produced vectors.
  if (validation.pathCount > 0) {
    cleanRun = runInkscape(binary, cleanArgv);
    if (cleanRun.status === 0) {
      validation = validateSvg(outFile);
      if (validation.ok && args.binary) {
        const collapsed = collapseToTwoTone(outFile);
        validation = { ...validateSvg(outFile), collapsedFills: collapsed };
      }
    } else {
      validation = {
        ...validation,
        ok: false,
        reason: `vector cleanup pass failed (exit ${cleanRun.status})`,
      };
    }
  }

  rmSync(workDir, { recursive: true, force: true });

  const traceFailed =
    traceRun.status !== 0 || /could not find action|expected argument format/.test(traceRun.stderr);
  const success = !traceFailed && validation.ok;

  const report = [
    `Trace bitmap: ${args.inputPath} -> ${outFile}`,
    `Binary: ${binary}`,
    `Params: scans=${scans} smooth=${smooth} stack=${stack} removeBackground=${removeBackground} speckles=${speckles}`,
    `Status: ${success ? "OK" : "FAILED"}`,
    `Vector paths: ${validation.pathCount}`,
    `Embedded raster: ${validation.hasEmbeddedImage ? "yes" : "no"}`,
    `Output size: ${validation.sizeBytes} bytes`,
  ];
  if (validation.collapsedFills !== undefined) {
    report.push(`Two-tone collapse: ${validation.collapsedFills} fill(s) mapped to #000000/#ffffff`);
  }
  if (validation.reason) report.push(`Reason: ${validation.reason}`);
  if (traceRun.stderr.trim()) report.push(`Trace stderr: ${traceRun.stderr.trim().slice(-300)}`);
  if (cleanRun?.stderr.trim()) report.push(`Cleanup stderr: ${cleanRun.stderr.trim().slice(-300)}`);

  return {
    content: [{ type: "text" as const, text: report.join("\n") }],
    isError: !success,
  };
}
