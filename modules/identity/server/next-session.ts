import "server-only";

import { cookies } from "next/headers";

import { sessionCookieName } from "./http";
import { identityRuntime } from "./runtime";
import { sessionContextFromToken } from "./session";

export async function currentSessionContext() {
  const runtime = identityRuntime();
  const cookieStore = await cookies();
  return sessionContextFromToken({
    config: runtime.config,
    database: runtime.database,
    token: cookieStore.get(sessionCookieName(runtime.config))?.value,
  });
}
