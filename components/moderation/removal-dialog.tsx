"use client";

import { WarningOctagon } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";

import type {
  ManagerModerationCaseDetail,
  RemovalGroundOption,
} from "../../modules/moderation/types";
import { AuroraButton } from "../aurora";

import { ModerationSubmitButton } from "./moderation-submit-button";
import styles from "./moderation.module.css";

interface RemovalDialogProps {
  readonly action: string;
  readonly caseDetail: ManagerModerationCaseDetail;
  readonly csrfToken: string;
  readonly error?: string;
  readonly filter: string;
  readonly idempotencyKey: string;
  readonly openOnLoad?: boolean;
  readonly removalGrounds: readonly RemovalGroundOption[];
}

export function RemovalDialog({
  action,
  caseDetail,
  csrfToken,
  error,
  filter,
  idempotencyKey,
  openOnLoad = false,
  removalGrounds,
}: RemovalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const groundRef = useRef<HTMLSelectElement>(null);

  function openDialog() {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (!dialog?.open) dialog?.showModal();
    requestAnimationFrame(() => groundRef.current?.focus());
  }

  function closeDialog() {
    dialogRef.current?.close();
    previousFocusRef.current?.focus();
  }

  useEffect(() => {
    if (openOnLoad) openDialog();
  }, [openOnLoad]);

  return (
    <>
      <AuroraButton
        className={styles.removeTrigger}
        onClick={openDialog}
        type="button"
        variant="danger"
      >
        <WarningOctagon aria-hidden="true" size={18} /> Прибрати з Каталогу
      </AuroraButton>
      <dialog
        aria-labelledby="remove-publication-title"
        className={styles.dialog}
        onCancel={(event) => {
          event.preventDefault();
          closeDialog();
        }}
        ref={dialogRef}
      >
        <h2 id="remove-publication-title">Прибрати книжку з Каталогу?</h2>
        <p>
          Нові покупки стануть неможливими. Уже придбані EPUB і MOBI залишаться
          в бібліотеках покупців.
        </p>
        <form action={action} className={styles.decisionForm} method="post">
          <input name="decision" type="hidden" value="remove_publication" />
          <input name="caseId" type="hidden" value={caseDetail.id} />
          <input name="csrfToken" type="hidden" value={csrfToken} />
          <input name="expectedRevision" type="hidden" value={caseDetail.revision} />
          <input name="filter" type="hidden" value={filter} />
          <input name="idempotencyKey" type="hidden" value={idempotencyKey} />
          <input name="confirmed" type="hidden" value="true" />

          <label htmlFor="removal-ground">Підстава</label>
          <select
            aria-describedby={error === "removal_ground_required" ? "removal-ground-error" : undefined}
            aria-invalid={error === "removal_ground_required" || undefined}
            defaultValue=""
            id="removal-ground"
            name="removalGround"
            ref={groundRef}
            required
          >
            <option disabled value="">Оберіть підставу</option>
            {removalGrounds.map((ground) => (
              <option key={ground.code} value={ground.code}>{ground.label}</option>
            ))}
          </select>
          {error === "removal_ground_required" ? (
            <p className={styles.fieldError} id="removal-ground-error" role="alert">
              Оберіть підставу прибирання книжки.
            </p>
          ) : null}

          {error && error !== "removal_ground_required" ? (
            <p className={styles.fieldError} role="alert">
              Не вдалося прибрати книжку. Оновіть чергу й повторіть дію.
            </p>
          ) : null}

          <div className={styles.dialogActions}>
            <AuroraButton onClick={closeDialog} type="button" variant="secondary">
              Скасувати
            </AuroraButton>
            <ModerationSubmitButton pendingLabel="Прибираємо…" variant="danger">
              Прибрати з Каталогу
            </ModerationSubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
