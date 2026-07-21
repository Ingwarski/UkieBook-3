import type { AuthIntent } from "./types";

export const DEFAULT_RETURN_TO = "/";

const allowedExactPaths = new Set([
  "/",
  "/admin",
  "/cart",
  "/library",
  "/login",
]);
const allowedPathPrefixes = ["/books/", "/author/", "/admin/"] as const;

function containsUnsafeEncoding(value: string): boolean {
  let decoded = value;
  for (let depth = 0; depth < 3; depth += 1) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      return true;
    }
    if (
      decoded.includes("\\") ||
      /[\u0000-\u001f\u007f]/u.test(decoded) ||
      decoded.startsWith("//") ||
      (decoded.split(/[?#]/u)[0] ?? "")
        .split("/")
        .some((segment) => segment === ".." || segment === ".")
    ) {
      return true;
    }
  }
  return false;
}

export function normalizeReturnTo(
  candidate: string | null | undefined,
  appOrigin: string,
  fallback = DEFAULT_RETURN_TO,
): string {
  if (
    !candidate ||
    candidate.length > 1_024 ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    containsUnsafeEncoding(candidate)
  ) {
    return fallback;
  }

  try {
    const origin = new URL(appOrigin);
    const resolved = new URL(candidate, origin);
    if (
      resolved.origin !== origin.origin ||
      resolved.username ||
      resolved.password ||
      resolved.pathname.startsWith("/api/") ||
      resolved.pathname.startsWith("/_next/")
    ) {
      return fallback;
    }
    const allowed =
      allowedExactPaths.has(resolved.pathname) ||
      allowedPathPrefixes.some((prefix) => resolved.pathname.startsWith(prefix));
    return allowed ? `${resolved.pathname}${resolved.search}${resolved.hash}` : fallback;
  } catch {
    return fallback;
  }
}

export function normalizeAuthIntent(
  candidate: string | null | undefined,
  returnTo: string,
): AuthIntent {
  if (candidate === "author" || returnTo.startsWith("/author/")) {
    return "author_onboarding";
  }
  return "default";
}
