import path from "node:path";

import { applyMigrations } from "../db/migrate";
import { openPostgresDatabase } from "../db/postgres";
import { relayPaidSaleEntitlements } from "../modules/library/server";
import { appendOutboxEvent } from "../modules/platform/outbox";
import { LocalPrivateObjectStorage } from "../modules/publishing/storage/private-object-storage";
import {
  UNIT06_CURRENT_EPUB_MARKER,
  UNIT06_CURRENT_MOBI_MARKER,
  UNIT06_FIXTURE_BOOK,
  UNIT06_FIXTURE_IDS,
} from "../tests/fixtures/library/unit06-fixtures";
import { requireDedicatedUnit06DatabaseUrl } from "./unit06-database-guard";

if (process.env.APP_ENV === "production") throw new Error("UNIT-06 fixtures cannot seed production");
if (process.env.UNIT06_ALLOW_FIXTURE_SEED !== "1") {
  throw new Error("Set UNIT06_ALLOW_FIXTURE_SEED=1 to acknowledge UNIT-06 fixture seeding");
}

const database = openPostgresDatabase(requireDedicatedUnit06DatabaseUrl(process.env.UNIT06_DATABASE_URL));
const storageRoot = path.resolve(
  process.env.UNIT06_PRIVATE_OBJECT_ROOT ?? process.env.PRIVATE_OBJECT_ROOT ?? ".data/unit06-private",
);
const storage = new LocalPrivateObjectStorage(storageRoot);

const objectDefinitions = [
  ["60606060-6060-4060-8060-606060606211", "manuscript", "text/plain; charset=utf-8", "purchased manuscript", "txt"],
  ["60606060-6060-4060-8060-606060606212", "cover", "image/png", "purchased cover", "png"],
  ["60606060-6060-4060-8060-606060606213", "preview", "application/json", "{\"version\":1}", "json"],
  ["60606060-6060-4060-8060-606060606214", "epub", "application/epub+zip", "UNIT-06 PURCHASED EPUB VERSION 1", "epub"],
  ["60606060-6060-4060-8060-606060606215", "mobi", "application/x-mobipocket-ebook", "UNIT-06 PURCHASED MOBI VERSION 1", "mobi"],
  ["60606060-6060-4060-8060-606060606221", "manuscript", "text/plain; charset=utf-8", "current manuscript", "txt"],
  ["60606060-6060-4060-8060-606060606222", "cover", "image/png", "current cover", "png"],
  ["60606060-6060-4060-8060-606060606223", "preview", "application/json", "{\"version\":2}", "json"],
  ["60606060-6060-4060-8060-606060606224", "epub", "application/epub+zip", UNIT06_CURRENT_EPUB_MARKER, "epub"],
  ["60606060-6060-4060-8060-606060606225", "mobi", "application/x-mobipocket-ebook", UNIT06_CURRENT_MOBI_MARKER, "mobi"],
] as const;

