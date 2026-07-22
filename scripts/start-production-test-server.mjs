import path from "node:path";
import { pathToFileURL } from "node:url";

const port = process.argv[2];
if (!port || !/^\d+$/.test(port)) {
  throw new Error("A numeric port is required");
}

const standaloneRoot = path.resolve(".next/standalone");
if (
  process.env.PRIVATE_OBJECT_ROOT &&
  !path.isAbsolute(process.env.PRIVATE_OBJECT_ROOT)
) {
  process.env.PRIVATE_OBJECT_ROOT = path.resolve(
    process.env.PRIVATE_OBJECT_ROOT,
  );
}
process.env.HOSTNAME = "127.0.0.1";
process.env.PORT = port;
process.chdir(standaloneRoot);
await import(pathToFileURL(path.join(standaloneRoot, "server.js")).href);
