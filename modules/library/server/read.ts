import "server-only";

import type { SqlDatabase, SqlExecutor } from "../../platform/sql-port";
import {
  LIBRARY_SCHEMA_VERSION,
  type BuyerReviewEligibility,
  type DownloadFormat,
  type LibraryItemReadModel,
  type LibraryReadModel,
  type LibraryReviewStatus,
  type RefundRequestStatus,
} from "../types";
import { asIso, LibraryInputError, requireUuid } from "./common";

interface LibraryRow extends Record<string, unknown> {
  readonly entitlement_id: string;
  readonly book_id: string;
  readonly title_snapshot: string;
  readonly author_public_name_snapshot: string;
  readonly cover_path_snapshot: string;
  readonly entitlement_status: "active" | "refunded";
  readonly refund_status: RefundRequestStatus | null;
  readonly review_status: LibraryReviewStatus | null;
  readonly resolved_book_version_id: string;
  readonly epub_object_id: string | null;
  readonly mobi_object_id: string | null;
  readonly created_at: Date | string;
}

async function libraryRows(
  executor: SqlExecutor,
  buyerUserId: string,
): Promise<readonly LibraryRow[]> {
  const result = await executor.query<LibraryRow>(
    `
      SELECT
        entitlement.id AS entitlement_id,
        entitlement.book_id,
        item.title_snapshot,
        item.author_public_name_snapshot,
        item.cover_path_snapshot,
        entitlement.status AS entitlement_status,
        refund.status AS refund_status,
        review.status AS review_status,
        COALESCE(publication.active_book_version_id, entitlement.source_book_version_id)
          AS resolved_book_version_id,
        COALESCE(resolved.epub_object_id, purchased.epub_object_id) AS epub_object_id,
        COALESCE(resolved.mobi_object_id, purchased.mobi_object_id) AS mobi_object_id,
        entitlement.created_at
      FROM library_entitlements entitlement
      JOIN commerce_order_items item ON item.id = entitlement.source_order_item_id
      JOIN publishing_book_versions purchased
        ON purchased.id = entitlement.source_book_version_id
      LEFT JOIN book_publications publication ON publication.book_id = entitlement.book_id
      LEFT JOIN publishing_book_versions resolved
        ON resolved.id = publication.active_book_version_id
      LEFT JOIN refund_requests refund ON refund.entitlement_id = entitlement.id
      LEFT JOIN library_reviews review ON review.entitlement_id = entitlement.id
      WHERE entitlement.buyer_user_id = $1
      ORDER BY entitlement.created_at DESC, entitlement.id DESC
    `,
    [requireUuid(buyerUserId, "buyerUserId")],
  );
  return result.rows;
}

function mapLibraryRow(row: LibraryRow): LibraryItemReadModel {
  const formats: DownloadFormat[] = [];
  if (row.entitlement_status === "active" && row.epub_object_id) formats.push("epub");
  if (row.entitlement_status === "active" && row.mobi_object_id) formats.push("mobi");
  return {
    authorPublicName: row.author_public_name_snapshot,
    bookId: row.book_id,
    coverPath: row.cover_path_snapshot,
    entitlementStatus: row.entitlement_status,
    formats,
    id: row.entitlement_id,
    purchasedAt: asIso(row.created_at, "entitlement created_at"),
    refundStatus: row.refund_status,
    resolvedBookVersionId: row.resolved_book_version_id,
    reviewStatus: row.review_status,
    title: row.title_snapshot,
  };
}

export async function loadLibrary(
  database: SqlDatabase,
  buyerUserId: string,
): Promise<LibraryReadModel> {
  return {
    items: (await libraryRows(database, buyerUserId)).map(mapLibraryRow),
    schemaVersion: LIBRARY_SCHEMA_VERSION,
  };
}

export async function reviewEligibilityForBook(
  database: SqlDatabase,
  input: { readonly buyerUserId: string; readonly bookId: string },
): Promise<BuyerReviewEligibility> {
  const result = await database.query<{
    entitlement_id: string;
    entitlement_status: "active" | "refunded";
    review_status: LibraryReviewStatus | null;
  }>(
    `
      SELECT entitlement.id AS entitlement_id, entitlement.status AS entitlement_status,
             review.status AS review_status
      FROM library_entitlements entitlement
      LEFT JOIN library_reviews review ON review.entitlement_id = entitlement.id
      WHERE entitlement.buyer_user_id = $1 AND entitlement.book_id = $2
    `,
    [requireUuid(input.buyerUserId, "buyerUserId"), requireUuid(input.bookId, "bookId")],
  );
  const row = result.rows[0];
  if (!row || row.entitlement_status !== "active") return { kind: "not_eligible" };
  if (row.review_status === "pending_moderation") return { kind: "pending_moderation" };
  if (row.review_status === "published") return { kind: "published" };
  if (row.review_status === "not_published") return { kind: "not_published" };
  return { entitlementId: row.entitlement_id, kind: "eligible" };
}

interface DownloadRow extends Record<string, unknown> {
  readonly book_id: string;
  readonly media_type: string;
  readonly resolved_book_version_id: string;
  readonly storage_key: string;
  readonly title_snapshot: string;
}

export interface LibraryDownloadTarget {
  readonly bookId: string;
  readonly mediaType: string;
  readonly filename: string;
  readonly storageKey: string;
  readonly resolvedBookVersionId: string;
}

function formatColumn(format: DownloadFormat): string {
  return format === "epub" ? "epub_object_id" : "mobi_object_id";
}

function safeFilename(value: string, extension: DownloadFormat): string {
  const stem = value
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 96) || "ukiebook";
  return `${stem}.${extension}`;
}

export async function loadLibraryDownloadTarget(
  database: SqlDatabase,
  input: {
    readonly buyerUserId: string;
    readonly entitlementId: string;
    readonly format: DownloadFormat;
  },
): Promise<LibraryDownloadTarget> {
  const column = formatColumn(input.format);
  const result = await database.query<DownloadRow>(
    `
      SELECT
        entitlement.book_id,
        object.media_type,
        COALESCE(publication.active_book_version_id, entitlement.source_book_version_id)
          AS resolved_book_version_id,
        object.storage_key,
        item.title_snapshot
      FROM library_entitlements entitlement
      JOIN commerce_order_items item ON item.id = entitlement.source_order_item_id
      JOIN publishing_book_versions purchased
        ON purchased.id = entitlement.source_book_version_id
      LEFT JOIN book_publications publication ON publication.book_id = entitlement.book_id
      LEFT JOIN publishing_book_versions resolved
        ON resolved.id = publication.active_book_version_id
      JOIN publishing_private_objects object
        ON object.id = COALESCE(resolved.${column}, purchased.${column})
      WHERE entitlement.id = $1
        AND entitlement.buyer_user_id = $2
        AND entitlement.status = 'active'
    `,
    [
      requireUuid(input.entitlementId, "entitlementId"),
      requireUuid(input.buyerUserId, "buyerUserId"),
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Library download was not found");
  return {
    bookId: row.book_id,
    filename: safeFilename(row.title_snapshot, input.format),
    mediaType: row.media_type,
    resolvedBookVersionId: row.resolved_book_version_id,
    storageKey: row.storage_key,
  };
}

export function parseDownloadFormat(value: string | null): DownloadFormat {
  if (value === "epub" || value === "mobi") return value;
  throw new LibraryInputError("DOWNLOAD_FORMAT", "Непідтримуваний формат файлу.");
}
