import type { AuthorBookListItem } from "../../modules/publishing/types";

const previewStatuses = new Set<AuthorBookListItem["draftStatus"]>([
  "converting",
  "conversion_failed",
  "ready",
]);

export function publishingDraftResumeHref(
  book: Pick<
    AuthorBookListItem,
    "currentStep" | "draftId" | "draftStatus" | "status"
  >,
): string | null {
  if (book.status !== "draft" || !book.draftId) return null;

  const draftId = encodeURIComponent(book.draftId);
  if (previewStatuses.has(book.draftStatus)) {
    return `/author/publish/preview?draft=${draftId}`;
  }

  const currentStep = Math.min(6, Math.max(1, book.currentStep ?? 1));
  return `/author/publish?draft=${draftId}&step=${currentStep}`;
}
