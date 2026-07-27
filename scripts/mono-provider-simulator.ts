import {
  generateKeyPairSync,
  randomUUID,
  sign as signBytes,
  type KeyObject,
} from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MAX_BODY_BYTES = 64_000;
const INVOICE_STATUSES = new Set([
  "created",
  "processing",
  "hold",
  "success",
  "failure",
  "reversed",
  "expired",
] as const);

type InvoiceStatus =
  | "created"
  | "processing"
  | "hold"
  | "success"
  | "failure"
  | "reversed"
  | "expired";

interface CreateInvoiceBody {
  readonly amount: number;
  readonly ccy: number;
  readonly destination?: string;
  readonly merchantPaymInfo?: {
    readonly reference?: string;
  };
  readonly redirectUrl: string;
  readonly validity?: number;
  readonly webHookUrl: string;
}

interface SimulatorInvoice {
  readonly amount: number;
  readonly ccy: number;
  readonly createdDate: string;
  readonly destination: string;
  readonly invoiceId: string;
  readonly pageUrl: string;
  readonly redirectUrl: string;
  readonly reference: string;
  readonly webHookUrl: string;
  failureReason?: string;
  finalAmount: number;
  modifiedDate: string;
  omitModifiedDate?: boolean;
  status: InvoiceStatus;
}

interface DeliveryReceipt {
  readonly attemptedAt: string;
  readonly invoiceId: string;
  readonly modifiedDate: string;
  readonly responseStatus: number | null;
  readonly status: InvoiceStatus;
  readonly transportError?: string;
}

export interface MonoProviderSimulator {
  readonly origin: string;
  readonly publicKeyBase64: string;
  close(): Promise<void>;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Referrer-Policy": "no-referrer",
  });
  response.end(JSON.stringify(body));
}

