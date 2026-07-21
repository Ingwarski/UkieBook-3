import { ProtectedBoundary } from "../../components/identity";
import { currentSessionContext } from "../../modules/identity/server/next-session";

export const dynamic = "force-dynamic";

export default async function LibraryBoundaryPage() {
  const context = await currentSessionContext();
  return (
    <ProtectedBoundary
      csrfToken={context?.csrfToken ?? ""}
      description="Маршрут Бібліотеки захищено. Вміст придбаних книжок з’явиться у UNIT-06."
      title="Бібліотека"
    />
  );
}
