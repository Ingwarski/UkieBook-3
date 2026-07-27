import "server-only";

import {
  createPublicKey,
  randomUUID,
  verify as verifySignature,
  type KeyObject,
} from "node:crypto";

import {
  PaymentProviderProtocolError,
  PaymentProviderRejectedError,
  PaymentProviderUnavailableError,
  PaymentWebhookSignatureError,
  type CreatedPaymentInvoice,
  type CreatePaymentInvoiceInput,
  type PaymentProviderAdapter,
} from "./adapter";
import {
  MONO_INVOICE_STATUSES,
  type MonoInvoiceObservation,
  type MonoInvoiceStatus,
} from "./types";

export interface MonoAdapterOptions {
  /**
   * Test-only escape hatch for a local provider simulator. This permits bare
   * HTTP loopback origins and loopback checkout URLs, never arbitrary HTTP.
   */
  readonly allowInsecureLoopback?: boolean;
  readonly apiOrigin?: string;
  readonly fetcher?: typeof fetch;
  readonly merchantToken: string;
  readonly maxResponseBytes?: number;
  readonly publicKeyBase64?: string;
  readonly publicKeyRefreshCooldownMs?: number;
}

function nonEmpty(value: unknown, field: string, max = 2_048): string {
  if (typeof value !== "string") {
    throw new PaymentProviderProtocolError(`${field} is missing`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new PaymentProviderProtocolError(`${field} is invalid`);
  }
  return normalized;
}

function integer(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new PaymentProviderProtocolError(`${field} is invalid`);
  }
  return value;
}

function optionalInteger(value: unknown, field: string): number | null {
  return value === null || value === undefined ? null : integer(value, field);
}

function optionalText(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/gu, " ").trim().slice(0, max);
  return normalized || null;
}

function optionalProtocolText(
  value: unknown,
  field: string,
  max: number,
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new PaymentProviderProtocolError(`${field} is invalid`);
  }
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (!normalized || normalized.length > max) {
    throw new PaymentProviderProtocolError(`${field} is invalid`);
  }
  return normalized;
}

function isoTimestamp(value: unknown, field: string): string {
  const text = nonEmpty(value, field, 80);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    throw new PaymentProviderProtocolError(`${field} is invalid`);
  }
  return date.toISOString();
}

function optionalIsoTimestamp(value: unknown, field: string): string | null {
  return value === null || value === undefined
    ? null
    : isoTimestamp(value, field);
}

export function parseMonoInvoiceObservation(
  payload: unknown,
): MonoInvoiceObservation {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new PaymentProviderProtocolError("mono invoice payload is invalid");
  }
  const value = payload as Record<string, unknown>;
  const statusValue = nonEmpty(value.status, "status", 32);
  if (!(MONO_INVOICE_STATUSES as readonly string[]).includes(statusValue)) {
    throw new PaymentProviderProtocolError("mono invoice status is unsupported");
  }
  return {
    amountKopiykas: integer(value.amount, "amount"),
    createdAt: optionalIsoTimestamp(value.createdDate, "createdDate"),
    currencyNumeric: integer(value.ccy, "ccy"),
    failureCode: optionalText(value.errCode, 80),
    failureReason: optionalText(value.failureReason, 320),
    finalAmountKopiykas: optionalInteger(value.finalAmount, "finalAmount"),
    invoiceId: nonEmpty(value.invoiceId, "invoiceId", 160),
    modifiedAt: optionalIsoTimestamp(value.modifiedDate, "modifiedDate"),
    reference: optionalProtocolText(value.reference, "reference", 120),
    status: statusValue as MonoInvoiceStatus,
  };
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new PaymentProviderProtocolError("mono response is not valid JSON");
  }
}

function isLoopbackHost(hostname: string): boolean {
  return new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(hostname);
}

function normalizedOrigin(
  value: string,
  allowInsecureLoopback: boolean,
): string {
  const url = new URL(value);
  const allowedProtocol =
    url.protocol === "https:" ||
    (allowInsecureLoopback &&
      url.protocol === "http:" &&
      isLoopbackHost(url.hostname));
  if (
    !allowedProtocol ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "MONO_API_ORIGIN must be a bare HTTPS origin (HTTP loopback is test-only)",
    );
  }
  return url.origin;
}

function publicKeyFromBase64(value: string): KeyObject {
  let decoded: Buffer;
  try {
    decoded = Buffer.from(value, "base64");
  } catch {
    throw new PaymentProviderProtocolError("mono public key is invalid");
  }
  if (decoded.length === 0) {
    throw new PaymentProviderProtocolError("mono public key is empty");
  }
  try {
    return createPublicKey(decoded);
  } catch {
    try {
      return createPublicKey({
        format: "der",
        key: decoded,
        type: "spki",
      });
    } catch {
      throw new PaymentProviderProtocolError("mono public key cannot be parsed");
    }
  }
}

