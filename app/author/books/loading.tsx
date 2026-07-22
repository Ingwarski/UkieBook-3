import styles from "../../../components/publishing/publishing.module.css";

export default function AuthorBooksLoading() {
  return (
    <main aria-busy="true" aria-label="Завантажуємо книжки автора" className={styles.authorPage}>
      <div className={styles.authorTop}><div className={styles.authorHeader} /></div>
      <div className={styles.authorContent}>
        <div className={styles.pageHeading}><div><p className={styles.eyebrow}>Кабінет автора</p><h1>Мої книжки</h1></div></div>
        <section className={[styles.panel, styles.bookList].join(" ")}>
          {[0, 1, 2].map((item) => <div className={styles.skeletonRow} key={item}><span className={styles.skeletonBlock} /><span className={styles.skeletonLines}><span /><span /></span></div>)}
        </section>
      </div>
    </main>
  );
}
