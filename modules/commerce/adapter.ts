import type { MonoInvoiceObservation } from "./types";

export interface CreatePaymentInvoiceInput {
  readonly amountKopiykas: number;
  readonly currencyNumeric: 980;
  readonly orderReference: string;
  readonly destination: string;
  readonly redirectUrl: string;
  readonly webhookUrl: string;
  readonly validitySeconds: number;
  readonly items: readonly {
    readonly bookId: string;
    readonly name: string;
    readonly unitPriceKopiykas: number;
  }[];
}

export interface CreatedPaymentInvoice {
  readonly invoiceId: string;
  readonly checkoutUrl: string;
}

export interface PaymentProviderAdapter {
  readonly id: "mono";
  createInvoice(input: CreatePaymentInvoiceInput): Promise<CreatedPaymentInvoice>;
  getInvoiceStatus(invoiceId: string): Promise<MonoInvoiceObservation>;
  verifyAndParseWebhook(
    rawBody: Uint8Array,
    signature: string,
  ): Promise<MonoInvoiceObservation>;
}

export class PaymentProviderUnavailableError extends Error {
  constructor(message = "Платіжний сервіс тимчасово недоступний.") {
    super(message);
    this.name = "PaymentProviderUnavailableError";
  }
}

export class PaymentProviderProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentProviderProtocolError";
  }
}

export class PaymentProviderConfigurationError extends Error {
  constructor(message = "Платіжний сервіс не налаштовано.") {
    super(message);
    this.name = "PaymentProviderConfigurationError";
  }
}

export class PaymentProviderRejectedError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`mono rejected invoice creation with HTTP ${status}`);
    this.name = "PaymentProviderRejectedError";
    this.status = status;
  }
}

export class PaymentWebhookSignatureError extends Error {
  constructor() {
    super("Invalid mono webhook signature");
    this.name = "PaymentWebhookSignatureError";
  }
}

export class UnavailablePaymentProviderAdapter implements PaymentProviderAdapter {
  readonly id = "mono" as const;

  async createInvoice(): Promise<never> {
    // No external request was made, so invoice creation is definitively absent
    // and the cart can be unlocked immediately.
    throw new PaymentProviderConfigurationError();
  }

  async getInvoiceStatus(): Promise<never> {
    throw new PaymentProviderUnavailableError();
  }

  async verifyAndParseWebhook(): Promise<never> {
    throw new PaymentProviderUnavailableError();
  }
}
