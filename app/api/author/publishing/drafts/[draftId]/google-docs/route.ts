import {
  publishingApiErrorResponse,
  readBoundedJsonBody,
  requireAuthorApiMutation,
} from "../../../../../../../modules/publishing/server/http";
import { importGoogleDocument } from "../../../../../../../modules/publishing/server/service";
import { publishingPrivateObjectStorage } from "../../../../../../../modules/publishing/storage/runtime";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { readonly params: Promise<{ readonly draftId: string }> },
) {
  try {
    const [{ context, environment, runtime }, route] = await Promise.all([
      requireAuthorApiMutation(request),
      params,
    ]);
    const parsedBody = await readBoundedJsonBody(request);
    const body =
      parsedBody && typeof parsedBody === "object"
        ? (parsedBody as { readonly documentUrl?: unknown })
        : {};
    const draft = await importGoogleDocument(
      runtime.database,
      publishingPrivateObjectStorage(),
      {
        authorId: context.session.userId,
        documentUrl: typeof body.documentUrl === "string" ? body.documentUrl : "",
        draftId: route.draftId,
        exportOrigin: environment.GOOGLE_DOCS_EXPORT_ORIGIN,
        maxBytes: environment.PUBLISHING_MAX_UPLOAD_BYTES,
      },
    );
    return Response.json({ draft });
  } catch (error) {
    return publishingApiErrorResponse(error);
  }
}
