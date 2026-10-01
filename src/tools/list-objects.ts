import { z } from "zod";
import { spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { detectInkscape } from "../engine/detector.ts";
import { mapIdsToTags, readDocumentMeta } from "../engine/svg-doc.ts";

export const listObjectsSchema = z.object({
  inputFile: z.string(),
  /** Only report these ids. Defaults to everything Inkscape knows about. */
  objectIds: z.array(z.string()).optional(),
});

export const listObjectsDescription = [
  "Inspect an SVG: canvas size, viewBox, and every object with its id, element type and",
  "bounding box as measured by Inkscape itself.",
  "This is how you discover the ids that inkscape_boolean_op, inkscape_raw_actions and",
  "inkscape_text_to_path accept, so inspect before targeting objects by id.",
  "Nested layers and groups are included, so parent structure is visible too.",
].join(" ");

export interface ObjectInfo {
  id: string;
  tag: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Ask Inkscape for real geometry via --query-all, which emits
 * "id,x,y,width,height" rows for every object including nested groups and layers.
 * This is authoritative: it reflects laid-out geometry rather than nominal attributes.
 */
function queryGeometry(binary: string, inputFile: string): ObjectInfo[] {
  const result = spawnSync(binary, [`--file=${inputFile}`, "--query-all"], {
    encoding: "utf-8",
    timeout: 30000,
  });
  if (result.status !== 0 || !result.stdout) return [];

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const comma = line.indexOf(",");
      if (comma === -1) return null;
      const id = line.slice(0, comma);
      const nums = line
        .slice(comma + 1)
        .split(",")
        .map((v) => Number(v.trim()));
      if (nums.length < 4 || !nums.slice(0, 4).every(Number.isFinite)) return null;
      return { id, x: nums[0], y: nums[1], width: nums[2], height: nums[3] };
    })
    .filter((r): r is ObjectInfo => r !== null);
}

export async function runListObjects(rawArgs: z.infer<typeof listObjectsSchema>) {
  const args = listObjectsSchema.parse(rawArgs);
  const detected = detectInkscape();

  if (!detected.found) {
    return {
      content: [{ type: "text" as const, text: `List objects FAILED: ${detected.message}` }],
      isError: true,
    };
  }
  if (!existsSync(args.inputFile)) {
    return {
      content: [
        { type: "text" as const, text: `List objects FAILED: input not found: ${args.inputFile}` },
      ],
      isError: true,
    };
  }

  const svg = readFileSync(args.inputFile, "utf-8");
  const tags = mapIdsToTags(svg);
  const warnings: string[] = [];

  let canvasLine = "Canvas: unknown";
  try {
    const meta = readDocumentMeta(svg);
    canvasLine = `Canvas: ${meta.width} x ${meta.height} (viewBox "${meta.viewBox}")`;
  } catch (err) {
    warnings.push((err as Error).message);
  }

  let objects = queryGeometry(detected.path, args.inputFile).map((o) => ({
    ...o,
    // Inkscape names the document node "svg1" even when the markup carries no id,
    // so fall back to the conventional name instead of reporting it as unknown.
    tag: tags.get(o.id) ?? (/^svg\d*$/.test(o.id) ? "svg" : "unknown"),
  }));

  if (objects.length === 0) {
    warnings.push(
      "Inkscape reported no measurable objects - the document may be empty, or may not be valid SVG",
    );
  }

  if (args.objectIds?.length) {
    const present = new Set(objects.map((o) => o.id));
    const missing = args.objectIds.filter((id) => !present.has(id));
    if (missing.length > 0) {
      warnings.push(`requested id(s) not present: ${missing.join(", ")}`);
    }
    const wanted = new Set(args.objectIds);
    objects = objects.filter((o) => wanted.has(o.id));
  }

  const lines: string[] = [`Document: ${args.inputFile}`, canvasLine, `Objects: ${objects.length}`, ""];

  if (objects.length > 0) {
    const idWidth = Math.max(...objects.map((o) => o.id.length), 2);
    const tagWidth = Math.max(...objects.map((o) => o.tag.length), 4);
    for (const o of objects) {
      lines.push(
        `  ${o.id.padEnd(idWidth)}  <${o.tag.padEnd(tagWidth)}>  x=${round(o.x)} y=${round(o.y)} w=${round(o.width)} h=${round(o.height)}`,
      );
    }
  }

  if (warnings.length > 0) {
    lines.push("", ...warnings.map((w) => `Note: ${w}`));
  }

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

function round(n: number): string {
  return String(Math.round(n * 100) / 100);
}
