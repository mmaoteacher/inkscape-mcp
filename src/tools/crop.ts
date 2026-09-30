import { z } from "zod";
import { spawnSync } from "child_process";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, extname } from "path";
import { detectInkscape } from "../engine/detector.ts";
import { readRasterSize } from "../engine/raster-size.ts";

export const cropSchema = z.object({
  inputPath: z.string(),
  outputPath: z.string().optional(),
  cropArea: z
    .object({
      x: z.number().optional().default(0),
      y: z.number().optional().default(0),
      w: z.number().optional().default(0),
      h: z.number().optional().default(0),
    })
    .optional()
    .default({ x: 0, y: 0, w: 0, h: 0 }),
  noiseRemoval: z.boolean().optional().default(false),
});

export const cropDescription = [
  "Crop a raster image to a rectangular region, optionally removing speckle noise first.",
  "cropArea is {x, y, w, h} in SOURCE IMAGE PIXELS and is converted internally to",
  "Inkscape document units, so callers can measure against the original bitmap.",
  "noiseRemoval applies the despeckle bitmap effect before cropping.",
  "Output defaults to a cropped PNG. An .svg outputPath is supported as a raster crop",
  "wrapped in SVG - chain into inkscape_trace_bitmap if vectors are required.",
].join(" ");

const SPECKLE_ACTION = "org.inkscape.effect.bitmap.despeckle.noprefs";

function runInkscape(binary: string, argv: string[], timeout = 60000) {
  return spawnSync(binary, argv, { encoding: "utf-8", timeout });
}

