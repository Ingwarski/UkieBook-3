import styles from "../../../../components/publishing/publishing.module.css";

export default function AuthorBookManagementLoading() {
  return (
    <main
      aria-busy="true"
      aria-label="Керування книжкою завантажується"
      className={styles.authorPage}
    >
      <div className={styles.authorTop}><div className={styles.authorHeader} /></div>
      <div className={styles.authorContent}>
        <div className={styles.managementHeading}>
          <p className={styles.eyebrow}>Керування книжкою</p>
          <h1>Стан книжки</h1>
        </div>
        <section className={[styles.panel, styles.managementOverview].join(" ")}>
          <span className={styles.skeletonBlock} />
          <span className={styles.skeletonLines}><span /><span /></span>
        </section>
      </div>
    </main>
  );
}
