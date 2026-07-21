import "server-only";

import type { SqlDatabase } from "../../platform/sql-port";
import type { AuthSession } from "../types";
import { csrfTokenForSession, sha256Hex, verifyCsrfToken } from "./crypto";
import type { AuthRuntimeConfig } from "./config";
import { loadSessionByDigest, type StoredSession } from "./repository";

export interface SessionContext {
  readonly csrfToken: string;
  readonly rawToken: string;
  readonly session: AuthSession;
  readonly stored: StoredSession;
}

export async function sessionContextFromToken(input: {
  readonly config: AuthRuntimeConfig;
  readonly database: SqlDatabase;
  readonly token: string | undefined;
}): Promise<SessionContext | null> {
  if (!input.token || input.token.length > 256) {
    return null;
  }
  const stored = await loadSessionByDigest(input.database, sha256Hex(input.token));
  if (!stored) {
    return null;
  }
  const expiresAt = new Date(
    Math.min(stored.absoluteExpiresAt.getTime(), stored.idleExpiresAt.getTime()),
  );
  return {
    csrfToken: csrfTokenForSession(input.token, input.config.authSecret),
    rawToken: input.token,
    session: {
      authorOnboarding: stored.authorOnboarding,
      expiresAt: expiresAt.toISOString(),
      roles: stored.roles,
      sessionId: stored.sessionId,
      userId: stored.userId,
    },
    stored,
  };
}

export function assertValidCsrf(
  candidate: FormDataEntryValue | null,
  context: SessionContext,
  config: AuthRuntimeConfig,
): void {
  if (
    typeof candidate !== "string" ||
    !verifyCsrfToken(candidate, context.rawToken, config.authSecret)
  ) {
    throw new Error("Invalid CSRF token");
  }
}
