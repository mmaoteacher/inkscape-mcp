import { z } from "zod";
import { existsSync, readFileSync } from "fs";
import { extname } from "path";
import { detectInkscape } from "../engine/detector.ts";
import { runActions } from "../engine/runner.ts";

export const rawActionsSchema = z.object({
  inputFile: z.string(),
  /** Semicolon-separated Inkscape action chain, e.g. "select-all;object-stroke-to-path". */
  actions: z.string().min(1),
  outputFile: z.string().optional(),
  outputType: z.string().optional().default("svg"),
  exportWidth: z.number().optional(),
  exportDpi: z.number().optional(),
  exportArea: z
    .object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() })
    .optional(),
});

export const rawActionsDescription = [
  "Run an arbitrary Inkscape action chain against a document and export the result.",
  "Escape hatch for anything the higher-level tools do not cover: boolean path ops,",
  "path effects, transforms, object-to-path, export-area, and so on.",
  "Actions are a semicolon-separated string, e.g.",
  '"select-all;object-stroke-to-path;path-simplify".',
  "List available actions with: /Applications/Inkscape.app/Contents/MacOS/inkscape --shell then action-list.",
  "Returns FAILED when Inkscape reports it could not run part of the chain, even if the",
  "process exits 0 - this is the failure mode that produced silently-empty output before.",
].join(" ");

export async function runRawActions(rawArgs: z.infer<typeof rawActionsSchema>) {
  const args = rawActionsSchema.parse(rawArgs);
  const detected = detectInkscape();

  if (!detected.found) {
    return {
      content: [{ type: "text" as const, text: `Raw actions FAILED: ${detected.message}` }],
      isError: true,
    };
  }
  if (!existsSync(args.inputFile)) {
    return {
      content: [{ type: "text" as const, text: `Raw actions FAILED: input not found: ${args.inputFile}` }],
      isError: true,
    };
  }

  // Trim and drop empty segments so a trailing ";" does not become a bogus action.
  const actionList = args.actions
    .split(";")
    .map((a) => a.trim())
    .filter((a) => a.length > 0);

  if (actionList.length === 0) {
    return {
      content: [{ type: "text" as const, text: "Raw actions FAILED: no actions provided" }],
      isError: true,
    };
  }

  const extraArgs: string[] = [];
  if (args.exportWidth) extraArgs.push(`--export-width=${Math.round(args.exportWidth)}`);
  if (args.exportDpi) extraArgs.push(`--export-dpi=${args.exportDpi}`);
  if (args.exportArea) {
    const { x0, y0, x1, y1 } = args.exportArea;
    extraArgs.push(`--export-area=${x0}:${y0}:${x1}:${y1}`);
  }

  const outFile =
    args.outputFile ||
    args.inputFile.replace(/\.[^./\\]+$/, "") + `_actions.${extname(args.outputFile || "") ? "" : args.outputType}`;

  const result = runActions(detected.path, {
    inputFile: args.inputFile,
    actions: actionList,
    outputFile: outFile,
    outputType: args.outputType,
    extraArgs,
  });

  const report: string[] = [
    `Raw actions: ${args.inputFile} -> ${outFile}`,
    `Binary: ${detected.path}`,
    `Actions: ${actionList.join(";")}`,
  ];
  const problems: string[] = [];

  if (result.spawnError) {
    report.push(`Status: FAILED`, `Error: ${result.spawnError}`);
    return { content: [{ type: "text" as const, text: report.join("\n") }], isError: true };
  }

  if (result.actionError) {
    problems.push(`Inkscape rejected part of the chain: ${result.actionError}`);
  }

  if (!existsSync(outFile)) {
    problems.push(`no output produced at ${outFile}`);
  } else {
    const size = readFileSync(outFile, "utf-8").length;
    report.push(`Output size: ${size} bytes`);
    if (extname(outFile).toLowerCase() === ".svg") {
      const svg = readFileSync(outFile, "utf-8");
      const counts = (tag: string) => (svg.match(new RegExp(`<${tag}[\\s>]`, "g")) || []).length;
      report.push(
        `Objects: path=${counts("path")} rect=${counts("rect")} circle=${counts("circle")} text=${counts("text")} image=${counts("image")}`,
      );
    }
  }

  if (result.stdout.trim()) report.push(`Stdout: ${result.stdout.trim().slice(-300)}`);
  if (result.stderr.trim()) report.push(`Stderr: ${result.stderr.trim().slice(-300)}`);

  const success = problems.length === 0;
  report.push(...problems.map((p) => `Problem: ${p}`));
  report.push(`Status: ${success ? "OK" : "FAILED"}`);

  return { content: [{ type: "text" as const, text: report.join("\n") }], isError: !success };
}
