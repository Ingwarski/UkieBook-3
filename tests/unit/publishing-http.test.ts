import { describe, expect, it, vi } from "vitest";

import {
  GOOGLE_DOCS_IMPORT_REQUEST_MAX_BYTES,
  MULTIPART_REQUEST_OVERHEAD_BYTES,
  readBoundedJsonBody,
  readBoundedUploadFormData,
} from "../../modules/publishing/server/http";

const maxFileBytes = 52_428_800;

function multipartRequest(contentLength?: string) {
  const form = new FormData();
  form.set("file", new Blob(["книжка"], { type: "text/plain" }), "book.txt");
  const request = new Request("https://ukiebook.test/upload", {
    body: form,
    method: "POST",
  });
  if (contentLength !== undefined) request.headers.set("content-length", contentLength);
  return {
    form,
    originalFormData: vi.spyOn(request, "formData"),
    request,
  };
}

describe("publishing multipart request bounds", () => {
  it("supports a missing Content-Length through the bounded stream path", async () => {
    const { originalFormData, request } = multipartRequest();

    const parsed = await readBoundedUploadFormData(request, maxFileBytes);

    expect(parsed.get("file")).toBeInstanceOf(File);
    expect(originalFormData).not.toHaveBeenCalled();
  });

  it.each(["not-a-number", "-1", "0", "1.5", "9007199254740992"])(
    "rejects malformed Content-Length %s before parsing multipart data",
    async (contentLength) => {
      const { originalFormData, request } = multipartRequest(contentLength);

      await expect(readBoundedUploadFormData(request, maxFileBytes)).rejects.toMatchObject({
        code: "INVALID_CONTENT_LENGTH",
        status: 400,
      });
      expect(request.bodyUsed).toBe(false);
      expect(originalFormData).not.toHaveBeenCalled();
    },
  );

  it("rejects an oversized declared length before reading or parsing the request", async () => {
    const { originalFormData, request } = multipartRequest(
      String(maxFileBytes + MULTIPART_REQUEST_OVERHEAD_BYTES + 1),
    );

    await expect(readBoundedUploadFormData(request, maxFileBytes)).rejects.toMatchObject({
      code: "FILE_TOO_LARGE",
      status: 413,
    });
    expect(request.bodyUsed).toBe(false);
    expect(originalFormData).not.toHaveBeenCalled();
  });

  it("caps an oversized stream when Content-Length is missing", async () => {
    const streamLimit = 128 + MULTIPART_REQUEST_OVERHEAD_BYTES;
    const request = new Request("https://ukiebook.test/upload", {
      body: new Uint8Array(streamLimit + 1),
      headers: { "content-type": "multipart/form-data; boundary=bounded-test" },
      method: "POST",
    });
    const originalFormData = vi.spyOn(request, "formData");

    await expect(readBoundedUploadFormData(request, 128)).rejects.toMatchObject({
      code: "FILE_TOO_LARGE",
      status: 413,
    });
    expect(request.bodyUsed).toBe(true);
    expect(originalFormData).not.toHaveBeenCalled();
  });

  it("parses an allowed browser multipart request from a bounded copy", async () => {
    const { originalFormData, request } = multipartRequest(
      String(maxFileBytes + MULTIPART_REQUEST_OVERHEAD_BYTES),
    );

    const parsed = await readBoundedUploadFormData(request, maxFileBytes);

    expect(parsed.get("file")).toBeInstanceOf(File);
    expect(originalFormData).not.toHaveBeenCalled();
  });
});

describe("Google Docs JSON request bounds", () => {
  function jsonRequest(body: string, contentLength?: string) {
    const request = new Request("https://ukiebook.test/google-docs", {
      body,
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (contentLength !== undefined) request.headers.set("content-length", contentLength);
    return request;
  }

  it("parses a small JSON object without using Request.json", async () => {
    const request = jsonRequest('{"documentUrl":"https://docs.google.com/document/d/book/edit"}');
    const originalJson = vi.spyOn(request, "json");

    await expect(readBoundedJsonBody(request)).resolves.toEqual({
      documentUrl: "https://docs.google.com/document/d/book/edit",
    });
    expect(originalJson).not.toHaveBeenCalled();
  });

  it("rejects an oversized declared JSON request before reading it", async () => {
    const request = jsonRequest(
      "{}",
      String(GOOGLE_DOCS_IMPORT_REQUEST_MAX_BYTES + 1),
    );

    await expect(readBoundedJsonBody(request)).rejects.toMatchObject({
      code: "REQUEST_TOO_LARGE",
      status: 413,
    });
    expect(request.bodyUsed).toBe(false);
  });

  it("caps a missing-length JSON stream", async () => {
    const request = jsonRequest(
      `"${"x".repeat(GOOGLE_DOCS_IMPORT_REQUEST_MAX_BYTES)}"`,
    );

    await expect(readBoundedJsonBody(request)).rejects.toMatchObject({
      code: "REQUEST_TOO_LARGE",
      status: 413,
    });
    expect(request.bodyUsed).toBe(true);
  });

  it("rejects malformed JSON inside the bound", async () => {
    await expect(readBoundedJsonBody(jsonRequest("{"))).rejects.toMatchObject({
      code: "INVALID_JSON",
      status: 400,
    });
  });
});
