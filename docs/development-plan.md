# Development Plan

## Source References

- `docs/prd.md` v1.2 — product scope, FR/NFR, US-001…US-012, acceptance scenarios and exact correction formula.
- `docs/project-context.md` — applied: section 7 (adaptive Ukrainian web/UAH), 11 (privacy/design constraints), 13 (conversion/operations/reference risks).
- `docs/canonical-terms.md` — applied roles, domain objects/actions/states, Screen/Flow Names and Terms to Avoid.
- `docs/user-journey.md`, `docs/screen-map.md`, `docs/wireframes.md` — journey, S-01…S-21, routes/states/structure.
- `docs/design-brief.md` — Approved Baseline `AVB-UKIEBOOK-AURORA-7B-V3`; target bundle hash `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724`; tree hash `7b13c9e123694cf800ccda987aa64a7f98e625d671161a838b4f94e315feba97`; permitted variance.
- `docs/architecture.md` — AD-1…AD-11, module/data/integration/security/runtime contracts.
- `docs/dod-evals.md` — standing DoD and reusable gates.
- `docs/qa-checklist.md` — concrete ACC/UJ/ST/WF/UX/VIS/RES/A11Y/INT/BD checks.
- `docs/guardrails.md` — authority, evidence and high-risk boundaries.
- `forge/design/README.md` and `forge/design/candidates/operator-final-7b/v3/` immutable target artifacts — visual reference only, no runtime truth. V1/V2 remain superseded history.
- `UkieBook-logo-transparent.svg` / `public/brand/UkieBook-logo-transparent.svg` — active official transparent-background SVG container, SHA-256 `db838dd4ad696f63cccb6aa86ab98e53dc5c6e13c1778ac340f62c5e4514617f`; raster-backed, not path-vector artwork.
- `forge/runs/UNIT-03/20260722T151115Z-6fb52daf3ff1/run.json` — canonical completed UNIT-03 receipt at revision `6fb52daf3ff11630454c13a76adfd7875c749e8f`; S-10/S-11/S-12 through `BookSubmitted`, real EPUB+legacy MOBI conversion, private artifact boundary and scoped visual/accessibility evidence. UNIT-04 is the next executable unit.

## Implementation Strategy

Build one TypeScript modular monolith as dependency-ordered vertical slices. Bootstrap the verification and data foundations first; then develop public catalog/identity and independently testable domain seams; integrate publishing, commerce, library, moderation and rewards through explicit contracts. Finish with cross-product visual/accessibility hardening and release topology.

The public S-01 desktop V3 target is reimplemented exactly in semantic React/CSS, not copied as application logic. Its locked correction includes the transparent SVG logo, all Book Covers at `border-radius:0`, seven distinct realistic baked-title artworks with no live title overlay, a fully visible five-cover shelf, exact hero sentence and public `35/65` formula. S-02…S-21 extend Aurora 7b through the approved Design/Experience Spine. Every visible unit binds to the same Baseline ID/hash and the exact-vs-extension coverage rules. Static HTML never substitutes for real auth, data, persistence, integrations, security or state behavior.

Money is integer kopiykas; standard percentage rules are exact basis points (`2900` net platform + `600` platform tax component + `6500` Author = `10000`; public platform share `3500`); ledger/outbox/jobs are transactional PostgreSQL records; objects are private and versioned; mono webhook handlers are idempotent; AI/email/conversion are adapters. Tests verify SDD truth rather than define it.

## Codebase Map

Current UNIT-00 foundation, UNIT-01 identity/profile, UNIT-02 catalog/Book Page behavior, UNIT-02-C1 correction and UNIT-03 publishing/conversion slice; latest completed implementation revision `6fb52daf3ff11630454c13a76adfd7875c749e8f`:

```text
app/
  page.tsx, loading.tsx       S-01 catalog and loading state
  books/[id]/                 S-02 Book Page, loading and not-found boundary
  api/health/               web runtime/revision health
  api/auth/                 Google/Facebook start, callback and logout boundaries
  login/                    S-03
  author/profile/           S-17 page and protected Server Action
  author/books|publish/     S-10/S-11/S-12 Author wizard, preview and submitted state
  api/author/publishing/    bounded private uploads/imports and Author-owned object reads
  admin/ library/           explicit guarded placeholders, not feature completion
  fixtures/aurora/          explicit non-product VIS-TOKENS fixture
components/
  aurora/                   tokens and accessible visual primitives
  identity/                 S-03/S-17 Aurora extension components and pending states
  catalog/                  semantic S-01/S-02 Aurora UI, formula, header, covers and pagination
  publishing/               Aurora Author list/wizard/preview, uploads, legal confirmations and recovery
modules/
  platform/                 runtime identity, SQL port, transactions, outbox/jobs, env/evidence
  identity/                 OAuth adapters, crypto, repository, sessions, guards and policy
  author-profile/           public profile validation/repository/service
  payout-details/           restricted encrypted-envelope repository boundary only
  catalog/                  additive public DTO/query/price contracts, PostgreSQL repository and guarded fixtures
  publishing/               drafts, immutable versions/declarations, converter, worker, private-storage port and service
db/
  migrations/               reversible checksummed PostgreSQL migrations 0001 + 0002 + 0003 + 0004
  postgres.ts               production adapter
  pglite.ts                 test-only adapter
workers/
  worker.ts scheduler.ts    separate executable roles
scripts/                    build/boundary/hygiene, OAuth simulator, UNIT-00/01/02/03 evidence runners
tests/
  unit/ integration/ e2e/ visual/ plus UNIT-01/02/03 browser/visual suites
public/brand/               active transparent-background UkieBook SVG and provider marks with provenance
public/books/covers/final/  seven distinct realistic 2:3 baked-title production Covers
```

The S-03/S-17 routes and identity/profile contracts above are complete only within UNIT-01; S-01/S-02 catalog behavior/read contracts are complete within UNIT-02 and their current V3 presentation within UNIT-02-C1. `/author/books` and `/author/publish` now implement UNIT-03 only through Author submission and `BookSubmitted`; `/admin`, `/library`, S-13/S-18 moderation/publication lifecycle and the public catalog projection remain later owning scopes. UNIT-02 deterministic catalog seed is a production-rejected bootstrap path; UNIT-04 must consume the frozen UNIT-03 event/version boundary to populate the additive catalog-publisher boundary after Manual Review and publication activation.

Module imports point inward to domain contracts; UI and provider adapters may depend on domain interfaces, never the reverse. Cross-module mutation happens through commands/events, not direct table writes.

