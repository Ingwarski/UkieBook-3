import "server-only";

import type { SqlExecutor } from "../../platform/sql-port";
import type { StoredSession } from "../../identity/server/repository";
import {
  appendAudit,
  insertSession,
  type SessionInsert,
} from "../../identity/server/repository";
import type { AuthorProfile } from "../types";

export async function loadAuthorProfile(
  executor: SqlExecutor,
  userId: string,
): Promise<AuthorProfile | null> {
  const result = await executor.query<{ public_name: string; user_id: string }>(
    `
      SELECT user_id, public_name
      FROM author_profiles
      WHERE user_id = $1
    `,
    [userId],
  );
  const row = result.rows[0];
  return row ? { authorId: row.user_id, publicName: row.public_name } : null;
}

export async function loadPublicAuthorProfile(
  executor: SqlExecutor,
  authorId: string,
): Promise<AuthorProfile | null> {
  // This deliberately selects and constructs only the two public fields. Never widen it.
  return loadAuthorProfile(executor, authorId);
}

export interface SaveAuthorProfileResult {
  readonly profile: AuthorProfile;
  readonly redirectTo?: string;
  readonly replacementSessionId?: string;
  readonly roleGranted: boolean;
}

export async function saveAuthorProfile(
  executor: SqlExecutor,
  input: {
    readonly profileName: string;
    readonly replacementSession?: Omit<SessionInsert, "authorizationVersion" | "userId">;
    readonly session: StoredSession;
  },
): Promise<SaveAuthorProfileResult> {
  const lockedUser = await executor.query<{ status: string }>(
    `
      SELECT status
      FROM users
      WHERE id = $1
      FOR UPDATE
    `,
    [input.session.userId],
  );
  if (lockedUser.rows[0]?.status !== "active") {
    throw new Error("The author profile user is not active");
  }

  // Lock the user before any session so concurrent onboarding submissions cannot
  // grant the role twice or deadlock while revoking one another's sessions.
  const lockedSession = await executor.query<{
    author_onboarding: boolean;
    return_to_after_onboarding: string | null;
  }>(
    `
      SELECT author_onboarding, return_to_after_onboarding
      FROM sessions
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
      FOR UPDATE
    `,
    [input.session.sessionId, input.session.userId],
  );
  const activeSession = lockedSession.rows[0];
  if (!activeSession) {
    throw new Error("The author profile session is no longer active");
  }

  const role = await executor.query<{ present: boolean }>(
    "SELECT TRUE AS present FROM user_roles WHERE user_id = $1 AND role = 'author'",
    [input.session.userId],
  );
  const alreadyAuthor = role.rows[0]?.present === true;
  if (!alreadyAuthor && !activeSession.author_onboarding) {
    throw new Error("Author role is required to update this profile");
  }

  await executor.query(
    `
      INSERT INTO author_profiles (user_id, public_name)
      VALUES ($1, $2)
      ON CONFLICT (user_id) DO UPDATE
      SET public_name = EXCLUDED.public_name,
          updated_at = CURRENT_TIMESTAMP
    `,
    [input.session.userId, input.profileName],
  );
  await appendAudit(executor, {
    eventType: "author_profile_updated",
    reasonCode: alreadyAuthor ? "author_edit" : "author_onboarding",
    userId: input.session.userId,
  });

  let roleGranted = false;
  let replacementSessionId: string | undefined;
  if (!alreadyAuthor) {
    if (!input.replacementSession) {
      throw new Error("Author onboarding requires session rotation");
    }
    const inserted = await executor.query(
      `
        INSERT INTO user_roles (user_id, role)
        VALUES ($1, 'author')
        ON CONFLICT (user_id, role) DO NOTHING
      `,
      [input.session.userId],
    );
    roleGranted = inserted.rowCount === 1;
    const user = await executor.query<{ authorization_version: number }>(
      `
        UPDATE users
        SET authorization_version = authorization_version + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND status = 'active'
        RETURNING authorization_version
      `,
      [input.session.userId],
    );
    const authorizationVersion = user.rows[0]?.authorization_version;
    if (!authorizationVersion) {
      throw new Error("Author onboarding user is not active");
    }
    await executor.query(
      `
        UPDATE sessions
        SET revoked_at = CURRENT_TIMESTAMP
        WHERE user_id = $1 AND revoked_at IS NULL
      `,
      [input.session.userId],
    );
    await appendAudit(executor, {
      eventType: "role_granted",
      metadata: { role: "author" },
      reasonCode: "author_profile_completed",
      userId: input.session.userId,
    });
    replacementSessionId = await insertSession(executor, {
      ...input.replacementSession,
      authorOnboarding: false,
      authorizationVersion,
      userId: input.session.userId,
    });
  }

  return {
    profile: { authorId: input.session.userId, publicName: input.profileName },
    redirectTo: !alreadyAuthor
      ? activeSession.return_to_after_onboarding ?? "/author/publish"
      : undefined,
    replacementSessionId,
    roleGranted,
  };
}
