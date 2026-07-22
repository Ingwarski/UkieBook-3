"use client";

import { ArrowLeft, CheckCircle, Desktop, DeviceMobile } from "@phosphor-icons/react";
import Image from "next/image";
import Link from "next/link";
import { useRef, useState, type KeyboardEvent } from "react";

import type { BookDraftReadModel } from "../../modules/publishing/types";
import { AuroraButton } from "../aurora";

import styles from "./publishing.module.css";

interface PreviewWorkspaceProps {
  readonly csrfToken: string;
  readonly draft: BookDraftReadModel & { readonly preview: NonNullable<BookDraftReadModel["preview"]> };
  readonly saveSampleAction: (formData: FormData) => Promise<void>;
}

export function PreviewWorkspace({ csrfToken, draft, saveSampleAction }: PreviewWorkspaceProps) {
  const [tab, setTab] = useState<"book" | "page">("book");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const bookTabRef = useRef<HTMLButtonElement>(null);
  const pageTabRef = useRef<HTMLButtonElement>(null);
  const storedSampleIndex =
    draft.samplePreviewArtifactId === draft.preview.artifactId &&
    draft.sampleSectionIndex !== null &&
    draft.sampleSectionIndex < draft.preview.document.sections.length
      ? draft.sampleSectionIndex
      : null;
  const [sampleSectionIndex, setSampleSectionIndex] = useState(
    storedSampleIndex === null ? "" : String(storedSampleIndex),
  );
  const selectedIndex = sampleSectionIndex === "" ? null : Number(sampleSectionIndex);
  const sample = selectedIndex === null
    ? null
    : draft.preview.document.sections[selectedIndex] ?? null;
  const chooseTab = (nextTab: "book" | "page", moveFocus = false) => {
    setTab(nextTab);
    if (moveFocus) {
      (nextTab === "book" ? bookTabRef : pageTabRef).current?.focus();
    }
  };
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextTab = event.key === "ArrowLeft" || event.key === "Home" ? "book" : "page";
    chooseTab(nextTab, true);
  };
  return (
    <div className={styles.previewStack}>
      <div className={styles.previewToolbar}>
        <div aria-label="Тип попереднього перегляду" className={styles.tabs} role="tablist">
          <button aria-controls="publishing-preview-panel" aria-selected={tab === "book"} className={tab === "book" ? styles.selected : undefined} id="publishing-preview-book-tab" onClick={() => chooseTab("book")} onKeyDown={handleTabKeyDown} ref={bookTabRef} role="tab" tabIndex={tab === "book" ? 0 : -1} type="button">Книжка</button>
          <button aria-controls="publishing-preview-panel" aria-selected={tab === "page"} className={tab === "page" ? styles.selected : undefined} id="publishing-preview-page-tab" onClick={() => chooseTab("page")} onKeyDown={handleTabKeyDown} ref={pageTabRef} role="tab" tabIndex={tab === "page" ? 0 : -1} type="button">Сторінка книжки</button>
        </div>
        <div aria-label="Розмір попереднього перегляду" className={styles.deviceToggle} role="group">
          <button aria-pressed={device === "desktop"} className={device === "desktop" ? styles.selected : undefined} onClick={() => setDevice("desktop")} type="button"><Desktop aria-hidden="true" size={18} /> Десктоп</button>
          <button aria-pressed={device === "mobile"} className={device === "mobile" ? styles.selected : undefined} onClick={() => setDevice("mobile")} type="button"><DeviceMobile aria-hidden="true" size={18} /> Мобільний</button>
        </div>
      </div>
      <section aria-label={tab === "book" ? "Попередній перегляд книжки" : "Попередній перегляд Сторінки книжки"} className={[styles.panel, styles.previewFrame, device === "mobile" ? styles.previewFrameMobile : ""].filter(Boolean).join(" ")} id="publishing-preview-panel" role="tabpanel">
        {tab === "book" ? (
          <div className={styles.editionLayout}>
            <nav aria-label="Зміст видання" className={styles.toc}>
              <strong>Зміст</strong>
              <ol>{draft.preview.document.sections.map((section, index) => <li key={`${section.heading}-${index}`}>{section.heading}</li>)}</ol>
            </nav>
            <article className={styles.readingSurface}>
              <h2>{draft.preview.document.title}</h2>
              {draft.preview.document.sections.map((section, sectionIndex) => (
                <section className={styles.readingSection} key={`${section.heading}-${sectionIndex}`}>
                  <h3>{section.heading}</h3>
                  {section.blocks.map((block, blockIndex) => block.kind === "paragraph" ? (
                    <p key={`${block.kind}-${blockIndex}`}>{block.text}</p>
                  ) : (
                    <Image alt={block.alt} className={styles.readingIllustration} height={900} key={`${block.kind}-${blockIndex}`} src={`/api/author/publishing/objects/${block.objectId}`} unoptimized width={1200} />
                  ))}
                </section>
              ))}
            </article>
          </div>
        ) : (
          <article className={styles.bookPreview}>
            <div className={styles.bookPreviewMain}>
              <p className={styles.eyebrow}>{draft.genreSlug?.replaceAll("-", " ")}</p>
              <h2>{draft.title}</h2>
              <p>Автор · {draft.authorPublicName}</p>
              <strong className={styles.previewPrice}>{((draft.basePriceKopiykas ?? 0) / 100).toLocaleString("uk-UA")} грн</strong>
              <p className={styles.bookPreviewDescription}>{draft.description}</p>
              {sample ? (
                <section className={styles.samplePreview}>
                  <p className={styles.eyebrow}>Безкоштовний фрагмент</p>
                  <h3>{sample.heading}</h3>
                  {sample.blocks.filter((block) => block.kind === "paragraph").slice(0, 2).map((block, index) => block.kind === "paragraph" ? <p key={index}>{block.text}</p> : null)}
                </section>
              ) : null}
            </div>
            {draft.coverUrl ? <Image alt={`${draft.title} — ${draft.authorPublicName}`} className={styles.previewCover} height={900} src={draft.coverUrl} unoptimized width={600} /> : null}
          </article>
        )}
      </section>
      <form action={saveSampleAction} className={[styles.panel, styles.sampleSelector].join(" ")}>
        <input name="csrfToken" type="hidden" value={csrfToken} />
        <input name="draftId" type="hidden" value={draft.draftId} />
        <input name="previewArtifactId" type="hidden" value={draft.preview.artifactId} />
        <div className={styles.field}>
          <label htmlFor="sample-section">Безкоштовний фрагмент *</label>
          <select
            aria-describedby="sample-section-help"
            id="sample-section"
            name="sampleSectionIndex"
            onChange={(event) => setSampleSectionIndex(event.currentTarget.value)}
            required
            value={sampleSectionIndex}
          >
            <option disabled value="">Оберіть розділ</option>
            {draft.preview.document.sections.map((section, index) => (
              <option key={`${section.heading}-${index}`} value={index}>
                {section.heading || `Розділ ${index + 1}`}
              </option>
            ))}
          </select>
          <span className={styles.fieldHelp} id="sample-section-help">
            Список створено з готового видання. Обраний розділ стане доступним читачам безкоштовно.
          </span>
        </div>
        <AuroraButton disabled={sampleSectionIndex === ""} type="submit">
          <CheckCircle aria-hidden="true" size={19} /> Зберегти фрагмент і перейти далі
        </AuroraButton>
      </form>
      <div className={styles.wizardActions}>
        <Link className={styles.secondaryLink} href={`/author/publish?draft=${encodeURIComponent(draft.draftId)}&step=4`}><ArrowLeft aria-hidden="true" size={18} /> Повернутися до редагування</Link>
      </div>
    </div>
  );
}
