/** Immutable ID used by the already-applied UNIT-00 migration. */
export const PLATFORM_FOUNDATION_MIGRATION_ID = "0001_platform_foundation";

/** Immutable ID used by the UNIT-01 identity migration. */
export const IDENTITY_SESSIONS_AUTHOR_PROFILE_MIGRATION_ID =
  "0002_identity_sessions_author_profile";

/** Immutable ID used by the UNIT-02 catalog read-model migration. */
export const CATALOG_READ_MODEL_MIGRATION_ID = "0003_catalog_read_model";

/** Latest schema understood by every production runtime. */
export const PLATFORM_SCHEMA_REVISION = CATALOG_READ_MODEL_MIGRATION_ID;
