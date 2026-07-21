import { ProtectedBoundary } from "../../components/identity";
import { currentSessionContext } from "../../modules/identity/server/next-session";

export const dynamic = "force-dynamic";

export default async function AdminBoundaryPage() {
  const context = await currentSessionContext();
  return (
    <ProtectedBoundary
      csrfToken={context?.csrfToken ?? ""}
      description="Маршрут менеджера захищено. Черга Ручної перевірки з’явиться у UNIT-04."
      title="Менеджерський простір"
    />
  );
}
