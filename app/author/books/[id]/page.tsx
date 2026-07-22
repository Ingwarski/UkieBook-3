import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AuthorBookManagementScreen } from "../../../../components/publishing";
import { requireProtectedPath } from "../../../../modules/identity/server/guard";
import { identityRuntime } from "../../../../modules/identity/server/runtime";
import { loadAuthorBookManagement } from "../../../../modules/moderation/server/service";

export const metadata: Metadata = { title: "Керування книжкою" };
export const dynamic = "force-dynamic";

interface AuthorBookManagementPageProps {
  readonly params: Promise<{ readonly id: string }>;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

export default async function AuthorBookManagementPage({
  params,
}: AuthorBookManagementPageProps) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const route = `/author/books/${encodeURIComponent(id)}`;
  const context = await requireProtectedPath(route);
  const runtime = identityRuntime();
  const book = await loadAuthorBookManagement(
    runtime.database,
    context!.session.userId,
    id,
  );
  if (!book) notFound();

  return (
    <AuthorBookManagementScreen
      book={book}
      csrfToken={context!.csrfToken}
    />
  );
}
