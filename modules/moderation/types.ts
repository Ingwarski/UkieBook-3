export const MODERATION_SCHEMA_VERSION = 1 as const;
export const MODERATION_POLICY_VERSION = 1 as const;
export const MODERATION_JOB_TYPE = "moderation.screen.v1" as const;
export const MODERATION_JOB_VERSION = 1 as const;
export const MODERATION_QUEUE = "publishing" as const;

export const MODERATION_SUBJECT_TYPES = ["book", "book_update", "review"] as const;
export type ModerationSubjectType = (typeof MODERATION_SUBJECT_TYPES)[number];

export const MODERATION_CASE_STATUSES = [
  "screening_pending",
  "manual_review_pending",
  "cleared",
  "approved",
  "rejected",
  "removed",
] as const;
export type ModerationCaseStatus = (typeof MODERATION_CASE_STATUSES)[number];

export type ModerationTriggerType = "submission" | "post_publication_risk";
export type ModerationScreeningResult = "clear" | "flagged" | "provider_error";
export type ModerationSignalSeverity = "info" | "warning" | "critical";

export const REASON_CATEGORY_LABELS = {
  content_restriction: "Обмеження щодо вмісту",
  spam: "Ознаки спаму",
  technical_issue: "Технічна проблема видання",
  rights_confirmation_required: "Потрібне підтвердження прав",
  platform_requirements: "Невідповідність вимогам платформи",
  legal_restriction: "Правове обмеження",
} as const;

export type ReasonCategoryCode = keyof typeof REASON_CATEGORY_LABELS;
export const REASON_CATEGORY_COPY_VERSION = 1 as const;

export interface ReasonCategoryOption {
  readonly code: ReasonCategoryCode;
  readonly label: string;
  readonly copyVersion: typeof REASON_CATEGORY_COPY_VERSION;
}

export const REASON_CATEGORY_OPTIONS: readonly ReasonCategoryOption[] = Object.entries(
  REASON_CATEGORY_LABELS,
).map(([code, label]) => ({
  code: code as ReasonCategoryCode,
  copyVersion: REASON_CATEGORY_COPY_VERSION,
  label,
}));

export const REMOVAL_GROUND_LABELS = {
  legal_violation: "Порушення закону",
  copyright_violation: "Порушення авторських прав",
  platform_rules_violation: "Порушення правил платформи",
} as const;

export type RemovalGround = keyof typeof REMOVAL_GROUND_LABELS;

export interface RemovalGroundOption {
  readonly code: RemovalGround;
  readonly label: string;
}

export const REMOVAL_GROUND_OPTIONS: readonly RemovalGroundOption[] = Object.entries(
  REMOVAL_GROUND_LABELS,
).map(([code, label]) => ({ code: code as RemovalGround, label }));

export const MODERATION_DECISION_ACTIONS = [
  "approve_publication",
  "reject_publication",
  "keep_published",
  "remove_publication",
  "approve_update",
  "reject_update",
  "publish_review",
  "do_not_publish_review",
] as const;
export type ModerationDecisionAction = (typeof MODERATION_DECISION_ACTIONS)[number];

export type BookLifecycleStatus =
  | "submitted"
  | "manual_review"
  | "rejected"
  | "published"
  | "unavailable";

export type BookPublicationAvailability =
  | "not_published"
  | "published"
  | "unavailable";

export interface AuthorBookManagementReadModel {
  readonly id: string;
  readonly title: string;
  readonly authorPublicName: string;
  readonly coverUrl: string | null;
  readonly status: BookLifecycleStatus;
  readonly availability: BookPublicationAvailability;
  readonly reasonCategory: ReasonCategoryOption | null;
  readonly updatedAt: string;
  readonly publicHref: string | null;
}

export interface ModerationInternalSignal {
  readonly code: string;
  readonly label: string;
  readonly severity: ModerationSignalSeverity;
}

export interface ManagerModerationQueueItem {
  readonly id: string;
  readonly revision: number;
  readonly subjectType: ModerationSubjectType;
  readonly status: "manual_review_pending";
  readonly title: string;
  readonly authorPublicName: string;
  readonly coverUrl: string | null;
  readonly aiSignal: string;
  readonly safeFail: boolean;
  readonly submittedAt: string;
  readonly isPublished: boolean;
}

export interface ManagerModerationCaseDetail extends ManagerModerationQueueItem {
  readonly fragment: string;
  readonly internalSignals: readonly ModerationInternalSignal[];
}

export interface ManagerModerationQueueReadModel {
  readonly filters: {
    readonly selectedType: ModerationSubjectType | "all";
    readonly counts: {
      readonly all: number;
      readonly book: number;
      readonly book_update: number;
      readonly review: number;
    };
  };
  readonly items: readonly ManagerModerationQueueItem[];
  readonly selected: ManagerModerationCaseDetail | null;
  readonly reasonCategories: readonly ReasonCategoryOption[];
  readonly removalGrounds: readonly RemovalGroundOption[];
}

export interface ModerationScreeningInput {
  readonly schemaVersion: typeof MODERATION_SCHEMA_VERSION;
  readonly policyVersion: typeof MODERATION_POLICY_VERSION;
  readonly caseId: string;
  readonly bookId: string;
  readonly bookVersionId: string;
  readonly title: string;
  readonly description: string;
  readonly text: string;
  readonly artifactHashes: readonly string[];
}

export interface AiModerationClearResult {
  readonly result: "clear";
  readonly providerRequestId?: string;
}

export interface AiModerationFlaggedResult {
  readonly result: "flagged";
  readonly providerRequestId?: string;
  readonly signals: readonly ModerationInternalSignal[];
}

export type AiModerationResult = AiModerationClearResult | AiModerationFlaggedResult;

export interface ModerationScreeningJobPayload {
  readonly caseId: string;
  readonly schemaVersion: typeof MODERATION_SCHEMA_VERSION;
}

export function isReasonCategoryCode(value: unknown): value is ReasonCategoryCode {
  return typeof value === "string" && Object.hasOwn(REASON_CATEGORY_LABELS, value);
}

export function isRemovalGround(value: unknown): value is RemovalGround {
  return typeof value === "string" && Object.hasOwn(REMOVAL_GROUND_LABELS, value);
}

export function reasonCategoryOption(code: ReasonCategoryCode): ReasonCategoryOption {
  return {
    code,
    copyVersion: REASON_CATEGORY_COPY_VERSION,
    label: REASON_CATEGORY_LABELS[code],
  };
}
