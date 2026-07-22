import {
  ArrowLeft,
  BookOpenText,
  CheckCircle,
  ShieldCheck,
} from "@phosphor-icons/react/dist/ssr";
import { randomUUID } from "node:crypto";
import Image from "next/image";
import Link from "next/link";

import type {
  ManagerModerationCaseDetail,
  ManagerModerationQueueItem,
  ManagerModerationQueueReadModel,
  ModerationDecisionAction,
  ModerationSubjectType,
} from "../../modules/moderation/types";
import { AuroraStatusBadge } from "../aurora";

import { ModerationSubmitButton } from "./moderation-submit-button";
import { ModerationNotice } from "./moderation-notice";
import { RemovalDialog } from "./removal-dialog";
import styles from "./moderation.module.css";

const moderationDecisionEndpoint = "/admin/moderation/decision";

interface ModerationQueueScreenProps {
  readonly csrfToken: string;
  readonly detailOpen: boolean;
  readonly error?: string;
  readonly queue: ManagerModerationQueueReadModel;
  readonly result?: string;
  readonly decision?: string;
}

const subjectLabels: Record<ModerationSubjectType, string> = {
  book: "Книжка",
  book_update: "Оновлення книжки",
  review: "Відгук",
};

function formattedDate(value: string): string {
  return new Intl.DateTimeFormat("uk-UA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function queueHref(filter: string, caseId?: string): string {
  const query = new URLSearchParams();
  if (filter !== "all") query.set("type", filter);
  if (caseId) query.set("case", caseId);
  const suffix = query.toString();
  return suffix ? `/admin/moderation?${suffix}` : "/admin/moderation";
}

function primaryDecision(caseDetail: ManagerModerationCaseDetail): {
  readonly action: ModerationDecisionAction;
  readonly label: string;
} {
  if (caseDetail.subjectType === "book_update") {
    return { action: "approve_update", label: "Схвалити оновлення" };
  }
  if (caseDetail.subjectType === "review") {
    return { action: "publish_review", label: "Опублікувати відгук" };
  }
  if (caseDetail.isPublished) {
    return { action: "keep_published", label: "Залишити в Каталозі" };
  }
  return { action: "approve_publication", label: "Схвалити й опублікувати" };
}

function negativeDecision(caseDetail: ManagerModerationCaseDetail): {
  readonly action: ModerationDecisionAction;
  readonly label: string;
} {
  if (caseDetail.subjectType === "book_update") {
    return { action: "reject_update", label: "Відхилити оновлення" };
  }
  if (caseDetail.subjectType === "review") {
    return { action: "do_not_publish_review", label: "Не публікувати" };
  }
  return { action: "reject_publication", label: "Відхилити книжку" };
}

function resultMessage(result: string | undefined): string | null {
  if (result === "publication_approved") return "Книжку схвалено й опубліковано.";
  if (result === "update_approved") return "Оновлення схвалено.";
  if (result === "review_published") return "Відгук опубліковано.";
  if (result === "kept_published") return "Книжка залишається в Каталозі.";
  if (result === "publication_rejected") return "Книжку відхилено. Автор побачить Категорію причини.";
  if (result === "update_rejected") return "Оновлення відхилено. Автор побачить Категорію причини.";
  if (result === "review_rejected") return "Відгук не буде опубліковано.";
  if (result === "publication_removed") return "Книжку прибрано з Каталогу.";
  return null;
}

function QueueItem({
  filter,
  item,
  selected,
}: {
  readonly filter: string;
  readonly item: ManagerModerationQueueItem;
  readonly selected: boolean;
}) {
  return (
    <li className={styles.queueItem}>
      <Link
        aria-current={selected ? "true" : undefined}
        className={[styles.queueLink, selected && styles.queueLinkSelected].filter(Boolean).join(" ")}
        href={queueHref(filter, item.id)}
        prefetch={false}
      >
        <span className={styles.queueItemTop}>
          <span className={styles.subjectType}>{subjectLabels[item.subjectType]}</span>
          <time dateTime={item.submittedAt}>{formattedDate(item.submittedAt)}</time>
        </span>
        <span className={styles.queueItemTitle}>{item.title}</span>
        <span className={styles.queueItemMeta}>{item.authorPublicName}</span>
        <span className={styles.queueSignal}>
          {item.safeFail ? "ШІ-скринінг недоступний" : item.aiSignal}
        </span>
      </Link>
    </li>
  );
}

function DecisionHiddenFields({
  action,
  caseDetail,
  csrfToken,
  filter,
}: {
  readonly action: ModerationDecisionAction;
  readonly caseDetail: ManagerModerationCaseDetail;
  readonly csrfToken: string;
  readonly filter: string;
}) {
  return (
    <>
      <input name="caseId" type="hidden" value={caseDetail.id} />
      <input name="csrfToken" type="hidden" value={csrfToken} />
      <input name="decision" type="hidden" value={action} />
      <input name="expectedRevision" type="hidden" value={caseDetail.revision} />
      <input name="filter" type="hidden" value={filter} />
      <input name="idempotencyKey" type="hidden" value={randomUUID()} />
    </>
  );
}

function CaseDetail({
  caseDetail,
  csrfToken,
  decision,
  error,
  filter,
  queue,
}: {
  readonly caseDetail: ManagerModerationCaseDetail;
  readonly csrfToken: string;
  readonly decision?: string;
  readonly error?: string;
  readonly filter: string;
  readonly queue: ManagerModerationQueueReadModel;
}) {
  const primary = primaryDecision(caseDetail);
  const negative = negativeDecision(caseDetail);
  const rejectionError = decision === negative.action ? error : undefined;
  const removalError = decision === "remove_publication" ? error : undefined;
  return (
    <article aria-labelledby="moderation-case-title" className={styles.detailPanel}>
      <Link className={styles.detailBack} href={queueHref(filter)} prefetch={false}>
        <ArrowLeft aria-hidden="true" size={18} /> До черги
      </Link>
      <div className={styles.detailTop}>
        {caseDetail.coverUrl ? (
          <Image
            alt={`${caseDetail.title} — ${caseDetail.authorPublicName}`}
            className={styles.detailCover}
            height={144}
            src={caseDetail.coverUrl}
            unoptimized
            width={96}
          />
        ) : (
          <span aria-hidden="true" className={styles.coverPlaceholder}>
            <BookOpenText size={30} />
          </span>
        )}
        <div className={styles.detailHeading}>
          <span className={styles.subjectType}>{subjectLabels[caseDetail.subjectType]}</span>
          <h2 id="moderation-case-title">{caseDetail.title}</h2>
          <div className={styles.detailMeta}>
            <span>{caseDetail.authorPublicName}</span>
            <time dateTime={caseDetail.submittedAt}>{formattedDate(caseDetail.submittedAt)}</time>
          </div>
          <AuroraStatusBadge label="На ручній перевірці" tone="warning" />
        </div>
      </div>

      <section aria-labelledby="case-content-title" className={styles.detailSection}>
        <h3 id="case-content-title">
          {caseDetail.subjectType === "review" ? "Текст відгуку" : "Фрагмент матеріалу"}
        </h3>
        <p>{caseDetail.fragment}</p>
      </section>

      <section
        aria-labelledby="ai-signal-title"
        className={[styles.detailSection, styles.aiSignal, caseDetail.safeFail && styles.aiUnavailable].filter(Boolean).join(" ")}
      >
        <h3 id="ai-signal-title">Сигнал ШІ</h3>
        <p>
          {caseDetail.safeFail
            ? "Автоматичний скринінг недоступний. Випадок передано на ручну перевірку."
            : caseDetail.aiSignal}
        </p>
        <small>Сигнал ШІ не є остаточним рішенням.</small>
        {caseDetail.internalSignals.length > 0 ? (
          <ul className={styles.signalList} aria-label="Внутрішні сигнали">
            {caseDetail.internalSignals.map((signal) => (
              <li key={signal.code} data-severity={signal.severity}>{signal.label}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section aria-labelledby="case-decision-title" className={[styles.detailSection, styles.decisionArea].join(" ")}>
        <h3 id="case-decision-title">Рішення</h3>
        <form action={moderationDecisionEndpoint} className={styles.primaryDecision} method="post">
          <DecisionHiddenFields action={primary.action} caseDetail={caseDetail} csrfToken={csrfToken} filter={filter} />
          <ModerationSubmitButton pendingLabel="Зберігаємо рішення…">
            <CheckCircle aria-hidden="true" size={18} /> {primary.label}
          </ModerationSubmitButton>
        </form>

        {caseDetail.subjectType === "review" ? (
          <form action={moderationDecisionEndpoint} className={styles.negativeDecision} method="post">
            <DecisionHiddenFields action={negative.action} caseDetail={caseDetail} csrfToken={csrfToken} filter={filter} />
            {rejectionError ? (
              <p className={styles.fieldError} role="alert">
                Не вдалося зберегти рішення. Оновіть чергу й повторіть дію.
              </p>
            ) : null}
            <ModerationSubmitButton pendingLabel="Зберігаємо рішення…" variant="danger">
              {negative.label}
            </ModerationSubmitButton>
          </form>
        ) : !caseDetail.isPublished ? (
          <details className={styles.decisionDisclosure} open={Boolean(rejectionError)}>
            <summary>{negative.label}</summary>
            <form action={moderationDecisionEndpoint} className={styles.decisionForm} method="post">
              <DecisionHiddenFields action={negative.action} caseDetail={caseDetail} csrfToken={csrfToken} filter={filter} />
              <label htmlFor={`reason-${caseDetail.id}`}>Категорія причини</label>
              <select
                aria-describedby={rejectionError === "reason_required" ? `reason-error-${caseDetail.id}` : `reason-help-${caseDetail.id}`}
                aria-invalid={rejectionError === "reason_required" || undefined}
                autoFocus={rejectionError === "reason_required"}
                defaultValue=""
                id={`reason-${caseDetail.id}`}
                name="reasonCategoryCode"
              >
                <option disabled value="">Оберіть категорію</option>
                {queue.reasonCategories.map((category) => (
                  <option key={category.code} value={category.code}>{category.label}</option>
                ))}
              </select>
              <p className={styles.fieldHelp} id={`reason-help-${caseDetail.id}`}>
                Автор побачить лише цю коротку категорію, без внутрішніх сигналів.
              </p>
              {rejectionError === "reason_required" ? (
                <p className={styles.fieldError} id={`reason-error-${caseDetail.id}`} role="alert">
                  Оберіть Категорію причини.
                </p>
              ) : null}
              {rejectionError && rejectionError !== "reason_required" ? (
                <p className={styles.fieldError} role="alert">
                  Не вдалося зберегти рішення. Оновіть чергу й повторіть дію.
                </p>
              ) : null}
              <ModerationSubmitButton pendingLabel="Зберігаємо рішення…" variant="danger">
                {negative.label}
              </ModerationSubmitButton>
            </form>
          </details>
        ) : null}

        {caseDetail.subjectType === "book" && caseDetail.isPublished ? (
          <section aria-labelledby="remove-book-title" className={styles.dangerZone}>
            <h3 id="remove-book-title">Доступність книжки</h3>
            <p>Прибирання з Каталогу блокує нові покупки й потребує окремого підтвердження.</p>
            <RemovalDialog
              action={moderationDecisionEndpoint}
              caseDetail={caseDetail}
              csrfToken={csrfToken}
              error={removalError}
              filter={filter}
              idempotencyKey={randomUUID()}
              openOnLoad={Boolean(removalError)}
              removalGrounds={queue.removalGrounds}
            />
          </section>
        ) : null}
      </section>
    </article>
  );
}

export function ModerationQueueScreen({
  csrfToken,
  decision,
  detailOpen,
  error,
  queue,
  result,
}: ModerationQueueScreenProps) {
  const filter = queue.filters.selectedType;
  const message = resultMessage(result);
  const errorHandledInsideCase = Boolean(
    decision && [
      "reject_publication",
      "reject_update",
      "do_not_publish_review",
      "remove_publication",
    ].includes(decision),
  );
  return (
    <>
      <header className={styles.pageHeading}>
        <div>
          <p className={styles.eyebrow}>Менеджерський простір</p>
          <h1>Ручна перевірка</h1>
          <p>Ризикові випадки, які потребують рішення людини.</p>
        </div>
        <span className={styles.queueCount}>
          {queue.filters.counts.all} у черзі
        </span>
      </header>

      {message ? <ModerationNotice className={styles.notice} role="status">{message}</ModerationNotice> : null}
      {error && (!queue.selected || !errorHandledInsideCase) ? (
        <ModerationNotice className={[styles.notice, styles.noticeError].join(" ")} role="alert">
          Не вдалося виконати дію. Оновіть чергу й спробуйте ще раз.
        </ModerationNotice>
      ) : null}

      {queue.items.length === 0 ? (
        <section className={styles.emptyState}>
          <div>
            <span aria-hidden="true" className={styles.emptyIcon}><ShieldCheck size={30} /></span>
            <h2>Все перевірено</h2>
            <p>Нових Ризикових випадків у вибраному фільтрі немає.</p>
            {filter !== "all" ? <Link className={styles.secondaryLink} href="/admin/moderation" prefetch={false}>Показати всю чергу</Link> : null}
          </div>
        </section>
      ) : (
        <div className={styles.queueLayout} data-detail-open={detailOpen ? "true" : "false"}>
          <section aria-label="Ризикові випадки" className={styles.queuePanel}>
            <form action="/admin/moderation" className={styles.filterForm} method="get">
              <label htmlFor="moderation-type">Тип випадку</label>
              <div className={styles.filterRow}>
                <select defaultValue={filter} id="moderation-type" name="type">
                  <option value="all">Усі ({queue.filters.counts.all})</option>
                  <option value="book">Книжки ({queue.filters.counts.book})</option>
                  <option value="book_update">Оновлення ({queue.filters.counts.book_update})</option>
                  <option value="review">Відгуки ({queue.filters.counts.review})</option>
                </select>
                <button className={styles.filterButton} type="submit">Застосувати</button>
              </div>
            </form>
            <ol className={styles.queueList}>
              {queue.items.map((item) => (
                <QueueItem filter={filter} item={item} key={item.id} selected={queue.selected?.id === item.id} />
              ))}
            </ol>
          </section>

          {queue.selected ? (
            <CaseDetail
              caseDetail={queue.selected}
              csrfToken={csrfToken}
              decision={decision}
              error={error}
              filter={filter}
              queue={queue}
            />
          ) : (
            <section className={styles.emptyState}>
              <div>
                <span aria-hidden="true" className={styles.emptyIcon}><BookOpenText size={30} /></span>
                <h2>Оберіть випадок</h2>
                <p>Деталі та доступні рішення зʼявляться тут.</p>
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}
