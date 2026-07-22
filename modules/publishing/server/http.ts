import "server-only";

import { assertSameOriginMutation, noStoreHeaders } from "../../identity/server/http";
import { currentSessionContext } from "../../identity/server/next-session";
import { identityRuntime } from "../../identity/server/runtime";
import { assertValidCsrf } from "../../identity/server/session";
import { readServerEnvironment } from "../../platform/environment/server";

export class PublishingApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "PublishingApiError";
    this.status = status;
    this.code = code;
  }
}

export async function requireAuthorApiMutation(request: Request) {
  const environment = readServerEnvironment();
  const runtime = identityRuntime();
  try {
    assertSameOriginMutation(request.headers, runtime.config.appOrigin);
  } catch {
    throw new PublishingApiError(403, "REQUEST_REJECTED", "Запит відхилено.");
  }
  const context = await currentSessionContext();
  if (!context) throw new PublishingApiError(401, "SESSION_REQUIRED", "Потрібен вхід.");
  if (!context.session.roles.includes("author")) {
    throw new PublishingApiError(403, "AUTHOR_REQUIRED", "Потрібна роль Автора.");
  }
  try {
    assertValidCsrf(request.headers.get("x-csrf-token"), context, runtime.config);
  } catch {
    throw new PublishingApiError(403, "REQUEST_REJECTED", "Запит відхилено.");
  }
  return { context, environment, runtime };
}

export async function requireAuthorApiRead() {
  const environment = readServerEnvironment();
  const context = await currentSessionContext();
  if (!context) throw new PublishingApiError(401, "SESSION_REQUIRED", "Потрібен вхід.");
  if (!context.session.roles.includes("author")) {
    throw new PublishingApiError(403, "AUTHOR_REQUIRED", "Потрібна роль Автора.");
  }
  return { context, environment, runtime: identityRuntime() };
}

export function publishingApiErrorResponse(error: unknown): Response {
  const candidate =
    error instanceof PublishingApiError
      ? error
      : error instanceof Error && error.name === "PublishingConflictError"
        ? new PublishingApiError(409, "CONFLICT", error.message)
      : error instanceof Error && error.name === "PublishingInputError" && "code" in error
        ? new PublishingApiError(400, String(error.code), error.message)
        : new PublishingApiError(
            500,
            "INTERNAL",
            "Не вдалося виконати дію. Чернетку збережено.",
          );
  return Response.json(
    { error: { code: candidate.code, message: candidate.message } },
    { headers: noStoreHeaders(), status: candidate.status },
  );
}

export const MULTIPART_REQUEST_OVERHEAD_BYTES = 1_048_576;
export const GOOGLE_DOCS_IMPORT_REQUEST_MAX_BYTES = 8_192;

export function requireUploadLength(request: Request, maxBytes: number): void {
  const value = request.headers.get("content-length");
  if (value === null) return;
  if (!/^[0-9]+$/u.test(value)) {
    throw new PublishingApiError(400, "INVALID_CONTENT_LENGTH", "Некоректний розмір файлу.");
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length) || length <= 0) {
    throw new PublishingApiError(400, "INVALID_CONTENT_LENGTH", "Некоректний розмір файлу.");
  }
  if (length > maxBytes + MULTIPART_REQUEST_OVERHEAD_BYTES) {
    throw new PublishingApiError(413, "FILE_TOO_LARGE", "Файл перевищує ліміт 50 МБ.");
  }
}

async function readBoundedUploadBody(request: Request, maxBytes: number): Promise<ArrayBuffer> {
  if (request.body === null) {
    throw new PublishingApiError(400, "FILE_REQUIRED", "Оберіть файл для завантаження.");
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new PublishingApiError(413, "FILE_TOO_LARGE", "Файл перевищує ліміт 50 МБ.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new ArrayBuffer(totalBytes);
  const view = new Uint8Array(body);
  let offset = 0;
  for (const chunk of chunks) {
    view.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readBoundedUploadFormData(
  request: Request,
  maxBytes: number,
): Promise<FormData> {
  requireUploadLength(request, maxBytes);
  const contentType = request.headers.get("content-type");
  if (contentType === null || !contentType.toLowerCase().startsWith("multipart/form-data;")) {
    throw new PublishingApiError(
      400,
      "INVALID_MULTIPART",
      "Некоректний формат завантаження.",
    );
  }
  const body = await readBoundedUploadBody(
    request,
    maxBytes + MULTIPART_REQUEST_OVERHEAD_BYTES,
  );
  const boundedRequest = new Request(request.url, {
    body,
    headers: { "content-type": contentType },
    method: "POST",
  });
  try {
    return await boundedRequest.formData();
  } catch {
    throw new PublishingApiError(
      400,
      "INVALID_MULTIPART",
      "Некоректний формат завантаження.",
    );
  }
}

export async function readBoundedJsonBody(
  request: Request,
  maxBytes = GOOGLE_DOCS_IMPORT_REQUEST_MAX_BYTES,
): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    throw new PublishingApiError(400, "INVALID_JSON", "Некоректний формат запиту.");
  }
  const declaredValue = request.headers.get("content-length");
  if (declaredValue !== null) {
    if (!/^[0-9]+$/u.test(declaredValue)) {
      throw new PublishingApiError(400, "INVALID_CONTENT_LENGTH", "Некоректний розмір запиту.");
    }
    const declaredLength = Number(declaredValue);
    if (!Number.isSafeInteger(declaredLength)) {
      throw new PublishingApiError(400, "INVALID_CONTENT_LENGTH", "Некоректний розмір запиту.");
    }
    if (declaredLength > maxBytes) {
      throw new PublishingApiError(413, "REQUEST_TOO_LARGE", "Запит перевищує допустимий розмір.");
    }
  }
  if (request.body === null) {
    throw new PublishingApiError(400, "INVALID_JSON", "Некоректний формат запиту.");
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new PublishingApiError(
          413,
          "REQUEST_TOO_LARGE",
          "Запит перевищує допустимий розмір.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    return JSON.parse(text) as unknown;
  } catch {
    throw new PublishingApiError(400, "INVALID_JSON", "Некоректний формат запиту.");
  }
}

export function requireUploadFileSize(file: File, maxBytes: number): void {
  if (file.size > maxBytes) {
    throw new PublishingApiError(413, "FILE_TOO_LARGE", "Файл перевищує ліміт 50 МБ.");
  }
}
