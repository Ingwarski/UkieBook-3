"use client";

import { useRef, useState } from "react";

import styles from "./library.module.css";

interface RefundRequestDialogProps {
  readonly csrfToken: string;
  readonly entitlementId: string;
}

export function RefundRequestDialog({
  csrfToken,
  entitlementId,
}: RefundRequestDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  return (
    <>
      <button
        className={styles.refundAction}
        onClick={() => dialogRef.current?.showModal()}
        type="button"
      >
        Запит на повернення
      </button>
      <dialog aria-labelledby={`refund-title-${entitlementId}`} className={styles.refundDialog} ref={dialogRef}>
        <form action="/api/library/refunds" method="post">
          <input name="csrfToken" type="hidden" value={csrfToken} />
          <input name="entitlementId" type="hidden" value={entitlementId} />
          <input name="idempotencyKey" type="hidden" value={idempotencyKey} />
          <header>
            <p className={styles.eyebrow}>Повернення</p>
            <h2 id={`refund-title-${entitlementId}`}>Поясніть причину</h2>
            <p>Менеджер перевірить заявку. До рішення книжка лишається доступною.</p>
          </header>
          <label htmlFor={`refund-reason-${entitlementId}`}>
            Причина повернення
          </label>
          <textarea
            id={`refund-reason-${entitlementId}`}
            minLength={10}
            name="reason"
            required
            rows={5}
          />
          <div className={styles.dialogActions}>
            <button className={styles.primaryAction} type="submit">
              Надіслати заявку
            </button>
            <button
              className={styles.secondaryAction}
              onClick={() => dialogRef.current?.close()}
              type="button"
            >
              Скасувати
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
