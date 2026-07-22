import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  applyMigrations,
  listAppliedMigrations,
  rollbackLatestMigration,
} from "../db/migrate";
import { migrations } from "../db/migrations";
import { openPostgresDatabase } from "../db/postgres";
import {
  loadPublicAuthorProfile,
  saveAuthorProfile,
} from "../modules/author-profile/server/repository";
import { persistAuthorProfile } from "../modules/author-profile/server/service";
import type { AuthRuntimeConfig } from "../modules/identity/server/config";
import {
  randomOpaqueToken,
  sha256Hex,
} from "../modules/identity/server/crypto";
import type {
  AuthorizationRequestInput,
  OAuthProvider,
  ProviderCallbackInput,
  VerifiedProviderIdentity,
} from "../modules/identity/server/provider";
import {
  insertSession,
  revokeSession,
} from "../modules/identity/server/repository";
import {
  OAuthCallbackFailure,
  finishOAuthFlow,
  startOAuthFlow,
} from "../modules/identity/server/service";
import { sessionContextFromToken } from "../modules/identity/server/session";
import { decideRouteAccess } from "../modules/identity/route-policy";
import type { AuthIntent } from "../modules/identity/types";
import { loadRestrictedPayoutEnvelope } from "../modules/payout-details/server/repository";
import {
  IDENTITY_SESSIONS_AUTHOR_PROFILE_MIGRATION_ID,
  PLATFORM_FOUNDATION_MIGRATION_ID,
} from "../modules/platform/schema-revision";
import type { SqlDatabase } from "../modules/platform/sql-port";
import { withSqlTransaction } from "../modules/platform/sql-port";

const databaseUrl = process.env.REAL_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("REAL_DATABASE_URL is required for the UNIT-01 PostgreSQL proof");
}

