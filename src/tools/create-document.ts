import { z } from "zod";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { detectInkscape } from "../engine/detector.ts";
import { runActions } from "../engine/runner.ts";
import { createSvgDocument, formatNumber, type SvgMeta } from "../engine/svg-doc.ts";

export const createDocumentSchema = z.object({
  width: z.number().positive().default(512),
  height: z.number().positive().default(512),
  outputFile: z.string().optional(),
  /** CSS colour for an opaque background rectangle, e.g. "#ffffff". Omit for transparent. */
  background: z.string().optional(),
  /** Reuse an existing file as a starting point instead of creating an empty canvas. */
  baseFile: z.string().optional(),
});

export const createDocumentDescription = [
  "Create a new SVG document, or start from an existing file with baseFile.",
  "Produces a canvas sized in user units (1 unit = 1 px at 96 DPI) with a matching viewBox,",
  "so later coordinates map 1:1 to pixels in the preview.",
  "The result is re-opened and re-exported by Inkscape, so an invalid document fails here",
  "rather than producing a file that fails to open later.",
].join(" ");

export async function runCreateDocument(rawArgs: z.infer<typeof createDocumentSchema>) {
  const args = createDocumentSchema.parse(rawArgs);
  const detected = detectInkscape();

  if (!detected.found) {
    return {
      content: [{ type: "text" as const, text: `Create document FAILED: ${detected.message}` }],
      isError: true,
    };
  }

  const outFile = args.outputFile || "untitled.svg";

  let svg: string;
  let source: string;
  if (args.baseFile) {
    if (!existsSync(args.baseFile)) {
      return {
        content: [
          { type: "text" as const, text: `Create document FAILED: baseFile not found: ${args.baseFile}` },
        ],
        isError: true,
      };
    }
    svg = readFileSync(args.baseFile, "utf-8");
    source = `copied from ${args.baseFile}`;
  } else {
    const meta: SvgMeta = { width: args.width, height: args.height, viewBox: `0 0 ${args.width} ${args.height}` };
    svg = createSvgDocument(meta, "  <!-- empty canvas -->", args.background);
    source = "new empty canvas";
  }

  mkdirSync(dirname(outFile) || ".", { recursive: true });
  writeFileSync(outFile, svg);

  // Round-trip through Inkscape: this validates the document and normalises the
  // output to what Inkscape itself would write. select-clear is a deliberate no-op
  // so the document is loaded and processed without altering it.
  const normalized = `${outFile.replace(/\.svg$/i, "")}_inkscape.svg`;
  const run = runActions(detected.path, {
    inputFile: outFile,
    actions: ["select-clear"],
    outputFile: normalized,
    outputType: "svg",
  });

  const report: string[] = [
    `Create document: ${outFile}`,
    `Binary: ${detected.path}`,
    `Source: ${source}`,
    `Canvas: ${formatNumber(args.width)} x ${formatNumber(args.height)}`,
  ];
  const problems: string[] = [];

  if (run.spawnError) {
    report.push(`Status: FAILED`, `Error: ${run.spawnError}`);
    return { content: [{ type: "text" as const, text: report.join("\n") }], isError: true };
  }
  if (!existsSync(normalized)) {
    problems.push(`Inkscape could not open the generated document (exit ${run.status})`);
    if (run.stderr.trim()) problems.push(run.stderr.trim().slice(-300));
  } else {
    report.push(`Inkscape validated: ${normalized} (${readFileSync(normalized, "utf-8").length} bytes)`);
  }

  report.push(...problems.map((p) => `Problem: ${p}`));
  report.push(`Status: ${problems.length === 0 ? "OK" : "FAILED"}`);

  return { content: [{ type: "text" as const, text: report.join("\n") }], isError: problems.length > 0 };
}
