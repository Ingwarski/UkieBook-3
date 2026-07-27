import {
  generateKeyPairSync,
  sign as signBytes,
} from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import {
  PaymentProviderConfigurationError,
  PaymentProviderProtocolError,
  PaymentProviderUnavailableError,
  PaymentWebhookSignatureError,
  UnavailablePaymentProviderAdapter,
  type CreatePaymentInvoiceInput,
} from "../../modules/commerce/adapter";
import { MonoPaymentAdapter } from "../../modules/commerce/mono-adapter";

const merchantToken = "unit05-adapter-merchant-token";
const servers: Server[] = [];

const invoiceInput: CreatePaymentInvoiceInput = {
  amountKopiykas: 29_800,
  currencyNumeric: 980,
  destination: "Книжки UkieBook: 1",
  items: [
    {
      bookId: "10101010-1010-4010-8010-101010101001",
      name: "Тестова книжка",
      unitPriceKopiykas: 29_800,
    },
  ],
  orderReference: "ukiebook-adapter-test",
  redirectUrl: "https://ukiebook.example/checkout/result?order=test",
  validitySeconds: 3_600,
  webhookUrl: "https://ukiebook.example/api/payments/mono/webhook",
};

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    ),
  );
});

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind");
  }
  return `http://127.0.0.1:${address.port}`;
}

function adapterWithFetcher(
  fetcher: typeof fetch,
  options: { readonly maxResponseBytes?: number } = {},
): MonoPaymentAdapter {
  return new MonoPaymentAdapter({
    fetcher,
    maxResponseBytes: options.maxResponseBytes,
    merchantToken,
  });
}

describe("MonoPaymentAdapter security boundaries", () => {
  it("classifies missing provider configuration as a definite no-create", async () => {
    await expect(
      new UnavailablePaymentProviderAdapter().createInvoice(),
    ).rejects.toBeInstanceOf(PaymentProviderConfigurationError);
  });

  it("does not follow a cross-origin redirect or disclose X-Token", async () => {
    let targetRequests = 0;
    let targetToken: string | undefined;
    const targetOrigin = await listen(
      createServer((request, response) => {
        targetRequests += 1;
        targetToken =
          typeof request.headers["x-token"] === "string"
            ? request.headers["x-token"]
            : undefined;
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end("{}");
      }),
    );
    let sourceRequests = 0;
    const sourceOrigin = await listen(
      createServer((request, response) => {
        sourceRequests += 1;
        expect(request.headers["x-token"]).toBe(merchantToken);
        response.writeHead(302, { Location: `${targetOrigin}/capture` });
        response.end();
      }),
    );
    const adapter = new MonoPaymentAdapter({
      allowInsecureLoopback: true,
      apiOrigin: sourceOrigin,
      merchantToken,
    });

    await expect(adapter.createInvoice(invoiceInput)).rejects.toBeInstanceOf(
      PaymentProviderUnavailableError,
    );
    expect(sourceRequests).toBe(1);
    expect(targetRequests).toBe(0);
    expect(targetToken).toBeUndefined();
  });

  it("rejects oversized declared and streamed responses", async () => {
    const declared = adapterWithFetcher(
      (async () =>
        new Response("{}", {
          headers: {
            "Content-Length": "2048",
            "Content-Type": "application/json",
          },
          status: 200,
        })) as typeof fetch,
      { maxResponseBytes: 1_024 },
    );
    await expect(declared.createInvoice(invoiceInput)).rejects.toBeInstanceOf(
      PaymentProviderProtocolError,
    );

    const streamed = adapterWithFetcher(
      (async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(700));
              controller.enqueue(new Uint8Array(700));
              controller.close();
            },
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          },
        )) as typeof fetch,
      { maxResponseBytes: 1_024 },
    );
    await expect(streamed.createInvoice(invoiceInput)).rejects.toBeInstanceOf(
      PaymentProviderProtocolError,
    );
  });

  it("maps an invalid checkout page URL to a protocol error", async () => {
    const adapter = adapterWithFetcher(
      (async () =>
        Response.json({
          invoiceId: "invoice-invalid-page-url",
          pageUrl: "not a URL",
        })) as typeof fetch,
    );

    await expect(adapter.createInvoice(invoiceInput)).rejects.toBeInstanceOf(
      PaymentProviderProtocolError,
    );
  });

  it("rejects a present but malformed provider reference", async () => {
    const adapter = adapterWithFetcher(
      (async () =>
        Response.json({
          amount: 29_800,
          ccy: 980,
          invoiceId: "invoice-invalid-reference",
          modifiedDate: "2026-07-27T10:00:00.000Z",
          reference: 42,
          status: "success",
        })) as typeof fetch,
    );

    await expect(
      adapter.getInvoiceStatus("invoice-invalid-reference"),
    ).rejects.toBeInstanceOf(PaymentProviderProtocolError);
  });

  it("single-flights one stale-key refresh and cools down forged retries", async () => {
    const stale = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const current = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const stalePublicKey = stale.publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64");
    const currentPublicKey = current.publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64");
    const rawBody = Buffer.from(
      JSON.stringify({
        amount: 29_800,
        ccy: 980,
        finalAmount: 29_800,
        invoiceId: "invoice-key-refresh",
        modifiedDate: "2026-07-27T10:00:00.000Z",
        reference: invoiceInput.orderReference,
        status: "success",
      }),
      "utf8",
    );
    const currentSignature = signBytes("sha256", rawBody, {
      dsaEncoding: "der",
      key: current.privateKey,
    }).toString("base64");
    let publicKeyRequests = 0;
    const adapter = new MonoPaymentAdapter({
      fetcher: (async () => {
        publicKeyRequests += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return Response.json({ key: currentPublicKey });
      }) as typeof fetch,
      merchantToken,
      publicKeyBase64: stalePublicKey,
      publicKeyRefreshCooldownMs: 60_000,
    });

    const verified = await Promise.all(
      Array.from({ length: 6 }, () =>
        adapter.verifyAndParseWebhook(rawBody, currentSignature),
      ),
    );
    expect(verified.every((item) => item.status === "success")).toBe(true);
    expect(publicKeyRequests).toBe(1);

    const forgedSignature = signBytes("sha256", rawBody, {
      dsaEncoding: "der",
      key: stale.privateKey,
    }).toString("base64");
    const forged = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        adapter.verifyAndParseWebhook(rawBody, forgedSignature),
      ),
    );
    expect(
      forged.every(
        (result) =>
          result.status === "rejected" &&
          result.reason instanceof PaymentWebhookSignatureError,
      ),
    ).toBe(true);
    expect(publicKeyRequests).toBe(1);
  });
});
