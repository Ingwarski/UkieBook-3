import styles from "./catalog.module.css";

export function FormulaRibbon() {
  return (
    <section aria-labelledby="formula-title" className={styles.formula}>
      <h2 className={styles.formulaLabel} id="formula-title">
        Прозора формула: з кожних 100 грн
      </h2>
      <div
        aria-label="6 відсотків податки, 65,8 відсотка автору, 28,2 відсотка платформі"
        className={styles.formulaBar}
        role="img"
      >
        <span className={styles.formulaTax}>6</span>
        <span className={styles.formulaAuthor}>65,8 — автору</span>
        <span className={styles.formulaPlatform}>28,2</span>
      </div>
    </section>
  );
}
