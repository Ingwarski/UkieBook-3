import { randomUUID } from "node:crypto";

import type { RefundQueueItem } from "../../modules/library/types";

import styles from "./refund-queue.module.css";

interface RefundQueueScreenProps {
  readonly csrfToken: string;
  readonly items: readonly RefundQueueItem[];
  readonly result?: string;
}

function formattedDate(value: string): string {
  return new Intl.DateTimeFormat("uk-UA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function RefundDecisionForm({
  csrfToken,
  decision,
  item,
}: {
  readonly csrfToken: string;
  readonly decision: "approved" | "declined";
  readonly item: RefundQueueItem;
}) {
  return (
    <form action="/admin/refunds/decision" className={styles.decisionForm} method="post">
      <input name="csrfToken" type="hidden" value={csrfToken} />
      <input name="decision" type="hidden" value={decision} />
      <input name="idempotencyKey" type="hidden" value={randomUUID()} />
      <input name="refundRequestId" type="hidden" value={item.id} />
      <label htmlFor={`${decision}-note-${item.id}`}>Коментар для аудиту (необовʼязково)</label>
      <textarea id={`${decision}-note-${item.id}`} maxLength={1200} name="decisionNote" rows={2} />
      <button data-decision={decision} type="submit">
        {decision === "approved" ? "Схвалити повернення" : "Відхилити заявку"}
      </button>
    </form>
  );
}

export function RefundQueueScreen({ csrfToken, items, result }: RefundQueueScreenProps) {
  return (
    <section aria-labelledby="refunds-title" className={styles.refundsPage}>
      <p className={styles.eyebrow}>Після покупки</p>
      <div className={styles.heading}>
        <div>
          <h1 id="refunds-title">Повернення</h1>
          <p>Рішення створює одну компенсацію та одразу закриває доступ до файлів.</p>
        </div>
        <span aria-label={`Заявок у черзі: ${items.length}`}>{items.length}</span>
      </div>
      {result === "approved" ? <p className={styles.notice} role="status">Повернення схвалено, компенсацію зафіксовано.</p> : null}
      {result === "declined" ? <p className={styles.notice} role="status">У поверненні відмовлено.</p> : null}
      {result === "error" ? <p className={styles.error} role="alert">Не вдалося зберегти рішення. Оновіть сторінку та повторіть.</p> : null}
      {items.length ? (
        <ol className={styles.queue}>
          {items.map((item) => (
            <li className={styles.item} key={item.id}>
              <header>
                <div>
                  <p className={styles.eyebrow}>Покупець · {item.buyerDisplayName}</p>
                  <h2>{item.title}</h2>
                  <time dateTime={item.requestedAt}>{formattedDate(item.requestedAt)}</time>
                </div>
                <strong>{item.formattedAmount}</strong>
              </header>
              <blockquote>{item.reason}</blockquote>
              <div className={styles.decisions}>
                <RefundDecisionForm csrfToken={csrfToken} decision="approved" item={item} />
                <RefundDecisionForm csrfToken={csrfToken} decision="declined" item={item} />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <section className={styles.emptyState}>
          <h2>Черга порожня</h2>
          <p>Нові заявки покупців з’являться тут.</p>
        </section>
      )}
    </section>
  );
}
