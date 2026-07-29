export const UNIT06_DATABASE_NAME = "ukiebook_unit06";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);

export function requireDedicatedUnit06DatabaseUrl(value: string | undefined): string {
  if (!value) throw new Error("UNIT06_DATABASE_URL is required");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("UNIT06_DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("UNIT06_DATABASE_URL must not contain connection override parameters");
  }
  if (!POSTGRES_PROTOCOLS.has(parsed.protocol)) {
    throw new Error("UNIT06_DATABASE_URL must use postgres: or postgresql:");
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error("UNIT-06 database mutation is restricted to loopback PostgreSQL");
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//u, ""));
  if (databaseName !== UNIT06_DATABASE_NAME) {
    throw new Error(`UNIT-06 requires the exact database ${UNIT06_DATABASE_NAME}`);
  }
  if (!parsed.username || !parsed.password) {
    throw new Error("UNIT06_DATABASE_URL must include dedicated credentials");
  }
  return value;
}
