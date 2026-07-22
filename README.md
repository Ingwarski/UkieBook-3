# UkieBook

![Офіційний логотип UkieBook](UkieBook-logo-transparent.svg)

UkieBook — українська платформа самопублікацій із власною онлайн-книгарнею. Поточний репозиторій містить валідований SDD-пакет, затверджений visual baseline «Аврора · пастельна 7b», офіційний логотип і доказові матеріали дизайну.

## Поточний стан

- SDD pipeline: `development-plan-validated`
- Approved Visual Baseline: `AVB-UKIEBOOK-AURORA-7B-V3`
- `UNIT-00` завершено на revision `f6e503b242d5a5eca59972dece1657f4d207b3e3`: Next.js/TypeScript web foundation, окремі worker/scheduler runtimes, PostgreSQL migrations + transaction/outbox/durable jobs, secret/import boundaries, Aurora tokens/primitives and automated evidence runner.
- `UNIT-01` завершено на revision `ab030a00f213d33f62783f0287dd8e5dcfe67101`: Google/Facebook OAuth adapters, one-time flows, hashed/revocable sessions, explicit RBAC, S-03/S-17, atomic first-Author profile+role grant, protected-data separation, real PostgreSQL/browser/visual evidence, AA control contrast and measured 44px touch targets.
- `UNIT-02` завершено на revision `a441ab415d2818872599f01efae856acebf75b42`: catalog/Book Page behavior, PostgreSQL projection, пошук/фільтри/сортування/пагінація, Discount/sample/reviews/unavailable/responsive states. Його V2 visual receipt лишається історичним.
- `UNIT-02-C1` завершено на correction revision `3f77594bcb615847bdd71846374184cd2070d305`: усі кути Обкладинок `0px`, сім унікальних baked-artwork Covers, необрізана перша полиця, exact hero copy, public `35/65`, manager-only `29+6+65` і transparent SVG logo. Revision-bound verification пройшов на `338d4450e107d6d6bafd56d4baa1ca3e578d0e04`; фінальна зовнішня Chrome-інспекція каталогу, Book Page і login не виявила нових console errors або horizontal overflow.
- `UNIT-03` завершено на revision `6fb52daf3ff11630454c13a76adfd7875c749e8f`: S-10/S-11/S-12 Author wizard, private DOCX/TXT/bounded Google Docs import, Calibre `9.11.0` conversion to validated EPUB + legacy MOBI, inline Illustrations, fallback/upload Cover, sample bound to the completed preview, immutable `BookVersion`, separate rights/license declarations, `BookSubmitted`, failure/retry and bounded request bodies. Canonical run passed 105 tests/2 skipped, 3/3 E2E, 30 visual screenshots, 7 accessibility receipts and `npm audit` with 0 vulnerabilities. Private storage is proved through the local adapter boundary; production S3-compatible deployment is not claimed.
- `UNIT-04` завершено на revision `4552048aeb2ba6da16b47ac289058b14d5641869`: `BookSubmitted` relay, safe auto-publication/manual routing, S-13/S-18, type-safe Book/Update/Review decision contracts, immutable screening/decision/audit, one active-publication pointer, atomic Catalog/public-Cover activation and audited FR-LIC-4 removal with archival S-02 unavailable state. Canonical run passed 109 tests/3 skipped, 4/4 E2E, 50 visual screenshots, 8 accessibility receipts, real PostgreSQL migration `0005_moderation_publication` and `npm audit` with 0 vulnerabilities. Update/Review producer/application flows, Discount/250 UAH and rewards/founder remain in later owning units.
- Canonical passed evidence: UNIT-00 — `forge/runs/UNIT-00/20260721T202102Z-f6e503b242d5/run.json`; UNIT-01 — `forge/runs/UNIT-01/20260721T221049Z-ab030a00f213/run.json`; UNIT-02 — `forge/runs/UNIT-02/20260722T011333Z-a441ab415d28/run.json`; UNIT-02-C1 — `forge/runs/UNIT-02-C1/20260722T115720Z-338d4450e107/run.json`; UNIT-03 — `forge/runs/UNIT-03/20260722T151115Z-6fb52daf3ff1/run.json`; UNIT-04 — `forge/runs/UNIT-04/20260722T190601Z-4552048aeb2b/run.json`.
- Наступний executable unit: `UNIT-05` — persistent/mergeable Cart, S-04, provider-owned S-05 mono payment, S-06 result/recovery, immutable order-price snapshot, signed/idempotent webhook reconciliation, transactional `PaidSale`, isolated E-01 purchase notification, auth return-to and failed-payment recovery.
- Решта product journeys і S-04…S-09/S-14…S-16/S-19…S-21 ще не реалізовані. Release readiness remains blocked by UNIT-05…UNIT-10 and external release gates. Credentialed Google/Facebook smoke окремо блокує production provider activation, але не завершеність локально доказаного UNIT-01.

## Основні артефакти

- [Product idea](docs/product-idea.md)
- [PRD](docs/prd.md)
- [Architecture](docs/architecture.md)
- [Design brief](docs/design-brief.md)
- [QA checklist](docs/qa-checklist.md)
- [Development plan](docs/development-plan.md)
- [UNIT-02-C1 design QA](design-qa.md)
- [SDD manifest](forge/sdd-manifest.json)
- [Active V3 design handoff](forge/design/candidates/operator-final-7b/v3/README.md)

Активний офіційний файл логотипа: [`UkieBook-logo-transparent.svg`](UkieBook-logo-transparent.svg), SHA-256 `db838dd4ad696f63cccb6aa86ab98e53dc5c6e13c1778ac340f62c5e4514617f`. Це transparent raster-backed SVG distribution container без background, не path-based vector artwork. [`UkieBook-logo.jpg`](UkieBook-logo.jpg) та [`UkieBook-logo-exact.svg`](UkieBook-logo-exact.svg) збережені лише як superseded history.
