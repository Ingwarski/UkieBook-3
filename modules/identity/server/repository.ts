import "server-only";

import { randomUUID } from "node:crypto";

import type { SqlExecutor, SqlRow } from "../../platform/sql-port";
import type { AuthIntent, OAuthProviderId, UserRole } from "../types";
import { isUserRole } from "../types";
import type { VerifiedProviderIdentity } from "./provider";

export interface OAuthFlowRecord {
  readonly id: string;
  readonly intent: AuthIntent;
  readonly provider: OAuthProviderId;
  readonly returnTo: string;
  readonly sealedCodeVerifier: string;
  readonly sealedNonce?: string;
}

interface OAuthFlowRow extends SqlRow {
  id: string;
  intent: AuthIntent;
  provider: OAuthProviderId;
  return_to: string;
  sealed_code_verifier: string;
  sealed_nonce: string | null;
}

interface SessionRow extends SqlRow {
  absolute_expires_at: Date | string;
  author_onboarding: boolean;
  authorization_version: number;
  idle_expires_at: Date | string;
  return_to_after_onboarding: string | null;
  session_id: string;
  user_authorization_version: number;
  user_id: string;
  user_status: string;
}

export interface StoredSession {
  readonly absoluteExpiresAt: Date;
  readonly authorOnboarding: boolean;
  readonly idleExpiresAt: Date;
  readonly returnToAfterOnboarding?: string;
  readonly roles: readonly UserRole[];
  readonly sessionId: string;
  readonly userId: string;
}

export interface SessionInsert {
  readonly absoluteExpiresAt: Date;
  readonly authorOnboarding: boolean;
  readonly authorizationVersion: number;
  readonly idleExpiresAt: Date;
  readonly returnToAfterOnboarding?: string;
  readonly tokenDigest: string;
  readonly userId: string;
}

