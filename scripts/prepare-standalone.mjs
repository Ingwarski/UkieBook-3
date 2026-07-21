import { cp, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

const standaloneRoot = path.resolve(".next/standalone");
const staticSource = path.resolve(".next/static");
const staticTarget = path.join(standaloneRoot, ".next/static");
await rm(staticTarget, { force: true, recursive: true });
await mkdir(path.dirname(staticTarget), { recursive: true });
await cp(staticSource, staticTarget, { recursive: true });

const publicSource = path.resolve("public");
const publicTarget = path.join(standaloneRoot, "public");
await rm(publicTarget, { force: true, recursive: true });
if (await exists(publicSource)) {
  await cp(publicSource, publicTarget, { recursive: true });
}

console.log("Prepared the self-contained Next.js standalone runtime.");
