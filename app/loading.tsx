import { PublicHeader } from "../components/catalog";
import styles from "../components/catalog/catalog.module.css";

export default function CatalogLoading() {
  return (
    <main aria-busy="true" aria-label="Каталог завантажується" className={styles.catalogPage}>
      <div className={styles.auroraRegion}>
        <PublicHeader viewer={{ isAuthor: false, signedIn: false }} />
        <section className={styles.hero}>
          <h1>
            Затишні вечори
            <br />
            <span>з українською книжкою</span>
          </h1>
          <p>Електронні книжки EPUB і MOBI миттєво у вашу бібліотеку.</p>
        </section>
        <div className={styles.loadingShelf}>
          {Array.from({ length: 5 }, (_, index) => (
            <span className={[styles.skeleton, styles.loadingCover].join(" ")} key={index} />
          ))}
        </div>
      </div>
      <div className={styles.loadingTiles}>
        {Array.from({ length: 4 }, (_, index) => (
          <span className={[styles.skeleton, styles.loadingTile].join(" ")} key={index} />
        ))}
      </div>
      <div className={[styles.skeleton, styles.loadingFormula].join(" ")} />
      <div className={styles.loadingResults}>
        <span className={[styles.skeleton, styles.loadingHeading].join(" ")} />
        <div>
          {Array.from({ length: 4 }, (_, index) => (
            <span className={[styles.skeleton, styles.loadingResult].join(" ")} key={index} />
          ))}
        </div>
      </div>
    </main>
  );
}