## Implementation Units

### UNIT-00 — Repository, runtime, data and verification foundation

- **Execution Status:** `completed` on 2026-07-21 at implementation revision `f6e503b242d5a5eca59972dece1657f4d207b3e3`; canonical passed run `forge/runs/UNIT-00/20260721T202102Z-f6e503b242d5/run.json`.
- **Purpose:** bootstrap the executable TypeScript/Next.js/worker runtime and stable evidence commands in the already initialized project repository without implementing product journeys.
- **Source References:** architecture AD-1/6/7/8/9; dod-evals Hard Gates; design-brief tokens/accessibility floor.
- **Depends On:** none.
- **Work Items:** initialize the npm workspace; scaffold Next.js App Router, Node worker and scheduler entrypoints; PostgreSQL migration/query layer; transaction/outbox/job primitives; environment validation and secret boundaries; CSS token layer matching Aurora; accessible primitive skeletons; Vitest/Playwright configuration; commands `build`, `lint`, `typecheck`, `test`, `test:e2e`, `test:visual`; evidence/result directories and format.
- **Acceptance Checks:** all six npm commands exist; build/lint/typecheck/unit smoke run locally; migrations can apply/rollback on an empty database; worker claims one test job idempotently; no secret enters client bundle; active token snapshot is reconciled to design-brief V3 by UNIT-02-C1.
- **Verification:** DoD `build`, `typecheck_lint`, `tests`; architecture boundary review; `VIS-TOKENS` token-export/computed-style fixture; `npm run test:visual` can capture a fixture route.
- **Delivery Layer:** infrastructure.
- **Baseline Impact:** enables later user-visible UI; no shippable product screen.
- **Prototype Reuse:** none.
- **Interfaces Produced:** `DomainTransaction`, `OutboxEvent`, `DurableJob`, environment contract, Aurora token module, Eval Result writer.
- **Interfaces Consumed:** none.
- **API/Data Contract References:** architecture AD-6/7/8/9.
- **Interface Owner:** platform foundation.
- **Compatibility Expectations:** migrations are forward-safe; event/job envelopes are versioned; npm command names remain stable.
- **Integration Verification:** web and worker use the same schema/revision; one committed transaction emits one outbox event and one idempotent job.
- **Completion Evidence:** all six stable commands passed; production web/worker/scheduler identities matched; real PostgreSQL migration/transaction/concurrency/idempotency/lease proofs passed; repository and browser secret-boundary proofs passed; UNIT-00 `VIS-TOKENS` fixture passed; zero open P0/P1 or blocking P2. Prototype reuse remained `none`, so no promotion receipt applies.

### UNIT-01 — Identity, sessions, RBAC and Author profile

- **Execution Status:** `completed` on 2026-07-21 at implementation revision `ab030a00f213d33f62783f0287dd8e5dcfe67101`; canonical passed run `forge/runs/UNIT-01/20260721T221049Z-ab030a00f213/run.json`.
- **Purpose:** implement Google/Facebook OAuth, role guards, public Author name and protected-data separation; deliver S-03/S-17.
- **Source References:** FR-AUTH-1..4; US-002; S-03/S-17 states/routes; architecture `identity`/`author-profile` and Security; QA ACC-01, ST-02/06/11, A11Y-02/03.
- **Depends On:** UNIT-00.
- **Work Items:** production Google OIDC/Facebook OAuth adapters with code+PKCE; one-time encrypted flows and provider mapping; hashed/revocable sessions; explicit Guest/Buyer/Author/Manager capability guards; first-Author redirect S-03→S-17→S-11 with atomic profile+role grant and session rotation; public `author_profile` separate from encrypted/restricted `author_payout_details`; append-only identity audit; semantic provider controls and controlled mutation errors.
- **Acceptance Checks:** only named OAuth methods appear; return-to-source works; protected-route matrix passes; Author cannot access Manager routes; public responses never expose payout fields; S-17 saves canonical public name.
- **Verification:** scoped ACC-01; UJ-01 stages 1–2; S-03 portion of ST-02, S-17 portion of ST-06 and identity portion of ST-11; `identity_integration`, `auth_security`, scoped `access_separation`; UX-04/06/07, affected RES-01/04/06 and A11Y-01..05; local provider-protocol/browser smoke. Credentialed live-provider smoke remains an activation gate.
- **Delivery Layer:** full-stack.
- **Approved Baseline ID:** `AVB-UKIEBOOK-AURORA-7B-V3`.
- **Immutable Visual Target Hash:** `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724`.
- **Baseline Screens States And Viewports:** S-03/S-17 all screen-map states at 390/430/768/1280/1440; Aurora extension coverage, no pixel target.
- **Design Contract And Permitted Variance:** Aurora forms/glass/tokens, provider brand controls, readable labels; exact S-01 not touched.
- **Operator Visual Overrides:** final 7b system only; no alternative candidate styling.
- **Visual Fidelity Verification:** `approved_visual_baseline_fidelity` via `VIS-AURORA-PUBLIC`, `VIS-AURORA-AUTHOR`, `VIS-TOKENS`, `VIS-GLASS`, affected RES/A11Y.
- **Prototype Reuse:** none.
- **Production Capabilities Added Beyond Prototype:** OAuth, sessions, RBAC, persistent profile, validation/errors/audit.
- **Interfaces Produced:** `OAuthProviderId`, `AuthIntent`, `AuthSession`, `UserRole`, `AuthorProfile`, `RouteAccessDecision`, provider adapter/registry and route guard policy; public profile DTO is exactly `{authorId, publicName}`.
- **Interfaces Consumed:** UNIT-00 `SqlDatabase`, transaction/migration/runtime/environment contracts and PostgreSQL adapter.
- **API/Data Contract References:** FR-AUTH; canonical roles/actions; architecture identity boundary.
- **Interface Owner:** `identity` / `author-profile`.
- **Compatibility Expectations:** migration IDs/checksums are immutable and additive; provider+subject mapping never auto-links by email; role checks have no hierarchy; public profile DTO excludes restricted fields by construction; payout envelope content remains UNIT-07-owned.
- **Integration Verification:** Google/Facebook callback→persistent session→trusted redirect; callback replay/concurrent mapping; first-Author S-17→atomic role/profile→session rotation; existing-Author return; negative role/CSRF/unsafe-return/forged-signature/wrong-nonce/userinfo-sub matrix; public/payout data separation.
- **Completion Evidence:** dependency audit, typecheck/lint/source boundaries, 55 Vitest tests and production build passed; real PostgreSQL rollback/reapply and identity concurrency proof passed; standard E2E/visual 1/1 each, UNIT-01 E2E 3/3 and visual 2/2 passed; 26 HiDPI screenshots, 200% reflow, computed control contrast ≥4.5:1 and every rendered S-03/S-17 link/button target ≥44×44 CSS px recorded; evidence secret scan found no leaks/trace/HAR; zero P0/P1/blocking P2. Live Google/Facebook consent remains blocked only for production provider activation.

