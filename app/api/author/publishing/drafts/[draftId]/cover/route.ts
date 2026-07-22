import {
  publishingApiErrorResponse,
  readBoundedUploadFormData,
  requireAuthorApiMutation,
  requireUploadFileSize,
} from "../../../../../../../modules/publishing/server/http";
import { uploadCover } from "../../../../../../../modules/publishing/server/service";
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
    const form = await readBoundedUploadFormData(
      request,
      environment.PUBLISHING_MAX_UPLOAD_BYTES,
    );
    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json(
        { error: { code: "FILE_REQUIRED", message: "Оберіть файл обкладинки." } },
        { status: 400 },
      );
    }
    requireUploadFileSize(file, environment.PUBLISHING_MAX_UPLOAD_BYTES);
    await uploadCover(runtime.database, publishingPrivateObjectStorage(), {
      authorId: context.session.userId,
      bytes: Buffer.from(await file.arrayBuffer()),
      draftId: route.draftId,
      fileName: file.name,
      maxBytes: environment.PUBLISHING_MAX_UPLOAD_BYTES,
    });
    return Response.json({ ok: true });
  } catch (error) {
    return publishingApiErrorResponse(error);
  }
}
