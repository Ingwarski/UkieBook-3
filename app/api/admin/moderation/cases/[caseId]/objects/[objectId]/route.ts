import { noStoreHeaders } from "../../../../../../../../modules/identity/server/http";
import { currentSessionContext } from "../../../../../../../../modules/identity/server/next-session";
import { findManagerCaseObject } from "../../../../../../../../modules/moderation/server/service";
import { productionDatabase } from "../../../../../../../../modules/platform/server/database";
import { publishingPrivateObjectStorage } from "../../../../../../../../modules/publishing/storage/runtime";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  {
    params,
  }: {
    readonly params: Promise<{ readonly caseId: string; readonly objectId: string }>;
  },
) {
  const context = await currentSessionContext();
  if (!context) {
    return new Response("Authentication required", {
      headers: noStoreHeaders(),
      status: 401,
    });
  }
  if (!context.session.roles.includes("manager")) {
    return new Response("Not found", { headers: noStoreHeaders(), status: 404 });
  }
  const { caseId, objectId } = await params;
  let object: Awaited<ReturnType<typeof findManagerCaseObject>>;
  try {
    object = await findManagerCaseObject(productionDatabase(), caseId, objectId);
  } catch {
    return new Response("Not found", { headers: noStoreHeaders(), status: 404 });
  }
  if (!object) return new Response("Not found", { headers: noStoreHeaders(), status: 404 });
  try {
    const bytes = await publishingPrivateObjectStorage().read(object.storageKey);
    const headers = new Headers(noStoreHeaders());
    headers.set("Content-Type", object.mediaType);
    headers.set("Content-Length", String(bytes.byteLength));
    headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set(
      "Content-Disposition",
      `${object.kind === "cover" ? "inline" : "attachment"}; filename=${object.kind}-${object.id}`,
    );
    return new Response(new Uint8Array(bytes), { headers });
  } catch {
    return new Response("Not found", { headers: noStoreHeaders(), status: 404 });
  }
}
