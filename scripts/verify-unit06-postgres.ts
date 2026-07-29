import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  applyMigrations,
  listAppliedMigrations,
  rollbackLatestMigration,
} from "../db/migrate";
import { openPostgresDatabase } from "../db/postgres";
import {
  decideRefund,
  LibraryConflictError,
  loadLibrary,
  loadLibraryDownloadTarget,
  relayPaidSaleEntitlements,
  relayReviewModerationDecisions,
  requestRefund,
  reviewEligibilityForBook,
  submitVerifiedBuyerReview,
} from "../modules/library/server";
import {
  decideReviewModerationCase,
  listPendingModerationReviewCases,
  relayReviewSubmittedEvents,
} from "../modules/moderation/server/review-moderation";
import { PLATFORM_SCHEMA_REVISION } from "../modules/platform/schema-revision";
import { LocalPrivateObjectStorage } from "../modules/publishing/storage/private-object-storage";
import {
  UNIT06_CURRENT_EPUB_MARKER,
  UNIT06_FIXTURE_IDS,
} from "../tests/fixtures/library/unit06-fixtures";
import { requireDedicatedUnit06DatabaseUrl, UNIT06_DATABASE_NAME } from "./unit06-database-guard";

const databaseUrl = requireDedicatedUnit06DatabaseUrl(process.env.UNIT06_DATABASE_URL);
const privateRoot = path.resolve(
  process.env.UNIT06_PRIVATE_OBJECT_ROOT ?? process.env.PRIVATE_OBJECT_ROOT ?? ".data/unit06-postgres-private",
);
const migrationDatabase = openPostgresDatabase(databaseUrl);
try {
  await migrationDatabase.query("DROP SCHEMA public CASCADE");
  await migrationDatabase.query("CREATE SCHEMA public");
  await applyMigrations(migrationDatabase);
  assert.equal((await listAppliedMigrations(migrationDatabase)).at(-1)?.id, PLATFORM_SCHEMA_REVISION);
  await rollbackLatestMigration(migrationDatabase);
  assert.notEqual((await listAppliedMigrations(migrationDatabase)).at(-1)?.id, PLATFORM_SCHEMA_REVISION);
  await applyMigrations(migrationDatabase);
  assert.equal((await listAppliedMigrations(migrationDatabase)).at(-1)?.id, PLATFORM_SCHEMA_REVISION);
} finally {
  await migrationDatabase.close?.();
}

process.env.APP_ENV = "test";
process.env.UNIT06_ALLOW_FIXTURE_SEED = "1";
process.env.UNIT06_PRIVATE_OBJECT_ROOT = privateRoot;
process.env.PRIVATE_OBJECT_ROOT = privateRoot;
await import("./seed-unit06-e2e");

const database = openPostgresDatabase(databaseUrl);
const storage = new LocalPrivateObjectStorage(privateRoot);
const proof = {
  approved_version_resolution: "passed",
  download_authorization: "passed",
  entitlement_from_paid_sale: "passed",
  exactly_once_refund_compensation: "passed",
  migration_roundtrip: "passed",
  post_refund_revocation: "passed",
  review_manual_moderation: "passed",
} as const;

