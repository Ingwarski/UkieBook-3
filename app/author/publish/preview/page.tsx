import { ArrowLeft, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuroraButton } from "../../../../components/aurora";
import {
  AuthorShell,
  PreviewPending,
  PreviewWorkspace,
} from "../../../../components/publishing";
import { PublishingErrorNotice } from "../../../../components/publishing/error-notice";
import styles from "../../../../components/publishing/publishing.module.css";
import { requireProtectedPath } from "../../../../modules/identity/server/guard";
import { identityRuntime } from "../../../../modules/identity/server/runtime";
import { loadAuthorDraft, PublishingInputError } from "../../../../modules/publishing/server/service";
import { publishingPrivateObjectStorage } from "../../../../modules/publishing/storage/runtime";
import { retryConversionAction, saveSampleSectionAction } from "../actions";

export const metadata: Metadata = { title: "Попередній перегляд видання" };
export const dynamic = "force-dynamic";

interface PreviewPageProps {
  readonly searchParams: Promise<{
    readonly draft?: string | string[];
    readonly error?: string | string[];
  }>;
}

const errorMessages: Readonly<Record<string, string>> = {
  conflict: "Чернетка змінилася в іншій вкладці. Оновіть сторінку й оберіть фрагмент ще раз.",
  preview_required: "Дочекайтеся готового попереднього перегляду.",
  sample: "Оберіть один із реальних розділів готового видання.",
  sample_stale: "Попередній перегляд змінився. Оберіть безкоштовний фрагмент ще раз.",
  save_failed: "Не вдалося зберегти фрагмент. Чернетку не втрачено.",
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PublishingPreviewPage({ searchParams }: PreviewPageProps) {
  const context = await requireProtectedPath("/author/publish/preview");
  const query = await searchParams;
  const draftId = first(query.draft);
  if (!draftId) redirect("/author/publish");
  const runtime = identityRuntime();
  let draft;
  try {
    draft = await loadAuthorDraft(
      runtime.database,
      publishingPrivateObjectStorage(),
      context!.session.userId,
      draftId,
    );
  } catch (error) {
    if (error instanceof PublishingInputError) redirect("/author/books?error=draft_not_found");
    throw error;
  }
  if (draft.status === "submitted") redirect("/author/books");
  if (draft.status === "draft" && !draft.preview) {
    redirect(`/author/publish?draft=${encodeURIComponent(draft.draftId)}&step=4`);
  }
  return (
    <AuthorShell active="publish" csrfToken={context!.csrfToken}>
      <div className={styles.previewWorkspace}>
        <header className={styles.previewHeader}>
          <p className={styles.eyebrow}>Крок 5 з 6</p>
          <h1>Попередній перегляд видання</h1>
          <p>Перевірте структуру, ілюстрації, обкладинку, опис і майбутню Сторінку книжки. Це контроль якості — не внутрішня читалка й не опублікована сторінка.</p>
        </header>
        {first(query.error) ? (
          <PublishingErrorNotice
            message={errorMessages[first(query.error)!] ?? errorMessages.save_failed!}
          />
        ) : null}
        {draft.status === "conversion_failed" ? (
          <section
            aria-labelledby="conversion-error-title"
            className={[styles.panel, styles.errorState].join(" ")}
            role="alert"
          >
            <div>
              <WarningCircle aria-hidden="true" size={54} />
              <h2 id="conversion-error-title">Не вдалося підготувати видання</h2>
              <p>{draft.conversionFailure?.message ?? "Чернетку збережено. Спробуйте ще раз або завантажте інший файл."}</p>
              <form action={retryConversionAction}>
                <input name="csrfToken" type="hidden" value={context!.csrfToken} />
                <input name="draftId" type="hidden" value={draft.draftId} />
                <AuroraButton type="submit">Спробувати ще раз</AuroraButton>
              </form>
              <Link className={styles.textLink} href={`/author/publish?draft=${encodeURIComponent(draft.draftId)}&step=1`}><ArrowLeft aria-hidden="true" size={17} /> Завантажити інший файл</Link>
            </div>
          </section>
        ) : draft.preview ? (
          <PreviewWorkspace
            csrfToken={context!.csrfToken}
            draft={{ ...draft, preview: draft.preview }}
            saveSampleAction={saveSampleSectionAction}
          />
        ) : (
          <PreviewPending />
        )}
      </div>
    </AuthorShell>
  );
}
