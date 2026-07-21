import type { Metadata } from "next";
import { forbidden, redirect } from "next/navigation";

import { AuthorProfileScreen } from "../../../components/identity";
import { loadAuthorProfile } from "../../../modules/author-profile/server/repository";
import { canCompleteAuthorOnboarding } from "../../../modules/identity/route-policy";
import { currentSessionContext } from "../../../modules/identity/server/next-session";
import { identityRuntime } from "../../../modules/identity/server/runtime";
import { saveAuthorProfileAction } from "./actions";

export const metadata: Metadata = { title: "Профіль автора" };
export const dynamic = "force-dynamic";

interface AuthorProfilePageProps {
  searchParams: Promise<{
    error?: string | string[];
    saved?: string | string[];
    value?: string | string[];
  }>;
}

const profileErrors: Record<string, string> = {
  required: "Укажіть публічне ім’я або псевдонім.",
  too_long: "Ім’я має містити не більше 120 символів.",
  too_short: "Ім’я має містити щонайменше 2 символи.",
  unsafe: "Ім’я містить неприпустимі службові символи.",
};

const requestRejectedError =
  "Не вдалося перевірити запит. Оновіть сторінку й спробуйте ще раз.";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AuthorProfilePage({
  searchParams,
}: AuthorProfilePageProps) {
  const context = await currentSessionContext();
  if (!context) {
    redirect("/login?returnTo=%2Fauthor%2Fprofile&intent=author");
  }
  if (!canCompleteAuthorOnboarding(context.session)) {
    forbidden();
  }
  const runtime = identityRuntime();
  const [query, profile] = await Promise.all([
    searchParams,
    loadAuthorProfile(runtime.database, context.session.userId),
  ]);
  const error = first(query.error);
  const fieldError = error ? profileErrors[error] : undefined;
  const rejectedValue = fieldError ? first(query.value) : undefined;
  return (
    <AuthorProfileScreen
      action={saveAuthorProfileAction}
      csrfToken={context.csrfToken}
      defaultValue={rejectedValue ?? profile?.publicName}
      fieldError={fieldError}
      formError={error === "request_rejected" ? requestRejectedError : undefined}
      saved={first(query.saved) === "1"}
    />
  );
}
