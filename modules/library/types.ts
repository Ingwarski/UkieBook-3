export const LIBRARY_SCHEMA_VERSION = 1 as const;

export type LibraryEntitlementStatus = "active" | "refunded";
export type LibraryReviewStatus =
  | "pending_moderation"
  | "published"
  | "not_published";
export type RefundRequestStatus = "pending" | "approved" | "declined";
export type RefundDecision = "approved" | "declined";
export type DownloadFormat = "epub" | "mobi";

export interface LibraryItemReadModel {
  readonly id: string;
  readonly bookId: string;
  readonly title: string;
  readonly authorPublicName: string;
  readonly coverPath: string;
  readonly entitlementStatus: LibraryEntitlementStatus;
  readonly refundStatus: RefundRequestStatus | null;
  readonly reviewStatus: LibraryReviewStatus | null;
  readonly resolvedBookVersionId: string;
  readonly formats: readonly DownloadFormat[];
  readonly purchasedAt: string;
}

export interface LibraryReadModel {
  readonly schemaVersion: typeof LIBRARY_SCHEMA_VERSION;
  readonly items: readonly LibraryItemReadModel[];
}

export type BuyerReviewEligibility =
  | { readonly kind: "not_eligible" }
  | { readonly kind: "eligible"; readonly entitlementId: string }
  | { readonly kind: "pending_moderation" }
  | { readonly kind: "published" }
  | { readonly kind: "not_published" };

export interface RefundQueueItem {
  readonly id: string;
  readonly entitlementId: string;
  readonly buyerDisplayName: string;
  readonly buyerEmail: string | null;
  readonly bookId: string;
  readonly title: string;
  readonly reason: string;
  readonly amountKopiykas: number;
  readonly formattedAmount: string;
  readonly status: RefundRequestStatus;
  readonly requestedAt: string;
}

export interface RefundApprovedPayload {
  readonly schemaVersion: typeof LIBRARY_SCHEMA_VERSION;
  readonly refundRequestId: string;
  readonly refundDecisionId: string;
  readonly refundCompensationId: string;
  readonly entitlementId: string;
  readonly paidSaleId: string;
  readonly buyerUserId: string;
  readonly bookId: string;
  readonly amountKopiykas: number;
  readonly currency: "UAH";
  readonly approvedAt: string;
}
