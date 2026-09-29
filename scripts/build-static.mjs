// Static build of the UI into out/ (for GitHub Pages and the Capacitor app).
// Route handlers cannot be exported, so src/app/api is moved aside during the build.
import { execSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";

const api = "src/app/api";
const parked = ".api-parked";
if (existsSync(parked)) throw new Error(`${parked} exists: a previous build was interrupted; move it back to ${api}`);
renameSync(api, parked);
try {
  execSync("next build", { stdio: "inherit", env: { ...process.env, STATIC_EXPORT: "1", NEXT_TELEMETRY_DISABLED: "1" } });
} finally {
  renameSync(parked, api);
}
