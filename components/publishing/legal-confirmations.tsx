"use client";

import { PaperPlaneTilt } from "@phosphor-icons/react";
import { useState } from "react";

import { AuroraButton } from "../aurora";

import styles from "./publishing.module.css";

interface LegalConfirmationsProps {
  readonly action: (formData: FormData) => void | Promise<void>;
  readonly csrfToken: string;
  readonly draftId: string;
}

export function LegalConfirmations({ action, csrfToken, draftId }: LegalConfirmationsProps) {
  const [rights, setRights] = useState(false);
  const [license, setLicense] = useState(false);
  const ready = rights && license;
  return (
    <form action={action} className={styles.legalStack}>
      <input name="csrfToken" type="hidden" value={csrfToken} />
      <input name="draftId" type="hidden" value={draftId} />
      <section className={styles.legalBlock}>
        <h3>Декларація прав</h3>
        <p>Ви зберігаєте майнові права на книжку й підтверджуєте, що маєте права або законну ліцензію на:</p>
        <ul><li>текст рукопису;</li><li>обкладинку;</li><li>усі завантажені зображення.</li></ul>
        <label className={styles.confirmation}>
          <input checked={rights} name="rightsConfirmed" onChange={(event) => setRights(event.currentTarget.checked)} type="checkbox" />
          <span>Підтверджую Декларацію прав на текст, обкладинку та зображення.</span>
        </label>
      </section>
      <section className={styles.legalBlock}>
        <h3>Невиключне право на 5 років</h3>
        <p>UkieBook отримує невиключне право розповсюджувати книжку у власному каталозі протягом 5 років. Автор не може зняти її з продажу раніше завершення цього строку.</p>
        <label className={styles.confirmation}>
          <input checked={license} name="fiveYearLicenseConfirmed" onChange={(event) => setLicense(event.currentTarget.checked)} type="checkbox" />
          <span>Окремо приймаю пʼятирічну невиключну ліцензійну умову та її наслідки.</span>
        </label>
      </section>
      <p aria-live="polite" className={styles.submitExplanation}>
        {ready ? "Обидва підтвердження надано. Книжку можна подати." : "Щоб подати книжку, надайте обидва окремі підтвердження."}
      </p>
      <AuroraButton disabled={!ready} type="submit"><PaperPlaneTilt aria-hidden="true" size={19} /> Подати книжку</AuroraButton>
    </form>
  );
}
