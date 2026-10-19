import { build } from "esbuild";
import { execFileSync } from "node:child_process";
let commit = "unknown";
try {
  commit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
} catch {}
await build({
  entryPoints: ["main/index.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/main.cjs",
  external: ["electron"],
  define: { READER_BUILD_COMMIT: JSON.stringify(commit) },
});
await build({
  entryPoints: ["preload/index.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/preload.cjs",
  external: ["electron"],
});
