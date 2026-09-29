import type { InkscapeEngine, ExecutionContext, ExecutionResult } from "./types.ts";

export interface ShellDaemonOptions {
  binaryPath?: string;
}

export class ShellDaemonEngine implements InkscapeEngine {
  private binaryPath: string;

  constructor(options?: ShellDaemonOptions) {
    this.binaryPath = options?.binaryPath || "inkscape";
  }

  async init() {
    // Phase 2: 啟動 inkscape --shell 進程，建立 IPC
    console.log(`[ShellDaemonEngine] Would start daemon: ${this.binaryPath} --shell`);
  }

  async dispose() {
    console.log("[ShellDaemonEngine] Disposed");
  }

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    // Phase 2: 透過 IPC 傳送 actions，而非 spawn 新進程
    return {
      success: true,
      stdout: `ShellDaemon executed actions: ${ctx.actions.join("; ")}`,
      stderr: "",
      durationMs: 10,
    };
  }
}
