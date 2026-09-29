import { spawnSync } from "child_process";

export function detectInkscape(): { found: boolean; path: string; version?: string; message: string } {
  try {
    const result = spawnSync("inkscape", ["--version"], { encoding: "utf-8", timeout: 5000 });
    if (result.status === 0) {
      const version = result.stdout.trim();
      return { found: true, path: "inkscape", version, message: `Found Inkscape: ${version}` };
    }
  } catch {
    // ignore
  }
  return {
    found: false,
    path: "",
    message: "Inkscape not found. Install: macOS `brew install inkscape`, Ubuntu `apt install inkscape`, Windows download from inkscape.org",
  };
}
