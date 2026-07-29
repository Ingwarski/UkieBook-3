import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  loadLibraryDownloadTarget,
  parseDownloadFormat,
  verifyLibraryDownloadSignature,
} from "../../../../../modules/library/server";
import { currentSessionContext } from "../../../../../modules/identity/server/next-session";
import { identityRuntime } from "../../../../../modules/identity/server/runtime";
import { noStoreHeaders } from "../../../../../modules/identity/server/http";
import { readServerEnvironment } from "../../../../../modules/platform/environment/server";
import { publishingPrivateObjectStorage } from "../../../../../modules/publishing/storage/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface DownloadRouteContext {
  readonly params: Promise<{ readonly itemId: string }>;
}

function denied(status: number): NextResponse {
  return new NextResponse(status === 401 ? "Authentication required" : "Not found", {
    headers: noStoreHeaders(),
    status,
  });
}

export async function GET(
  request: NextRequest,
  { params }: DownloadRouteContext,
): Promise<NextResponse> {
  const session = await currentSessionContext();
  if (!session) return denied(401);
  const { itemId } = await params;
  const environment = readServerEnvironment();
  if (!environment.AUTH_SECRET) return denied(404);

  try {
    const format = parseDownloadFormat(request.nextUrl.searchParams.get("format"));
    const target = await loadLibraryDownloadTarget(identityRuntime().database, {
      buyerUserId: session.session.userId,
      entitlementId: itemId,
      format,
    });
    const signature = request.nextUrl.searchParams.get("signature");
    const expiresAt = request.nextUrl.searchParams.get("expires");
    if (
      !signature ||
      !expiresAt ||
      !verifyLibraryDownloadSignature({
        buyerUserId: session.session.userId,
        entitlementId: itemId,
        expiresAt,
        format,
        resolvedBookVersionId: target.resolvedBookVersionId,
        secret: environment.AUTH_SECRET,
        signature,
      })
    ) {
      return denied(404);
    }
    const bytes = await publishingPrivateObjectStorage().read(target.storageKey);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        ...noStoreHeaders(),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(target.filename)}`,
        "Content-Type": target.mediaType,
        "X-Content-Type-Options": "nosniff",
      },
      status: 200,
    });
  } catch {
    return denied(404);
  }
}
