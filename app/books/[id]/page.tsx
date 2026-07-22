import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BookPageScreen } from "../../../components/catalog";
import { loadBookPage } from "../../../modules/catalog/server/service";
import { currentSessionContext } from "../../../modules/identity/server/next-session";

export const metadata: Metadata = {
  title: "Книжка",
};

export const dynamic = "force-dynamic";

interface BookRouteProps {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<{
    reviews?: string | string[];
    sample?: string | string[];
  }>;
}

function reviewPage(value: string | string[] | undefined): number {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || !/^\d+$/u.test(candidate)) return 1;
  const parsed = Number(candidate);
  return Number.isSafeInteger(parsed) ? Math.max(1, Math.min(parsed, 10_000)) : 1;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

export default async function BookRoute({ params, searchParams }: BookRouteProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!isUuid(id)) notFound();
  const [book, session] = await Promise.all([
    loadBookPage(id, { reviewsPage: reviewPage(query.reviews) }),
    currentSessionContext(),
  ]);
  if (!book) notFound();

  return (
    <BookPageScreen
      book={book}
      sampleOpen={(Array.isArray(query.sample) ? query.sample[0] : query.sample) === "1"}
      viewer={{
        isAuthor: session?.session.roles.includes("author") ?? false,
        signedIn: session !== null,
      }}
    />
  );
}
