export const COMMERCE_SCHEMA_VERSION = 1 as const;
export const COMMERCE_QUEUE = "commerce";
export const PAYMENT_RECONCILIATION_JOB_TYPE = "commerce.reconcile-payment.v1";
export const PAYMENT_RECONCILIATION_JOB_VERSION = 1 as const;
export const PAYMENT_CREATION_WATCHDOG_JOB_TYPE =
  "commerce.watch-payment-creation.v1";

export type CartStatus =
  | "active"
  | "checkout_pending"
  | "purchased"
  | "merged";

export type OrderStatus =
  | "payment_pending"
  | "paid"
  | "payment_failed"
  | "cancelled";

export const MONO_INVOICE_STATUSES = [
  "created",
  "processing",
  "hold",
  "success",
  "failure",
  "reversed",
  "expired",
] as const;
export type MonoInvoiceStatus = (typeof MONO_INVOICE_STATUSES)[number];

export type PaymentSessionStatus =
  | "creating"
  | "creation_unknown"
  | MonoInvoiceStatus;

export interface CartItemReadModel {
  readonly bookId: string;
  readonly title: string;
  readonly authorPublicName: string;
  readonly coverPath: string;
  readonly available: boolean;
  readonly basePriceKopiykas: number;
  readonly actualPriceKopiykas: number;
  readonly formattedActualPrice: string;
  readonly discountKopiykas: number;
}

export interface CartReadModel {
  readonly schemaVersion: typeof COMMERCE_SCHEMA_VERSION;
  readonly id: string;
  readonly status: CartStatus;
  readonly revision: number;
  readonly items: readonly CartItemReadModel[];
  readonly totalKopiykas: number;
  readonly formattedTotal: string;
  readonly checkoutAllowed: boolean;
}

export interface OrderItemSnapshot {
  readonly id: string;
  readonly ordinal: number;
  readonly bookId: string;
  readonly bookVersionId: string;
  readonly authorId: string;
  readonly title: string;
  readonly authorPublicName: string;
  readonly coverPath: string;
  readonly quantity: 1;
  readonly basePriceKopiykas: number;
  readonly discountKopiykas: number;
  readonly unitPriceKopiykas: number;
  readonly lineTotalKopiykas: number;
}

export interface CheckoutOrder {
  readonly id: string;
  readonly buyerUserId: string;
  readonly cartId: string;
  readonly cartRevision: number;
  readonly reference: string;
  readonly status: OrderStatus;
  readonly currency: "UAH";
  readonly totalKopiykas: number;
  readonly items: readonly OrderItemSnapshot[];
  readonly paidAt: string | null;
  readonly createdAt: string;
}

export interface PaymentSession {
  readonly id: string;
  readonly orderId: string;
  readonly provider: "mono";
  readonly requestKey: string;
  readonly providerInvoiceId: string | null;
  readonly checkoutUrl: string | null;
  readonly status: PaymentSessionStatus;
  readonly amountKopiykas: number;
  readonly currencyNumeric: 980;
  readonly providerModifiedAt: string | null;
  readonly failureCode: string | null;
  readonly failureReason: string | null;
  readonly reconciliationAttempt: number;
  readonly expiresAt: string;
}

export interface MonoInvoiceObservation {
  readonly invoiceId: string;
  readonly status: MonoInvoiceStatus;
  readonly amountKopiykas: number;
  readonly finalAmountKopiykas: number | null;
  readonly currencyNumeric: number;
  readonly reference: string | null;
  readonly createdAt: string | null;
  readonly modifiedAt: string | null;
  readonly failureCode: string | null;
  readonly failureReason: string | null;
}

export interface StartCheckoutResult {
  readonly order: CheckoutOrder;
  readonly paymentSession: PaymentSession;
  readonly redirectUrl: string;
}

export interface CheckoutResultReadModel {
  readonly schemaVersion: typeof COMMERCE_SCHEMA_VERSION;
  readonly orderId: string;
  readonly orderStatus: OrderStatus;
  readonly paymentStatus: PaymentSessionStatus;
  readonly items: readonly Pick<
    OrderItemSnapshot,
    | "authorPublicName"
    | "bookId"
    | "coverPath"
    | "title"
    | "unitPriceKopiykas"
  >[];
  readonly totalKopiykas: number;
  readonly formattedTotal: string;
  readonly failureMessage: string | null;
  readonly emailStatus: "failed" | "queued" | "sent" | null;
}

export interface PaidSalePayload {
  readonly schemaVersion: typeof COMMERCE_SCHEMA_VERSION;
  readonly paidSaleId: string;
  readonly orderId: string;
  readonly buyerUserId: string;
  readonly paymentSessionId: string;
  readonly provider: "mono";
  readonly providerInvoiceId: string;
  readonly currency: "UAH";
  readonly totalKopiykas: number;
  readonly paidAt: string;
  readonly items: readonly {
    readonly orderItemId: string;
    readonly bookId: string;
    readonly bookVersionId: string;
    readonly authorId: string;
    readonly quantity: 1;
    readonly paidPriceKopiykas: number;
  }[];
}

export interface PaymentReconciliationJobPayload {
  readonly schemaVersion: typeof COMMERCE_SCHEMA_VERSION;
  readonly paymentSessionId: string;
  readonly attempt: number;
  readonly notBefore: string;
  readonly purpose: "creation_watchdog" | "status";
}
