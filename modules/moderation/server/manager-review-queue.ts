import "server-only";

import type { SqlDatabase } from "../../platform/sql-port";
import type { PrivateObjectStorage } from "../../publishing/storage/private-object-storage";
import type {
  ManagerModerationQueueReadModel,
  ModerationSubjectType,
} from "../types";
import { loadManagerModerationQueue } from "./service";
import {
  findModerationReviewCase,
  listPendingModerationReviewCases,
  managerReviewCaseDetail,
  managerReviewQueueItem,
} from "./review-moderation";

export async function loadManagerModerationQueueIncludingReviews(
  database: SqlDatabase,
  storage: PrivateObjectStorage,
  options: {
    readonly subjectType?: ModerationSubjectType | "all";
    readonly selectedCaseId?: string | null;
  } = {},
): Promise<ManagerModerationQueueReadModel> {
  const selectedType = options.subjectType ?? "all";
  const base = await loadManagerModerationQueue(database, storage, options);
  const reviewCases = selectedType === "book" || selectedType === "book_update"
    ? []
    : await listPendingModerationReviewCases(database);
  const items = [
    ...base.items,
    ...reviewCases.map(managerReviewQueueItem),
  ].sort((left, right) =>
    left.submittedAt.localeCompare(right.submittedAt) || left.id.localeCompare(right.id),
  );
  const selectedId = options.selectedCaseId ?? items[0]?.id ?? null;
  if (!selectedId) return { ...base, items, selected: null };

  const reviewCase = await findModerationReviewCase(database, selectedId);
  if (
    reviewCase?.status === "manual_review_pending" &&
    (selectedType === "all" || selectedType === "review")
  ) {
    return {
      ...base,
      items,
      selected: managerReviewCaseDetail(reviewCase),
    };
  }
  return {
    ...base,
    items,
    selected: base.selected?.id === selectedId ? base.selected : null,
  };
}
