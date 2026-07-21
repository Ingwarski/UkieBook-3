/** Immutable ID used by the already-applied UNIT-00 migration. */
export const PLATFORM_FOUNDATION_MIGRATION_ID = "0001_platform_foundation";

/** Immutable ID used by the UNIT-01 identity migration. */
export const IDENTITY_SESSIONS_AUTHOR_PROFILE_MIGRATION_ID =
  "0002_identity_sessions_author_profile";

/** Latest schema understood by every production runtime. */
export const PLATFORM_SCHEMA_REVISION =
  IDENTITY_SESSIONS_AUTHOR_PROFILE_MIGRATION_ID;
