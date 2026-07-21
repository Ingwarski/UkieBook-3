import "server-only";

import type { SqlDatabase } from "../../platform/sql-port";
import { withSqlTransaction } from "../../platform/sql-port";
import type { AuthRuntimeConfig } from "../../identity/server/config";
import { randomOpaqueToken, sha256Hex } from "../../identity/server/crypto";
import type { SessionContext } from "../../identity/server/session";
import { saveAuthorProfile } from "./repository";

export async function persistAuthorProfile(input: {
  readonly config: AuthRuntimeConfig;
  readonly database: SqlDatabase;
  readonly publicName: string;
  readonly sessionContext: SessionContext;
}) {
  const replacementToken = input.sessionContext.session.authorOnboarding
    ? randomOpaqueToken()
    : undefined;
  const now = Date.now();
  const idleExpiresAt = new Date(
    now + input.config.sessionIdleLifetimeSeconds * 1_000,
  );
  const absoluteExpiresAt = new Date(
    now + input.config.sessionAbsoluteLifetimeSeconds * 1_000,
  );
  const result = await withSqlTransaction(input.database, (transaction) =>
    saveAuthorProfile(transaction, {
      profileName: input.publicName,
      replacementSession: replacementToken
        ? {
            absoluteExpiresAt,
            authorOnboarding: false,
            idleExpiresAt,
            tokenDigest: sha256Hex(replacementToken),
          }
        : undefined,
      session: input.sessionContext.stored,
    }),
  );
  return {
    ...result,
    replacementSession: replacementToken
      ? { expiresAt: idleExpiresAt, token: replacementToken }
      : undefined,
  };
}
