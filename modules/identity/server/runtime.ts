import "server-only";

import { readServerEnvironment } from "../../platform/environment/server";
import type { SqlDatabase } from "../../platform/sql-port";
import { productionDatabase } from "../../platform/server/database";
import type { OAuthProviderId } from "../types";
import { authRuntimeConfig, createProviderRegistry } from "./config";
import type { OAuthProvider } from "./provider";

export function identityDatabase(): SqlDatabase {
  return productionDatabase();
}

export function identityRuntime(): {
  readonly config: ReturnType<typeof authRuntimeConfig>;
  readonly database: SqlDatabase;
  readonly provider: (id: OAuthProviderId) => OAuthProvider;
} {
  const environment = readServerEnvironment();
  return {
    config: authRuntimeConfig(environment),
    database: identityDatabase(),
    provider(id) {
      const providers = createProviderRegistry(environment);
      const provider = providers.get(id);
      if (!provider) {
        throw new Error(`Unsupported OAuth provider: ${id}`);
      }
      return provider;
    },
  };
}
