export const NOTIFICATION_SCHEMA_VERSION = 1 as const;
export const NOTIFICATION_QUEUE = "notifications";
export const PURCHASE_EMAIL_JOB_TYPE = "notifications.send-purchase-email.v1";
export const PURCHASE_EMAIL_JOB_VERSION = 1 as const;

export interface PurchaseNotificationRequestedPayload {
  readonly schemaVersion: typeof NOTIFICATION_SCHEMA_VERSION;
  readonly deliveryId: string;
  readonly orderId: string;
  readonly paidSaleId: string;
  readonly buyerUserId: string;
}

export interface PurchaseEmailJobPayload
  extends PurchaseNotificationRequestedPayload {}

export interface PurchaseEmailMessage {
  readonly idempotencyKey: string;
  readonly to: string;
  readonly from: string;
  readonly subject: string;
  readonly text: string;
}

export interface SentEmailReceipt {
  readonly providerMessageId: string;
}