### UNIT-02 — Aurora public catalog and Book Page (behavior baseline)

- **Execution Status:** `completed` on 2026-07-22 at implementation revision `a441ab415d2818872599f01efae856acebf75b42`; canonical behavior/persistence run `forge/runs/UNIT-02/20260722T011333Z-a441ab415d28/run.json`. Its V2 visual receipt is historical and superseded by UNIT-02-C1.
- **Purpose:** deliver production S-01 and S-02 with exact desktop baseline plus search/filter/read-model behavior and responsive states.
- **Source References:** FR-CAT-1..4, FR-AUTH-2, US-001/004; S-01/S-02; wireframes S-01/S-02; architecture AD-8/11; QA ACC-08, ST-01 and behavior portions of WF/UX/INT. Current visual authority is delegated to UNIT-02-C1.
- **Depends On:** UNIT-00. Can start with source fixtures; authenticated header integration consumes UNIT-01 when ready.
- **Work Items:** semantic Aurora header/hero/shelf/tiles/formula; catalog repository/read model, title/Author/Genre/Discount query, pagination; Book Page with sample/reviews slot; real icons; loading/empty/error/unavailable states; deterministic responsive reflow; authenticated Library/profile affordance integration. Exact correction assets/copy/geometry are owned by UNIT-02-C1.
- **Acceptance Checks:** S-01 1280 default/hover matches target within permitted variance; official logo identity is preserved inside the locked header geometry; header labels/copy exact; search/filter URLs/state work; Book Page includes all FR-CAT-3 content; no horizontal overflow at required viewports; semantic keyboard controls replace demo divs without visual drift.
- **Verification:** ACC-08; ST-01; WF-02/04; UX-03/04/07; VIS-S01-1280-DEFAULT/HOVER/RESPONSIVE; VIS-AURORA-PUBLIC; VIS-TOKENS; VIS-GLASS; VIS-COVER; VIS-FORMULA; VIS-BRAND-LOGO; RES-01/02; A11Y-01/02/04/06/08; catalog-owned cover/tile/search/Genre/Discount portion of INT-04. The Cart destination/behavior portion of INT-04 remains UNIT-05-owned and is not claimed by UNIT-02.
- **Delivery Layer:** full-stack.
- **Approved Baseline ID:** `AVB-UKIEBOOK-AURORA-7B-V3`.
- **Immutable Visual Target Hash:** `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724`.
- **Baseline Screens States And Viewports:** exact S-01 `/` default/cover+tile hover at 1280×900; derived S-01 states at 390/430/768/1440; S-02 all states at 390/768/1280 via extension contract.
- **Design Contract And Permitted Variance:** all Baseline permitted variance; functional result continuation follows formula or existing controls; no insertion inside locked sequence.
- **Operator Visual Overrides:** original UNIT-02 receipt is historical; active corrections are owned and verified by UNIT-02-C1.
- **Visual Fidelity Verification:** `approved_visual_baseline_fidelity` with all `VIS-S01-*`, `VIS-AURORA-PUBLIC`, `VIS-TOKENS`, `VIS-GLASS`, `VIS-COVER`, `VIS-FORMULA` and `VIS-BRAND-LOGO` checks.
- **Prototype Reuse:** none.
- **Production Capabilities Added Beyond Prototype:** routing, real data/query, semantic controls, responsive layout, state handling, accessibility, Book Page.
- **Interfaces Produced:** `CatalogQuery`, `BookCatalogReadModel`, `BookPageReadModel`, `PricePresentation`.
- **Interfaces Consumed:** UNIT-00 persistence/tokens; optional UNIT-01 `AuthSession`.
- **API/Data Contract References:** FR-CAT; screen-map S-01/S-02; canonical Book/Genre/Discount/Free Sample.
- **Interface Owner:** `catalog`.
- **Compatibility Expectations:** read DTOs are versioned/additive; price always integer kopiykas + formatted UAH.
- **Integration Verification:** fixture→query/filter→S-01/S-02; auth-state header; visual target comparisons.
- **Completion Evidence:** dependency audit, typecheck/lint/source boundaries, npm audit, tests/build and real PostgreSQL migration 0003/read-model/privacy/Discount receipts remain immutable at the original run. Its V2 screenshots are history only. Cart destination/behavior is explicitly unpassed and UNIT-05-owned; Prototype Reuse remains `none`.

### UNIT-02-C1 — Operator correction: V3 catalog presentation and formula truth

- **Execution Status:** `completed` on 2026-07-22 at implementation revision `3f77594bcb615847bdd71846374184cd2070d305`; canonical passed run `forge/runs/UNIT-02-C1/20260722T115720Z-338d4450e107/run.json`.
- **Purpose:** close the exact operator correction without changing UNIT-02 catalog behavior or the next-unit order.
- **Depends On:** UNIT-02.
- **Work Items:** freeze `AVB-UKIEBOOK-AURORA-7B-V3`; use `UkieBook-logo-transparent.svg` without background; set every Book Cover radius to `0`; use seven distinct realistic 2:3 assets with different baked-in titles and no live title overlay; make all five first-row covers fully visible; set exact hero sentence `Електронні книжки EPUB і MOBI миттєво у вашу бібліотеку.`; set public ribbon to `35%` platform / `65% — автору`; reconcile all 13 SDD owner artifacts and tests.
- **Acceptance Checks:** V3 target bundle hash `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724`, tree `7b13c9e123694cf800ccda987aa64a7f98e625d671161a838b4f94e315feba97` and VQA `ffae4a71e0db785033aad606e91b1557ef46d56d86690f8e09ae6cc81906323c` bind the run; DOM/computed-style/asset/geometry/browser checks prove every correction; no old percentage or hero copy remains active.
- **Financial Boundary:** public/Author presentation uses `35/65`; future UNIT-07 implements manager-only `29%` net platform revenue + `6%` platform tax component + `65%` Author, exact basis points `2900+600+6500=10000`.
- **Verification:** build/typecheck/lint/tests; exact V3 S-01 browser comparison; `VIS-S01-*`, `VIS-COVER`, `VIS-SHELF`, `VIS-HERO-COPY`, `VIS-FORMULA`, `VIS-BRAND-LOGO`; external browser inspection after this visual unit.
- **Delivery Layer:** frontend + SDD reconciliation.
- **Approved Baseline ID:** `AVB-UKIEBOOK-AURORA-7B-V3`.
- **Immutable Visual Target Hash:** `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724`.
- **Prototype Reuse:** none.
- **Next Executable Unit:** UNIT-03.