try {
  await database.query("DROP SCHEMA public CASCADE");
  await database.query("CREATE SCHEMA public");
  await applyMigrations(database);
  await database.query("INSERT INTO catalog_genres (slug, label) VALUES ('proza', 'Проза')");
  await database.query(
    `
      INSERT INTO users (id, private_email, private_email_verified, private_display_name)
      VALUES
        ($1, 'author-unit06@example.invalid', TRUE, 'Олена Вітрова'),
        ($2, 'google-private@simulator.test', TRUE, 'Google Private Simulator'),
        ($3, 'facebook-private@simulator.test', TRUE, 'Manager Private Simulator')
    `,
    [UNIT06_FIXTURE_IDS.authorUserId, UNIT06_FIXTURE_IDS.buyerUserId, UNIT06_FIXTURE_IDS.managerUserId],
  );
  await database.query(
    `
      INSERT INTO oauth_accounts (
        id, user_id, provider, provider_subject, provider_email,
        provider_email_verified, provider_display_name
      ) VALUES
        ('60606060-6060-4060-8060-606060606011', $1, 'google', 'google-simulated-subject', 'google-private@simulator.test', TRUE, 'Google Private Simulator'),
        ('60606060-6060-4060-8060-606060606012', $2, 'facebook', 'facebook-simulated-subject', 'facebook-private@simulator.test', TRUE, 'Manager Private Simulator')
    `,
    [UNIT06_FIXTURE_IDS.buyerUserId, UNIT06_FIXTURE_IDS.managerUserId],
  );
  await database.query(
    `
      INSERT INTO user_roles (user_id, role) VALUES
        ($1, 'author'), ($1, 'buyer'), ($2, 'buyer'), ($3, 'manager'), ($3, 'buyer')
    `,
    [UNIT06_FIXTURE_IDS.authorUserId, UNIT06_FIXTURE_IDS.buyerUserId, UNIT06_FIXTURE_IDS.managerUserId],
  );
  await database.query("INSERT INTO author_profiles (user_id, public_name) VALUES ($1, $2)", [
    UNIT06_FIXTURE_IDS.authorUserId,
    UNIT06_FIXTURE_BOOK.author,
  ]);

  for (const [id, kind, mediaType, content, extension] of objectDefinitions) {
    const bytes = Buffer.from(content);
    const stored = await storage.putImmutable({
      bytes,
      extension,
      kind,
      ownerUserId: UNIT06_FIXTURE_IDS.authorUserId,
    });
    await database.query(
      `
        INSERT INTO publishing_private_objects (
          id, owner_user_id, object_kind, storage_key, sha256, byte_length,
          media_type, original_name
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [id, UNIT06_FIXTURE_IDS.authorUserId, kind, stored.storageKey, stored.sha256, stored.byteLength, mediaType, `unit06.${extension}`],
    );
  }

  await database.query(
    "INSERT INTO publishing_books (id, author_id, title, status) VALUES ($1, $2, $3, 'published')",
    [UNIT06_FIXTURE_IDS.bookId, UNIT06_FIXTURE_IDS.authorUserId, UNIT06_FIXTURE_BOOK.title],
  );
  const insertVersion = `
    INSERT INTO publishing_book_versions (
      id, book_id, version_number, author_id, manuscript_object_id,
      cover_object_id, preview_object_id, epub_object_id, mobi_object_id,
      title, description, genre_slug, base_price_kopiykas, sample_section_index
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'proza', $12, 0)
  `;
  await database.query(insertVersion, [
    UNIT06_FIXTURE_IDS.purchasedVersionId, UNIT06_FIXTURE_IDS.bookId, 1,
    UNIT06_FIXTURE_IDS.authorUserId, objectDefinitions[0][0], objectDefinitions[1][0],
    objectDefinitions[2][0], objectDefinitions[3][0], objectDefinitions[4][0],
    UNIT06_FIXTURE_BOOK.title, "Перше придбане видання для перевірки entitlement.", UNIT06_FIXTURE_BOOK.priceKopiykas,
  ]);
  await database.query(insertVersion, [
    UNIT06_FIXTURE_IDS.activeVersionId, UNIT06_FIXTURE_IDS.bookId, 2,
    UNIT06_FIXTURE_IDS.authorUserId, objectDefinitions[5][0], objectDefinitions[6][0],
    objectDefinitions[7][0], objectDefinitions[8][0], objectDefinitions[9][0],
    UNIT06_FIXTURE_BOOK.title, "Поточне схвалене видання, яке має отримати покупець.", UNIT06_FIXTURE_BOOK.priceKopiykas,
  ]);
  await database.query(
    `
      INSERT INTO outbox_events (
        id, topic, event_type, event_version, aggregate_type, aggregate_id,
        payload, idempotency_key, correlation_id, occurred_at, published_at, publish_attempts
      ) VALUES ($1, 'catalog.book-published.v1', 'BookPublished', 1, 'Book', $2, $3::jsonb, $4, $2, $5, $5, 1)
    `,
    [
      UNIT06_FIXTURE_IDS.publicationEventId,
      UNIT06_FIXTURE_IDS.bookId,
      JSON.stringify({ bookId: UNIT06_FIXTURE_IDS.bookId, bookVersionId: UNIT06_FIXTURE_IDS.activeVersionId }),
      `unit06-fixture-publication:${UNIT06_FIXTURE_IDS.bookId}`,
      "2026-07-28T10:00:00.000Z",
    ],
  );
  await database.query(
    `
      INSERT INTO moderation_cases (
        id, subject_type, subject_id, subject_version_id, trigger_type,
        source_event_id, idempotency_key, status
      ) VALUES ($1, 'book_update', $2, $3, 'submission', $4, $5, 'approved')
    `,
    [UNIT06_FIXTURE_IDS.publicationCaseId, UNIT06_FIXTURE_IDS.bookId, UNIT06_FIXTURE_IDS.activeVersionId, UNIT06_FIXTURE_IDS.publicationEventId, `unit06-publication-case:${UNIT06_FIXTURE_IDS.bookId}`],
  );
  await database.query(
    "INSERT INTO moderation_book_subjects (case_id, book_id, book_version_id) VALUES ($1, $2, $3)",
    [UNIT06_FIXTURE_IDS.publicationCaseId, UNIT06_FIXTURE_IDS.bookId, UNIT06_FIXTURE_IDS.activeVersionId],
  );
  await database.query(
    `
      INSERT INTO book_publications (book_id, active_book_version_id, state, activation_case_id)
      VALUES ($1, $2, 'published', $3)
    `,
    [UNIT06_FIXTURE_IDS.bookId, UNIT06_FIXTURE_IDS.activeVersionId, UNIT06_FIXTURE_IDS.publicationCaseId],
  );
  await database.query(
    `
      INSERT INTO catalog_book_read_models (
        book_id, title, author_public_id, author_public_name, genre_slug,
        description, sample_title, sample_blocks, cover_path, cover_theme,
        base_price_kopiykas, availability, catalog_rank, rating_count,
        published_at, updated_at, source_book_version_id, source_event_id, projection_revision
      ) VALUES (
        $1, $2, $3, $4, 'proza', $5, 'Розділ перший', $6::jsonb,
        $7, 'violet', $8, 'published', 1, 0, $9, $9, $10, $11, 1
      )
    `,
    [
      UNIT06_FIXTURE_IDS.bookId, UNIT06_FIXTURE_BOOK.title, UNIT06_FIXTURE_IDS.authorUserId,
      UNIT06_FIXTURE_BOOK.author, "Тиха історія про літо, море і повернення додому.",
      JSON.stringify([{ kind: "paragraph", text: "Над лиманом повільно сходило сонце." }]),
      UNIT06_FIXTURE_BOOK.coverPath, UNIT06_FIXTURE_BOOK.priceKopiykas,
      "2026-07-28T10:00:00.000Z", UNIT06_FIXTURE_IDS.activeVersionId, UNIT06_FIXTURE_IDS.publicationEventId,
    ],
  );

  const paidAt = "2026-07-28T12:00:00.000Z";
  await database.query(
    "INSERT INTO commerce_carts (id, buyer_user_id, status, revision) VALUES ($1, $2, 'purchased', 1)",
    [UNIT06_FIXTURE_IDS.cartId, UNIT06_FIXTURE_IDS.buyerUserId],
  );
  await database.query(
    `
      INSERT INTO commerce_orders (
        id, buyer_user_id, cart_id, cart_revision, reference, status,
        total_kopiykas, paid_at
      ) VALUES ($1, $2, $3, 1, 'unit06-paid-order', 'paid', $4, $5)
    `,
    [UNIT06_FIXTURE_IDS.orderId, UNIT06_FIXTURE_IDS.buyerUserId, UNIT06_FIXTURE_IDS.cartId, UNIT06_FIXTURE_BOOK.priceKopiykas, paidAt],
  );
  await database.query(
    `
      INSERT INTO commerce_order_items (
        id, order_id, ordinal, book_id, book_version_id, author_id,
        title_snapshot, author_public_name_snapshot, cover_path_snapshot,
        quantity, base_price_kopiykas, discount_kopiykas,
        unit_price_kopiykas, line_total_kopiykas
      ) VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, 1, $9, 0, $9, $9)
    `,
    [
      UNIT06_FIXTURE_IDS.orderItemId, UNIT06_FIXTURE_IDS.orderId, UNIT06_FIXTURE_IDS.bookId,
      UNIT06_FIXTURE_IDS.purchasedVersionId, UNIT06_FIXTURE_IDS.authorUserId,
      UNIT06_FIXTURE_BOOK.title, UNIT06_FIXTURE_BOOK.author, UNIT06_FIXTURE_BOOK.coverPath,
      UNIT06_FIXTURE_BOOK.priceKopiykas,
    ],
  );
  await database.query(
    `
      INSERT INTO commerce_payment_sessions (
        id, order_id, request_key, provider_invoice_id, checkout_url,
        status, amount_kopiykas, expires_at, provider_created_at, provider_modified_at
      ) VALUES ($1, $2, 'unit06-payment-request', 'unit06-invoice', 'https://pay.example.invalid/unit06', 'success', $3, '2026-07-28T13:00:00.000Z', $4, $4)
    `,
    [UNIT06_FIXTURE_IDS.paymentSessionId, UNIT06_FIXTURE_IDS.orderId, UNIT06_FIXTURE_BOOK.priceKopiykas, paidAt],
  );
  await database.query(
    `
      INSERT INTO commerce_paid_sales (
        id, order_id, payment_session_id, provider_invoice_id,
        total_kopiykas, paid_at
      ) VALUES ($1, $2, $3, 'unit06-invoice', $4, $5)
    `,
    [UNIT06_FIXTURE_IDS.paidSaleId, UNIT06_FIXTURE_IDS.orderId, UNIT06_FIXTURE_IDS.paymentSessionId, UNIT06_FIXTURE_BOOK.priceKopiykas, paidAt],
  );
  await appendOutboxEvent(database, {
    aggregateId: UNIT06_FIXTURE_IDS.paidSaleId,
    aggregateType: "PaidSale",
    correlationId: UNIT06_FIXTURE_IDS.orderId,
    eventType: "PaidSale",
    idempotencyKey: `unit06-paid-sale:${UNIT06_FIXTURE_IDS.paidSaleId}`,
    occurredAt: paidAt,
    payload: {
      buyerUserId: UNIT06_FIXTURE_IDS.buyerUserId,
      currency: "UAH",
      items: [{
        authorId: UNIT06_FIXTURE_IDS.authorUserId,
        bookId: UNIT06_FIXTURE_IDS.bookId,
        bookVersionId: UNIT06_FIXTURE_IDS.purchasedVersionId,
        orderItemId: UNIT06_FIXTURE_IDS.orderItemId,
        paidPriceKopiykas: UNIT06_FIXTURE_BOOK.priceKopiykas,
        quantity: 1,
      }],
      orderId: UNIT06_FIXTURE_IDS.orderId,
      paidAt,
      paidSaleId: UNIT06_FIXTURE_IDS.paidSaleId,
      paymentSessionId: UNIT06_FIXTURE_IDS.paymentSessionId,
      provider: "mono",
      providerInvoiceId: "unit06-invoice",
      schemaVersion: 1,
      totalKopiykas: UNIT06_FIXTURE_BOOK.priceKopiykas,
    },
    topic: "commerce.paid-sale.v1",
  });
  const entitlementIds = await relayPaidSaleEntitlements(database);
  if (entitlementIds.length !== 1) throw new Error("UNIT-06 seed failed to create exactly one entitlement");
  process.stdout.write(`${JSON.stringify({ active_version: UNIT06_FIXTURE_IDS.activeVersionId, entitlement: entitlementIds[0], status: "passed" })}\n`);
} finally {
  await database.close?.();
}
