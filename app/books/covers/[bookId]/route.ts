import { noStoreHeaders } from "../../../../modules/identity/server/http";
import { findPublicCoverObject } from "../../../../modules/moderation/server/repository";
import { productionDatabase } from "../../../../modules/platform/server/database";
import { publishingPrivateObjectStorage } from "../../../../modules/publishing/storage/runtime";

export const dynamic = "force-dynamic";

const publicCoverMediaTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ readonly bookId: string }> },
) {
  const { bookId } = await params;
  let object: Awaited<ReturnType<typeof findPublicCoverObject>>;
  try {
    object = await findPublicCoverObject(productionDatabase(), bookId);
  } catch {
    return new Response("Not found", { headers: noStoreHeaders(), status: 404 });
  }
  if (!object || !publicCoverMediaTypes.has(object.mediaType)) {
    return new Response("Not found", { headers: noStoreHeaders(), status: 404 });
  }
  try {
    const bytes = await publishingPrivateObjectStorage().read(object.storageKey);
    const headers = new Headers(noStoreHeaders());
    headers.set("Content-Type", object.mediaType);
    headers.set("Content-Length", String(bytes.byteLength));
    headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("ETag", `\"${object.sha256}\"`);
    headers.set("Content-Disposition", `inline; filename=cover-${bookId}`);
    return new Response(new Uint8Array(bytes), { headers });
  } catch {
    return new Response("Not found", { headers: noStoreHeaders(), status: 404 });
  }
}
