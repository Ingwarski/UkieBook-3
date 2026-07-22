import type { Metadata } from "next";

import { CatalogScreen } from "../components/catalog";
import { catalogFixtureShell } from "../modules/catalog/fixture-read-model";
import { normalizeCatalogQuery } from "../modules/catalog/query";
import { loadCatalog } from "../modules/catalog/server/service";
import { currentSessionContext } from "../modules/identity/server/next-session";

export const metadata: Metadata = {
  title: "Каталог",
  description: "Українські електронні книжки у форматах EPUB і MOBI.",
};

export const dynamic = "force-dynamic";

interface CatalogPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}
export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const query = normalizeCatalogQuery(await searchParams);
  const asOf = new Date();
  const [catalogResult, sessionResult] = await Promise.allSettled([
    loadCatalog(query, asOf),
    currentSessionContext(),
  ]);
  const model =
    catalogResult.status === "fulfilled"
      ? catalogResult.value
      : catalogFixtureShell(query, asOf);
  const session = sessionResult.status === "fulfilled" ? sessionResult.value : null;

  return (
    <CatalogScreen
      errorMessage={
        catalogResult.status === "rejected"
          ? "Перевірте зʼєднання й повторіть спробу — добірка вище залишається доступною."
          : undefined
      }
      model={model}
      viewer={{
        isAuthor: session?.session.roles.includes("author") ?? false,
        signedIn: session !== null,
      }}
    />
  );
}
