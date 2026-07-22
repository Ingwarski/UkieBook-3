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
  plugins: [
    {
      name: "server-only-node-runtime",
      setup(runtimeBuild) {
        runtimeBuild.onResolve({ filter: /^server-only$/ }, () => ({
          namespace: "server-only-node-runtime",
          path: "server-only",
        }));
        runtimeBuild.onLoad(
          { filter: /.*/, namespace: "server-only-node-runtime" },
          () => ({ contents: "export {};", loader: "js" }),
        );
      },
    },
  ],
  sourcemap: "external",
  sourcesContent: false,
  target: "node20"
});

console.log("Built web-adjacent worker, scheduler, and migration runtimes.");