/** Ask Inkscape for the document size in its own user units via --query-all. */
function queryDocumentSize(binary: string, inputPath: string): { width: number; height: number } | null {
  const result = runInkscape(binary, [`--file=${inputPath}`, "--query-all"], 30000);
  if (result.status !== 0 || !result.stdout) return null;
  // Lines look like: "image1,0,0,428,493.333" - the leading id is not numeric,
  // so match the trailing x,y,width,height quad rather than parsing every column.
  const sizes = result.stdout
    .split("\n")
    .map((line) => line.match(/(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({ width: Number(m[3]), height: Number(m[4]) }))
    .filter((s) => Number.isFinite(s.width) && Number.isFinite(s.height) && s.width > 0 && s.height > 0);

  if (sizes.length === 0) return null;
  // The document root reports the largest box; use it for the px -> unit conversion.
  return sizes.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
}

export async function cropBitmap(rawArgs: z.infer<typeof cropSchema>) {
  const args = cropSchema.parse(rawArgs);
  const detected = detectInkscape();

  if (!detected.found) {
    return {
      content: [{ type: "text" as const, text: `Crop bitmap FAILED: ${detected.message}` }],
      isError: true,
    };
  }
  const binary = detected.path;

  const isSvgOutput = extname(args.outputPath || "").toLowerCase() === ".svg";
  const outFile =
    args.outputPath ||
    args.inputPath.replace(/\.(png|jpg|jpeg|bmp|gif|tiff?)$/i, isSvgOutput ? "_cropped.svg" : "_cropped.png");

  const area = args.cropArea;
  const hasArea = area.w > 0 && area.h > 0;

  const notes: string[] = [];
  const problems: string[] = [];

  if (!existsSync(args.inputPath)) {
    return {
      content: [{ type: "text" as const, text: `Crop bitmap FAILED: input not found: ${args.inputPath}` }],
      isError: true,
    };
  }

  // --export-area is expressed in document user units, which do not match source pixels
  // (a 642px PNG at 144 DPI imports as 428 user units). Probe the document and scale.
  let exportArea: string[] = [];
  let exportDpi: string[] = [];
  let expected: { width: number; height: number } | null = null;

  if (hasArea) {
    const docSize = queryDocumentSize(binary, args.inputPath);
    const srcSize = readRasterSize(args.inputPath);
    const scaleX = docSize && srcSize ? docSize.width / srcSize.width : 1;
    const scaleY = docSize && srcSize ? docSize.height / srcSize.height : 1;

    if (!docSize || !srcSize) {
      notes.push(
        "could not determine the px -> document-unit scale; cropArea treated as document units",
      );
    } else {
      notes.push(
        `source ${srcSize.width}x${srcSize.height}px -> document ${docSize.width.toFixed(2)}x${docSize.height.toFixed(2)} units (scale ${scaleX.toFixed(4)})`,
      );
    }

    const x0 = area.x * scaleX;
    const y0 = area.y * scaleY;
    const x1 = (area.x + area.w) * scaleX;
    const y1 = (area.y + area.h) * scaleY;

    if (x1 <= x0 || y1 <= y0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Crop bitmap FAILED: cropArea ${area.w}x${area.h} collapses to an empty region (x0=${x0.toFixed(2)}, y0=${y0.toFixed(2)}). Check that x/y/w/h are within the source image bounds.`,
          },
        ],
        isError: true,
      };
    }

    // Reject areas that fall outside the source image instead of silently returning
    // a blank or mis-registered crop.
    if (srcSize && (area.x < 0 || area.y < 0 || area.x + area.w > srcSize.width || area.y + area.h > srcSize.height)) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Crop bitmap FAILED: cropArea ${area.x},${area.y} ${area.w}x${area.h} exceeds the source image bounds (${srcSize.width}x${srcSize.height}px).`,
          },
        ],
        isError: true,
      };
    }

    // No --export-area-snap here: snapping rounds the region to whole document units and
    // inflates the result (a 200x200 source-px crop came out 203x201). Snapping is also
    // wrong for fractional crops, so the fractional area is passed through untouched.
    exportArea = [`--export-area=${x0}:${y0}:${x1}:${y1}`];
    // Raster export defaults to 96 DPI, i.e. 1 document unit == 1 output pixel. To hand
    // back a crop measured in SOURCE pixels, re-scale the export by 1/scale (this also
    // reproduces the source image's own DPI, e.g. 144 for a 642px wide @144dpi PNG).
    if (docSize && srcSize && scaleX > 0) {
      const dpi = 96 / scaleX;
      exportDpi = [`--export-dpi=${Math.round(dpi * 1000) / 1000}`];
      notes.push(`exporting at ${dpi.toFixed(2)} DPI to keep source-pixel dimensions`);
    }
    expected = { width: Math.round(area.w), height: Math.round(area.h) };
  }

  const actions = ["select-all", ...(args.noiseRemoval ? [SPECKLE_ACTION] : [])].join(";");

  // --export-area only affects raster export, so an SVG target is produced in two
  // steps: crop to a temporary PNG, then wrap that bitmap in an SVG document.
  const workDir = mkdtempSync(join(tmpdir(), "inkscape-crop-"));
  const croppedPng = join(workDir, "cropped.png");

  try {
    const rasterArgv = [
      `--file=${args.inputPath}`,
      ...exportArea,
      ...exportDpi,
      "--export-type=png",
      `--export-filename=${isSvgOutput ? croppedPng : outFile}`,
      "--export-overwrite",
      `--actions=${actions}`,
    ];
    const rasterRun = runInkscape(binary, rasterArgv);

    if (rasterRun.error) {
      return {
        content: [
          { type: "text" as const, text: `Crop bitmap FAILED: could not run Inkscape (${rasterRun.error.message})` },
        ],
        isError: true,
      };
    }

    if (rasterRun.status !== 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Crop bitmap FAILED: exit ${rasterRun.status}\nStderr: ${rasterRun.stderr.trim().slice(-400)}`,
          },
        ],
        isError: true,
      };
    }

    // Validate the raster crop actually happened instead of trusting the exit code.
    const produced = isSvgOutput ? croppedPng : outFile;
    if (!existsSync(produced)) {
      return {
        content: [{ type: "text" as const, text: `Crop bitmap FAILED: no output produced at ${outFile}` }],
        isError: true,
      };
    }

    const actual = readRasterSize(produced);
    if (!actual) {
      problems.push("could not read the output image dimensions for verification");
    } else if (expected && (actual.width !== expected.width || actual.height !== expected.height)) {
      problems.push(
        `crop size mismatch: expected ${expected.width}x${expected.height}, produced ${actual.width}x${actual.height}`,
      );
    }

    if (isSvgOutput) {
      const svgRun = runInkscape(binary, [
        `--file=${croppedPng}`,
        "--export-type=svg",
        `--export-filename=${outFile}`,
        "--export-overwrite",
      ]);
      if (svgRun.status !== 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Crop bitmap FAILED: SVG wrap failed (exit ${svgRun.status})\nStderr: ${svgRun.stderr.trim().slice(-400)}`,
            },
          ],
          isError: true,
        };
      }
      if (!existsSync(outFile)) {
        return {
          content: [{ type: "text" as const, text: `Crop bitmap FAILED: no SVG produced at ${outFile}` }],
          isError: true,
        };
      }
      notes.push("SVG output is a raster crop wrapped in an SVG document (chain into inkscape_trace_bitmap for vectors)");
    }

    const success = problems.length === 0;
    const report = [
      `Crop bitmap: ${args.inputPath} -> ${outFile}`,
      `Binary: ${binary}`,
      `Area: ${hasArea ? `${area.x},${area.y} ${area.w}x${area.h} (source px)` : "full canvas"}`,
      `Noise removal: ${args.noiseRemoval ? `ON (${SPECKLE_ACTION})` : "OFF"}`,
      actual ? `Output size: ${actual.width}x${actual.height}px` : "Output size: unknown",
      ...notes.map((n) => `Note: ${n}`),
      ...problems.map((p) => `Problem: ${p}`),
      `Status: ${success ? "OK" : "FAILED"}`,
    ];
    if (rasterRun.stderr.trim()) report.push(`Stderr: ${rasterRun.stderr.trim().slice(-300)}`);

    return { content: [{ type: "text" as const, text: report.join("\n") }], isError: !success };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
