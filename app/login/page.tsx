import type { Metadata } from "next";

import { LoginScreen } from "../../components/identity";
import {
  normalizeAuthIntent,
  normalizeReturnTo,
} from "../../modules/identity/return-to";
import { oauthErrorMessage } from "../../modules/identity/server/service";

export const metadata: Metadata = {
  title: "Вхід",
};

export const dynamic = "force-dynamic";

interface LoginPageProps {
  searchParams: Promise<{
    error?: string | string[];
    intent?: string | string[];
    returnTo?: string | string[];
  }>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const query = await searchParams;
  const returnTo = normalizeReturnTo(
    first(query.returnTo),
    "https://ukiebook.local",
  );
  const intent = normalizeAuthIntent(first(query.intent), returnTo);
  return (
    <LoginScreen
      error={oauthErrorMessage(first(query.error))}
      facebookAction="/api/auth/facebook/start"
      googleAction="/api/auth/google/start"
      intent={intent === "author_onboarding" ? "author" : "default"}
      returnHref={returnTo === "/login" ? "/" : returnTo}
      returnTo={returnTo}
    />
  );
}