### UNIT-03 — Publishing, conversion proof and Author wizard

- **Execution Status:** `completed` on 2026-07-22 at implementation revision `6fb52daf3ff11630454c13a76adfd7875c749e8f`; canonical passed run `forge/runs/UNIT-03/20260722T151115Z-6fb52daf3ff1/run.json`.
- **Purpose:** prove EPUB/MOBI engine and deliver S-10/S-11/S-12 from draft to submitted Book version.
- **Source References:** FR-PUB-1..9, FR-LIC-1..3, US-002/003; journey Author 1–8; S-10…S-12; architecture AD-4/9 and closed OQ-AR3; QA ACC-02..04, UJ-01/03, ST-04, INT-02.
- **Depends On:** UNIT-00, UNIT-01; UNIT-02 read-model interface for the Сторінка книжки inside Попередній перегляд видання.
- **Work Items:** run the bounded converter enabler on representative DOCX/TXT/Google Docs fixtures with inline Illustrations; prove `calibre-legacy-mobi-v1` on Calibre `9.11.0`; implement bounded private uploads/imports, version hashes, technical normalization, fallback/upload Cover, sample selection bound to the completed current `PreviewArtifact`, background conversion, draft persistence, Попередній перегляд видання/Сторінки книжки; separate rights and license confirmations; emit immutable `BookVersion` and `BookSubmitted`, then return the Author to the submitted S-10 state. S-13/moderation/publication remains UNIT-04.
- **Acceptance Checks:** both formats validate on fixtures; technical cleanup never rewrites meaning; conversion failure preserves draft and reports recovery; Попередній перегляд видання covers all FR-PUB-6 zones; submission blocked unless both confirmations are true; Author never enters S-18.
- **Verification:** `conversion_pipeline`, `journey_author_e2e` through submission, ACC-02..04, ST-04, WF-03/04, INT-02, storage authorization tests.
- **Delivery Layer:** full-stack.
- **Approved Baseline ID:** `AVB-UKIEBOOK-AURORA-7B-V3`.
- **Immutable Visual Target Hash:** `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724`.
- **Baseline Screens States And Viewports:** S-10/S-11/S-12 all states at 390/430/768/1280/1440; Aurora Author extension coverage.
- **Design Contract And Permitted Variance:** calm Aurora forms/statuses, Literata reading surface after provenance check, clear legal blocks; no pixel target.
- **Operator Visual Overrides:** 7b visual system; rights/license functionality added without redesign.
- **Visual Fidelity Verification:** `approved_visual_baseline_fidelity` via `VIS-AURORA-AUTHOR`, `VIS-TOKENS`, `VIS-GLASS`, `VIS-COVER`, RES-04, A11Y forms/dialogs.
- **Prototype Reuse:** none.
- **Production Capabilities Added Beyond Prototype:** upload/storage, conversion, draft/version state, Попередній перегляд видання, Cover fallback, legal confirmations.
- **Interfaces Produced:** `BookDraft`, `BookVersion`, `ConversionJob/Result`, `PreviewArtifact`, `BookSubmitted`.
- **Interfaces Consumed:** UNIT-01 `AuthSession/AuthorProfile`; UNIT-02 `BookPageReadModel` shape; UNIT-00 jobs/storage.
- **API/Data Contract References:** FR-PUB/LIC; AD-4/9.
- **Interface Owner:** `publishing`.
- **Compatibility Expectations:** converter input/output adapters are replaceable; BookVersion immutable; events schema-versioned.
- **Integration Verification:** upload→job→artifacts→Попередній перегляд видання→two confirmations→submitted state.
- **Completion Evidence:** Calibre `9.11.0` with `epub-container.v1` and `legacy-mobi-header.v1` validators produced real EPUB and legacy MOBI from DOCX/TXT/bounded Google Docs; DOCX/Google Docs inline Illustrations and meaning hashes were preserved. Dedicated PostgreSQL `ukiebook_unit03` proved migration `0004`, private local storage through `PrivateObjectStorage`, immutable `BookVersion`, separate declarations, one `BookSubmitted`, stale-job protection and conversion failure/retry without draft loss. All bounded-body, repository, build/typecheck/lint and audit gates passed; Vitest recorded 105 passed/2 skipped, E2E 3/3, and the Aurora Author extension recorded 30 screenshots plus 7 accessibility receipts with no blocking findings. The receipt does not claim production S3 deployment, Manual Review, moderation decisions, publication activation or public catalog projection.

### UNIT-04 — Manual Review and Book lifecycle

- **Purpose:** deliver moderation routing, S-13/S-18, type-specific decisions and audited removal under FR-LIC-4.
- **Source References:** FR-MOD-1..5, FR-LIC-4; US-010; supporting Manager journey; S-13/S-18; architecture AD-5; QA ACC-05/06, ST-05/07, UJ-05.
- **Depends On:** UNIT-01, UNIT-03; UNIT-02 publication read model.
- **Work Items:** AI adapter/fake and safe-fail; moderation_case states; Manager queue/detail; Book/Update Author Reason Category; review decision without unsupported buyer reason; publication activation; audited removal of risky published Book; downstream status/read-model events.
- **Acceptance Checks:** safe item and risky/manual paths work; internal criteria absent from public DTO/logs; each object type produces correct downstream state; removal requires reason/confirmation and makes S-02 unavailable; Author receives only canonical Reason Category.
- **Verification:** `moderation_flow`, `access_separation`, ACC-05/06, ST-05/07, UJ-05, audit inspection.
- **Delivery Layer:** full-stack.
- **Approved Baseline ID:** `AVB-UKIEBOOK-AURORA-7B-V3`.
- **Immutable Visual Target Hash:** `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724`.
- **Baseline Screens States And Viewports:** S-13/S-18 states at 390/768/1280; S-02 unavailable state.
- **Design Contract And Permitted Variance:** Aurora Author/Manager extension; status semantics consistent; destructive confirmation explicit.
- **Operator Visual Overrides:** final 7b system.
- **Visual Fidelity Verification:** `approved_visual_baseline_fidelity` via `VIS-AURORA-AUTHOR/MANAGER/PUBLIC`, `VIS-TOKENS`, `VIS-GLASS`, `VIS-COVER` and UX-05/06.
- **Prototype Reuse:** none.
- **Production Capabilities Added Beyond Prototype:** AI routing, Manual Review, audit, publication lifecycle and removal.
- **Interfaces Produced:** `ModerationCase`, `ModerationDecision`, `PublicationActivated/Removed`, `ReasonCategory`.
- **Interfaces Consumed:** `BookSubmitted`, UNIT-01 Manager role, UNIT-02 catalog publisher.
- **API/Data Contract References:** FR-MOD/LIC-4; moderation module boundary.
- **Interface Owner:** `moderation`.
- **Compatibility Expectations:** public decision DTO never includes internal signals/rules; decisions idempotent/audited.
- **Integration Verification:** submitted→AI result→queue→decision→Author/public state.

