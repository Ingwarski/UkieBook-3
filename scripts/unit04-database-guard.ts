export const UNIT04_DATABASE_NAME = "ukiebook_unit04";

export function requireDedicatedUnit04DatabaseUrl(
  value: string | undefined,
): string {
  if (!value) throw new Error("UNIT04_DATABASE_URL is required");

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("UNIT04_DATABASE_URL must be a valid PostgreSQL URL");
  }

  if (parsed.search || parsed.hash) {
    throw new Error(
      "UNIT04_DATABASE_URL must not contain connection override parameters",
    );
  }
  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
    throw new Error(
      "UNIT04_DATABASE_URL must use postgres: or postgresql:",
    );
  }
  if (!new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(parsed.hostname)) {
    throw new Error(
      "UNIT-04 database mutation is restricted to a loopback PostgreSQL host",
    );
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//u, ""));
  if (databaseName !== UNIT04_DATABASE_NAME) {
    throw new Error(
      `UNIT-04 database mutation requires the exact database ${UNIT04_DATABASE_NAME}`,
    );
  }
  if (!parsed.username || !parsed.password) {
    throw new Error(
      "UNIT04_DATABASE_URL must include dedicated PostgreSQL credentials",
    );
  }

  return value;
}
