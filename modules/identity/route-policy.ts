import type { AuthSession, UserRole } from "./types";

export type RouteRequirement = "public" | "authenticated" | UserRole;

export type RouteAccessDecision =
  | { readonly outcome: "allow"; readonly requirement: RouteRequirement }
  | { readonly outcome: "deny"; readonly requirement: RouteRequirement }
  | {
      readonly outcome: "redirect_to_login";
      readonly requirement: RouteRequirement;
    };

function isPathFamily(pathname: string, root: string): boolean {
  return pathname === root || pathname.startsWith(`${root}/`);
}

export function routeRequirement(pathname: string): RouteRequirement {
  if (isPathFamily(pathname, "/admin")) {
    return "manager";
  }
  if (isPathFamily(pathname, "/author")) {
    return "author";
  }
  if (isPathFamily(pathname, "/library")) {
    return "authenticated";
  }
  return "public";
}

export function decideRouteAccess(
  pathname: string,
  session: AuthSession | null,
): RouteAccessDecision {
  const requirement = routeRequirement(pathname);
  if (requirement === "public") {
    return { outcome: "allow", requirement };
  }
  if (!session) {
    return { outcome: "redirect_to_login", requirement };
  }
  if (requirement === "authenticated") {
    return { outcome: "allow", requirement };
  }
  return session.roles.includes(requirement)
    ? { outcome: "allow", requirement }
    : { outcome: "deny", requirement };
}

export function canCompleteAuthorOnboarding(session: AuthSession): boolean {
  return session.authorOnboarding || session.roles.includes("author");
}