### UNIT-05 — Cart, orders, mono and purchase notification

- **Purpose:** deliver S-04/S-05/S-06 and E-01 with idempotent Paid Sale events.
- **Source References:** FR-PAY-1..5, US-006; Buyer journey/failure; architecture AD-3/7; QA ACC-09, UJ-02/03, ST-02, INT-01, BD-02.
- **Depends On:** UNIT-00, UNIT-01, UNIT-02.
- **Work Items:** persistent/mergeable Cart; order price snapshot; mono redirect adapter/sandbox; webhook verification/idempotency/reconciliation; payment result; transactional `PaidSale` outbox event; email adapter/fake and E-01; failure preserves Cart.
- **Acceptance Checks:** multi-book one payment; auth return and failure recovery; one provider event/session creates one paid order/event; unpaid/cancelled order creates no Paid Sale; email failure does not block Library entitlement event.
- **Verification:** `webhook_idempotency`, `paid_sale_only`, Buyer e2e through success/failure, ACC-09, ST-02, INT-01, captured email.
- **Delivery Layer:** full-stack/integration.
- **Approved Baseline ID:** `AVB-UKIEBOOK-AURORA-7B-V3`.
- **Immutable Visual Target Hash:** `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724`.
- **Baseline Screens States And Viewports:** S-04/S-06 all states at 390/768/1280; S-05 external provider surface excluded from visual control.
- **Design Contract And Permitted Variance:** Aurora public checkout shell; provider-owned payment UI follows provider; Cart rows reflow per wireframes.
- **Operator Visual Overrides:** final 7b system.
- **Visual Fidelity Verification:** `approved_visual_baseline_fidelity` via `VIS-AURORA-PUBLIC`, `VIS-TOKENS`, `VIS-GLASS`, RES-03, A11Y/INT.
- **Prototype Reuse:** none.
- **Production Capabilities Added Beyond Prototype:** Cart persistence, orders, provider session/webhook, email and state transitions.
- **Interfaces Produced:** `Cart`, `Order`, `PaymentSession`, `PaidSale`, `PurchaseNotificationRequested`.
- **Interfaces Consumed:** UNIT-01 session; UNIT-02 PricePresentation; UNIT-00 outbox/jobs.
- **API/Data Contract References:** FR-PAY; AD-3/7.
- **Interface Owner:** `commerce` / `notifications`.
- **Compatibility Expectations:** price snapshot immutable; webhook event key unique; provider adapter replaceable.
- **Integration Verification:** catalog→Cart→auth→mono sandbox/webhook→result→PaidSale/email.

### UNIT-06 — Library, reviews and Refund workflow

- **Purpose:** deliver S-07/S-08/S-09/S-20 and purchased-file authorization.
- **Source References:** FR-LIB-1..3, FR-REV-1/2, FR-REF-1..3; US-007/008; supporting Refund journey; architecture AD-9; QA ACC-10/11, ST-03/09.
- **Depends On:** UNIT-01, UNIT-02, UNIT-04 for review moderation, UNIT-05 for PaidSale.
- **Work Items:** consume PaidSale to create `library_item`; signed EPUB/MOBI download; latest approved version resolution; verified-Buyer review and moderation status; Refund request modal/Manager queue/decision; `RefundApproved` compensation event; status propagation.
- **Acceptance Checks:** unpaid/non-owner cannot download/review; Buyer can re-download both formats; newest approved version resolves; review does not promise unsupported rejection reason; Refund decision updates Buyer status and emits one compensation.
- **Verification:** ACC-10/11, UJ-02/04, ST-03/09, object authorization tests, update propagation hook, Refund idempotency.
- **Delivery Layer:** full-stack.
- **Approved Baseline ID:** `AVB-UKIEBOOK-AURORA-7B-V3`.
- **Immutable Visual Target Hash:** `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724`.
- **Baseline Screens States And Viewports:** S-07/S-08/S-09/S-20 all states at 390/768/1280.
- **Design Contract And Permitted Variance:** Aurora public/Manager extension, accessible modal, file actions equal priority.
- **Operator Visual Overrides:** final 7b system.
- **Visual Fidelity Verification:** `approved_visual_baseline_fidelity` via `VIS-AURORA-PUBLIC/MANAGER`, `VIS-TOKENS`, `VIS-GLASS`, `VIS-COVER`, RES-03/05, A11Y-07.
- **Prototype Reuse:** none.
- **Production Capabilities Added Beyond Prototype:** entitlements, signed downloads, review eligibility/moderation, Refund/audit/compensation.
- **Interfaces Produced:** `LibraryEntitlement`, `ReviewSubmitted`, `RefundRequest`, `RefundApproved`.
- **Interfaces Consumed:** `PaidSale`, `BookVersion`, moderation decision, storage signer.
- **API/Data Contract References:** FR-LIB/REV/REF; AD-9.
- **Interface Owner:** `library` / `reviews` / `commerce` Refund subdomain.
- **Compatibility Expectations:** entitlement unique by Buyer+Book; version pointer changes only on approved update; compensation idempotent.
- **Integration Verification:** PaidSale→Library/download/review; Refund request→Manager decision→status/event.

### UNIT-07 — Ledger, Rewards, Payouts and Founder Author

