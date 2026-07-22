import styles from "../../../components/moderation/moderation.module.css";

export default function ModerationLoading() {
  return (
    <div aria-busy="true" aria-label="Черга Ручної перевірки завантажується">
      <header className={styles.pageHeading}>
        <div>
          <p className={styles.eyebrow}>Менеджерський простір</p>
          <h1>Ручна перевірка</h1>
        </div>
      </header>
      <div className={styles.queueLayout}>
        <section className={styles.queuePanel}>
          <div className={styles.loadingBlock} />
          <div className={styles.loadingRows}>
            <span /><span /><span />
          </div>
        </section>
        <section className={styles.detailPanel}>
          <div className={styles.loadingDetail} />
        </section>
      </div>
    </div>
  );
}
