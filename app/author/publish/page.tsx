import { ProtectedBoundary } from "../../../components/identity";
import { requireProtectedPath } from "../../../modules/identity/server/guard";

export const dynamic = "force-dynamic";

export default async function PublishBoundaryPage() {
  const context = await requireProtectedPath("/author/publish");
  return (
    <ProtectedBoundary
      csrfToken={context?.csrfToken ?? ""}
      description="Маршрут майстра публікації готовий до інтеграції з UNIT-03."
      title="Нова книжка"
    />
  );
}