- **Purpose:** deliver financial source of truth and S-15/S-16/S-19/S-21.
- **Source References:** FR-REW-1..6, FR-PYT-1..4, FR-FND-1..4, FR-UPD-2; US-009/011/012; architecture AD-2/7; QA ACC-12..14, ST-06/08/10, VIS-FORMULA.
- **Depends On:** UNIT-00, UNIT-01, UNIT-05 PaidSale; UNIT-06 RefundApproved.
- **Work Items:** append-only accrual ledger in integer kopiykas; paid/Refund compensation; versioned exact split `platform_net_revenue_bps=2900`, `platform_tax_component_bps=600`, `author_share_bps=6500`, derived public `platform_share_bps=3500`; per-Book reward read model; payout_details/model; monthly payout rows/threshold/carry; confirm actual Payout one-by-one; atomic singleton Founder Author transfer; restricted DTOs/audit.
- **Acceptance Checks:** all money vectors exact to kopiyka; `2900+600=3500` and `2900+600+6500=10000`; public/Author surfaces show only `35% platform / 65% Author`; S-19 manager rows show `29%` net platform, `6%` platform tax component, `65%` Author; ledger reproduces S-15/S-19; no Buyer personal data in Author API; <100 carries; each row independent; one Founder under concurrency; Founder receives 100% and update-fee exemption contract.
- **Verification:** `money_formula`, `ledger_reproducibility`, `paid_sale_only`, `payout_rules`, `access_separation`, ACC-12..14, ST-06/08/10, concurrency tests.
- **Delivery Layer:** full-stack.
- **Approved Baseline ID:** `AVB-UKIEBOOK-AURORA-7B-V3`.
- **Immutable Visual Target Hash:** `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724`.
- **Baseline Screens States And Viewports:** S-15/S-16/S-19/S-21 at 390/768/1280; formula motif may recur on S-15.
- **Design Contract And Permitted Variance:** Aurora Author/Manager extension, tabular numbers, quiet financial UI, consequences before CTA.
- **Operator Visual Overrides:** V3 public formula is exactly `35/65`; manager-only decomposition is `29+6+65`; external legal/tax release review does not make these operator-confirmed percentages provisional.
- **Visual Fidelity Verification:** `approved_visual_baseline_fidelity` via `VIS-AURORA-AUTHOR/MANAGER`, `VIS-TOKENS`, `VIS-GLASS`, `VIS-FORMULA`, UX-02/05, RES-04/05.
- **Prototype Reuse:** none.
- **Production Capabilities Added Beyond Prototype:** ledger, money rules, private payout data, monthly scheduler/read models, singleton Founder transaction.
- **Interfaces Produced:** `AccrualEvent`, `RewardReadModel`, `PayoutRow`, `PayoutConfirmed`, `FounderAssignment`.
- **Interfaces Consumed:** `PaidSale`, `RefundApproved`, UNIT-01 roles/payout profile, scheduler.
- **API/Data Contract References:** FR-REW/PYT/FND; AD-2/7.
- **Interface Owner:** `rewards`.
- **Compatibility Expectations:** ledger immutable; rule version and four exact-bps fields are recorded per event/read model; public/Author read models exclude Buyer PII and manager-only `29+6` fields.
- **Integration Verification:** PaidSale/Refund→ledger→monthly row→Manager confirmation→Author status; concurrent Founder transfer.

### UNIT-08 — Discounts and Book Update integration

- **Purpose:** complete post-publication Author operations S-13/S-14 and their cross-module effects.
- **Source References:** FR-CAT-4, FR-UPD-1..3, FR-FND-4; supporting Discount/Update journeys; QA ACC-07/08, UJ-04, ST-05.
- **Depends On:** UNIT-02, UNIT-03, UNIT-04, UNIT-06, UNIT-07.
- **Work Items:** dated Discount state/value validation; actual-price read model for catalog/cart/rewards; Update submission with optional Manuscript/Cover; 250 UAH pending-fee/reservation logic and Founder exemption; re-conversion/moderation; atomic active-version switch; Library latest-version propagation and fee accrual.
- **Acceptance Checks:** Discount changes exactly at boundaries; paid price drives ledger; ordinary Author sees 250 UAH consequence before submit; insufficient accrual waits; Founder sees no fee; approval updates prior Buyer files without double fee/version switch.
- **Verification:** ACC-07/08, UJ-04, ST-05, `payout_rules`, `update_propagation`, date-boundary and idempotency tests.
- **Delivery Layer:** full-stack/integration.
- **Approved Baseline ID:** `AVB-UKIEBOOK-AURORA-7B-V3`.
- **Immutable Visual Target Hash:** `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724`.
- **Baseline Screens States And Viewports:** S-02/S-07/S-13/S-14/S-15/S-18 affected states at 390/768/1280.
- **Design Contract And Permitted Variance:** Aurora extension; Discount badges/old-new price; financial warning before CTA; status semantics shared.
- **Operator Visual Overrides:** final 7b system.
- **Visual Fidelity Verification:** `approved_visual_baseline_fidelity` for affected public/Author/Manager checks plus `VIS-TOKENS`, `VIS-GLASS`, `VIS-COVER` and `VIS-FORMULA` where the affected surface uses them.
- **Prototype Reuse:** none.
- **Production Capabilities Added Beyond Prototype:** time rules, cross-module update state, fee and Library propagation.
- **Interfaces Produced:** `DiscountSchedule`, `BookUpdateSubmitted/Approved`, `UpdateFeeAccrued`, `BookVersionActivated`.
- **Interfaces Consumed:** catalog PricePresentation, publishing converter, moderation decisions, library entitlement, rewards ledger.
- **API/Data Contract References:** FR-CAT-4/UPD/FND-4.
- **Interface Owner:** `catalog` Discount + `publishing` Book Update orchestration.
- **Compatibility Expectations:** event handlers idempotent; old BookVersion immutable; price/fee rule version traceable.
- **Integration Verification:** Discount/Update journeys across all consuming modules.

### UNIT-09 — Whole-product responsive, accessibility and visual hardening

