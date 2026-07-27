export interface CommerceViewerModel {
  readonly cartCount: number;
  readonly isAuthor: boolean;
  readonly signedIn: boolean;
}

export interface CommerceBookItemViewModel {
  readonly authorName: string;
  readonly bookId: string;
  readonly coverSrc: string;
  readonly discountLabel?: string | null;
  readonly formattedActualPrice: string;
  readonly formattedBasePrice: string;
  readonly title: string;
}

export interface CartScreenModel extends CommerceViewerModel {
  readonly cartEditable: boolean;
  readonly checkoutAllowed: boolean;
  readonly checkoutBlockReason?: string;
  readonly csrfToken?: string;
  readonly errorMessage?: string;
  readonly formattedTotal: string;
  readonly items: readonly CommerceBookItemViewModel[];
  readonly noticeMessage?: string;
}

export type CheckoutResultState = "failure" | "pending" | "success";
export type PurchaseEmailStatus = "failed" | "queued" | "sent";

export interface CheckoutResultScreenModel extends CommerceViewerModel {
  readonly emailStatus?: PurchaseEmailStatus | null;
  readonly failureMessage?: string;
  readonly formattedTotal: string;
  readonly items: readonly CommerceBookItemViewModel[];
  readonly refreshHref?: string;
  readonly state: CheckoutResultState;
}
