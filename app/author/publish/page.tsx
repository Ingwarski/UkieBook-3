import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PublishWizard } from "../../../components/publishing";
import { requireProtectedPath } from "../../../modules/identity/server/guard";
import { identityRuntime } from "../../../modules/identity/server/runtime";
import { readServerEnvironment } from "../../../modules/platform/environment/server";
import { listGenres } from "../../../modules/publishing/server/repository";
import {
  createAuthorDraft,
  loadAuthorDraft,
  loadLatestAuthorDraft,
  PublishingInputError,
} from "../../../modules/publishing/server/service";
import { publishingPrivateObjectStorage } from "../../../modules/publishing/storage/runtime";

export const metadata: Metadata = { title: "Нова книжка" };
export const dynamic = "force-dynamic";

interface PublishPageProps {
  readonly searchParams: Promise<{
    readonly created?: string | string[];
    readonly draft?: string | string[];
    readonly error?: string | string[];
    readonly saved?: string | string[];
    readonly step?: string | string[];
  }>;
}

const errorMessages: Readonly<Record<string, string>> = {
  broken_manuscript: "Не вдалося прочитати рукопис. Завантажте справний DOCX або TXT.",
  conflict: "Чернетка змінилася в іншій вкладці. Оновіть сторінку, перш ніж продовжити.",
  confirmations_required: "Окремо підтвердьте Декларацію прав і пʼятирічну ліцензійну умову.",
  genre: "Оберіть один жанр зі списку.",
  incomplete: "Завершіть попередні кроки — чернетка лишилася збереженою.",
  preview_required: "Спершу перевірте готове видання.",
  price: "Укажіть коректну ціну в гривнях.",
  required: "Заповніть усі обовʼязкові поля.",
  sample: "Оберіть розділ для безкоштовного фрагмента.",
  save_failed: "Не вдалося зберегти зміни. Чернетку не втрачено.",
  too_long: "Одне з полів перевищує допустиму довжину.",
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function stepNumber(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(6, Math.max(1, parsed)) : 1;
}

export default async function PublishPage({ searchParams }: PublishPageProps) {
  const context = await requireProtectedPath("/author/publish");
  const runtime = identityRuntime();
  const environment = readServerEnvironment();
  const storage = publishingPrivateObjectStorage();
  const query = await searchParams;
  const requestedDraft = first(query.draft);
  let draft;
  try {
    draft = requestedDraft
      ? await loadAuthorDraft(runtime.database, storage, context!.session.userId, requestedDraft)
      : await loadLatestAuthorDraft(runtime.database, storage, context!.session.userId);
  } catch (error) {
    if (error instanceof PublishingInputError) redirect("/author/books?error=draft_not_found");
    throw error;
  }
  draft ??= await createAuthorDraft(runtime.database, storage, context!.session.userId);
  if (draft.status === "submitted") redirect("/author/books");
  let step = stepNumber(first(query.step));
  if (step > 1 && !draft.manuscriptObjectId) step = 1;
  if (step > 2 && (!draft.title.trim() || draft.title === "Нова книжка" || !draft.description.trim())) step = 2;
  if (step > 3 && !draft.coverObjectId) step = 3;
  if (
    step > 4 &&
    (!draft.genreSlug || draft.basePriceKopiykas === null)
  ) step = 4;
  if (
    step === 6 &&
    (
      draft.status !== "ready" ||
      !draft.preview ||
      draft.sampleSectionIndex === null ||
      draft.samplePreviewArtifactId !== draft.preview.artifactId
    )
  ) {
    redirect(`/author/publish/preview?draft=${encodeURIComponent(draft.draftId)}`);
  }
  const genres = await listGenres(runtime.database);
  return (
    <PublishWizard
      csrfToken={context!.csrfToken}
      draft={draft}
      error={first(query.error) ? errorMessages[first(query.error)!] ?? errorMessages.save_failed : undefined}
      genres={genres}
      priceHint={{
        maxKopiykas: environment.PUBLISHING_PRICE_HINT_MAX_KOPIYKAS,
        minKopiykas: environment.PUBLISHING_PRICE_HINT_MIN_KOPIYKAS,
      }}
      saved={first(query.saved) === "1" || first(query.created) === "1"}
      step={step}
    />
  );
}
