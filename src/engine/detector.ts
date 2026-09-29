import { spawnSync, existsSync } from "fs";

const MACOS_APP_PATH = "/Applications/Inkscape.app/Contents/MacOS/inkscape";

export function detectInkscape(): { found: boolean; path: string; version?: string; message: string } {
  // 先嘗試 PATH
  try {
    const result = spawnSync("inkscape", ["--version"], { encoding: "utf-8", timeout: 5000 });
    if (result.status === 0) {
      return { found: true, path: "inkscape", version: result.stdout.trim(), message: `Found Inkscape (PATH): ${result.stdout.trim()}` };
    }
  } catch { /* ignore */ }

  // 再嘗試 macOS App 路徑
  if (existsSync(MACOS_APP_PATH)) {
    try {
      const result = spawnSync(MACOS_APP_PATH, ["--version"], { encoding: "utf-8", timeout: 5000 });
      if (result.status === 0) {
        return { found: true, path: MACOS_APP_PATH, version: result.stdout.trim(), message: `Found Inkscape (macOS App): ${MACOS_APP_PATH}` };
      }
    } catch { /* ignore */ }
  }

  return {
    found: false,
    path: "",
    message: "Inkscape not found. macOS: check /Applications/Inkscape.app; install via brew or inkscape.org",
  };
}
