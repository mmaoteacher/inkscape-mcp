import { spawnSync } from "child_process";

/**
 * Patterns Inkscape prints on stderr when it cannot carry out part of an action
 * chain. Inkscape usually still exits 0 in these cases, so a bare exit-code check
 * silently reports success for work that never happened.
 */
const ACTION_ERROR_PATTERNS = [
  /could not find action for/i,
  /expected argument format/i,
  /parsing arguments failed/i,
  /is not a valid action/i,
  /no action by that name/i,
  /action .* failed/i,
];

export interface ActionRunOptions {
  inputFile?: string;
  actions: string[];
  outputFile?: string;
  outputType?: string;
  /** Extra CLI flags, e.g. ["--export-area=0:0:10:10", "--export-dpi=144"]. */
  extraArgs?: string[];
  timeoutMs?: number;
}

export interface ActionRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** Set when the process could not be started at all (e.g. binary missing). */
  spawnError?: string;
  /** Set when Inkscape reported that it could not run part of the action chain. */
  actionError?: string;
}

/** Detect action-level failures that still exit with status 0. */
export function findActionError(stderr: string): string | undefined {
  for (const pattern of ACTION_ERROR_PATTERNS) {
    const match = stderr.match(pattern);
    if (match) {
      const line = stderr.split("\n").find((l) => pattern.test(l));
      return (line ?? match[0]).trim();
    }
  }
  return undefined;
}

/**
 * Run an Inkscape action chain in one-shot batch mode.
 *
 * Actions must be passed as a single semicolon-separated --actions argument:
 * Inkscape does not accept them as repeated flags, and it treats stray arguments
 * as input filenames.
 */
export function runActions(binaryPath: string, options: ActionRunOptions): ActionRunResult {
  const start = Date.now();
  const args: string[] = [];

  if (options.inputFile) args.push(`--file=${options.inputFile}`);
  if (options.outputFile) {
    args.push(`--export-filename=${options.outputFile}`);
    // Without this Inkscape appends "_out" when the type is unchanged.
    args.push("--export-overwrite");
  }
  if (options.outputType) args.push(`--export-type=${options.outputType}`);
  if (options.extraArgs?.length) args.push(...options.extraArgs);
  if (options.actions.length > 0) args.push(`--actions=${options.actions.join(";")}`);

  const result = spawnSync(binaryPath, args, { encoding: "utf-8", timeout: options.timeoutMs ?? 60000 });
  const stderr = result.stderr ?? "";
  const stdout = result.stdout ?? "";

  const actionError = findActionError(stderr);
  const spawnError = result.error?.message;

  return {
    ok: !spawnError && result.status === 0 && !actionError,
    stdout,
    stderr,
    durationMs: Date.now() - start,
    spawnError,
    actionError,
  };
}
