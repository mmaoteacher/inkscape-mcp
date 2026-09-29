export interface ExecutionContext {
  inputFile?: string;
  outputFile?: string;
  actions: string[];
}

export interface ExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface InkscapeEngine {
  init(): Promise<void>;
  execute(ctx: ExecutionContext): Promise<ExecutionResult>;
  dispose(): Promise<void>;
}
