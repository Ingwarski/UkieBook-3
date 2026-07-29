import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import type { DownloadFormat } from "../types";

const DOWNLOAD_TTL_SECONDS = 10 * 60;

function message(input: {
  readonly buyerUserId: string;
  readonly entitlementId: string;
  readonly expiresAt: number;
  readonly format: DownloadFormat;
  readonly resolvedBookVersionId: string;
}): string {
  return [
    "library-download-v1",
    input.entitlementId,
    input.buyerUserId,
    input.format,
    input.resolvedBookVersionId,
    String(input.expiresAt),
  ].join("|");
}

function sign(input: {
  readonly secret: string;
  readonly buyerUserId: string;
  readonly entitlementId: string;
  readonly expiresAt: number;
  readonly format: DownloadFormat;
  readonly resolvedBookVersionId: string;
}): string {
  return createHmac("sha256", input.secret)
    .update(message(input))
    .digest("base64url");
}

export function libraryDownloadHref(input: {
  readonly secret: string;
  readonly buyerUserId: string;
  readonly entitlementId: string;
  readonly format: DownloadFormat;
  readonly resolvedBookVersionId: string;
  readonly now?: Date;
}): string {
  const expiresAt =
    Math.floor((input.now?.getTime() ?? Date.now()) / 1000) +
    DOWNLOAD_TTL_SECONDS;
  const signature = sign({ ...input, expiresAt });
  const query = new URLSearchParams({
    expires: String(expiresAt),
    format: input.format,
    signature,
  });
  return `/api/library/download/${input.entitlementId}?${query.toString()}`;
}

export function verifyLibraryDownloadSignature(input: {
  readonly secret: string;
  readonly buyerUserId: string;
  readonly entitlementId: string;
  readonly expiresAt: string;
  readonly format: DownloadFormat;
  readonly resolvedBookVersionId: string;
  readonly signature: string;
  readonly now?: Date;
}): boolean {
  if (!/^\d{1,12}$/u.test(input.expiresAt)) return false;
  const expiresAt = Number(input.expiresAt);
  const now = Math.floor((input.now?.getTime() ?? Date.now()) / 1000);
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt < now ||
    expiresAt > now + DOWNLOAD_TTL_SECONDS + 5
  ) {
    return false;
  }
  const expected = sign({ ...input, expiresAt });
  const actualBytes = Buffer.from(input.signature);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.byteLength === expectedBytes.byteLength &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}