- **Purpose:** close all Baseline, responsive, accessibility, state and browser gates after functional slices exist.
- **Source References:** Approved Baseline; wireframes Responsive; QA WF/UX/VIS/RES/A11Y/BD; dod-evals UX/UI gates.
- **Depends On:** UNIT-01…UNIT-08.
- **Work Items:** full route/state capture matrix; exact S-01 V3 diffs; dedicated token/glass/Cover/shelf/hero-copy/formula invariant evidence; active transparent-SVG hash, alpha/background and shape comparison; measured contrast corrections within variance; semantic/control/focus audit; target-size/zoom/reflow fixes; mobile master-detail/table/form layouts; reduced-motion verification; cross-browser critical journeys; canonical copy sweep; regression snapshot baselines keyed by Baseline ID/hash.
- **Acceptance Checks:** every applicable visual/accessibility/responsive check passes; no unsupported viewport overflow; all controls keyboard-operable; S-01 exact scope remains unchanged beyond permitted variance; no blocking P0/P1/P2.
- **Verification:** `npm run test:visual`, `npm run test:e2e`, VIS-S01-*, VIS-AURORA-*, VIS-TOKENS, VIS-GLASS, VIS-COVER, VIS-SHELF, VIS-HERO-COPY, VIS-FORMULA, VIS-BRAND-LOGO, RES-01..06, A11Y-01..08, BD-01/02, `approved_visual_baseline_fidelity` for every visible unit.
- **Delivery Layer:** frontend/integration.
- **Approved Baseline ID:** `AVB-UKIEBOOK-AURORA-7B-V3`.
- **Immutable Visual Target Hash:** `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724`.
- **Baseline Screens States And Viewports:** S-01 exact/default/hover 1280; S-01 derived 390/430/768/1440; S-02…S-21 all canonical states at applicable required viewports.
- **Design Contract And Permitted Variance:** exact Baseline section; no additional variance can be invented here.
- **Operator Visual Overrides:** imported final 7b V3, 1:1 covered scope, responsive/a11y extension allowed; transparent raster-backed SVG is active; all covers square; baked artwork/no overlay; shelf uncut; exact hero sentence; public `35/65` formula.
- **Visual Fidelity Verification:** `approved_visual_baseline_fidelity` full affected matrix.
- **Prototype Reuse:** none.
- **Production Capabilities Added Beyond Prototype:** complete responsive states, semantics, accessibility, browser evidence and regression tooling.
- **Interfaces Produced:** VisualQAEvidence/eval results keyed by route/state/viewport/Baseline.
- **Interfaces Consumed:** all visible route/state contracts and target artifacts.
- **API/Data Contract References:** QA checklist and Baseline.
- **Interface Owner:** frontend platform + each affected module owner.
- **Compatibility Expectations:** visual snapshots include Baseline ID/hash; fixture changes are explicit and reviewed.
- **Integration Verification:** full product route matrix and both critical journeys across browser floor.

### UNIT-10 — Deployment, operations and release-candidate evidence

- **Purpose:** deploy one revision as web/worker/scheduler and produce release evidence without converting external legal/provider questions into code assumptions.
- **Source References:** architecture deployment topology; dod-evals Release Checks; guardrails high-risk authorization; product-idea pre-release checks; QA Release Readiness.
- **Depends On:** UNIT-00…UNIT-09.
- **Work Items:** environment topology, migrations, private object storage, secret injection, worker/scheduler health, logs/correlation/dead-letter visibility, backup/restore rehearsal, mono reconciliation, release eval aggregation; record external legal/tax, mono terms and font provenance evidence when supplied.
- **Acceptance Checks:** all processes run same revision; migration/rollback and restore rehearsed; secrets server-only; dead letters/reconciliation observable; all applicable automated/manual gates have current evidence; no release occurs while external release blockers remain.
- **Verification:** full DoD Gate Matrix, `release_journeys`, `release_findings`, security/privacy/access checks, restore evidence, `legal_tax_review`, `mono_terms_confirmed`, font provenance.
- **Delivery Layer:** infrastructure/integration.
- **Baseline Impact:** serves all user-visible states/actions; deployment change must rerun smoke + affected visual evidence.
- **Prototype Reuse:** none.
- **Interfaces Produced:** deployed endpoints/process health, release Eval bundle, operational runbook.
- **Interfaces Consumed:** all prior module/process contracts.
- **API/Data Contract References:** architecture runtime/observability; dod-evals release format.
- **Interface Owner:** platform operations.
- **Compatibility Expectations:** environment config schema validated; rollback preserves database/object compatibility; release evidence references immutable revision and Baseline.
- **Integration Verification:** staged deployment→migration→critical journeys→worker/scheduler jobs→reconciliation→evidence bundle.

## Dependency Order

```mermaid
flowchart LR
  U00[UNIT-00 Foundation] --> U01[UNIT-01 Identity]
  U00 --> U02[UNIT-02 Catalog]
  U02 --> U02C1[UNIT-02-C1 V3 correction]
  U01 --> U03[UNIT-03 Publishing]
  U02C1 --> U03
  U03 --> U04[UNIT-04 Moderation]
  U01 --> U05[UNIT-05 Commerce]
  U02C1 --> U05
  U04 --> U06[UNIT-06 Library Reviews Refunds]
  U05 --> U06
  U05 --> U07[UNIT-07 Rewards Payouts]
  U06 --> U07
  U02 --> U08[UNIT-08 Discounts Updates]
  U03 --> U08
  U04 --> U08
  U06 --> U08
  U07 --> U08
  U01 --> U09[UNIT-09 UX hardening]
  U02C1 --> U09
  U03 --> U09
  U04 --> U09
  U05 --> U09
  U06 --> U09
  U07 --> U09
  U08 --> U09
  U09 --> U10[UNIT-10 Release]
```

UNIT-00, UNIT-01, UNIT-02, correction UNIT-02-C1 and UNIT-03 are complete within their recorded scopes. The next executable unit is UNIT-04: consume `BookSubmitted`, deliver S-13/S-18 Manual Review and Book lifecycle, produce audited moderation decisions, activate publication and update the bounded public catalog projection. UNIT-03 freezes the immutable version/event and Aurora Author contracts that UNIT-04 consumes; UNIT-05 is also dependency-ready against UNIT-01/02-C1 but remains later in the approved value order. No financial consumer begins against an unversioned `PaidSale`/`RefundApproved` event. UNIT-09 is a convergence unit, not a substitute for per-unit UX evidence.

## Verification Plan