const EXPECTED_DATABASE_NAME = "ukiebook_unit01";
const parsedDatabaseUrl = new URL(databaseUrl);
const databaseName = decodeURIComponent(
  parsedDatabaseUrl.pathname.replace(/^\//u, ""),
);
if (
  parsedDatabaseUrl.search ||
  parsedDatabaseUrl.hash ||
  !["postgres:", "postgresql:"].includes(parsedDatabaseUrl.protocol) ||
  !new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(
    parsedDatabaseUrl.hostname,
  ) ||
  databaseName !== EXPECTED_DATABASE_NAME ||
  !parsedDatabaseUrl.username ||
  !parsedDatabaseUrl.password
) {
  throw new Error(
    `REAL_DATABASE_URL must use credentials for the exact loopback database ${EXPECTED_DATABASE_NAME}`,
  );
}
const verifiedDatabaseUrl = databaseUrl;
const unit01Migrations = migrations.slice(0, 2);
const FOUNDATION_TABLES = ["durable_jobs", "outbox_events"] as const;
const IDENTITY_TABLES = [
  "author_payout_details",
  "author_profiles",
  "identity_audit_events",
  "oauth_accounts",
  "oauth_flows",
  "sessions",
  "user_roles",
  "users",
] as const;
const ALL_APPLICATION_TABLES = [...FOUNDATION_TABLES, ...IDENTITY_TABLES].sort();
const evidenceRoot = process.env.UNIT_EVIDENCE_DIR
  ? path.resolve(process.env.UNIT_EVIDENCE_DIR)
  : undefined;
const implementationRevision =
  process.env.APP_REVISION ?? process.env.IMPLEMENTATION_REVISION ?? "working-tree";

interface DatabaseIdentity extends Record<string, unknown> {
  database_name: string;
  server_version: string;
}

interface ConstraintRow extends Record<string, unknown> {
  constraint_definition: string;
  constraint_name: string;
  constraint_type: string;
  table_name: string;
}

interface IndexRow extends Record<string, unknown> {
  index_definition: string;
  index_name: string;
  table_name: string;
}

interface IdentityCounts extends Record<string, unknown> {
  accounts: number;
  audit_events: number;
  flows: number;
  payout_details: number;
  profiles: number;
  roles: number;
  sessions: number;
  users: number;
}

interface ProofArtifacts {
  readonly accessSeparation: Record<string, unknown>;
  readonly authorProfileRole: Record<string, unknown>;
  readonly migrationRoundtrip: Record<string, unknown>;
  readonly oauthSessionConcurrency: Record<string, unknown>;
}

class DeterministicGoogleProvider implements OAuthProvider {
  readonly id = "google" as const;

  constructor(private readonly identity: VerifiedProviderIdentity) {}

  createAuthorizationUrl(input: AuthorizationRequestInput): URL {
    assert.ok(input.nonce, "Google authorization requests must carry an OIDC nonce");
    assert.ok(input.codeChallenge.length >= 43, "PKCE challenge was not generated");
    const url = new URL("https://provider-proof.invalid/google/authorize");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", input.state);
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("nonce", input.nonce);
    return url;
  }

  async exchangeAndVerify(input: ProviderCallbackInput): Promise<VerifiedProviderIdentity> {
    assert.equal(
      input.callbackUrl.searchParams.get("state"),
      input.expectedState,
      "The claimed flow state must be bound to the callback",
    );
    assert.ok(input.expectedNonce, "The persisted Google nonce must be recovered");
    assert.ok(input.codeVerifier.length >= 43, "The persisted PKCE verifier must be recovered");
    return this.identity;
  }
}

async function writeEvidence(relativePath: string, value: unknown): Promise<void> {
  if (!evidenceRoot) {
    return;
  }
  const target = path.join(evidenceRoot, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function applicationTables(database: SqlDatabase): Promise<string[]> {
  const result = await database.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
        'outbox_events', 'durable_jobs', 'users', 'oauth_accounts',
        'user_roles', 'oauth_flows', 'sessions', 'author_profiles',
        'author_payout_details', 'identity_audit_events'
      )
    ORDER BY table_name
  `);
  return result.rows.map((row) => row.table_name);
}

async function identityCounts(database: SqlDatabase): Promise<IdentityCounts> {
  const result = await database.query<IdentityCounts>(`
    SELECT
      (SELECT COUNT(*)::int FROM users) AS users,
      (SELECT COUNT(*)::int FROM oauth_accounts) AS accounts,
      (SELECT COUNT(*)::int FROM user_roles) AS roles,
      (SELECT COUNT(*)::int FROM oauth_flows) AS flows,
      (SELECT COUNT(*)::int FROM sessions) AS sessions,
      (SELECT COUNT(*)::int FROM author_profiles) AS profiles,
      (SELECT COUNT(*)::int FROM author_payout_details) AS payout_details,
      (SELECT COUNT(*)::int FROM identity_audit_events) AS audit_events
  `);
  const counts = result.rows[0];
  assert.ok(counts, "PostgreSQL did not return UNIT-01 row counts");
  return counts;
}

async function rollbackAllKnownMigrations(database: SqlDatabase): Promise<void> {
  for (;;) {
    const rolledBack = await rollbackLatestMigration(database, unit01Migrations);
    if (!rolledBack) {
      return;
    }
  }
}

async function cleanAppliedDatabase(database: SqlDatabase): Promise<{
  applied: Awaited<ReturnType<typeof applyMigrations>>;
  counts: IdentityCounts;
  tables: string[];
}> {
  await rollbackAllKnownMigrations(database);
  assert.deepEqual(
    await applicationTables(database),
    [],
    "Refusing to drop unmanaged tables in the dedicated UNIT-01 database",
  );
  const applied = await applyMigrations(database, unit01Migrations);
  assert.deepEqual(applied, [
    { direction: "up", id: PLATFORM_FOUNDATION_MIGRATION_ID },
    { direction: "up", id: IDENTITY_SESSIONS_AUTHOR_PROFILE_MIGRATION_ID },
  ]);
  const counts = await identityCounts(database);
  assert.deepEqual(counts, {
    accounts: 0,
    audit_events: 0,
    flows: 0,
    payout_details: 0,
    profiles: 0,
    roles: 0,
    sessions: 0,
    users: 0,
  });
  return { applied, counts, tables: await applicationTables(database) };
}

function hasConstraint(
  constraints: readonly ConstraintRow[],
  table: string,
  predicate: (row: ConstraintRow) => boolean,
): boolean {
  return constraints.some((row) => row.table_name === table && predicate(row));
}

async function startProofFlow(input: {
  config: AuthRuntimeConfig;
  database: SqlDatabase;
  intent: AuthIntent;
  provider: OAuthProvider;
  returnTo: string;
}) {
  const started = await startOAuthFlow(input);
  const state = started.authorizationUrl.searchParams.get("state");
  assert.ok(state, "OAuth start did not return state");
  return {
    ...started,
    callbackUrl: new URL(
      `/api/auth/google/callback?code=unit01-proof&state=${encodeURIComponent(state)}`,
      input.config.appOrigin,
    ),
  };
}

function fulfilledValues<Value>(
  results: readonly PromiseSettledResult<Value>[],
): Value[] {
  return results
    .filter((result): result is PromiseFulfilledResult<Value> => result.status === "fulfilled")
    .map((result) => result.value);
}

async function runProof(
  database: SqlDatabase,
  databaseIdentity: DatabaseIdentity,
): Promise<ProofArtifacts> {
  await rollbackAllKnownMigrations(database);
  const emptyTables = await applicationTables(database);
  assert.deepEqual(
    emptyTables,
    [],
    "The dedicated UNIT-01 database contains unmanaged application tables",
  );

  const firstApply = await applyMigrations(database, unit01Migrations);
  assert.deepEqual(firstApply, [
    { direction: "up", id: PLATFORM_FOUNDATION_MIGRATION_ID },
    { direction: "up", id: IDENTITY_SESSIONS_AUTHOR_PROFILE_MIGRATION_ID },
  ]);
  const tablesAfterApply = await applicationTables(database);
  assert.deepEqual(tablesAfterApply, ALL_APPLICATION_TABLES);

  const constraintsResult = await database.query<ConstraintRow>(`
    SELECT
      cls.relname AS table_name,
      con.conname AS constraint_name,
      con.contype::text AS constraint_type,
      pg_get_constraintdef(con.oid) AS constraint_definition
    FROM pg_constraint con
    JOIN pg_class cls ON cls.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace
    WHERE ns.nspname = 'public'
      AND cls.relname IN (
        'users', 'oauth_accounts', 'user_roles', 'oauth_flows', 'sessions',
        'author_profiles', 'author_payout_details', 'identity_audit_events'
      )
    ORDER BY cls.relname, con.conname
  `);
  const constraints = constraintsResult.rows;
  assert.ok(
    hasConstraint(
      constraints,
      "oauth_accounts",
      (row) => row.constraint_definition === "UNIQUE (provider, provider_subject)",
    ),
    "Provider subject uniqueness constraint is missing",
  );
  assert.ok(
    hasConstraint(
      constraints,
      "oauth_accounts",
      (row) => row.constraint_definition === "UNIQUE (user_id, provider)",
    ),
    "Per-user provider uniqueness constraint is missing",
  );
  assert.ok(
    hasConstraint(
      constraints,
      "oauth_flows",
      (row) => row.constraint_definition === "UNIQUE (state_digest)",
    ),
    "OAuth state uniqueness constraint is missing",
  );
  assert.ok(
    hasConstraint(
      constraints,
      "sessions",
      (row) => row.constraint_definition === "UNIQUE (token_digest)",
    ),
    "Session digest uniqueness constraint is missing",
  );
  assert.ok(
    hasConstraint(
      constraints,
      "author_profiles",
      (row) => row.constraint_type === "f" && row.constraint_definition.includes("REFERENCES users(id)"),
    ),
    "Public Author profile ownership constraint is missing",
  );
  assert.ok(
    hasConstraint(
      constraints,
      "author_payout_details",
      (row) => row.constraint_definition.includes("octet_length(nonce) = 12"),
    ),
    "Payout envelope nonce-size constraint is missing",
  );
  assert.ok(
    hasConstraint(
      constraints,
      "identity_audit_events",
      (row) => row.constraint_definition.includes("jsonb_typeof(metadata) = 'object'"),
    ),
    "Identity audit metadata object constraint is missing",
  );

  const indexesResult = await database.query<IndexRow>(`
    SELECT
      tablename AS table_name,
      indexname AS index_name,
      indexdef AS index_definition
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename IN (
        'users', 'oauth_accounts', 'user_roles', 'oauth_flows', 'sessions',
        'author_profiles', 'author_payout_details', 'identity_audit_events'
      )
    ORDER BY tablename, indexname
  `);
  const indexes = indexesResult.rows;
  for (const expectedIndex of [
    "oauth_flows_expiry_idx",
    "sessions_user_active_idx",
    "identity_audit_user_created_idx",
  ]) {
    assert.ok(
      indexes.some((row) => row.index_name === expectedIndex),
      `Identity index ${expectedIndex} is missing`,
    );
  }
  assert.ok(
    indexes.find((row) => row.index_name === "sessions_user_active_idx")?.index_definition.includes(
      "WHERE (revoked_at IS NULL)",
    ),
    "The active-session lookup index must remain partial",
  );

  const rolledBackIdentity = await rollbackLatestMigration(database, unit01Migrations);
  assert.deepEqual(rolledBackIdentity, {
    direction: "down",
    id: IDENTITY_SESSIONS_AUTHOR_PROFILE_MIGRATION_ID,
  });
  const tablesAfterIdentityRollback = await applicationTables(database);
  assert.deepEqual(tablesAfterIdentityRollback, [...FOUNDATION_TABLES].sort());
  const historyAfterIdentityRollback = await listAppliedMigrations(database);
  assert.deepEqual(
    historyAfterIdentityRollback.map((row) => row.id),
    [PLATFORM_FOUNDATION_MIGRATION_ID],
  );

  const identityReapply = await applyMigrations(database, unit01Migrations);
  assert.deepEqual(identityReapply, [
    { direction: "up", id: IDENTITY_SESSIONS_AUTHOR_PROFILE_MIGRATION_ID },
  ]);
  const historyAfterReapply = await listAppliedMigrations(database);
  assert.deepEqual(
    historyAfterReapply.map((row) => row.id),
    [
      PLATFORM_FOUNDATION_MIGRATION_ID,
      IDENTITY_SESSIONS_AUTHOR_PROFILE_MIGRATION_ID,
    ],
  );
  for (const [index, migration] of unit01Migrations.entries()) {
    assert.equal(historyAfterReapply[index]?.checksum, migration.checksum);
    assert.match(historyAfterReapply[index]?.checksum ?? "", /^[0-9a-f]{64}$/u);
  }
  assert.deepEqual(await identityCounts(database), {
    accounts: 0,
    audit_events: 0,
    flows: 0,
    payout_details: 0,
    profiles: 0,
    roles: 0,
    sessions: 0,
    users: 0,
  });

  const config: AuthRuntimeConfig = {
    appEnv: "test",
    appOrigin: "http://127.0.0.1:3199",
    authSecret: randomBytes(32).toString("base64url"),
    flowLifetimeSeconds: 600,
    sessionAbsoluteLifetimeSeconds: 30 * 24 * 60 * 60,
    sessionIdleLifetimeSeconds: 7 * 24 * 60 * 60,
  };
  const providerSubject = `unit01-real-postgres-${randomUUID()}`;
  const privateEmail = "private-unit01-proof@example.invalid";
  const provider = new DeterministicGoogleProvider({
    displayName: "Private UNIT-01 Proof User",
    email: privateEmail,
    emailVerified: true,
    provider: "google",
    subject: providerSubject,
  });

  const mappingStarts = await Promise.all([
    startProofFlow({ config, database, intent: "default", provider, returnTo: "/cart" }),
    startProofFlow({ config, database, intent: "default", provider, returnTo: "/library" }),
  ]);
  const mappingLogins = await Promise.all(
    mappingStarts.map((started) =>
      finishOAuthFlow({
        browserBinding: started.browserBinding,
        callbackUrl: started.callbackUrl,
        config,
        database,
        provider,
      }),
    ),
  );
  const mappingCountsResult = await database.query<{
    accounts: number;
    distinct_session_users: number;
    sessions: number;
    users: number;
  }>(`
    SELECT
      (SELECT COUNT(*)::int FROM users) AS users,
      (SELECT COUNT(*)::int FROM oauth_accounts) AS accounts,
      (SELECT COUNT(*)::int FROM sessions) AS sessions,
      (SELECT COUNT(DISTINCT user_id)::int FROM sessions) AS distinct_session_users
  `);
  const mappingCounts = mappingCountsResult.rows[0];
  assert.deepEqual(mappingCounts, {
    accounts: 1,
    distinct_session_users: 1,
    sessions: 2,
    users: 1,
  });
  const digestProof = await database.query<{
    digest_count: number;
    digests_well_formed: boolean;
    raw_token_matches: number;
  }>(
    `
      SELECT
        COUNT(*)::int AS digest_count,
        BOOL_AND(token_digest ~ '^[0-9a-f]{64}$') AS digests_well_formed,
        COUNT(*) FILTER (WHERE token_digest = ANY($1::text[]))::int AS raw_token_matches
      FROM sessions
    `,
    [mappingLogins.map((login) => login.sessionToken)],
  );
  assert.deepEqual(digestProof.rows[0], {
    digest_count: 2,
    digests_well_formed: true,
    raw_token_matches: 0,
  });

  const callbackRaceStart = await startProofFlow({
    config,
    database,
    intent: "default",
    provider,
    returnTo: "/library",
  });
  const callbackRace = await Promise.allSettled([
    finishOAuthFlow({
      browserBinding: callbackRaceStart.browserBinding,
      callbackUrl: callbackRaceStart.callbackUrl,
      config,
      database,
      provider,
    }),
    finishOAuthFlow({
      browserBinding: callbackRaceStart.browserBinding,
      callbackUrl: callbackRaceStart.callbackUrl,
      config,
      database,
      provider,
    }),
  ]);
  assert.equal(fulfilledValues(callbackRace).length, 1);
  const rejectedCallback = callbackRace.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  assert.ok(rejectedCallback, "Exactly one concurrent callback must be rejected");
  assert.ok(rejectedCallback.reason instanceof OAuthCallbackFailure);
  assert.equal(rejectedCallback.reason.code, "invalid_flow");
  const callbackLogin = fulfilledValues(callbackRace)[0];
  assert.ok(callbackLogin);

  const onboardingStarts = await Promise.all([
    startProofFlow({
      config,
      database,
      intent: "author_onboarding",
      provider,
      returnTo: "/author/profile",
    }),
    startProofFlow({
      config,
      database,
      intent: "author_onboarding",
      provider,
      returnTo: "/author/publish",
    }),
  ]);
  const onboardingLogins = await Promise.all(
    onboardingStarts.map((started) =>
      finishOAuthFlow({
        browserBinding: started.browserBinding,
        callbackUrl: started.callbackUrl,
        config,
        database,
        provider,
      }),
    ),
  );
  assert.ok(onboardingLogins.every((login) => login.redirectTo === "/author/profile"));
  const onboardingContexts = await Promise.all(
    onboardingLogins.map((login) =>
      sessionContextFromToken({ config, database, token: login.sessionToken }),
    ),
  );
  assert.ok(onboardingContexts.every((context) => context?.session.authorOnboarding === true));
  const firstOnboardingContext = onboardingContexts[0];
  const secondOnboardingContext = onboardingContexts[1];
  assert.ok(firstOnboardingContext && secondOnboardingContext);

  const preAuthorDecisions = {
    admin: decideRouteAccess("/admin", firstOnboardingContext.session),
    author: decideRouteAccess("/author/books", firstOnboardingContext.session),
    library: decideRouteAccess("/library", firstOnboardingContext.session),
  };
  assert.equal(preAuthorDecisions.admin.outcome, "deny");
  assert.equal(preAuthorDecisions.author.outcome, "deny");
  assert.equal(preAuthorDecisions.library.outcome, "allow");

  await assert.rejects(
    withSqlTransaction(database, (transaction) =>
      saveAuthorProfile(transaction, {
        profileName: "This transaction must roll back",
        session: firstOnboardingContext.stored,
      }),
    ),
    /requires session rotation/u,
  );
  const rolledBackProfileState = await database.query<{
    author_roles: number;
    profile_audits: number;
    profiles: number;
  }>(`
    SELECT
      (SELECT COUNT(*)::int FROM author_profiles) AS profiles,
      (SELECT COUNT(*)::int FROM user_roles WHERE role = 'author') AS author_roles,
      (
        SELECT COUNT(*)::int
        FROM identity_audit_events
        WHERE event_type = 'author_profile_updated'
      ) AS profile_audits
  `);
  assert.deepEqual(rolledBackProfileState.rows[0], {
    author_roles: 0,
    profile_audits: 0,
    profiles: 0,
  });

  const profileSaveRace = await Promise.allSettled([
    persistAuthorProfile({
      config,
      database,
      publicName: "Автор PostgreSQL A",
      sessionContext: firstOnboardingContext,
    }),
    persistAuthorProfile({
      config,
      database,
      publicName: "Автор PostgreSQL B",
      sessionContext: secondOnboardingContext,
    }),
  ]);
  const successfulProfileSaves = fulfilledValues(profileSaveRace);
  assert.equal(successfulProfileSaves.length, 1);
  const failedProfileSave = profileSaveRace.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  assert.ok(failedProfileSave, "Exactly one concurrent Author profile save must fail");
  assert.match(String(failedProfileSave.reason), /session is no longer active/u);
  const successfulProfileSave = successfulProfileSaves[0];
  assert.ok(successfulProfileSave?.replacementSession?.token);
  assert.equal(successfulProfileSave.roleGranted, true);

  const allPreRotationTokens = [
    ...mappingLogins.map((login) => login.sessionToken),
    callbackLogin.sessionToken,
    ...onboardingLogins.map((login) => login.sessionToken),
  ];
  const staleContexts = await Promise.all(
    allPreRotationTokens.map((token) => sessionContextFromToken({ config, database, token })),
  );
  assert.ok(staleContexts.every((context) => context === null));
  const replacementContext = await sessionContextFromToken({
    config,
    database,
    token: successfulProfileSave.replacementSession.token,
  });
  assert.ok(replacementContext);
  assert.deepEqual(replacementContext.session.roles, ["author", "buyer"]);
  assert.equal(replacementContext.session.authorOnboarding, false);

  const authorStateResult = await database.query<{
    active_sessions: number;
    author_roles: number;
    authorization_version: number;
    buyer_roles: number;
    profiles: number;
    revoked_sessions: number;
  }>(`
    SELECT
      (SELECT COUNT(*)::int FROM author_profiles) AS profiles,
      (SELECT COUNT(*)::int FROM user_roles WHERE role = 'author') AS author_roles,
      (SELECT COUNT(*)::int FROM user_roles WHERE role = 'buyer') AS buyer_roles,
      (SELECT COUNT(*)::int FROM sessions WHERE revoked_at IS NULL) AS active_sessions,
      (SELECT COUNT(*)::int FROM sessions WHERE revoked_at IS NOT NULL) AS revoked_sessions,
      (SELECT authorization_version FROM users LIMIT 1) AS authorization_version
  `);
  const authorState = authorStateResult.rows[0];
  assert.deepEqual(authorState, {
    active_sessions: 1,
    author_roles: 1,
    authorization_version: 2,
    buyer_roles: 1,
    profiles: 1,
    revoked_sessions: allPreRotationTokens.length,
  });

  const publicProfile = await loadPublicAuthorProfile(
    database,
    replacementContext.session.userId,
  );
  assert.deepEqual(publicProfile, successfulProfileSave.profile);
  assert.deepEqual(Object.keys(publicProfile ?? {}).sort(), ["authorId", "publicName"]);

  const payoutSentinel =
    process.env.UNIT01_PAYOUT_SENTINEL ?? `UNIT01-PAYOUT-${randomUUID()}`;
  const payoutKeyId = "unit01-restricted-proof-key";
  await database.query(
    `
      INSERT INTO author_payout_details (
        user_id, schema_version, key_id, nonce, ciphertext, authentication_tag
      ) VALUES ($1, 1, $2, $3, $4, $5)
    `,
    [
      replacementContext.session.userId,
      payoutKeyId,
      Buffer.alloc(12, 1),
      Buffer.from(payoutSentinel, "utf8"),
      Buffer.alloc(16, 2),
    ],
  );
  const restrictedPayout = await loadRestrictedPayoutEnvelope(
    database,
    replacementContext.session.userId,
  );
  assert.ok(restrictedPayout, "The restricted payout fixture was not persisted");
  assert.equal(Buffer.from(restrictedPayout.ciphertext).toString("utf8"), payoutSentinel);
  const publicSurfaces = JSON.stringify({
    profile: publicProfile,
    session: {
      authorOnboarding: replacementContext.session.authorOnboarding,
      roles: replacementContext.session.roles,
    },
  });
  assert.ok(!publicSurfaces.includes(payoutSentinel));
  assert.ok(!publicSurfaces.includes(payoutKeyId));
  assert.ok(!publicSurfaces.includes(privateEmail));

  const postAuthorDecisions = {
    admin: decideRouteAccess("/admin", replacementContext.session),
    author: decideRouteAccess("/author/books", replacementContext.session),
    library: decideRouteAccess("/library", replacementContext.session),
  };
  assert.equal(postAuthorDecisions.admin.outcome, "deny");
  assert.equal(postAuthorDecisions.author.outcome, "allow");
  assert.equal(postAuthorDecisions.library.outcome, "allow");
  const managerRoles = await database.query<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM user_roles WHERE role = 'manager'",
  );
  assert.equal(managerRoles.rows[0]?.count, 0);

  const authorizationVersion = authorState?.authorization_version;
  assert.equal(authorizationVersion, 2);
  const now = Date.now();
  const expiredToken = randomOpaqueToken();
  const expiredSessionId = await insertSession(database, {
    absoluteExpiresAt: new Date(now + 120_000),
    authorOnboarding: false,
    authorizationVersion,
    idleExpiresAt: new Date(now + 60_000),
    tokenDigest: sha256Hex(expiredToken),
    userId: replacementContext.session.userId,
  });
  await database.query(
    `
      UPDATE sessions
      SET created_at = CURRENT_TIMESTAMP - INTERVAL '3 days',
          idle_expires_at = CURRENT_TIMESTAMP - INTERVAL '2 days',
          absolute_expires_at = CURRENT_TIMESTAMP - INTERVAL '1 day'
      WHERE id = $1
    `,
    [expiredSessionId],
  );
  assert.equal(
    await sessionContextFromToken({ config, database, token: expiredToken }),
    null,
  );

  const revokedToken = randomOpaqueToken();
  const revokedSessionId = await insertSession(database, {
    absoluteExpiresAt: new Date(now + 120_000),
    authorOnboarding: false,
    authorizationVersion,
    idleExpiresAt: new Date(now + 60_000),
    tokenDigest: sha256Hex(revokedToken),
    userId: replacementContext.session.userId,
  });
  assert.ok(await sessionContextFromToken({ config, database, token: revokedToken }));
  await revokeSession(
    database,
    revokedSessionId,
    replacementContext.session.userId,
    "unit01_acceptance_proof",
  );
  assert.equal(
    await sessionContextFromToken({ config, database, token: revokedToken }),
    null,
  );
  assert.ok(
    await sessionContextFromToken({
      config,
      database,
      token: successfulProfileSave.replacementSession.token,
    }),
    "The unrelated replacement session must stay active",
  );

  const auditResult = await database.query<{
    event_type: string;
    id: string;
    reason_code: string | null;
  }>(`
    SELECT id, event_type, reason_code
    FROM identity_audit_events
    ORDER BY created_at, id
  `);
  const auditEvents = auditResult.rows;
  const eventTypes = auditEvents.map((row) => row.event_type);
  assert.equal(eventTypes.filter((event) => event === "role_granted").length, 2);
  assert.equal(eventTypes.filter((event) => event === "author_profile_updated").length, 1);
  assert.equal(eventTypes.filter((event) => event === "session_revoked").length, 1);
  const auditTarget = auditEvents[0];
  assert.ok(auditTarget);
  await assert.rejects(
    database.query(
      "UPDATE identity_audit_events SET reason_code = 'tampered' WHERE id = $1",
      [auditTarget.id],
    ),
    /append-only/u,
  );
  await assert.rejects(
    database.query("DELETE FROM identity_audit_events WHERE id = $1", [auditTarget.id]),
    /append-only/u,
  );
  const auditCountAfterMutationAttempts = await database.query<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM identity_audit_events",
  );
  assert.equal(auditCountAfterMutationAttempts.rows[0]?.count, auditEvents.length);

  const migrationRoundtrip = {
    constraints,
    database: databaseIdentity,
    empty_application_tables_before_apply: emptyTables,
    first_apply: firstApply,
    history_after_identity_reapply: historyAfterReapply.map((row) => ({
      checksum: row.checksum,
      id: row.id,
    })),
    identity_reapply: identityReapply,
    indexes,
    implementation_revision: implementationRevision,
    rollback_identity_only: rolledBackIdentity,
    tables_after_apply: tablesAfterApply,
    tables_after_identity_rollback: tablesAfterIdentityRollback,
    verified_at: new Date().toISOString(),
  };
  const oauthSessionConcurrency = {
    callback_race: {
      fulfilled: callbackRace.filter((result) => result.status === "fulfilled").length,
      rejected: callbackRace.filter((result) => result.status === "rejected").length,
      rejection_code: rejectedCallback.reason.code,
    },
    concurrent_mapping: mappingCounts,
    digest_storage: digestProof.rows[0],
    implementation_revision: implementationRevision,
    provider: "google",
    provider_subject_sha256: createHash("sha256").update(providerSubject).digest("hex"),
    verified_at: new Date().toISOString(),
  };
  const authorProfileRole = {
    append_only_audit: {
      delete_rejected: true,
      event_count_preserved: auditCountAfterMutationAttempts.rows[0]?.count,
      event_types: eventTypes,
      update_rejected: true,
    },
    atomic_failure_rolled_back: rolledBackProfileState.rows[0],
    concurrent_profile_saves: {
      fulfilled: successfulProfileSaves.length,
      rejected: profileSaveRace.filter((result) => result.status === "rejected").length,
      stale_session_rejected: true,
    },
    final_author_state: authorState,
    implementation_revision: implementationRevision,
    old_sessions_rejected: staleContexts.length,
    public_profile: publicProfile,
    replacement_session: {
      active: true,
      author_onboarding: replacementContext.session.authorOnboarding,
      roles: replacementContext.session.roles,
    },
    verified_at: new Date().toISOString(),
  };
  const accessSeparation = {
    author_has_no_implicit_manager_role: managerRoles.rows[0]?.count === 0,
    expired_session_rejected: true,
    implementation_revision: implementationRevision,
    payout_ciphertext: {
      absent_from_public_surfaces: !publicSurfaces.includes(payoutSentinel),
      persisted_in_restricted_boundary: true,
      sentinel_sha256: createHash("sha256").update(payoutSentinel).digest("hex"),
    },
    pre_author_route_decisions: preAuthorDecisions,
    post_author_route_decisions: postAuthorDecisions,
    public_profile_fields: Object.keys(publicProfile ?? {}).sort(),
    revoked_session_rejected: true,
    verified_at: new Date().toISOString(),
  };
  return {
    accessSeparation,
    authorProfileRole,
    migrationRoundtrip,
    oauthSessionConcurrency,
  };
}

async function main(): Promise<void> {
  const database = openPostgresDatabase(verifiedDatabaseUrl);
  let databaseIdentityVerified = false;
  let artifacts: ProofArtifacts | undefined;
  let proofError: unknown;
  let cleanupError: unknown;
  let finalState:
    | Awaited<ReturnType<typeof cleanAppliedDatabase>>
    | undefined;

  try {
    const identityResult = await database.query<DatabaseIdentity>(`
      SELECT
        current_database() AS database_name,
        current_setting('server_version') AS server_version
    `);
    const databaseIdentity = identityResult.rows[0];
    assert.equal(
      databaseIdentity?.database_name,
      EXPECTED_DATABASE_NAME,
      `Refusing to run destructive UNIT-01 proof outside ${EXPECTED_DATABASE_NAME}`,
    );
    assert.ok(databaseIdentity);
    databaseIdentityVerified = true;
    artifacts = await runProof(database, databaseIdentity);
  } catch (error) {
    proofError = error;
  }

  if (databaseIdentityVerified) {
    try {
      finalState = await cleanAppliedDatabase(database);
    } catch (error) {
      cleanupError = error;
    }
  }
  try {
    await database.close?.();
  } catch (error) {
    cleanupError ??= error;
  }

  if (proofError && cleanupError) {
    throw new AggregateError(
      [proofError, cleanupError],
      "UNIT-01 PostgreSQL proof and dedicated-database cleanup both failed",
    );
  }
  if (proofError) {
    throw proofError;
  }
  if (cleanupError) {
    throw cleanupError;
  }
  assert.ok(artifacts && finalState);
  assert.deepEqual(finalState.tables, ALL_APPLICATION_TABLES);

  const migrationRoundtrip = {
    ...artifacts.migrationRoundtrip,
    final_clean_state: finalState,
  };
  await Promise.all([
    writeEvidence(
      "evidence/database/unit01-migration-roundtrip.json",
      migrationRoundtrip,
    ),
    writeEvidence(
      "evidence/identity/oauth-session-concurrency.json",
      artifacts.oauthSessionConcurrency,
    ),
    writeEvidence(
      "evidence/identity/author-profile-role.json",
      artifacts.authorProfileRole,
    ),
    writeEvidence(
      "evidence/security/access-separation.json",
      artifacts.accessSeparation,
    ),
  ]);

  console.log(
    JSON.stringify(
      {
        database: EXPECTED_DATABASE_NAME,
        evidence_written: Boolean(evidenceRoot),
        final_identity_rows: finalState.counts,
        migrations: finalState.applied.map((result) => result.id),
        status: "passed",
      },
      null,
      2,
    ),
  );
}

await main();
