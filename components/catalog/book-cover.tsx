import Image from "next/image";

import type { CatalogBookSummary } from "../../modules/catalog/types";

import styles from "./catalog.module.css";

interface BookCoverProps {
  readonly book: Pick<CatalogBookSummary, "cover">;
  readonly priority?: boolean;
  readonly variant: "shelf" | "tile" | "result" | "detail";
}
export function BookCover({ book, priority = false, variant }: BookCoverProps) {
  return (
    <span className={[styles.bookCover, styles[`${variant}Cover`]].join(" ")}>
      <Image
        alt={book.cover.alt}
        className={styles.coverArtwork}
        fill
        priority={priority}
        sizes={
          variant === "detail"
            ? "(max-width: 700px) 76vw, 320px"
            : variant === "result"
              ? "(max-width: 600px) 34vw, 150px"
              : variant === "tile"
                ? "64px"
                : "138px"
        }
        src={book.cover.src}
      />
    </span>
  );
}
