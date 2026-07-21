import "server-only";

import { forbidden, redirect } from "next/navigation";

import { decideRouteAccess } from "../route-policy";
import { currentSessionContext } from "./next-session";

export async function requireProtectedPath(pathname: string) {
  const context = await currentSessionContext();
  const decision = decideRouteAccess(pathname, context?.session ?? null);
  if (decision.outcome === "redirect_to_login") {
    const query = new URLSearchParams({ returnTo: pathname });
    if (decision.requirement === "author") {
      query.set("intent", "author");
    }
    redirect(`/login?${query.toString()}`);
  }
  if (decision.outcome === "deny") {
    forbidden();
  }
  return context;
}
