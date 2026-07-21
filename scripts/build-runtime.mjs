import { rm } from "node:fs/promises";
import path from "node:path";

import { build } from "esbuild";

const outputDirectory = path.resolve("dist/runtime");
await rm(outputDirectory, { force: true, recursive: true });

await build({
  bundle: true,
  entryPoints: {
    "db-migrate": "db/migrations/cli.ts",
    scheduler: "workers/scheduler.ts",
    worker: "workers/worker.ts"
  },
  format: "esm",
  outdir: outputDirectory,
  packages: "external",
  platform: "node",
  sourcemap: "external",
  sourcesContent: false,
  target: "node20"
});

console.log("Built web-adjacent worker, scheduler, and migration runtimes.");
