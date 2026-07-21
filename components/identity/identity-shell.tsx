import Image from "next/image";
import type { ReactNode } from "react";

import officialLogo from "../../UkieBook-logo-exact.svg";
import { AuroraGlassSurface } from "../aurora";

import styles from "./identity.module.css";

const officialLogoSource =
  typeof officialLogo === "string" ? officialLogo : officialLogo.src;

export interface IdentityShellProps {
  children: ReactNode;
  description: string;
  headingId: string;
  homeHref?: string;
  title: string;
}

export function IdentityShell({
  children,
  description,
  headingId,
  homeHref = "/",
  title,
}: IdentityShellProps) {
  const descriptionId = `${headingId}-description`;

  return (
    <main className={styles.screen}>
      <div className={styles.frame}>
        <a aria-label="UkieBook — головна" className={styles.brand} href={homeHref}>
          <Image
            alt=""
            aria-hidden="true"
            className={styles.brandMark}
            height="26"
            src={officialLogoSource}
            unoptimized
            width="26"
          />
          <span className={styles.wordmark}>
            Ukie<strong>Book</strong>
          </span>
        </a>

        <AuroraGlassSurface
          aria-describedby={descriptionId}
          aria-labelledby={headingId}
          as="section"
          className={styles.panel}
        >
          <header className={styles.header}>
            <h1 id={headingId}>{title}</h1>
            <p id={descriptionId}>{description}</p>
          </header>
          {children}
        </AuroraGlassSurface>
      </div>
    </main>
  );
}

export interface IdentityNoticeProps {
  children: ReactNode;
  tone: "error" | "success";
}

export function IdentityNotice({ children, tone }: IdentityNoticeProps) {
  return (
    <div
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={[styles.notice, styles[`${tone}Notice`]].join(" ")}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
