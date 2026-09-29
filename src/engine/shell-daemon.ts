import { spawn } from "child_process";
import type { InkscapeEngine, ExecutionContext, ExecutionResult } from "./types.ts";
import { detectInkscape } from "./detector.ts";

export interface ShellDaemonOptions {
  binaryPath?: string;
}

export class ShellDaemonEngine implements InkscapeEngine {
  private binaryPath: string;
  private proc?: ReturnType<typeof spawn>;

  constructor(options?: ShellDaemonOptions) {
    this.binaryPath = options?.binaryPath || "inkscape";
  }

  async init() {
    const detected = detectInkscape();
    const bin = detected.found ? detected.path : this.binaryPath;
    this.proc = spawn(bin, ["--shell"], { stdio: ["pipe", "pipe", "pipe"] });
    // 等待 shell 啟動完成
    await new Promise<void>((resolve) => {
      this.proc?.stdout?.once("data", () => resolve());
      setTimeout(() => resolve(), 500);
    });
  }

  async dispose() {
    if (this.proc && !this.proc.killed) {
      this.proc.stdin?.write("quit\n");
      setTimeout(() => this.proc?.kill(), 200);
    }
  }

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const start = Date.now();
    const actionsStr = ctx.actions.join("; ");
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      this.proc?.stdout?.on("data", (d) => stdout += d.toString());
      this.proc?.stderr?.on("data", (d) => stderr += d.toString());
      this.proc?.stdin?.write(actionsStr + "\n");
      setTimeout(() => {
        resolve({
          success: true,
          stdout: stdout.slice(-500), // 取最後輸出
          stderr,
          durationMs: Date.now() - start,
        });
      }, 500);
    });
  }
}
