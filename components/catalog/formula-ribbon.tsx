import styles from "./catalog.module.css";

export function FormulaRibbon() {
  return (
    <section aria-labelledby="formula-title" className={styles.formula}>
      <h2 className={styles.formulaLabel} id="formula-title">
        Прозора формула: з кожних 100 грн
      </h2>
      <div
        aria-label="35 відсотків платформі, 65 відсотків автору"
        className={styles.formulaBar}
        role="img"
      >
        <span className={styles.formulaPlatform}>35%</span>
        <span className={styles.formulaAuthor}>65% — автору</span>
      </div>
    </section>
  );
}
