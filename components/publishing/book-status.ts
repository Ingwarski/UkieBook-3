import type { AuroraStatusTone } from "../aurora";
import type {
  PublishingBookStatus,
  PublishingDraftStatus,
} from "../../modules/publishing/types";

export type AuthorBookLifecycleStatus =
  | PublishingBookStatus
  | "removed"
  | "unavailable";

export interface AuthorBookStatusPresentation {
  readonly label: string;
  readonly tone: AuroraStatusTone;
}

export function authorBookStatusPresentation(
  status: AuthorBookLifecycleStatus,
  draftStatus: PublishingDraftStatus | null = null,
): AuthorBookStatusPresentation {
  if (status === "draft") {
    if (draftStatus === "converting") {
      return { label: "Конвертується", tone: "info" };
    }
    if (draftStatus === "conversion_failed") {
      return { label: "Потрібна увага", tone: "error" };
    }
    return { label: "Чернетка", tone: "info" };
  }
  if (status === "submitted") {
    return { label: "На модерації", tone: "info" };
  }
  if (status === "manual_review") {
    return { label: "На ручній перевірці", tone: "warning" };
  }
  if (status === "rejected") {
    return { label: "Відхилено", tone: "error" };
  }
  if (status === "removed" || status === "unavailable") {
    return { label: "Прибрано з Каталогу", tone: "error" };
  }
  return { label: "Опубліковано", tone: "success" };
}