try {
  const duplicateRelay = await relayPaidSaleEntitlements(database);
  assert.equal(duplicateRelay.length, 0);
  const entitlementRows = await database.query<{
    id: string;
    source_book_version_id: string;
    status: string;
  }>("SELECT id, source_book_version_id, status FROM library_entitlements");
  assert.equal(entitlementRows.rowCount, 1);
  const entitlement = entitlementRows.rows[0]!;
  assert.equal(entitlement.source_book_version_id, UNIT06_FIXTURE_IDS.purchasedVersionId);
  assert.equal(entitlement.status, "active");

  const library = await loadLibrary(database, UNIT06_FIXTURE_IDS.buyerUserId);
  assert.equal(library.items.length, 1);
  assert.equal(library.items[0]?.resolvedBookVersionId, UNIT06_FIXTURE_IDS.activeVersionId);
  assert.deepEqual(library.items[0]?.formats, ["epub", "mobi"]);
  const target = await loadLibraryDownloadTarget(database, {
    buyerUserId: UNIT06_FIXTURE_IDS.buyerUserId,
    entitlementId: entitlement.id,
    format: "epub",
  });
  assert.equal(target.resolvedBookVersionId, UNIT06_FIXTURE_IDS.activeVersionId);
  assert.equal((await storage.read(target.storageKey)).toString("utf8"), UNIT06_CURRENT_EPUB_MARKER);
  await assert.rejects(
    loadLibraryDownloadTarget(database, {
      buyerUserId: UNIT06_FIXTURE_IDS.managerUserId,
      entitlementId: entitlement.id,
      format: "epub",
    }),
    /not found/u,
  );

  await assert.rejects(
    submitVerifiedBuyerReview(database, {
      bookId: UNIT06_FIXTURE_IDS.bookId,
      buyerUserId: UNIT06_FIXTURE_IDS.managerUserId,
      idempotencyKey: "unit06-unverified-review",
      rating: 5,
      reviewText: "Цей відгук не повинен пройти.",
    }),
    (error: unknown) => error instanceof LibraryConflictError && error.code === "VERIFIED_BUYER_REQUIRED",
  );
  const review = await submitVerifiedBuyerReview(database, {
    bookId: UNIT06_FIXTURE_IDS.bookId,
    buyerUserId: UNIT06_FIXTURE_IDS.buyerUserId,
    idempotencyKey: "unit06-verified-review",
    rating: 5,
    reviewText: "Тиха й дуже тепла історія. Рекомендую читачам.",
  });
  const reviewAgain = await submitVerifiedBuyerReview(database, {
    bookId: UNIT06_FIXTURE_IDS.bookId,
    buyerUserId: UNIT06_FIXTURE_IDS.buyerUserId,
    idempotencyKey: "unit06-verified-review",
    rating: 5,
    reviewText: "Тиха й дуже тепла історія. Рекомендую читачам.",
  });
  assert.equal(reviewAgain.reviewId, review.reviewId);
  assert.equal((await relayReviewSubmittedEvents(database)).length, 1);
  assert.equal((await relayReviewSubmittedEvents(database)).length, 0);
  const cases = await listPendingModerationReviewCases(database);
  assert.equal(cases.length, 1);
  await decideReviewModerationCase(database, {
    action: "publish_review",
    caseId: cases[0]!.id,
    expectedRevision: cases[0]!.revision,
    idempotencyKey: "unit06-publish-review",
    managerUserId: UNIT06_FIXTURE_IDS.managerUserId,
  });
  await decideReviewModerationCase(database, {
    action: "publish_review",
    caseId: cases[0]!.id,
    expectedRevision: cases[0]!.revision,
    idempotencyKey: "unit06-publish-review",
    managerUserId: UNIT06_FIXTURE_IDS.managerUserId,
  });
  assert.equal((await relayReviewModerationDecisions(database)).length, 1);
  assert.equal((await relayReviewModerationDecisions(database)).length, 0);
  const publishedReview = await database.query<{ count: number; status: string }>(
    `
      SELECT review.status, (SELECT COUNT(*)::int FROM catalog_review_read_models WHERE review_id = review.id) AS count
      FROM library_reviews review WHERE review.id = $1
    `,
    [review.reviewId],
  );
  assert.deepEqual(publishedReview.rows[0], { count: 1, status: "published" });

  const refund = await requestRefund(database, {
    buyerUserId: UNIT06_FIXTURE_IDS.buyerUserId,
    entitlementId: entitlement.id,
    idempotencyKey: "unit06-refund-request",
    reason: "Файл не підходить для мого пристрою читання.",
  });
  const refundAgain = await requestRefund(database, {
    buyerUserId: UNIT06_FIXTURE_IDS.buyerUserId,
    entitlementId: entitlement.id,
    idempotencyKey: "unit06-refund-request",
    reason: "Файл не підходить для мого пристрою читання.",
  });
  assert.equal(refundAgain.refundRequestId, refund.refundRequestId);
  const decision = await decideRefund(database, {
    decision: "approved",
    decisionNote: "Схвалено в інтеграційному доказі.",
    idempotencyKey: "unit06-refund-approved",
    managerUserId: UNIT06_FIXTURE_IDS.managerUserId,
    refundRequestId: refund.refundRequestId,
  });
  const decisionAgain = await decideRefund(database, {
    decision: "approved",
    decisionNote: "Схвалено в інтеграційному доказі.",
    idempotencyKey: "unit06-refund-approved",
    managerUserId: UNIT06_FIXTURE_IDS.managerUserId,
    refundRequestId: refund.refundRequestId,
  });
  assert.equal(decisionAgain.compensationId, decision.compensationId);
  const compensation = await database.query<{
    compensations: number;
    events: number;
    status: string;
  }>(
    `
      SELECT
        (SELECT COUNT(*)::int FROM refund_compensations WHERE refund_request_id = $1) AS compensations,
        (SELECT COUNT(*)::int FROM outbox_events WHERE event_type = 'RefundApproved' AND aggregate_id = $1::text) AS events,
        (SELECT status FROM library_entitlements WHERE id = $2) AS status
    `,
    [refund.refundRequestId, entitlement.id],
  );
  assert.deepEqual(compensation.rows[0], { compensations: 1, events: 1, status: "refunded" });
  await assert.rejects(
    loadLibraryDownloadTarget(database, {
      buyerUserId: UNIT06_FIXTURE_IDS.buyerUserId,
      entitlementId: entitlement.id,
      format: "epub",
    }),
    /not found/u,
  );
  assert.deepEqual(
    await reviewEligibilityForBook(database, {
      bookId: UNIT06_FIXTURE_IDS.bookId,
      buyerUserId: UNIT06_FIXTURE_IDS.buyerUserId,
    }),
    { kind: "not_eligible" },
  );
  await assert.rejects(
    database.query("UPDATE refund_compensations SET amount_kopiykas = amount_kopiykas + 1 WHERE id = $1", [decision.compensationId]),
    /append-only/u,
  );

  const receipt = {
    database_name: UNIT06_DATABASE_NAME,
    proof,
    schema_revision: PLATFORM_SCHEMA_REVISION,
    status: "passed",
    verified_at: new Date().toISOString(),
  };
  if (process.env.UNIT_EVIDENCE_DIR) {
    const targetPath = path.resolve(process.env.UNIT_EVIDENCE_DIR, "evidence/database/unit06-postgres-proof.json");
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
} finally {
  await database.close?.();
}
