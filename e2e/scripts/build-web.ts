import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { E2E_API_URL, E2E_DIST_DIR } from "../src/env.js";

/*
 * A production build of the web app FOR THE E2E STACK.
 *
 * Why a separate build: Next.js resolves `rewrites()` (our /api → API proxy) at
 * BUILD time and writes the target into .next/routes-manifest.json. The suite's
 * API runs on its own port, so it needs a build that points there. Building
 * into its own folder (.next-e2e) leaves your normal `.next` build untouched.
 */
const webDir = fileURLToPath(new URL("../../apps/web/", import.meta.url));
const nextBin = createRequire(`${webDir}package.json`).resolve("next/dist/bin/next");

const result = spawnSync(process.execPath, [nextBin, "build"], {
  cwd: webDir,
  stdio: "inherit",
  env: {
    ...process.env,
    API_URL: E2E_API_URL,
    NEXT_DIST_DIR: E2E_DIST_DIR,
    NEXT_TELEMETRY_DISABLED: "1",
  },
});
process.exit(result.status ?? 1);
