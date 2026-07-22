import { findPrivateObjectForAuthor } from "../../../../../../modules/publishing/server/repository";
import {
  publishingApiErrorResponse,
  requireAuthorApiRead,
} from "../../../../../../modules/publishing/server/http";
import { publishingPrivateObjectStorage } from "../../../../../../modules/publishing/storage/runtime";
import { noStoreHeaders } from "../../../../../../modules/identity/server/http";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ readonly objectId: string }> },
) {
  try {
    const [{ context, runtime }, route] = await Promise.all([requireAuthorApiRead(), params]);
    const object = await findPrivateObjectForAuthor(
      runtime.database,
      context.session.userId,
      route.objectId,
    );
    if (!object) return new Response("Not found", { status: 404 });
    const bytes = await publishingPrivateObjectStorage().read(object.storageKey);
    const headers = new Headers(noStoreHeaders());
    headers.set("Content-Type", object.mediaType);
    headers.set("Content-Length", String(bytes.byteLength));
    headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set(
      "Content-Disposition",
      `${object.kind === "epub" || object.kind === "mobi" ? "attachment" : "inline"}; filename="${object.kind}-${object.id}.${object.kind === "cover" || object.kind === "illustration" ? "png" : object.kind}"`,
    );
    return new Response(new Uint8Array(bytes), { headers });
  } catch (error) {
    return publishingApiErrorResponse(error);
  }
}
