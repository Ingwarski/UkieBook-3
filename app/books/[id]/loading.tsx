import { PublicHeader } from "../../../components/catalog";
import styles from "../../../components/catalog/catalog.module.css";

export default function BookLoading() {
  return (
    <main aria-busy="true" aria-label="Книжка завантажується" className={styles.bookPage}>
      <div className={styles.bookAuroraHeader}>
        <PublicHeader viewer={{ isAuthor: false, signedIn: false }} />
      </div>
      <div className={styles.bookLoadingBody}>
        <span className={[styles.skeleton, styles.bookLoadingCover].join(" ")} />
        <div>
          <span className={[styles.skeleton, styles.bookLoadingKicker].join(" ")} />
          <span className={[styles.skeleton, styles.bookLoadingTitle].join(" ")} />
          <span className={[styles.skeleton, styles.bookLoadingText].join(" ")} />
          <span className={[styles.skeleton, styles.bookLoadingButton].join(" ")} />
        </div>
      </div>
    </main>
  );
}
