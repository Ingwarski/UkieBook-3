import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

import { PublicHeader } from "../../../components/catalog";
import styles from "../../../components/catalog/catalog.module.css";

export default function BookNotFound() {
  return (
    <main className={styles.bookPage}>
      <div className={styles.bookAuroraHeader}>
        <PublicHeader viewer={{ isAuthor: false, signedIn: false }} />
      </div>
      <section className={styles.notFoundSurface}>
        <p className={styles.eyebrow}>404</p>
        <h1>Такої книжки немає</h1>
        <p>Можливо, посилання застаріло або в адресі є помилка.</p>
        <Link className={styles.primaryCta} href="/">
          <ArrowLeft aria-hidden="true" size={18} /> Повернутися до каталогу
        </Link>
      </section>
    </main>
  );
}
