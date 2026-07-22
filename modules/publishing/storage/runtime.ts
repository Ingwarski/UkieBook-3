import "server-only";

import path from "node:path";

import { readServerEnvironment } from "../../platform/environment/server";
import { LocalPrivateObjectStorage } from "./private-object-storage";

let storage: LocalPrivateObjectStorage | undefined;

export function publishingPrivateObjectStorage(): LocalPrivateObjectStorage {
  const environment = readServerEnvironment();
  storage ??= new LocalPrivateObjectStorage(
    path.isAbsolute(environment.PRIVATE_OBJECT_ROOT)
      ? environment.PRIVATE_OBJECT_ROOT
      : path.resolve(
          /* turbopackIgnore: true */ process.cwd(),
          environment.PRIVATE_OBJECT_ROOT,
        ),
  );
  return storage;
}
