import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  commerceRuntime,
  CommerceInputError,
  CommerceNotFoundError,
  processMonoWebhook,
} from "../../../../../modules/commerce/server";
import {
  PaymentProviderProtocolError,
  PaymentProviderUnavailableError,
  PaymentWebhookSignatureError,
} from "../../../../../modules/commerce";
import { noStoreHeaders } from "../../../../../modules/identity/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function readBoundedBody(
  request: NextRequest,
  maximumBytes: number,
): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel("Webhook body exceeds limit");
        throw new CommerceInputError(
          "WEBHOOK_BODY_TOO_LARGE",
          "Webhook body exceeds limit",
        );
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function POST(request: NextRequest) {
  const commerce = commerceRuntime();
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > commerce.config.webhookMaxBytes
  ) {
    return new NextResponse("Webhook body is too large", {
      headers: noStoreHeaders(),
      status: 413,
    });
  }
  const signature = request.headers.get("x-sign")?.trim() ?? "";
  if (!signature || signature.length > 2_048) {
    return new NextResponse("Invalid webhook signature", {
      headers: noStoreHeaders(),
      status: 401,
    });
  }

  try {
    const rawBody = await readBoundedBody(
      request,
      commerce.config.webhookMaxBytes,
    );
    const result = await processMonoWebhook({
      database: commerce.database,
      maxBodyBytes: commerce.config.webhookMaxBytes,
      provider: commerce.provider,
      rawBody,
      signature,
    });
    return NextResponse.json(
      {
        applied: result.applied,
        duplicate: result.duplicate,
        status: "accepted",
      },
      { headers: noStoreHeaders(), status: 200 },
    );
  } catch (error) {
    const status =
      error instanceof PaymentWebhookSignatureError
        ? 401
        : error instanceof CommerceNotFoundError
          ? 404
          : error instanceof CommerceInputError
            ? error.code === "WEBHOOK_BODY_TOO_LARGE"
              ? 413
              : 400
            : error instanceof PaymentProviderProtocolError
              ? 400
              : error instanceof PaymentProviderUnavailableError
                ? 503
                : 500;
    return new NextResponse(
      status === 401
        ? "Invalid webhook signature"
        : status === 503
          ? "Webhook verification temporarily unavailable"
          : "Webhook was not accepted",
      { headers: noStoreHeaders(), status },
    );
  }
}
