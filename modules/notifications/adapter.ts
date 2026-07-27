import type {
  PurchaseEmailMessage,
  SentEmailReceipt,
} from "./types";

export interface TransactionalEmailAdapter {
  send(message: PurchaseEmailMessage): Promise<SentEmailReceipt>;
}

export class EmailProviderUnavailableError extends Error {
  constructor() {
    super("Transactional email provider is not configured");
    this.name = "EmailProviderUnavailableError";
  }
}

export class UnavailableEmailAdapter implements TransactionalEmailAdapter {
  async send(): Promise<never> {
    throw new EmailProviderUnavailableError();
  }
}

export class CapturedEmailAdapter implements TransactionalEmailAdapter {
  readonly messages: PurchaseEmailMessage[] = [];

  async send(message: PurchaseEmailMessage): Promise<SentEmailReceipt> {
    const existing = this.messages.find(
      (candidate) => candidate.idempotencyKey === message.idempotencyKey,
    );
    if (!existing) this.messages.push(message);
    return { providerMessageId: `captured:${message.idempotencyKey}` };
  }
}
