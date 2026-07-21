import { PLATFORM_SCHEMA_REVISION } from "./schema-revision";

export interface RuntimeIdentity {
  readonly appRevision: string;
  readonly role: "db-migrate" | "scheduler" | "web" | "worker";
  readonly schemaRevision: string;
}

export function readRuntimeIdentity(
  role: RuntimeIdentity["role"],
  source: Record<string, string | undefined> = process.env,
): RuntimeIdentity {
  return {
    appRevision: source.APP_REVISION?.trim() || "development",
    role,
    schemaRevision: PLATFORM_SCHEMA_REVISION,
  };
}
