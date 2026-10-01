import { z } from "zod";
import { existsSync, readFileSync } from "fs";
import { detectInkscape } from "../engine/detector.ts";
import { runActions } from "../engine/runner.ts";

export const textToPathSchema = z.object({
  inputFile: z.string(),
  outputFile: z.string().optional(),
  /** Restrict the conversion to these text ids. Defaults to every text object. */
  objectIds: z.array(z.string()).optional(),
  /** Simplify the resulting outlines to reduce node count. */
  simplify: z.boolean().optional().default(false),
});

export const textToPathDescription = [
  "Convert live <text> elements in an SVG into vector <path> outlines.",
  "Use this when text must render identically everywhere (no font dependency) or before",
  "running boolean operations on type.",
  "Verifies that no <text> element survives in the output, so a silent no-op is reported",
  "as FAILED instead of OK.",
].join(" ");

export interface SvgObjectCounts {
  text: number;
  path: number;
  image: number;
}

export function countSvgObjects(svg: string): SvgObjectCounts {
  const count = (tag: string) => (svg.match(new RegExp(`<${tag}[\\s>]`, "g")) || []).length;
  return { text: count("text"), path: count("path"), image: count("image") };
}

export async function runTextToPath(rawArgs: z.infer<typeof textToPathSchema>) {
  const args = textToPathSchema.parse(rawArgs);
  const detected = detectInkscape();

  if (!detected.found) {
    return {
      content: [{ type: "text" as const, text: `Text to path FAILED: ${detected.message}` }],
      isError: true,
    };
  }
  if (!existsSync(args.inputFile)) {
    return {
      content: [
        { type: "text" as const, text: `Text to path FAILED: input not found: ${args.inputFile}` },
      ],
      isError: true,
    };
  }

  const outFile = args.outputFile || args.inputFile.replace(/\.svg$/i, "") + "_text2path.svg";
  const before = countSvgObjects(readFileSync(args.inputFile, "utf-8"));

  if (before.text === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Text to path FAILED: ${args.inputFile} contains no <text> element (text=${before.text}, path=${before.path}, image=${before.image}). Nothing to convert.`,
        },
      ],
      isError: true,
    };
  }

  const selection = args.objectIds?.length
    ? args.objectIds.map((id) => `select-by-id:${id}`).join(";")
    : "select-all";

  const actionChain = [
    "select-clear",
    selection,
    "object-to-path",
    ...(args.simplify ? ["path-simplify"] : []),
  ];

  const result = runActions(detected.path, {
    inputFile: args.inputFile,
    actions: actionChain,
    outputFile: outFile,
    outputType: "svg",
  });

  const report: string[] = [
    `Text to path: ${args.inputFile} -> ${outFile}`,
    `Binary: ${detected.path}`,
    `Selection: ${args.objectIds?.length ? args.objectIds.join(", ") : "all objects"}`,
    `Simplify: ${args.simplify ? "on" : "off"}`,
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
    const after = countSvgObjects(readFileSync(outFile, "utf-8"));
    report.push(`Text elements: ${before.text} -> ${after.text}`);
    report.push(`Path elements: ${before.path} -> ${after.path}`);

    if (after.text > 0) {
      problems.push(
        `${after.text} <text> element(s) remain - check that objectIds match real element ids`,
      );
    } else if (after.path <= before.path) {
      problems.push("no new path outlines were produced");
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
