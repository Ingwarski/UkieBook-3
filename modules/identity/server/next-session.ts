import "server-only";

import { cookies } from "next/headers";

import { readServerEnvironment } from "../../platform/environment/server";
import { authCookieConfig } from "./config";
import { readSessionCookie } from "./http";
import { identityRuntime } from "./runtime";
import { sessionContextFromToken } from "./session";

export async function currentSessionContext() {
  const cookieStore = await cookies();
  const token = readSessionCookie(
    cookieStore,
    authCookieConfig(readServerEnvironment()),
  );
  if (!token) return null;
  const runtime = identityRuntime();
  return sessionContextFromToken({
    config: runtime.config,
    database: runtime.database,
    token,
  });
}
