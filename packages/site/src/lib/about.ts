/**
 * What this site is: its version and build, its environment, and which
 * edges it works with. The edge facts come from the backend's own outputs
 * (custom.app: minEdgeVersion from edge-shared/http.ts, edgeRelease
 * from backend/edge-release/release.json), so they cannot drift from what
 * the edge API enforces.
 */

export interface AppInfo {
  version: string;
  commit: string | null;
  environment: string | null;
  minEdgeVersion: string | null;
  edgeRelease: string | null;
}

export function appInfo(): AppInfo {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  const pkg = require("../../package.json") as { version: string };
  let custom: Record<string, string> = {};
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    custom = (require("../amplify_outputs.json").custom?.app ?? {}) as Record<string, string>;
  } catch { /* a build without a backend */ }
  return {
    version: pkg.version,
    commit: process.env.GATSBY_COMMIT_ID || null,
    environment: custom.environment ?? null,
    minEdgeVersion: custom.minEdgeVersion ?? null,
    edgeRelease: custom.edgeRelease ?? null,
  };
}

/** "1.2.3" ≥ "1.0.0"? The same rule as the edge API's gate. */
export function versionAtLeast(v: string | null | undefined, min: string | null | undefined): boolean {
  if (!min) return true;
  const parse = (x: string | null | undefined) => /^\s*(\d+)\.(\d+)\.(\d+)/.exec(x ?? "")?.slice(1).map(Number);
  const a = parse(v), b = parse(min);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}
