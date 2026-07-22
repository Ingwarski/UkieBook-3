import type { Metadata } from "next";

import {
  AURORA_BASELINE_ID,
  AURORA_TARGET_BUNDLE_HASH,
  AuroraButton,
  AuroraField,
  AuroraGlassSurface,
  AuroraIconButton,
  AuroraStatusBadge,
  auroraTokens,
} from "../../../components/aurora";

import styles from "./fixture.module.css";

export const metadata: Metadata = {
  title: "Aurora token fixture",
  robots: {
    follow: false,
    index: false,
  },
};

const swatches = [
  ["Теплий фон", auroraTokens.color.background],
  ["Текст", auroraTokens.color.text],
  ["Brand accent", auroraTokens.color.accent],
  ["Gradient start", auroraTokens.color.gradientStart],
  ["Gradient end", auroraTokens.color.gradientEnd],
  ["Formula platform · 35%", auroraTokens.color.formulaPlatform],
] as const;

export default function AuroraFixturePage() {
  return (
    <main
      className={styles.fixture}
      data-baseline-id={AURORA_BASELINE_ID}
      data-target-bundle-hash={AURORA_TARGET_BUNDLE_HASH}
    >
      <div className={styles.content}>
        <header className={styles.intro}>
          <p className={styles.eyebrow}>VIS-TOKENS · UNIT-00</p>
          <h1>Aurora Pastel 7b foundation</h1>
          <p>
            Непродуктовий fixture для перевірки токенів, фокусу, семантичних станів і
            доступних базових контролів.
          </p>
          <code className={styles.baseline}>
            {AURORA_BASELINE_ID} · {AURORA_TARGET_BUNDLE_HASH}
          </code>
        </header>

        <AuroraGlassSurface as="section" aria-labelledby="fixture-colors" className={styles.section}>
          <h2 id="fixture-colors">Source tokens</h2>
          <p className={styles.sectionDescription}>
            Значення відтворюють затверджений V3 Design Spine без підміни палітри.
          </p>
          <div className={styles.swatches}>
            {swatches.map(([label, color]) => (
              <div className={styles.swatch} key={label} style={{ background: color }}>
                <strong>{label}</strong>
                <code>{color}</code>
              </div>
            ))}
          </div>
        </AuroraGlassSurface>

        <AuroraGlassSurface as="section" aria-labelledby="fixture-controls" className={styles.section}>
          <h2 id="fixture-controls">Accessible controls</h2>
          <p className={styles.sectionDescription}>
            Усі інтерактивні цілі мають щонайменше 44×44px і видимий keyboard focus.
          </p>
          <div className={styles.actions}>
            <AuroraButton>Основна дія</AuroraButton>
            <AuroraButton variant="secondary">Другорядна</AuroraButton>
            <AuroraButton busy>Збереження</AuroraButton>
            <AuroraButton disabled>Недоступна</AuroraButton>
            <AuroraIconButton aria-label="Пошук">
              <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
                <path d="m16 16 4 4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
              </svg>
            </AuroraIconButton>
          </div>
          <div className={styles.formExample}>
            <AuroraField
              description="Постійна підказка лишається пов’язаною з полем."
              id="fixture-title"
              label="Назва книжки"
              placeholder="Наприклад, Хроніки степу"
              required
            />
          </div>
        </AuroraGlassSurface>

        <AuroraGlassSurface as="section" aria-labelledby="fixture-states" className={styles.section}>
          <h2 id="fixture-states">Textual status semantics</h2>
          <p className={styles.sectionDescription}>
            Колір підсилює стан, але його значення завжди присутнє текстом.
          </p>
          <div className={styles.statuses}>
            <AuroraStatusBadge label="Опубліковано" tone="success" />
            <AuroraStatusBadge label="Очікує перевірки" tone="warning" />
            <AuroraStatusBadge label="Потрібна дія" tone="error" />
            <AuroraStatusBadge label="Чернетка" tone="info" />
          </div>
          <div className={styles.formExample}>
            <AuroraField
              error="Укажіть назву — введені дані не втрачено."
              id="fixture-error"
              label="Приклад помилки"
              required
            />
          </div>
        </AuroraGlassSurface>
      </div>
    </main>
  );
}
