import { z } from "zod";
import { existsSync, readFileSync } from "fs";
import { extname } from "path";
import { detectInkscape } from "../engine/detector.ts";
import { runActions } from "../engine/runner.ts";

export const BOOLEAN_OPERATIONS = {
  union: "path-union",
  difference: "path-difference",
  intersection: "path-intersection",
  division: "path-division",
  exclusion: "path-exclusion",
  combine: "path-combine",
} as const;

export const booleanOpSchema = z.object({
  inputFile: z.string(),
  operation: z.enum(["union", "difference", "intersection", "division", "exclusion", "combine"]),
  outputFile: z.string().optional(),
  /** Ids to operate on. When omitted every top-level object is selected. */
  objectIds: z.array(z.string()).optional(),
  /** Remove the path effects Inkscape may add around a boolean result. */
  removePathEffects: z.boolean().optional().default(true),
});

export const booleanOpDescription = [
  "Combine selected paths in an SVG with a boolean operation.",
  "operation is one of: union, difference, intersection, division, exclusion, combine.",
  "difference/division/exclusion act on z-order: the bottom object is the base and later",
  "objects are subtracted from it, so objectIds order matters.",
  "Without objectIds all top-level objects are used, bottom-most first as Inkscape orders them.",
  "Verifies the object count actually changed, so a no-op is reported as FAILED rather than OK.",
].join(" ");

/** Count drawable top-level elements in an SVG. */
function countObjects(svg: string): number {
  const tags = ["path", "rect", "circle", "ellipse", "polygon", "polyline", "line"];
  return tags.reduce((n, tag) => n + (svg.match(new RegExp(`<${tag}[\\s>]`, "g")) || []).length, 0);
}

export async function runBooleanOp(rawArgs: z.infer<typeof booleanOpSchema>) {
  const args = booleanOpSchema.parse(rawArgs);
  const detected = detectInkscape();

  if (!detected.found) {
    return {
      content: [{ type: "text" as const, text: `Boolean op FAILED: ${detected.message}` }],
      isError: true,
    };
  }
  if (!existsSync(args.inputFile)) {
    return {
      content: [{ type: "text" as const, text: `Boolean op FAILED: input not found: ${args.inputFile}` }],
      isError: true,
    };
  }

  const outFile = args.outputFile || args.inputFile.replace(/\.svg$/i, "") + `_${args.operation}.svg`;
  const action = BOOLEAN_OPERATIONS[args.operation];

  const before = readFileSync(args.inputFile, "utf-8");
  const beforeCount = countObjects(before);

  // With explicit ids, select them in the given order so z-order is deterministic.
  const selection = args.objectIds?.length
    ? args.objectIds.map((id) => `select-by-id:${id}`).join(";")
    : "select-all:no-groups";

  const actionChain = [
    "select-clear",
    selection,
    action,
    ...(args.removePathEffects ? ["remove-path-effect"] : []),
  ];

  const result = runActions(detected.path, {
    inputFile: args.inputFile,
    actions: actionChain,
    outputFile: outFile,
    outputType: "svg",
  });

  const report: string[] = [
    `Boolean op: ${args.operation} (${action})`,
    `Input: ${args.inputFile}`,
    `Output: ${outFile}`,
    `Binary: ${detected.path}`,
    `Selection: ${args.objectIds?.length ? args.objectIds.join(", ") : "all top-level objects"}`,
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
    const after = readFileSync(outFile, "utf-8");
    const afterCount = countObjects(after);
    report.push(`Objects: ${beforeCount} -> ${afterCount}`);

    if (afterCount === 0) {
      problems.push("result contains no drawable objects - the operation consumed everything");
    } else if (afterCount >= beforeCount && args.operation !== "combine" && args.operation !== "division") {
      problems.push(
        `object count did not decrease (${beforeCount} -> ${afterCount}); the shapes may not overlap`,
      );
    }
    if (/<(image|text)[\s>]/.test(after)) {
      problems.push("output still contains a raster image or live text element");
    }
  }

  if (result.stderr.trim()) report.push(`Stderr: ${result.stderr.trim().slice(-300)}`);
  report.push(...problems.map((p) => `Problem: ${p}`));
  report.push(`Status: ${problems.length === 0 ? "OK" : "FAILED"}`);

  return {
    content: [{ type: "text" as const, text: report.join("\n") }],
    isError: problems.length > 0,
  };
}
