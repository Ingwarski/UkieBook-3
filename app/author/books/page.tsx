import { ProtectedBoundary } from "../../../components/identity";
import { requireProtectedPath } from "../../../modules/identity/server/guard";

export const dynamic = "force-dynamic";

export default async function AuthorBooksBoundaryPage() {
  const context = await requireProtectedPath("/author/books");
  return (
    <ProtectedBoundary
      csrfToken={context?.csrfToken ?? ""}
      description="Маршрут Кабінету автора готовий до інтеграції з UNIT-03."
      title="Мої книжки"
    />
  );
}
