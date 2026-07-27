import {
  createPublicKey,
  verify as verifySignature,
} from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import {
  startMonoProviderSimulator,
  type MonoProviderSimulator,
} from "../../scripts/mono-provider-simulator";
import { MonoPaymentAdapter } from "../../modules/commerce/mono-adapter";

const merchantToken = "unit05-test-merchant-token";
const controlToken = "unit05-test-control-token";
const simulators: MonoProviderSimulator[] = [];

afterEach(async () => {
  await Promise.all(simulators.splice(0).map((simulator) => simulator.close()));
});

describe("mono provider simulator", () => {
  it("creates an invoice, exposes status and signs the exact webhook body", async () => {
    let webhookBody = "";
    let webhookSignature = "";
    const webhookServer = await import("node:http").then(({ createServer }) =>
      createServer(async (request, response) => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        webhookBody = Buffer.concat(chunks).toString("utf8");
        webhookSignature = String(request.headers["x-sign"] ?? "");
        response.writeHead(200).end();
      }),
    );
    await new Promise<void>((resolve) =>
      webhookServer.listen(0, "127.0.0.1", resolve),
    );
    const webhookAddress = webhookServer.address();
    if (!webhookAddress || typeof webhookAddress === "string") {
      throw new Error("Webhook receiver did not bind");
    }

    const simulator = await startMonoProviderSimulator({
      controlToken,
      merchantToken,
    });
    simulators.push(simulator);
    const webhookUrl = `http://127.0.0.1:${webhookAddress.port}/webhook`;
    const created = await fetch(
      `${simulator.origin}/api/merchant/invoice/create`,
      {
        body: JSON.stringify({
          amount: 29_800,
          ccy: 980,
          merchantPaymInfo: { reference: "order-unit05" },
          redirectUrl: "http://127.0.0.1:3121/checkout/result?order=unit05",
          webHookUrl: webhookUrl,
        }),
        headers: {
          "Content-Type": "application/json",
          "X-Token": merchantToken,
        },
        method: "POST",
      },
    );
    expect(created.status).toBe(200);
    const invoice = (await created.json()) as {
      invoiceId: string;
      pageUrl: string;
    };
    expect(invoice.pageUrl).toBe(`${simulator.origin}/checkout/${invoice.invoiceId}`);

    const statusBefore = await fetch(
      `${simulator.origin}/api/merchant/invoice/status?invoiceId=${invoice.invoiceId}`,
      { headers: { "X-Token": merchantToken } },
    );
    expect(await statusBefore.json()).toMatchObject({
      amount: 29_800,
      ccy: 980,
      invoiceId: invoice.invoiceId,
      reference: "order-unit05",
      status: "created",
    });

    const transitioned = await fetch(
      `${simulator.origin}/__control/invoices/${invoice.invoiceId}/status`,
      {
        body: JSON.stringify({ status: "success" }),
        headers: {
          "Content-Type": "application/json",
          "X-Unit05-Control-Token": controlToken,
        },
        method: "POST",
      },
    );
    expect(transitioned.status).toBe(200);
    expect(JSON.parse(webhookBody)).toMatchObject({
      amount: 29_800,
      finalAmount: 29_800,
      invoiceId: invoice.invoiceId,
      status: "success",
    });

    const publicKey = createPublicKey({
      format: "der",
      key: Buffer.from(simulator.publicKeyBase64, "base64"),
      type: "spki",
    });
    expect(
      verifySignature(
        "sha256",
        Buffer.from(webhookBody, "utf8"),
        publicKey,
        Buffer.from(webhookSignature, "base64"),
      ),
    ).toBe(true);
    const runtimeAdapter = new MonoPaymentAdapter({
      allowInsecureLoopback: true,
      apiOrigin: simulator.origin,
      merchantToken,
      publicKeyBase64: simulator.publicKeyBase64,
    });
    await expect(
      runtimeAdapter.verifyAndParseWebhook(
        Buffer.from(webhookBody, "utf8"),
        webhookSignature,
      ),
    ).resolves.toMatchObject({
      amountKopiykas: 29_800,
      invoiceId: invoice.invoiceId,
      status: "success",
    });

    await new Promise<void>((resolve, reject) =>
      webhookServer.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it("rejects invalid merchant credentials and unsafe provider callbacks", async () => {
    const simulator = await startMonoProviderSimulator({
      controlToken,
      merchantToken,
    });
    simulators.push(simulator);

    const unauthorized = await fetch(
      `${simulator.origin}/api/merchant/invoice/create`,
      {
        body: "{}",
        headers: { "Content-Type": "application/json", "X-Token": "wrong" },
        method: "POST",
      },
    );
    expect(unauthorized.status).toBe(403);

    const unsafe = await fetch(
      `${simulator.origin}/api/merchant/invoice/create`,
      {
        body: JSON.stringify({
          amount: 10_000,
          ccy: 980,
          redirectUrl: "https://evil.example/result",
          webHookUrl: "https://evil.example/webhook",
        }),
        headers: {
          "Content-Type": "application/json",
          "X-Token": merchantToken,
        },
        method: "POST",
      },
    );
    expect(unsafe.status).toBe(400);
  });

  it("never forwards the merchant token across an HTTP redirect", async () => {
    let redirectedRequests = 0;
    let redirectedToken: string | undefined;
    const redirectTarget = await import("node:http").then(({ createServer }) =>
      createServer((request, response) => {
        redirectedRequests += 1;
        redirectedToken = request.headers["x-token"] as string | undefined;
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end("{}");
      }),
    );
    const providerServer = await import("node:http").then(({ createServer }) =>
      createServer((_request, response) => {
        const targetAddress = redirectTarget.address();
        if (!targetAddress || typeof targetAddress === "string") {
          response.writeHead(500).end();
          return;
        }
        response
          .writeHead(302, {
            Location: `http://127.0.0.1:${targetAddress.port}/capture`,
          })
          .end();
      }),
    );
    await new Promise<void>((resolve) =>
      redirectTarget.listen(0, "127.0.0.1", resolve),
    );
    await new Promise<void>((resolve) =>
      providerServer.listen(0, "127.0.0.1", resolve),
    );
    try {
      const providerAddress = providerServer.address();
      if (!providerAddress || typeof providerAddress === "string") {
        throw new Error("Redirecting provider did not bind");
      }
      const adapter = new MonoPaymentAdapter({
        allowInsecureLoopback: true,
        apiOrigin: `http://127.0.0.1:${providerAddress.port}`,
        merchantToken,
      });
      await expect(adapter.getInvoiceStatus("redirect-test")).rejects.toMatchObject({
        name: "PaymentProviderUnavailableError",
      });
      expect(redirectedRequests).toBe(0);
      expect(redirectedToken).toBeUndefined();
    } finally {
      await Promise.all([
        new Promise<void>((resolve, reject) =>
          providerServer.close((error) =>
            error ? reject(error) : resolve(),
          ),
        ),
        new Promise<void>((resolve, reject) =>
          redirectTarget.close((error) =>
            error ? reject(error) : resolve(),
          ),
        ),
      ]);
    }
  });

  it("rejects a streaming response that exceeds the configured byte limit", async () => {
    const fetcher = (async (
      _input: string | URL | Request,
      init?: RequestInit,
    ) => {
      expect(init?.redirect).toBe("error");
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(800));
          controller.enqueue(new Uint8Array(800));
          controller.close();
        },
      });
      return new Response(body, {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }) as typeof fetch;
    const adapter = new MonoPaymentAdapter({
      allowInsecureLoopback: true,
      apiOrigin: "http://127.0.0.1:3317",
      fetcher,
      maxResponseBytes: 1_024,
      merchantToken,
    });
    await expect(adapter.getInvoiceStatus("oversized-test")).rejects.toThrow(
      /response is too large/u,
    );
  });
});
