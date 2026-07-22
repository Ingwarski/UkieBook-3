import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
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

// Next's file tracer can retain the @img/sharp-libvips package metadata while
// omitting its platform-native shared library. Copy every installed libvips
// optional package as a complete tree so the standalone runtime is genuinely
// self-contained on the platform where it was built.
const imagePackagesSource = path.resolve("node_modules/@img");
if (await exists(imagePackagesSource)) {
  const imagePackagesTarget = path.join(standaloneRoot, "node_modules/@img");
  for (const packageName of await readdir(imagePackagesSource)) {
    if (!packageName.startsWith("sharp-libvips-")) continue;
    const packageSource = path.join(imagePackagesSource, packageName);
    const packageTarget = path.join(imagePackagesTarget, packageName);
    await rm(packageTarget, { force: true, recursive: true });
    await mkdir(path.dirname(packageTarget), { recursive: true });
    await cp(packageSource, packageTarget, { dereference: true, recursive: true });
  }
}

console.log("Prepared the self-contained Next.js standalone runtime.");
