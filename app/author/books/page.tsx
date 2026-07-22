import type { Metadata } from "next";

import { AuthorBooksScreen } from "../../../components/publishing";
import { requireProtectedPath } from "../../../modules/identity/server/guard";
import { identityRuntime } from "../../../modules/identity/server/runtime";
import { listAuthorBooks } from "../../../modules/publishing/server/repository";

export const metadata: Metadata = { title: "Мої книжки" };
export const dynamic = "force-dynamic";

interface AuthorBooksPageProps {
  readonly searchParams: Promise<{
    readonly error?: string | string[];
    readonly submitted?: string | string[];
  }>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AuthorBooksPage({ searchParams }: AuthorBooksPageProps) {
  const context = await requireProtectedPath("/author/books");
  const runtime = identityRuntime();
  const [books, query] = await Promise.all([
    listAuthorBooks(runtime.database, context!.session.userId),
    searchParams,
  ]);
  return (
    <AuthorBooksScreen
      books={books}
      csrfToken={context!.csrfToken}
      error={first(query.error)}
      submitted={first(query.submitted) === "1"}
    />
  );
}
