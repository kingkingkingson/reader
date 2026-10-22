import { build } from "esbuild";
await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: "dist/main.mjs",
});
