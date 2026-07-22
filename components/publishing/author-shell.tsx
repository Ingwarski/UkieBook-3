import { BookOpenText, List, SignOut, Storefront, UserCircle } from "@phosphor-icons/react/dist/ssr";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import officialLogo from "../../UkieBook-logo-transparent.svg";

import styles from "./publishing.module.css";

const officialLogoSource = typeof officialLogo === "string" ? officialLogo : officialLogo.src;

interface AuthorShellProps {
  readonly active: "books" | "profile" | "publish";
  readonly children: ReactNode;
  readonly csrfToken: string;
}

function AuthorLinks({ active }: Pick<AuthorShellProps, "active">) {
  return (
    <>
      <Link aria-current={active === "books" || active === "publish" ? "page" : undefined} href="/author/books">
        <BookOpenText aria-hidden="true" size={18} /> Мої книжки
      </Link>
      <Link aria-current={active === "profile" ? "page" : undefined} href="/author/profile">
        <UserCircle aria-hidden="true" size={18} /> Профіль
      </Link>
      <Link href="/">
        <Storefront aria-hidden="true" size={18} /> До каталогу
      </Link>
    </>
  );
}

export function AuthorShell({ active, children, csrfToken }: AuthorShellProps) {
  return (
    <main className={styles.authorPage}>
      <div className={styles.authorTop}>
        <header className={styles.authorHeader}>
          <Link aria-label="UkieBook — головна" className={styles.brand} href="/">
            <Image
              alt=""
              aria-hidden="true"
              height={26}
              priority
              src={officialLogoSource}
              unoptimized
              width={26}
            />
            <span>Ukie<strong>Book</strong></span>
          </Link>
          <nav aria-label="Кабінет автора" className={styles.authorNavigation}>
            <AuthorLinks active={active} />
          </nav>
          <span className={styles.headerSpacer} />
          <form action="/api/auth/logout" className={[styles.logoutForm, styles.authorNavigation].join(" ")} method="post">
            <input name="csrfToken" type="hidden" value={csrfToken} />
            <button type="submit"><SignOut aria-hidden="true" size={18} /> Вийти</button>
          </form>
          <details className={styles.mobileMenu}>
            <summary aria-label="Відкрити меню автора"><List aria-hidden="true" size={22} /></summary>
            <nav aria-label="Мобільний кабінет автора" className={styles.mobileNav}>
              <AuthorLinks active={active} />
              <form action="/api/auth/logout" method="post">
                <input name="csrfToken" type="hidden" value={csrfToken} />
                <button type="submit"><SignOut aria-hidden="true" size={18} /> Вийти</button>
              </form>
            </nav>
          </details>
        </header>
      </div>
      <div className={styles.authorContent}>{children}</div>
    </main>
  );
}