export class MonoPaymentAdapter implements PaymentProviderAdapter {
  readonly id = "mono" as const;
  private readonly apiOrigin: string;
  private readonly allowInsecureLoopback: boolean;
  private readonly fetcher: typeof fetch;
  private readonly merchantToken: string;
  private readonly maxResponseBytes: number;
  private publicKey: KeyObject | null;
  private publicKeyRefresh: Promise<KeyObject> | null = null;
  private publicKeyRefreshAttemptedAt = 0;
  private publicKeyRefreshSucceeded = true;
  private readonly publicKeyRefreshCooldownMs: number;

  constructor(options: MonoAdapterOptions) {
    this.allowInsecureLoopback = options.allowInsecureLoopback === true;
    this.apiOrigin = normalizedOrigin(
      options.apiOrigin ?? "https://api.monobank.ua",
      this.allowInsecureLoopback,
    );
    this.fetcher = options.fetcher ?? fetch;
    this.merchantToken = nonEmpty(
      options.merchantToken,
      "MONO_MERCHANT_TOKEN",
      1_024,
    );
    this.publicKey = options.publicKeyBase64
      ? publicKeyFromBase64(options.publicKeyBase64)
      : null;
    this.maxResponseBytes = options.maxResponseBytes ?? 1_048_576;
    if (
      !Number.isSafeInteger(this.maxResponseBytes) ||
      this.maxResponseBytes < 1_024 ||
      this.maxResponseBytes > 10_485_760
    ) {
      throw new Error("maxResponseBytes must be between 1024 and 10485760");
    }
    this.publicKeyRefreshCooldownMs =
      options.publicKeyRefreshCooldownMs ?? 5 * 60_000;
    if (
      !Number.isSafeInteger(this.publicKeyRefreshCooldownMs) ||
      this.publicKeyRefreshCooldownMs < 1_000
    ) {
      throw new Error("publicKeyRefreshCooldownMs must be at least 1000");
    }
  }

