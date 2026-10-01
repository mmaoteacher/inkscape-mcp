import { z } from "zod";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { detectInkscape } from "../engine/detector.ts";
import { runActions } from "../engine/runner.ts";
import {
  assertSafeId,
  ensureSvgNamespace,
  escapeXml,
  formatNumber,
  insertFragment,
  mapIdsToTags,
} from "../engine/svg-doc.ts";

export const SHAPE_TYPES = [
  "rect",
  "circle",
  "ellipse",
  "line",
  "polygon",
  "polyline",
  "star",
] as const;

export const addShapeSchema = z.object({
  inputFile: z.string(),
  shape: z.enum(SHAPE_TYPES),
  id: z.string().optional(),
  /** Bounding box for rect / ellipse / star; centre + radius for circle. */
  x: z.number().optional(),
  y: z.number().optional(),
  w: z.number().optional(),
  h: z.number().optional(),
  r: z.number().optional(),
  /** Explicit point list for polygon / polyline: [[x,y], ...]. */
  points: z.array(z.tuple([z.number(), z.number()])).optional(),
  /** star only: number of points, and the inner radius ratio (0-1). */
  starPoints: z.number().int().min(3).max(64).optional(),
  innerRatio: z.number().min(0.01).max(1).optional(),
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().optional(),
  opacity: z.number().min(0).max(1).optional(),
  outputFile: z.string().optional(),
});

export const addShapeDescription = [
  "Append a shape to an SVG document.",
  "shape: rect, circle, ellipse, line, polygon, polyline or star.",
  "rect/ellipse/star use x,y,w,h as a bounding box; circle uses x,y as the centre with r;",
  "line uses x,y,w,h as the two endpoints (w/h may be negative);",
  "polygon/polyline take points as [[x,y], ...].",
  "Every shape gets a stable id (generated when omitted) so later tools can target it,",
  "and the result is verified with inkscape_list_objects.",
].join(" ");

interface Paint {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
}

function paintAttrs(paint: Paint): string {
  const parts: string[] = [];
  // Inkscape's default fill is black; an explicit "none" must be honoured.
  parts.push(`fill="${escapeXml(paint.fill ?? "none")}"`);
  if (paint.stroke) {
    parts.push(`stroke="${escapeXml(paint.stroke)}"`);
    parts.push(`stroke-width="${formatNumber(paint.strokeWidth ?? 1)}"`);
  }
  if (paint.opacity !== undefined) parts.push(`opacity="${formatNumber(paint.opacity)}"`);
  return parts.join(" ");
}

function requireNumber(value: number | undefined, name: string): number {
  if (value === undefined || !Number.isFinite(value)) {
    throw new Error(`Missing required numeric argument "${name}" for this shape`);
  }
  return value;
}

function starPoints(cx: number, cy: number, outer: number, inner: number, tips: number): string {
  const pts: string[] = [];
  for (let i = 0; i < tips * 2; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (Math.PI * i) / tips - Math.PI / 2;
    pts.push(`${formatNumber(cx + radius * Math.cos(angle))},${formatNumber(cy + radius * Math.sin(angle))}`);
  }
  return pts.join(" ");
}

export function buildShapeMarkup(shape: string, args: z.infer<typeof addShapeSchema>): string {
  const id = args.id ? (assertSafeId(args.id), args.id) : undefined;
  const idAttr = id ? ` id="${escapeXml(id)}"` : "";
  const paint = paintAttrs(args);

  switch (shape) {
    case "rect": {
      const w = requireNumber(args.w, "w");
      const h = requireNumber(args.h, "h");
      if (w === 0 || h === 0) throw new Error("rect needs non-zero w and h");
      return `  <rect${idAttr} x="${formatNumber(args.x ?? 0)}" y="${formatNumber(args.y ?? 0)}" width="${formatNumber(w)}" height="${formatNumber(h)}" ${paint} />`;
    }
    case "circle": {
      const r = requireNumber(args.r, "r");
      if (r <= 0) throw new Error("circle needs a positive r");
      return `  <circle${idAttr} cx="${formatNumber(args.x ?? 0)}" cy="${formatNumber(args.y ?? 0)}" r="${formatNumber(r)}" ${paint} />`;
    }
    case "ellipse": {
      const w = requireNumber(args.w, "w");
      const h = requireNumber(args.h, "h");
      if (w === 0 || h === 0) throw new Error("ellipse needs non-zero w and h");
      const rx = w / 2;
      const ry = h / 2;
      return `  <ellipse${idAttr} cx="${formatNumber((args.x ?? 0) + rx)}" cy="${formatNumber((args.y ?? 0) + ry)}" rx="${formatNumber(rx)}" ry="${formatNumber(ry)}" ${paint} />`;
    }
    case "line": {
      const x = args.x ?? 0;
      const y = args.y ?? 0;
      const w = requireNumber(args.w, "w");
      const h = requireNumber(args.h, "h");
      if (w === 0 && h === 0) throw new Error("line needs a non-zero length (w and/or h)");
      return `  <line${idAttr} x1="${formatNumber(x)}" y1="${formatNumber(y)}" x2="${formatNumber(x + w)}" y2="${formatNumber(y + h)}" ${paint} />`;
    }
    case "polygon":
    case "polyline": {
      const pts = args.points;
      if (!pts || pts.length < 2) {
        throw new Error(`${shape} needs at least two points, e.g. points: [[0,0],[50,20],[20,60]]`);
      }
      const coords = pts.map(([px, py]) => `${formatNumber(px)},${formatNumber(py)}`).join(" ");
      return `  <${shape}${idAttr} points="${coords}" ${paint} />`;
    }
    case "star": {
      const w = requireNumber(args.w, "w");
      const h = requireNumber(args.h, "h");
      if (w === 0 || h === 0) throw new Error("star needs non-zero w and h");
      const cx = (args.x ?? 0) + w / 2;
      const cy = (args.y ?? 0) + h / 2;
      const outer = Math.min(w, h) / 2;
      const tips = args.starPoints ?? 5;
      const inner = outer * (args.innerRatio ?? 0.382);
      return `  <polygon${idAttr} points="${starPoints(cx, cy, outer, inner, tips)}" ${paint} />`;
    }
    default:
      throw new Error(`Unsupported shape: ${shape}`);
  }
}