export async function insertOAuthFlow(
  executor: SqlExecutor,
  input: {
    readonly browserBindingDigest: string;
    readonly expiresAt: Date;
    readonly intent: AuthIntent;
    readonly provider: OAuthProviderId;
    readonly returnTo: string;
    readonly sealedCodeVerifier: string;
    readonly sealedNonce?: string;
    readonly stateDigest: string;
  },
): Promise<string> {
  const id = randomUUID();
  await executor.query(
    `
      INSERT INTO oauth_flows (
        id, provider, state_digest, browser_binding_digest,
        sealed_code_verifier, sealed_nonce, return_to, intent, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      id,
      input.provider,
      input.stateDigest,
      input.browserBindingDigest,
      input.sealedCodeVerifier,
      input.sealedNonce ?? null,
      input.returnTo,
      input.intent,
      input.expiresAt,
    ],
  );
  return id;
}

export async function claimOAuthFlow(
  executor: SqlExecutor,
  input: {
    readonly browserBindingDigest: string;
    readonly provider: OAuthProviderId;
    readonly stateDigest: string;
  },
): Promise<OAuthFlowRecord | null> {
  const result = await executor.query<OAuthFlowRow>(
    `
      UPDATE oauth_flows
      SET status = 'processing', claimed_at = CURRENT_TIMESTAMP
      WHERE provider = $1
        AND state_digest = $2
        AND browser_binding_digest = $3
        AND status = 'pending'
        AND expires_at > CURRENT_TIMESTAMP
      RETURNING id, provider, sealed_code_verifier, sealed_nonce, return_to, intent
    `,
    [input.provider, input.stateDigest, input.browserBindingDigest],
  );
  const row = result.rows[0];
  return row
    ? {
        id: row.id,
        intent: row.intent,
        provider: row.provider,
        returnTo: row.return_to,
        sealedCodeVerifier: row.sealed_code_verifier,
        sealedNonce: row.sealed_nonce ?? undefined,
      }
    : null;
}

export async function markOAuthFlowFailed(
  executor: SqlExecutor,
  flowId: string,
  failureCode: string,
): Promise<void> {
  await executor.query(
    `
      UPDATE oauth_flows
      SET status = 'failed', completed_at = CURRENT_TIMESTAMP, failure_code = $2
      WHERE id = $1 AND status = 'processing'
    `,
    [flowId, failureCode],
  );
}

async function appendAudit(
  executor: SqlExecutor,
  input: {
    readonly eventType:
      | "login_succeeded"
      | "login_failed"
      | "role_granted"
      | "role_revoked"
      | "session_revoked"
      | "author_profile_updated";
    readonly metadata?: Readonly<Record<string, string>>;
    readonly provider?: OAuthProviderId;
    readonly reasonCode?: string;
    readonly userId?: string;
  },
): Promise<void> {
  await executor.query(
    `
      INSERT INTO identity_audit_events (
        id, user_id, event_type, provider, reason_code, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [
      randomUUID(),
      input.userId ?? null,
      input.eventType,
      input.provider ?? null,
      input.reasonCode ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

export async function appendFailedLoginAudit(
  executor: SqlExecutor,
  provider: OAuthProviderId,
  reasonCode: string,
): Promise<void> {
  await appendAudit(executor, {
    eventType: "login_failed",
    provider,
    reasonCode,
  });
}

async function rolesForUser(executor: SqlExecutor, userId: string): Promise<UserRole[]> {
  const result = await executor.query<{ role: string }>(
    "SELECT role FROM user_roles WHERE user_id = $1 ORDER BY role",
    [userId],
  );
  return result.rows.map((row) => row.role).filter(isUserRole);
}

export async function insertSession(
  executor: SqlExecutor,
  input: SessionInsert,
): Promise<string> {
  const id = randomUUID();
  await executor.query(
    `
      INSERT INTO sessions (
        id, user_id, token_digest, authorization_version,
        author_onboarding, return_to_after_onboarding,
        idle_expires_at, absolute_expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      id,
      input.userId,
      input.tokenDigest,
      input.authorizationVersion,
      input.authorOnboarding,
      input.returnToAfterOnboarding ?? null,
      input.idleExpiresAt,
      input.absoluteExpiresAt,
    ],
  );
  return id;
}

export interface CompletedLogin {
  readonly authorOnboarding: boolean;
  readonly hasAuthorProfile: boolean;
  readonly roles: readonly UserRole[];
  readonly sessionId: string;
  readonly userId: string;
}

export async function completeOAuthLogin(
  executor: SqlExecutor,
  input: {
    readonly flow: OAuthFlowRecord;
    readonly identity: VerifiedProviderIdentity;
    readonly session: Omit<SessionInsert, "authorizationVersion" | "userId">;
  },
): Promise<CompletedLogin> {
  const existing = await executor.query<{ user_id: string }>(
    `
      SELECT user_id
      FROM oauth_accounts
      WHERE provider = $1 AND provider_subject = $2
      FOR UPDATE
    `,
    [input.identity.provider, input.identity.subject],
  );
  let userId = existing.rows[0]?.user_id;
  let created = false;

  if (!userId) {
    const proposedUserId = randomUUID();
    await executor.query(
      `
        INSERT INTO users (
          id, private_email, private_email_verified, private_display_name
        ) VALUES ($1, $2, $3, $4)
      `,
      [
        proposedUserId,
        input.identity.email ?? null,
        input.identity.emailVerified,
        input.identity.displayName ?? null,
      ],
    );
    const account = await executor.query<{ user_id: string }>(
      `
        INSERT INTO oauth_accounts (
          id, user_id, provider, provider_subject,
          provider_email, provider_email_verified, provider_display_name
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (provider, provider_subject) DO NOTHING
        RETURNING user_id
      `,
      [
        randomUUID(),
        proposedUserId,
        input.identity.provider,
        input.identity.subject,
        input.identity.email ?? null,
        input.identity.emailVerified,
        input.identity.displayName ?? null,
      ],
    );
    userId = account.rows[0]?.user_id;
    if (userId) {
      created = true;
      await executor.query(
        "INSERT INTO user_roles (user_id, role) VALUES ($1, 'buyer')",
        [userId],
      );
      await appendAudit(executor, {
        eventType: "role_granted",
        reasonCode: "initial_authenticated_role",
        userId,
        metadata: { role: "buyer" },
      });
    } else {
      await executor.query("DELETE FROM users WHERE id = $1", [proposedUserId]);
      const winner = await executor.query<{ user_id: string }>(
        `
          SELECT user_id
          FROM oauth_accounts
          WHERE provider = $1 AND provider_subject = $2
          FOR UPDATE
        `,
        [input.identity.provider, input.identity.subject],
      );
      userId = winner.rows[0]?.user_id;
    }
  }

  if (!userId) {
    throw new Error("Unable to resolve the OAuth account owner");
  }

  if (!created) {
    await executor.query(
      `
        UPDATE oauth_accounts
        SET provider_email = $3,
            provider_email_verified = $4,
            provider_display_name = $5,
            last_login_at = CURRENT_TIMESTAMP
        WHERE provider = $1 AND provider_subject = $2
      `,
      [
        input.identity.provider,
        input.identity.subject,
        input.identity.email ?? null,
        input.identity.emailVerified,
        input.identity.displayName ?? null,
      ],
    );
  }

  const user = await executor.query<{ authorization_version: number }>(
    "SELECT authorization_version FROM users WHERE id = $1 AND status = 'active' FOR UPDATE",
    [userId],
  );
  const authorizationVersion = user.rows[0]?.authorization_version;
  if (!authorizationVersion) {
    throw new Error("The OAuth account owner is not active");
  }
  const roles = await rolesForUser(executor, userId);
  const profile = await executor.query<{ present: boolean }>(
    "SELECT TRUE AS present FROM author_profiles WHERE user_id = $1",
    [userId],
  );
  const hasAuthorProfile = profile.rows[0]?.present === true;
  const authorOnboarding =
    input.flow.intent === "author_onboarding" && !roles.includes("author");
  const sessionId = await insertSession(executor, {
    ...input.session,
    authorOnboarding,
    authorizationVersion,
    returnToAfterOnboarding: authorOnboarding ? "/author/publish" : undefined,
    userId,
  });
  await appendAudit(executor, {
    eventType: "login_succeeded",
    provider: input.identity.provider,
    reasonCode: created ? "new_account" : "returning_account",
    userId,
  });
  const completed = await executor.query(
    `
      UPDATE oauth_flows
      SET status = 'consumed', completed_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND status = 'processing'
    `,
    [input.flow.id],
  );
  if (completed.rowCount !== 1) {
    throw new Error("OAuth flow was not in the claimed state");
  }
  return {
    authorOnboarding,
    hasAuthorProfile,
    roles,
    sessionId,
    userId,
  };
}

export async function loadSessionByDigest(
  executor: SqlExecutor,
  tokenDigest: string,
): Promise<StoredSession | null> {
  const result = await executor.query<SessionRow>(
    `
      SELECT
        s.id AS session_id,
        s.user_id,
        s.authorization_version,
        s.author_onboarding,
        s.return_to_after_onboarding,
        s.idle_expires_at,
        s.absolute_expires_at,
        u.authorization_version AS user_authorization_version,
        u.status AS user_status
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_digest = $1
        AND s.revoked_at IS NULL
        AND s.idle_expires_at > CURRENT_TIMESTAMP
        AND s.absolute_expires_at > CURRENT_TIMESTAMP
        AND u.status = 'active'
        AND s.authorization_version = u.authorization_version
    `,
    [tokenDigest],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    absoluteExpiresAt: new Date(row.absolute_expires_at),
    authorOnboarding: row.author_onboarding,
    idleExpiresAt: new Date(row.idle_expires_at),
    returnToAfterOnboarding: row.return_to_after_onboarding ?? undefined,
    roles: await rolesForUser(executor, row.user_id),
    sessionId: row.session_id,
    userId: row.user_id,
  };
}

export async function revokeSession(
  executor: SqlExecutor,
  sessionId: string,
  userId: string,
  reasonCode: string,
): Promise<void> {
  const result = await executor.query(
    `
      UPDATE sessions
      SET revoked_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
    `,
    [sessionId, userId],
  );
  if (result.rowCount === 1) {
    await appendAudit(executor, {
      eventType: "session_revoked",
      reasonCode,
      userId,
    });
  }
}

export { appendAudit };