- After every unit: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`; affected integration/e2e/visual commands follow the unit fields.
- For UNIT-00 foundation changes, `REAL_DATABASE_URL=<ephemeral-postgres-url> npm run verify:unit00` is the canonical bundle-producing rerun and must target real PostgreSQL.
- For UNIT-01 identity/profile changes, `REAL_DATABASE_URL=postgres://<credentials>@127.0.0.1:<port>/ukiebook_unit01 npm run verify:unit01` is the canonical bundle-producing rerun; the runner rejects a dirty tree, non-loopback host or different database name and includes real PostgreSQL, E2E, responsive/contrast and secret-evidence gates.
- For UNIT-02/C1 catalog presentation changes, the UNIT-02 verifier must bind the V3 bundle/tree/VQA hashes, revision and external-browser visual inspection in `forge/runs/UNIT-02-C1/20260722T115720Z-338d4450e107/run.json`; old V2 receipts never satisfy the active gate.
- For UNIT-03 publishing/converter changes, `REAL_DATABASE_URL=postgres://<credentials>@127.0.0.1:<port>/ukiebook_unit03 npm run verify:unit03` is the canonical bundle-producing rerun. It must keep the dedicated loopback database guard, Calibre `9.11.0`/adapter and both validators, migration `0004`, private-artifact/version/submission/failure-retry proofs, 3/3 Author E2E, and the 30-visual/7-accessibility receipt matrix; canonical completed evidence is `forge/runs/UNIT-03/20260722T151115Z-6fb52daf3ff1/run.json`.
- Persist results in dod-evals format with unit, revision, timestamp, evidence and findings. A missing applicable command/result is `blocked`, never passed by inspection.
- Money tests use integer fixtures, discount boundaries, duplicate/out-of-order events, Refund compensation, threshold/carry, update fee and Founder cases.
- Conversion tests use representative DOCX/TXT/Google Docs fixtures with headings, Unicode Ukrainian text and inline Illustrations; EPUB/MOBI validators are external evidence.
- Access tests cover every role/route and DTO data-minimization boundary.
- Cross-layer integration tests assert event schema/version, idempotency and producer/consumer ownership.
- Public release additionally requires legal/tax, mono-terms and font-provenance evidence; these are external gates, not reasons to omit code tests.

## Visual And UX Verification

- S-01 exact: compare fresh 1280×900 default/hover captures with immutable target and reference captures; record each deviation as permitted or finding.
- S-01 responsive: compare against approved reflow contract, not the non-responsive 390px reference squeeze.
- S-02…S-21: verify Aurora tokens/components/status semantics, wireframe hierarchy, canonical states and viewports; do not claim pixel equality where no target exists.
- Dedicated invariants: record separate `VIS-TOKENS`, `VIS-GLASS`, `VIS-COVER`, `VIS-SHELF`, `VIS-HERO-COPY` and `VIS-FORMULA` results using V3 captures/computed styles as reference and fresh production evidence as the pass basis. Every Book Cover has radius `0`; S-01 proves seven distinct baked-artwork sources and no live cover-title overlay.
- Official logo: verify every rendered instance uses `UkieBook-logo-transparent.svg` hash `db838dd4ad696f63cccb6aa86ab98e53dc5c6e13c1778ac340f62c5e4514617f`, has transparent corners/no backing plate and preserves locked brand geometry. The asset is raster-backed, not path-vector.
- Every visual result records Baseline ID, target hash, route, state, viewport, fixture, variance, capture and finding release effect.
- Runtime interactions, data, auth and accessibility need their own evidence even when visual diff is green.

## Risks And Sequencing Notes

- **MOBI:** UNIT-03 closed the engine enabler with pinned Calibre `9.11.0`, `calibre-legacy-mobi-v1` and `legacy-mobi-header.v1` proof. Any converter/runtime change must rerun the representative fixtures; inability to reproduce valid legacy MOBI blocks the affected publishing change and never silently degrades to EPUB-only.
- **Financial formula:** implement operator-confirmed exact-bps rule `2900+600+6500=10000`, expose `3500/6500` publicly and `2900/600/6500` only to managers; legal/accounting change requires upstream SDD regeneration and migration plan.
- **mono:** provider docs/signature/tariffs must be refreshed just in time; sandbox behavior does not prove production commercial terms.
- **OAuth activation:** local production adapters, negative OIDC vectors and browser flows are proven, but real registered redirect/consent behavior must be smoked with credentialed Google/Facebook pre-production apps before enabling either provider in production.
- **Design fidelity vs accessibility:** permitted variance authorizes only measured semantic/contrast/target/reflow fixes; UNIT-09 must prove both fidelity and AA rather than sacrificing either silently.
- **Logo source format:** the active official mark is the transparent-background raster-backed SVG container. It must keep transparency and source silhouette/proportions/internal line structure; it does not claim path-vector geometry or infinite-scale vector quality.
- **Manual operations:** Manager flows ship before automation; background jobs expose dead-letter/retry visibility so one failure does not corrupt payouts or hide moderation work.
- **Repository bootstrap:** Git/GitHub plus UNIT-00 application runtime, verification commands and CI-ready project structure are complete. Hosted deployment/CI topology remains UNIT-10 scope.

## Coverage Matrix

| Source scope | Owning implementation unit(s) |
|---|---|
| FR-AUTH, S-03/S-17 | UNIT-01 |
| FR-CAT, S-01/S-02 | UNIT-02 behavior/data + UNIT-02-C1 V3 presentation; Discount integration UNIT-08 |
| FR-PUB, FR-LIC-1..3, S-10…S-12 | UNIT-03 |
| FR-MOD, FR-LIC-4, S-13/S-18 | UNIT-04; Update states UNIT-08 |
| FR-PAY, S-04…S-06, E-01 | UNIT-05 |
| FR-LIB/REV/REF, S-07…S-09/S-20 | UNIT-06 |
| FR-REW/PYT/FND, S-15/S-16/S-19/S-21 | UNIT-07 |
| FR-CAT-4/UPD/FND-4, S-13/S-14 and downstream states | UNIT-08 |
| All responsive/accessibility/visual states | each visible unit + convergence UNIT-09 |
| Deployment/release evidence | UNIT-10 |

All PRD FR groups and screen-map S-01…S-21 map to at least one unit. Out-of-scope product areas remain out of all units.

## Out Of Scope

Internal reader, fixed-layout books, native apps, subscriptions/bundles/promocodes, additional languages/currencies, automatic payouts without Manager, DRM, dark-mode switch, marketing-only site, generic redesign of Aurora 7b, direct prototype-code promotion.

## Open Questions

- OQ-DP1 closed: UNIT-03 selected and proved Calibre `9.11.0` via `calibre-legacy-mobi-v1`, with `epub-container.v1` and `legacy-mobi-header.v1` receipts in `forge/runs/UNIT-03/20260722T151115Z-6fb52daf3ff1/run.json`; future adapter/runtime changes reopen only the affected regression gate, not the completed unit retroactively.
- OQ-DP2. Production email and AI-moderation providers are selected behind existing adapters before deployment; local fakes make earlier units executable without inventing vendor commitments.
- OQ-DP3. Hosting vendor is selected when executing UNIT-10 within the fixed web/worker/scheduler/PostgreSQL/object-storage topology.
- Release-only external blockers remain: legal/tax review, mono current terms/tariffs and font license/provenance.