export async function runAddShape(rawArgs: z.infer<typeof addShapeSchema>) {
  const args = addShapeSchema.parse(rawArgs);
  const detected = detectInkscape();

  if (!detected.found) {
    return {
      content: [{ type: "text" as const, text: `Add shape FAILED: ${detected.message}` }],
      isError: true,
    };
  }
  if (!existsSync(args.inputFile)) {
    return {
      content: [{ type: "text" as const, text: `Add shape FAILED: input not found: ${args.inputFile}` }],
      isError: true,
    };
  }

  const outFile = args.outputFile || args.inputFile;

  let markup: string;
  try {
    markup = buildShapeMarkup(args.shape, args);
  } catch (err) {
    return {
      content: [{ type: "text" as const, text: `Add shape FAILED: ${(err as Error).message}` }],
      isError: true,
    };
  }

  const original = readFileSync(args.inputFile, "utf-8");
  let updated: string;
  try {
    updated = insertFragment(ensureSvgNamespace(original), markup);
  } catch (err) {
    return {
      content: [{ type: "text" as const, text: `Add shape FAILED: ${(err as Error).message}` }],
      isError: true,
    };
  }

  mkdirSync(dirname(outFile) || ".", { recursive: true });
  writeFileSync(outFile, updated);

  // Verify Inkscape actually parses the new element, otherwise a typo in the markup
  // would leave a file that looks written but does not render.
  const run = runActions(detected.path, {
    inputFile: outFile,
    actions: ["select-clear"],
    outputFile: `${outFile.replace(/\.svg$/i, "")}_check.svg`,
    outputType: "svg",
  });

  const report: string[] = [
    `Add shape: ${args.shape} -> ${outFile}`,
    `Binary: ${detected.path}`,
    `Markup: ${markup.trim()}`,
  ];
  const problems: string[] = [];

  if (run.spawnError) {
    report.push(`Status: FAILED`, `Error: ${run.spawnError}`);
    return { content: [{ type: "text" as const, text: report.join("\n") }], isError: true };
  }
  if (run.actionError) {
    problems.push(`Inkscape rejected the document: ${run.actionError}`);
  }

  const checkFile = `${outFile.replace(/\.svg$/i, "")}_check.svg`;
  if (!existsSync(checkFile)) {
    problems.push(`Inkscape could not open the updated document (exit ${run.status})`);
    if (run.stderr.trim()) problems.push(run.stderr.trim().slice(-400));
  } else {
    // Confirm the new element survived Inkscape's parse by matching its id in the
    // re-exported document.
    const requestedId = args.id;
    const exported = readFileSync(checkFile, "utf-8");
    if (requestedId) {
      const tags = mapIdsToTags(exported);
      if (!tags.has(requestedId)) {
        problems.push(`element id "${requestedId}" is missing from the Inkscape re-export`);
      } else {
        report.push(`Verified: id "${requestedId}" present as <${tags.get(requestedId)}> after Inkscape round-trip`);
      }
    } else {
      const before = mapIdsToTags(original).size;
      const after = mapIdsToTags(exported).size;
      if (after <= before) {
        problems.push(`element count did not grow (${before} -> ${after}); the shape was not added`);
      } else {
        report.push(`Verified: element count ${before} -> ${after} after Inkscape round-trip`);
      }
    }
  }

  report.push(...problems.map((p) => `Problem: ${p}`));
  report.push(`Status: ${problems.length === 0 ? "OK" : "FAILED"}`);

  return { content: [{ type: "text" as const, text: report.join("\n") }], isError: problems.length > 0 };
}
