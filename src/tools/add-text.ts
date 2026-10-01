import { z } from "zod";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { detectInkscape } from "../engine/detector.ts";
import { runActions } from "../engine/runner.ts";
import { assertSafeId, ensureSvgNamespace, escapeXml, formatNumber, insertFragment } from "../engine/svg-doc.ts";

export const addTextSchema = z.object({
  inputFile: z.string(),
  text: z.string().min(1),
  x: z.number().default(0),
  y: z.number().default(0),
  id: z.string().optional(),
  fontFamily: z.string().default("Helvetica"),
  fontSize: z.number().positive().default(24),
  fontWeight: z.enum(["normal", "bold"]).optional(),
  /** CSS colour, e.g. "#20364b". */
  fill: z.string().default("#000000"),
  letterSpacing: z.number().optional(),
  textAnchor: z.enum(["start", "middle", "end"]).optional(),
  outputFile: z.string().optional(),
});

export const addTextDescription = [
  "Append a live <text> element to an SVG document.",
  "text content is XML-escaped, so quotes and ampersands are safe.",
  "y is the text baseline, matching SVG/Inkscape convention.",
  "Text stays editable and font-dependent; convert it with inkscape_text_to_path when",
  "the result must render identically without the font installed.",
].join(" ");

export async function runAddText(rawArgs: z.infer<typeof addTextSchema>) {
  const args = addTextSchema.parse(rawArgs);
  const detected = detectInkscape();

  if (!detected.found) {
    return {
      content: [{ type: "text" as const, text: `Add text FAILED: ${detected.message}` }],
      isError: true,
    };
  }
  if (!existsSync(args.inputFile)) {
    return {
      content: [{ type: "text" as const, text: `Add text FAILED: input not found: ${args.inputFile}` }],
      isError: true,
    };
  }

  const outFile = args.outputFile || args.inputFile;
  if (args.id) assertSafeId(args.id);

  const attrs: string[] = [
    `x="${formatNumber(args.x)}"`,
    `y="${formatNumber(args.y)}"`,
    `font-family="${escapeXml(args.fontFamily)}"`,
    `font-size="${formatNumber(args.fontSize)}"`,
    `fill="${escapeXml(args.fill)}"`,
  ];
  if (args.id) attrs.push(`id="${escapeXml(args.id)}"`);
  if (args.fontWeight) attrs.push(`font-weight="${args.fontWeight}"`);
  if (args.letterSpacing !== undefined) attrs.push(`letter-spacing="${formatNumber(args.letterSpacing)}"`);
  if (args.textAnchor) attrs.push(`text-anchor="${args.textAnchor}"`);

  const markup = `  <text ${attrs.join(" ")}>${escapeXml(args.text)}</text>`;

  const original = readFileSync(args.inputFile, "utf-8");
  let updated: string;
  try {
    updated = insertFragment(ensureSvgNamespace(original), markup);
  } catch (err) {
    return {
      content: [{ type: "text" as const, text: `Add text FAILED: ${(err as Error).message}` }],
      isError: true,
    };
  }

  mkdirSync(dirname(outFile) || ".", { recursive: true });
  writeFileSync(outFile, updated);

  // Inkscape must actually lay the text out, which also confirms the font resolved
  // to something with real metrics rather than silently collapsing to zero width.
  const run = runActions(detected.path, {
    inputFile: outFile,
    actions: ["select-clear"],
    outputFile: `${outFile.replace(/\.svg$/i, "")}_check.svg`,
    outputType: "svg",
  });

  const report: string[] = [
    `Add text: "${args.text}" -> ${outFile}`,
    `Binary: ${detected.path}`,
    `Font: ${args.fontFamily} ${formatNumber(args.fontSize)}px`,
  ];
  const problems: string[] = [];

  if (run.spawnError) {
    report.push(`Status: FAILED`, `Error: ${run.spawnError}`);
    return { content: [{ type: "text" as const, text: report.join("\n") }], isError: true };
  }
  if (run.actionError) problems.push(`Inkscape rejected the document: ${run.actionError}`);

  const checkFile = `${outFile.replace(/\.svg$/i, "")}_check.svg`;
  if (!existsSync(checkFile)) {
    problems.push(`Inkscape could not open the updated document (exit ${run.status})`);
    if (run.stderr.trim()) problems.push(run.stderr.trim().slice(-400));
  } else {
    // Inkscape reports the laid-out text extent, which proves the glyphs resolved.
    const query = runActions(detected.path, {
      inputFile: checkFile,
      actions: args.id ? [`select-by-id:${args.id}`, "query-width", "query-height"] : ["select-all", "query-width", "query-height"],
    });
    const dims = (query.stdout || "")
      .split("\n")
      .map((l) => Number(l.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (dims.length >= 2) {
      report.push(`Laid-out extent: ${dims[0]} x ${dims[1]}`);
      if (dims[0] === 0 || dims[1] === 0) {
        problems.push("text has zero extent - the font may not be available");
      }
    } else {
      problems.push("could not measure the text extent; Inkscape may not have laid it out");
    }
  }

  report.push(...problems.map((p) => `Problem: ${p}`));
  report.push(`Status: ${problems.length === 0 ? "OK" : "FAILED"}`);

  return { content: [{ type: "text" as const, text: report.join("\n") }], isError: problems.length > 0 };
}
