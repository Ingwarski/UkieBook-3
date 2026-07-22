import { platformFoundationMigration } from "./0001_platform_foundation";
import { identitySessionsAuthorProfileMigration } from "./0002_identity_sessions_author_profile";
import { catalogReadModelMigration } from "./0003_catalog_read_model";
import { publishingPipelineMigration } from "./0004_publishing_pipeline";
import { moderationPublicationMigration } from "./0005_moderation_publication";
import type { Migration } from "./types";
import { PLATFORM_SCHEMA_REVISION } from "../../modules/platform/schema-revision";

export const migrations: readonly Migration[] = [
  platformFoundationMigration,
  identitySessionsAuthorProfileMigration,
  catalogReadModelMigration,
  publishingPipelineMigration,
  moderationPublicationMigration,
];
export const DATABASE_SCHEMA_REVISION = PLATFORM_SCHEMA_REVISION;

export type { Migration } from "./types";