function sendHtml(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'none'; form-action 'self'; style-src 'unsafe-inline'",
    "Content-Type": "text/html; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function readRawBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += value.length;
    if (length > MAX_BODY_BYTES) throw new Error("request body too large");
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const raw = await readRawBody(request);
  if (raw.length === 0) return {};
  return JSON.parse(raw.toString("utf8"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLoopbackUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(parsed.hostname) &&
      new Set(["http:", "https:"]).has(parsed.protocol) &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

function invoicePayload(invoice: SimulatorInvoice): Record<string, unknown> {
  return {
    amount: invoice.amount,
    ccy: invoice.ccy,
    createdDate: invoice.createdDate,
    destination: invoice.destination,
    failureReason: invoice.failureReason,
    finalAmount: invoice.finalAmount,
    invoiceId: invoice.invoiceId,
    ...(invoice.omitModifiedDate
      ? {}
      : { modifiedDate: invoice.modifiedDate }),
    reference: invoice.reference,
    status: invoice.status,
  };
}

function normalizedStatus(value: unknown): InvoiceStatus | null {
  return typeof value === "string" && INVOICE_STATUSES.has(value as InvoiceStatus)
    ? (value as InvoiceStatus)
    : null;
}

function validCreateInvoiceBody(value: unknown): value is CreateInvoiceBody {
  if (!isRecord(value)) return false;
  return (
    Number.isSafeInteger(value.amount) &&
    Number(value.amount) > 0 &&
    value.ccy === 980 &&
    typeof value.redirectUrl === "string" &&
    isLoopbackUrl(value.redirectUrl) &&
    typeof value.webHookUrl === "string" &&
    isLoopbackUrl(value.webHookUrl) &&
    (value.validity === undefined ||
      (Number.isSafeInteger(value.validity) &&
        Number(value.validity) >= 60 &&
        Number(value.validity) <= 86_400))
  );
}

function requireControlToken(
  request: IncomingMessage,
  response: ServerResponse,
  expected: string,
): boolean {
  if (request.headers["x-unit05-control-token"] !== expected) {
    sendJson(response, 403, { errCode: "FORBIDDEN", errText: "Invalid control token" });
    return false;
  }
  return true;
}

function monotonicTimestamp(previous: string): string {
  const now = Date.now();
  return new Date(Math.max(now, Date.parse(previous) + 1)).toISOString();
}

export async function startMonoProviderSimulator(input: {
  readonly controlToken: string;
  readonly merchantToken: string;
  readonly port?: number;
  readonly publicKeyFile?: string;
}): Promise<MonoProviderSimulator> {
  if (!input.controlToken) throw new Error("UNIT05_MONO_CONTROL_TOKEN is required");
  if (!input.merchantToken) throw new Error("MONO_MERCHANT_TOKEN is required");

  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const publicKeyBase64 = publicKey
    .export({ format: "der", type: "spki" })
    .toString("base64");
  const invoices = new Map<string, SimulatorInvoice>();
  const deliveries: DeliveryReceipt[] = [];
  let origin = "";

  async function deliverWebhook(
    invoice: SimulatorInvoice,
    signingKey: KeyObject = privateKey,
  ): Promise<DeliveryReceipt> {
    const body = JSON.stringify(invoicePayload(invoice));
    const signature = signBytes("sha256", Buffer.from(body, "utf8"), {
      dsaEncoding: "der",
      key: signingKey,
    }).toString("base64");
    let responseStatus: number | null = null;
    let transportError: string | undefined;
    try {
      const webhookResponse = await fetch(invoice.webHookUrl, {
        body,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-Sign": signature,
        },
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
      responseStatus = webhookResponse.status;
      await webhookResponse.body?.cancel();
    } catch (error) {
      transportError =
        error instanceof Error
          ? `${error.name}:${error.message}`.slice(0, 240)
          : "unknown_transport_error";
    }
    const receipt: DeliveryReceipt = {
      attemptedAt: new Date().toISOString(),
      invoiceId: invoice.invoiceId,
      modifiedDate: invoice.modifiedDate,
      responseStatus,
      status: invoice.status,
      ...(transportError ? { transportError } : {}),
    };
    deliveries.push(receipt);
    return receipt;
  }

  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(
        request.url ?? "/",
        origin || "http://127.0.0.1",
      );

      if (requestUrl.pathname === "/health") {
        sendJson(response, 200, {
          invoiceCount: invoices.size,
          status: "ok",
        });
        return;
      }

      if (
        request.method === "GET" &&
        requestUrl.pathname === "/api/merchant/pubkey"
      ) {
        if (request.headers["x-token"] !== input.merchantToken) {
          sendJson(response, 403, {
            errCode: "FORBIDDEN",
            errText: "Invalid merchant token",
          });
          return;
        }
        sendJson(response, 200, { key: publicKeyBase64 });
        return;
      }

      if (
        request.method === "POST" &&
        requestUrl.pathname === "/api/merchant/invoice/create"
      ) {
        if (request.headers["x-token"] !== input.merchantToken) {
          sendJson(response, 403, {
            errCode: "FORBIDDEN",
            errText: "Invalid merchant token",
          });
          return;
        }
        const body = await readJsonBody(request);
        if (!validCreateInvoiceBody(body)) {
          sendJson(response, 400, {
            errCode: "INVALID_REQUEST",
            errText: "Invalid invoice create payload",
          });
          return;
        }
        const invoiceId = randomUUID();
        const createdDate = new Date().toISOString();
        const reference =
          body.merchantPaymInfo?.reference?.trim() || `unit05-${invoiceId}`;
        const invoice: SimulatorInvoice = {
          amount: body.amount,
          ccy: body.ccy,
          createdDate,
          destination: body.destination?.trim() || "UkieBook",
          finalAmount: 0,
          invoiceId,
          modifiedDate: createdDate,
          pageUrl: `${origin}/checkout/${invoiceId}`,
          redirectUrl: body.redirectUrl,
          reference,
          status: "created",
          webHookUrl: body.webHookUrl,
        };
        invoices.set(invoiceId, invoice);
        sendJson(response, 200, {
          invoiceId,
          pageUrl: invoice.pageUrl,
        });
        return;
      }

      if (
        request.method === "GET" &&
        requestUrl.pathname === "/api/merchant/invoice/status"
      ) {
        if (request.headers["x-token"] !== input.merchantToken) {
          sendJson(response, 403, {
            errCode: "FORBIDDEN",
            errText: "Invalid merchant token",
          });
          return;
        }
        const invoiceId = requestUrl.searchParams.get("invoiceId") ?? "";
        const invoice = invoices.get(invoiceId);
        if (!invoice) {
          sendJson(response, 404, {
            errCode: "INVOICE_NOT_FOUND",
            errText: "Invoice not found",
          });
          return;
        }
        sendJson(response, 200, invoicePayload(invoice));
        return;
      }

      const checkoutMatch = requestUrl.pathname.match(
        /^\/checkout\/([0-9a-f-]+)$/u,
      );
      if (request.method === "GET" && checkoutMatch) {
        const invoice = invoices.get(checkoutMatch[1] ?? "");
        if (!invoice) {
          sendHtml(response, 404, "<h1>Invoice not found</h1>");
          return;
        }
        sendHtml(
          response,
          200,
          `<!doctype html>
<html lang="uk">
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>mono simulator</title>
  <style>
    body{font:16px/1.5 system-ui;margin:0;padding:3rem;background:#f5f5f5;color:#111}
    main{max-width:34rem;margin:auto;background:#fff;padding:2rem;border-radius:1.5rem}
    form{display:inline-block;margin:.5rem}.primary{background:#111;color:#fff}
    button{min-height:44px;padding:.75rem 1.1rem;border:1px solid #111;border-radius:999px}
  </style>
  <main>
    <h1>Тестова оплата mono</h1>
    <p>Сума: ${htmlEscape((invoice.amount / 100).toFixed(2))} UAH</p>
    <p>Замовлення: ${htmlEscape(invoice.reference)}</p>
    <form method="post" action="/__control/browser/${invoice.invoiceId}/success"><button class="primary">Оплатити</button></form>
    <form method="post" action="/__control/browser/${invoice.invoiceId}/failure"><button>Відхилити платіж</button></form>
    <form method="post" action="/__control/browser/${invoice.invoiceId}/cancel"><button>Скасувати</button></form>
  </main>
</html>`,
        );
        return;
      }

      const browserActionMatch = requestUrl.pathname.match(
        /^\/__control\/browser\/([0-9a-f-]+)\/(success|failure|cancel)$/u,
      );
      if (request.method === "POST" && browserActionMatch) {
        const invoice = invoices.get(browserActionMatch[1] ?? "");
        if (!invoice) {
          sendHtml(response, 404, "<h1>Invoice not found</h1>");
          return;
        }
        const action = browserActionMatch[2];
        invoice.status = action === "success" ? "success" : "failure";
        invoice.failureReason =
          action === "success"
            ? undefined
            : action === "cancel"
              ? "cancelled_by_user"
              : "declined";
        invoice.finalAmount = action === "success" ? invoice.amount : 0;
        invoice.modifiedDate = monotonicTimestamp(invoice.modifiedDate);
        await deliverWebhook(invoice);
        const redirect = new URL(invoice.redirectUrl);
        redirect.searchParams.set("invoiceId", invoice.invoiceId);
        response.writeHead(303, { Location: redirect.toString() }).end();
        return;
      }

      if (requestUrl.pathname.startsWith("/__control/")) {
        if (!requireControlToken(request, response, input.controlToken)) return;

        if (
          request.method === "POST" &&
          requestUrl.pathname === "/__control/reset"
        ) {
          invoices.clear();
          deliveries.splice(0);
          sendJson(response, 200, { status: "reset" });
          return;
        }
        if (
          request.method === "GET" &&
          requestUrl.pathname === "/__control/invoices"
        ) {
          sendJson(response, 200, {
            invoices: [...invoices.values()].map((invoice) => ({
              ...invoicePayload(invoice),
              pageUrl: invoice.pageUrl,
              redirectUrl: invoice.redirectUrl,
              webHookUrl: invoice.webHookUrl,
            })),
          });
          return;
        }
        if (
          request.method === "GET" &&
          requestUrl.pathname === "/__control/deliveries"
        ) {
          sendJson(response, 200, { deliveries });
          return;
        }

        const controlInvoiceMatch = requestUrl.pathname.match(
          /^\/__control\/invoices\/([0-9a-f-]+)\/(status|deliver)$/u,
        );
        if (request.method === "POST" && controlInvoiceMatch) {
          const invoice = invoices.get(controlInvoiceMatch[1] ?? "");
          if (!invoice) {
            sendJson(response, 404, { error: "invoice_not_found" });
            return;
          }
          const body = await readJsonBody(request);
          if (!isRecord(body)) {
            sendJson(response, 400, { error: "invalid_control_payload" });
            return;
          }

          if (controlInvoiceMatch[2] === "status") {
            const status = normalizedStatus(body.status);
            if (!status) {
              sendJson(response, 400, { error: "invalid_status" });
              return;
            }
            invoice.status = status;
            invoice.finalAmount =
              status === "success" || status === "hold" ? invoice.amount : 0;
            invoice.failureReason =
              typeof body.failureReason === "string"
                ? body.failureReason.slice(0, 160)
                : status === "failure"
                  ? "declined"
                  : undefined;
            invoice.modifiedDate =
              typeof body.modifiedDate === "string" &&
              Number.isFinite(Date.parse(body.modifiedDate))
                ? new Date(body.modifiedDate).toISOString()
                : monotonicTimestamp(invoice.modifiedDate);
            invoice.omitModifiedDate = body.omitModifiedDate === true;
            const shouldDeliver = body.deliverWebhook !== false;
            const delivery = shouldDeliver
              ? await deliverWebhook(invoice)
              : null;
            sendJson(response, 200, {
              delivery,
              invoice: invoicePayload(invoice),
            });
            return;
          }

          const attempts =
            Number.isSafeInteger(body.attempts) &&
            Number(body.attempts) >= 1 &&
            Number(body.attempts) <= 3
              ? Number(body.attempts)
              : 1;
          const attemptReceipts: DeliveryReceipt[] = [];
          for (let attempt = 0; attempt < attempts; attempt += 1) {
            attemptReceipts.push(await deliverWebhook(invoice));
          }
          sendJson(response, 200, { deliveries: attemptReceipts });
          return;
        }
      }

      sendJson(response, 404, {
        errCode: "NOT_FOUND",
        errText: "Not found",
      });
    } catch (error) {
      sendJson(response, 500, {
        errCode: "SIMULATOR_ERROR",
        errText:
          error instanceof Error
            ? `${error.name}:${error.message}`.slice(0, 240)
            : "Unknown simulator error",
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.port ?? 0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Mono simulator did not bind a TCP port");
  }
  origin = `http://127.0.0.1:${address.port}`;

  if (input.publicKeyFile) {
    const destination = path.resolve(input.publicKeyFile);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(
      destination,
      `${JSON.stringify({
        algorithm: "ECDSA_SHA256",
        encoding: "spki-der-base64",
        key: publicKeyBase64,
        origin,
      })}\n`,
      { mode: 0o600 },
    );
  }

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
    origin,
    publicKeyBase64,
  };
}

const executedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (executedPath === import.meta.url) {
  const portText = process.argv[2];
  if (!portText || !/^\d+$/u.test(portText)) {
    throw new Error("A numeric port is required");
  }
  const simulator = await startMonoProviderSimulator({
    controlToken: process.env.UNIT05_MONO_CONTROL_TOKEN ?? "",
    merchantToken: process.env.MONO_MERCHANT_TOKEN ?? "",
    port: Number(portText),
    publicKeyFile: process.argv[3],
  });
  process.stdout.write(
    `${JSON.stringify({
      origin: simulator.origin,
      publicKeyFile: process.argv[3] ? path.resolve(process.argv[3]) : null,
      status: "ready",
    })}\n`,
  );

  const stop = async () => {
    await simulator.close();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
