// src/launcher-path.ts
import { existsSync } from "fs";
import { join } from "path";

// Path to the built Electrobun viewer binary, relative to the repo root, or null if not built.
// CONFIRMED dev-build layout: build/dev-macos-arm64/<appName>-dev.app/Contents/MacOS/launcher
// appName is "sedno-viewer" (electrobun.config.ts), so the dev bundle is "sedno-viewer-dev.app".
export function resolveLauncherPath(repoRoot: string = join(import.meta.dir, "..")): string | null {
  const candidate = join(
    repoRoot,
    "viewer-app", "build", "dev-macos-arm64", "sedno-viewer-dev.app", "Contents", "MacOS", "launcher",
  );
  return existsSync(candidate) ? candidate : null;
}
