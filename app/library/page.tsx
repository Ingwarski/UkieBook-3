import { LibraryScreen } from "../../components/library";
import { currentCartCount } from "../commerce-request";
import {
  libraryDownloadHref,
  loadLibrary,
} from "../../modules/library/server";
import { currentSessionContext } from "../../modules/identity/server/next-session";
import { identityRuntime } from "../../modules/identity/server/runtime";
import { readServerEnvironment } from "../../modules/platform/environment/server";

export const dynamic = "force-dynamic";

interface LibraryRouteProps {
  readonly searchParams: Promise<{ readonly refund?: string | string[] }>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LibraryPage({ searchParams }: LibraryRouteProps) {
  const [session, query] = await Promise.all([currentSessionContext(), searchParams]);
  if (!session) return null;

  const runtime = identityRuntime();
  const environment = readServerEnvironment();
  if (!environment.AUTH_SECRET) {
    throw new Error("AUTH_SECRET is required to sign Library downloads");
  }
  const downloadSecret = environment.AUTH_SECRET;
  const [library, cartCount] = await Promise.all([
    loadLibrary(runtime.database, session.session.userId),
    currentCartCount(session).catch(() => 0),
  ]);
  const downloads = Object.fromEntries(
    library.items.map((item) => [
      item.id,
      Object.fromEntries(
        item.formats.map((format) => [
          format,
          libraryDownloadHref({
            buyerUserId: session.session.userId,
            entitlementId: item.id,
            format,
            resolvedBookVersionId: item.resolvedBookVersionId,
            secret: downloadSecret,
          }),
        ]),
      ),
    ]),
  );

  return (
    <LibraryScreen
      csrfToken={session.csrfToken}
      downloads={downloads}
      library={library}
      refundResult={first(query.refund)}
      viewer={{
        cartCount,
        isAuthor: session.session.roles.includes("author"),
        signedIn: true,
      }}
    />
  );
}
