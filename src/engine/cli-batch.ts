import { spawn } from "child_process";
import type { InkscapeEngine, ExecutionContext, ExecutionResult } from "./types.ts";
import { detectInkscape } from "./detector.ts";

export interface CliBatchOptions {
  binaryPath?: string;
}

export class CliBatchEngine implements InkscapeEngine {
  private binaryPath: string;

  constructor(options?: CliBatchOptions) {
    this.binaryPath = options?.binaryPath || "inkscape";
  }

  async init() {
    const detected = detectInkscape();
    if (detected.found && detected.path !== "inkscape") {
      this.binaryPath = detected.path;
    }
  }

  async dispose() {}

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const start = Date.now();
    // Inkscape only accepts actions as a single semicolon-separated --actions argument;
    // passing them as separate argv entries makes it try to interpret each as a file.
    const args: string[] = [];
    if (ctx.inputFile) args.push(`--file=${ctx.inputFile}`);
    if (ctx.outputFile) args.push(`--export-filename=${ctx.outputFile}`);
    if (ctx.actions.length > 0) args.push(`--actions=${ctx.actions.join(";")}`);
    return new Promise((resolve) => {
      const proc = spawn(this.binaryPath, args, { shell: false });
      let stdout = "";
      let stderr = "";
      proc.stdout?.on("data", (d) => stdout += d.toString());
      proc.stderr?.on("data", (d) => stderr += d.toString());
      proc.on("close", (code) => {
        resolve({
          success: code === 0,
          stdout,
          stderr,
          durationMs: Date.now() - start,
        });
      });
    });
  }
}
