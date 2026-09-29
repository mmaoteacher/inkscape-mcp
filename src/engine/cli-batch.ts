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
    const args = ctx.actions.concat(ctx.inputFile ? ["--file", ctx.inputFile] : []);
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
