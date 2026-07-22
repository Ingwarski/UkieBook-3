import {
  List,
  ShieldCheck,
  SignOut,
  Storefront,
} from "@phosphor-icons/react/dist/ssr";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import officialLogo from "../../UkieBook-logo-transparent.svg";

import styles from "./moderation.module.css";

const officialLogoSource =
  typeof officialLogo === "string" ? officialLogo : officialLogo.src;

interface ManagerShellProps {
  readonly children: ReactNode;
  readonly csrfToken: string;
}

function ManagerLinks() {
  return (
    <>
      <Link aria-current="page" href="/admin/moderation" prefetch={false}>
        <ShieldCheck aria-hidden="true" size={18} /> Ручна перевірка
      </Link>
      <Link href="/" prefetch={false}>
        <Storefront aria-hidden="true" size={18} /> До каталогу
      </Link>
    </>
  );
}

export function ManagerShell({ children, csrfToken }: ManagerShellProps) {
  return (
    <main className={styles.managerPage}>
      <div className={styles.managerTop}>
        <header className={styles.managerHeader}>
          <Link aria-label="UkieBook — головна" className={styles.brand} href="/" prefetch={false}>
            <Image
              alt=""
              aria-hidden="true"
              height={26}
              priority
              src={officialLogoSource}
              unoptimized
              width={26}
            />
            <span>
              Ukie<strong>Book</strong>
            </span>
          </Link>
          <nav aria-label="Менеджерський простір" className={styles.managerNavigation}>
            <ManagerLinks />
          </nav>
          <span className={styles.headerSpacer} />
          <form
            action="/api/auth/logout"
            className={[styles.logoutForm, styles.managerNavigation].join(" ")}
            method="post"
          >
            <input name="csrfToken" type="hidden" value={csrfToken} />
            <button type="submit">
              <SignOut aria-hidden="true" size={18} /> Вийти
            </button>
          </form>
          <details className={styles.mobileMenu}>
            <summary aria-label="Відкрити меню менеджера">
              <List aria-hidden="true" size={22} />
            </summary>
            <nav aria-label="Мобільний менеджерський простір" className={styles.mobileNav}>
              <ManagerLinks />
              <form action="/api/auth/logout" method="post">
                <input name="csrfToken" type="hidden" value={csrfToken} />
                <button type="submit">
                  <SignOut aria-hidden="true" size={18} /> Вийти
                </button>
              </form>
            </nav>
          </details>
        </header>
      </div>
      <div className={styles.managerContent}>{children}</div>
    </main>
  );
}
