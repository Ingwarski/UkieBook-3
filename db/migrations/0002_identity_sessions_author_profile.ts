import { createHash } from "node:crypto";

import type { Migration } from "./types";
import { runStatements } from "./types";
import { IDENTITY_SESSIONS_AUTHOR_PROFILE_MIGRATION_ID } from "../../modules/platform/schema-revision";

const upStatements = [
  `
    CREATE TABLE users (
      id UUID PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'disabled')),
      private_email TEXT,
      private_email_verified BOOLEAN NOT NULL DEFAULT FALSE,
      private_display_name TEXT,
      authorization_version INTEGER NOT NULL DEFAULT 1
        CHECK (authorization_version > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE oauth_accounts (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL CHECK (provider IN ('google', 'facebook')),
      provider_subject TEXT NOT NULL CHECK (length(btrim(provider_subject)) > 0),
      provider_email TEXT,
      provider_email_verified BOOLEAN NOT NULL DEFAULT FALSE,
      provider_display_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_login_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (provider, provider_subject),
      UNIQUE (user_id, provider)
    )
  `,
  `
    CREATE TABLE user_roles (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('buyer', 'author', 'manager')),
      granted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, role)
    )
  `,
  `
    CREATE TABLE oauth_flows (
      id UUID PRIMARY KEY,
      provider TEXT NOT NULL CHECK (provider IN ('google', 'facebook')),
      state_digest CHAR(64) NOT NULL UNIQUE
        CHECK (state_digest ~ '^[0-9a-f]{64}$'),
      browser_binding_digest CHAR(64) NOT NULL
        CHECK (browser_binding_digest ~ '^[0-9a-f]{64}$'),
      sealed_code_verifier TEXT NOT NULL,
      sealed_nonce TEXT,
      return_to TEXT NOT NULL,
      intent TEXT NOT NULL CHECK (intent IN ('default', 'author_onboarding')),
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'consumed', 'failed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMPTZ NOT NULL,
      claimed_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      failure_code TEXT,
      CHECK (expires_at > created_at),
      CHECK (sealed_nonce IS NOT NULL OR provider = 'facebook')
    )
  `,
  `
    CREATE INDEX oauth_flows_expiry_idx
      ON oauth_flows (expires_at, status)
  `,
  `
    CREATE TABLE sessions (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_digest CHAR(64) NOT NULL UNIQUE
        CHECK (token_digest ~ '^[0-9a-f]{64}$'),
      authorization_version INTEGER NOT NULL CHECK (authorization_version > 0),
      author_onboarding BOOLEAN NOT NULL DEFAULT FALSE,
      return_to_after_onboarding TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      idle_expires_at TIMESTAMPTZ NOT NULL,
      absolute_expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      CHECK (idle_expires_at > created_at),
      CHECK (absolute_expires_at >= idle_expires_at),
      CHECK (author_onboarding OR return_to_after_onboarding IS NULL)
    )
  `,
  `
    CREATE INDEX sessions_user_active_idx
      ON sessions (user_id, absolute_expires_at)
      WHERE revoked_at IS NULL
  `,
  `
    CREATE TABLE author_profiles (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      public_name VARCHAR(120) NOT NULL
        CHECK (length(btrim(public_name)) BETWEEN 2 AND 120),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE author_payout_details (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      schema_version INTEGER NOT NULL CHECK (schema_version > 0),
      key_id TEXT NOT NULL CHECK (length(btrim(key_id)) > 0),
      nonce BYTEA NOT NULL CHECK (octet_length(nonce) = 12),
      ciphertext BYTEA NOT NULL CHECK (octet_length(ciphertext) > 0),
      authentication_tag BYTEA NOT NULL CHECK (octet_length(authentication_tag) = 16),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE identity_audit_events (
      id UUID PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL CHECK (
        event_type IN (
          'login_succeeded',
          'login_failed',
          'role_granted',
          'role_revoked',
          'session_revoked',
          'author_profile_updated'
        )
      ),
      provider TEXT CHECK (provider IS NULL OR provider IN ('google', 'facebook')),
      reason_code TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (jsonb_typeof(metadata) = 'object')
    )
  `,
  `
    CREATE INDEX identity_audit_user_created_idx
      ON identity_audit_events (user_id, created_at, id)
  `,
  `
    CREATE FUNCTION reject_identity_audit_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RAISE EXCEPTION 'identity audit events are append-only';
    END;
    $$
  `,
  `
    CREATE TRIGGER identity_audit_append_only
      BEFORE UPDATE OR DELETE ON identity_audit_events
      FOR EACH ROW EXECUTE FUNCTION reject_identity_audit_mutation()
  `,
] as const;

const downStatements = [
  "DROP TRIGGER IF EXISTS identity_audit_append_only ON identity_audit_events",
  "DROP FUNCTION IF EXISTS reject_identity_audit_mutation()",
  "DROP TABLE IF EXISTS identity_audit_events",
  "DROP TABLE IF EXISTS author_payout_details",
  "DROP TABLE IF EXISTS author_profiles",
  "DROP TABLE IF EXISTS sessions",
  "DROP TABLE IF EXISTS oauth_flows",
  "DROP TABLE IF EXISTS user_roles",
  "DROP TABLE IF EXISTS oauth_accounts",
  "DROP TABLE IF EXISTS users",
] as const;

export const identitySessionsAuthorProfileMigration: Migration = {
  checksum: createHash("sha256")
    .update(
      JSON.stringify({
        down: downStatements,
        id: IDENTITY_SESSIONS_AUTHOR_PROFILE_MIGRATION_ID,
        up: upStatements,
      }),
    )
    .digest("hex"),
  id: IDENTITY_SESSIONS_AUTHOR_PROFILE_MIGRATION_ID,
  up: (connection) => runStatements(connection, upStatements),
  down: (connection) => runStatements(connection, downStatements),
};