  private async request(
    path: string,
    init: RequestInit,
  ): Promise<Uint8Array> {
    let response: Response;
    try {
      response = await this.fetcher(new URL(path, this.apiOrigin), {
        ...init,
        headers: {
          Accept: "application/json",
          "X-Token": this.merchantToken,
          ...init.headers,
        },
        redirect: "error",
        signal: init.signal ?? AbortSignal.timeout(15_000),
      });
    } catch {
      throw new PaymentProviderUnavailableError();
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > this.maxResponseBytes
    ) {
      await response.body?.cancel("mono response exceeds size limit");
      throw new PaymentProviderProtocolError("mono response is too large");
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    if (reader) {
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          length += next.value.byteLength;
          if (length > this.maxResponseBytes) {
            await reader.cancel("mono response exceeds size limit");
            throw new PaymentProviderProtocolError("mono response is too large");
          }
          chunks.push(next.value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable) throw new PaymentProviderUnavailableError();
      throw new PaymentProviderRejectedError(response.status);
    }
    return bytes;
  }

  async createInvoice(
    input: CreatePaymentInvoiceInput,
  ): Promise<CreatedPaymentInvoice> {
    const bytes = await this.request("/api/merchant/invoice/create", {
      body: JSON.stringify({
        amount: input.amountKopiykas,
        ccy: input.currencyNumeric,
        merchantPaymInfo: {
          basketOrder: input.items.map((item) => ({
            code: item.bookId,
            name: item.name.slice(0, 200),
            qty: 1,
            sum: item.unitPriceKopiykas,
            total: item.unitPriceKopiykas,
            unit: "шт.",
          })),
          destination: input.destination.slice(0, 280),
          reference: input.orderReference,
        },
        paymentType: "debit",
        redirectUrl: input.redirectUrl,
        validity: input.validitySeconds,
        webHookUrl: input.webhookUrl,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const payload = parseJson(bytes);
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new PaymentProviderProtocolError(
        "mono create-invoice response is invalid",
      );
    }
    const value = payload as Record<string, unknown>;
    const invoiceId = nonEmpty(value.invoiceId, "invoiceId", 160);
    const checkoutUrl = nonEmpty(value.pageUrl, "pageUrl");
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(checkoutUrl);
    } catch {
      throw new PaymentProviderProtocolError("mono checkout URL is invalid");
    }
    if (
      parsedUrl.protocol !== "https:" &&
      !(
        this.allowInsecureLoopback &&
        parsedUrl.protocol === "http:" &&
        isLoopbackHost(parsedUrl.hostname)
      )
    ) {
      throw new PaymentProviderProtocolError("mono checkout URL is not HTTPS");
    }
    return { checkoutUrl: parsedUrl.toString(), invoiceId };
  }

  async getInvoiceStatus(invoiceId: string): Promise<MonoInvoiceObservation> {
    const query = new URLSearchParams({
      invoiceId: nonEmpty(invoiceId, "invoiceId", 160),
    });
    const bytes = await this.request(
      `/api/merchant/invoice/status?${query.toString()}`,
      { method: "GET" },
    );
    return parseMonoInvoiceObservation(parseJson(bytes));
  }

  private async refreshPublicKey(): Promise<KeyObject> {
    if (!this.publicKeyRefresh) {
      // Defer the refresh body so the shared promise is installed before any
      // state changes are visible to concurrent webhook verifications.
      this.publicKeyRefresh = Promise.resolve().then(async () => {
        this.publicKeyRefreshAttemptedAt = Date.now();
        this.publicKeyRefreshSucceeded = false;
        const bytes = await this.request("/api/merchant/pubkey", {
          method: "GET",
        });
        const payload = parseJson(bytes);
        if (
          typeof payload !== "object" ||
          payload === null ||
          Array.isArray(payload)
        ) {
          throw new PaymentProviderProtocolError(
            "mono public-key response is invalid",
          );
        }
        const value = payload as Record<string, unknown>;
        const key = publicKeyFromBase64(nonEmpty(value.key, "key", 16_384));
        this.publicKey = key;
        this.publicKeyRefreshSucceeded = true;
        return key;
      });
    }
    const pending = this.publicKeyRefresh;
    try {
      return await pending;
    } finally {
      if (this.publicKeyRefresh === pending) {
        this.publicKeyRefresh = null;
      }
    }
  }

  private async verify(
    rawBody: Uint8Array,
    signatureBase64: string,
  ): Promise<boolean> {
    const signature = Buffer.from(
      nonEmpty(signatureBase64, "X-Sign", 2_048),
      "base64",
    );
    if (signature.length === 0) return false;
    const hadCachedKey = this.publicKey !== null;
    const refreshAllowed =
      Date.now() - this.publicKeyRefreshAttemptedAt >=
      this.publicKeyRefreshCooldownMs;
    if (!this.publicKey && !refreshAllowed && !this.publicKeyRefresh) {
      throw new PaymentProviderUnavailableError(
        "mono public key refresh is cooling down",
      );
    }
    const key = this.publicKey ?? (await this.refreshPublicKey());
    if (verifySignature("sha256", rawBody, key, signature)) return true;
    // A cold verification already fetched the newest key; never fetch twice
    // for one untrusted request.
    if (!hadCachedKey) return false;
    if (this.publicKeyRefresh) {
      const refreshed = await this.refreshPublicKey();
      return verifySignature("sha256", rawBody, refreshed, signature);
    }
    if (!refreshAllowed) {
      if (!this.publicKeyRefreshSucceeded) {
        throw new PaymentProviderUnavailableError(
          "mono public key refresh is cooling down",
        );
      }
      return false;
    }
    const refreshed = await this.refreshPublicKey();
    return verifySignature("sha256", rawBody, refreshed, signature);
  }

  async verifyAndParseWebhook(
    rawBody: Uint8Array,
    signature: string,
  ): Promise<MonoInvoiceObservation> {
    if (!(await this.verify(rawBody, signature))) {
      throw new PaymentWebhookSignatureError();
    }
    return parseMonoInvoiceObservation(parseJson(rawBody));
  }
}

export class DeterministicMonoPaymentAdapter
  implements PaymentProviderAdapter
{
  readonly id = "mono" as const;
  readonly createdInvoices: CreatePaymentInvoiceInput[] = [];
  readonly observations = new Map<string, MonoInvoiceObservation>();
  private counter = 0;

  async createInvoice(
    input: CreatePaymentInvoiceInput,
  ): Promise<CreatedPaymentInvoice> {
    this.createdInvoices.push(input);
    this.counter += 1;
    const invoiceId = `test_invoice_${this.counter}_${randomUUID()}`;
    this.observations.set(invoiceId, {
      amountKopiykas: input.amountKopiykas,
      createdAt: new Date().toISOString(),
      currencyNumeric: input.currencyNumeric,
      failureCode: null,
      failureReason: null,
      finalAmountKopiykas: input.amountKopiykas,
      invoiceId,
      modifiedAt: new Date().toISOString(),
      reference: input.orderReference,
      status: "created",
    });
    return {
      checkoutUrl: `https://pay.mbnk.test/${encodeURIComponent(invoiceId)}`,
      invoiceId,
    };
  }

  async getInvoiceStatus(invoiceId: string): Promise<MonoInvoiceObservation> {
    const observation = this.observations.get(invoiceId);
    if (!observation) {
      throw new PaymentProviderProtocolError("Test invoice was not found");
    }
    return observation;
  }

  async verifyAndParseWebhook(
    rawBody: Uint8Array,
    signature: string,
  ): Promise<MonoInvoiceObservation> {
    if (signature !== "deterministic-test-signature") {
      throw new PaymentWebhookSignatureError();
    }
    return parseMonoInvoiceObservation(parseJson(rawBody));
  }

  setObservation(observation: MonoInvoiceObservation): void {
    this.observations.set(observation.invoiceId, observation);
  }
}
