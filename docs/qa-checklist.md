# QA Checklist

## Source References

- `docs/prd.md` v1.2 — FR/NFR, User Stories, E2E acceptance scenarios and operator-confirmed `35/65` rule.
- `docs/user-journey.md` — primary Buyer/Author and supporting/Manager journeys.
- `docs/screen-map.md` — canonical S-01…S-21 routes/states.
- `docs/wireframes.md` — structural deltas and responsive behavior.
- `docs/design-brief.md` — approved Baseline `AVB-UKIEBOOK-AURORA-7B-V3`; target bundle hash `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724`; permitted variance.
- `UkieBook-logo-transparent.svg` / `public/brand/UkieBook-logo-transparent.svg` — active official transparent-background SVG container; SHA-256 `db838dd4ad696f63cccb6aa86ab98e53dc5c6e13c1778ac340f62c5e4514617f`; raster-backed, not path-vector artwork.
- `forge/design/evidence/AVB-UKIEBOOK-AURORA-7B-V3.visual-qa.json` — reference QA for the immutable V3 target; SHA-256 `ffae4a71e0db785033aad606e91b1557ef46d56d86690f8e09ae6cc81906323c`; not production implementation evidence.
- V1/V2 target, JPG/exact-SVG and equivalence receipts remain immutable superseded history only.
- `docs/architecture.md` — AD-2/3/4/6/7/8/9/10/11 and security boundaries.
- `docs/dod-evals.md` — reusable gates, severity and result contract.
- `docs/guardrails.md` — evidence policy.
- `docs/project-context.md` — consumed section 7 (platform/viewports) and section 13 (risk applicability).
- Migration `0005_moderation_publication`, `modules/moderation/`, S-13/S-18/S-02 UNIT-04 routes, `scripts/verify-unit04-postgres.ts`, `tests/e2e-unit04/`, `tests/visual-unit04/` and `scripts/run-unit04-verification.mjs` — canonical UNIT-04 verification surface passed at revision `4552048aeb2ba6da16b47ac289058b14d5641869`; receipt `forge/runs/UNIT-04/20260722T190601Z-4552048aeb2b/run.json`.

Product-route, journey and release checks below remain `blocked` until their owning units produce fresh implementation evidence. UNIT-00 platform foundation, UNIT-01 identity/profile, UNIT-02 behavior/persistence, UNIT-02-C1 V3 visual correction, UNIT-03 publishing/conversion and UNIT-04 moderation/publication execution recorded below are scoped passed exceptions. Baseline approval and test source code alone do not pass runtime checks.

### UNIT-00 Foundation Execution

- **Result:** `passed` for UNIT-00 only at implementation revision `f6e503b242d5a5eca59972dece1657f4d207b3e3`.
- **Canonical Evidence:** `forge/runs/UNIT-00/20260721T202102Z-f6e503b242d5/run.json` plus its `evals/` and `evidence/` tree.
- **Passed Scope:** pinned dependency/audit checks; typecheck/lint/import-boundary checks; 23 unit/integration tests; production web+worker+scheduler build and shared revision/schema identity; real PostgreSQL migration rollback/reapply, transactional outbox/job, competing claim, semantic idempotency and lease recovery; repository/browser secret boundaries; production foundation E2E; UNIT-00 `VIS-TOKENS` fixture.
- **Visual Limit:** the fixture proves the Aurora source-token export and computed styles at its recorded route/state/1280 viewport. It does not pass the global `VIS-TOKENS` row for all future routes/viewports and does not implement or visually approve S-01…S-21.
- **Findings:** zero open P0/P1 or blocking P2 in UNIT-00 scope.

### UNIT-01 Identity And Author-Profile Execution

- **Result:** `passed` for UNIT-01 at implementation revision `ab030a00f213d33f62783f0287dd8e5dcfe67101`.
- **Canonical Evidence:** `forge/runs/UNIT-01/20260721T221049Z-ab030a00f213/run.json` plus its `evals/` and `evidence/` tree; 64 files, evidence secret scan `passed`, no trace/HAR artifacts.
- **Passed Acceptance Scope:** ACC-01 only for S-03 providers, safe-return OAuth, identity/session guards, S-17 public profile and the public-versus-encrypted-payout boundary; FR-AUTH-4 payout-model contents/UI remain UNIT-07. UJ-01 passes only Author stages 1–2 (OAuth → first profile → S-11 handoff). ST-02 passes only S-03; ST-06 only S-17; ST-11 only Guest redirects and Author→Manager denial. Combined rows are not globally passed.
- **Functional Evidence:** 55/55 Vitest checks; standard E2E 1/1; UNIT-01 E2E 3/3 for Google/Facebook, callback replay, trusted return, first/existing Author paths, atomic role/profile session rotation, controlled CSRF rejection, Manager denial and privacy; real PostgreSQL migration/concurrency/session proof leaves both migrations applied and all identity tables clean.
- **Visual/Responsive Evidence:** S-03 and S-17 Aurora extension checks passed at 390/430/768/1280/1440, 26 HiDPI screenshots plus focus and 200% reflow receipts. Computed button contrast is ≥4.5:1 (Google 16.48:1, Facebook 4.73:1, S-17 action minimum 4.51:1); every rendered link/button target is measured at ≥44×44 CSS px (minimum 93.69×44, including the 93.69×44 logo/home target); errors are textual and invalid S-17 focuses/preserves the field value.
- **Scoped QA IDs Passed:** UX-04/06/07 for S-03/S-17; VIS-AURORA-PUBLIC for S-03; VIS-AURORA-AUTHOR for S-17; VIS-TOKENS/VIS-GLASS/VIS-BRAND-LOGO on those routes; RES-01/04/06; the control-contrast portion of A11Y-01, exercised S-03/S-17 portions of A11Y-02/03/05, and A11Y-04 for every rendered S-03/S-17 link/button. This does not pass release-wide text/AT checks, unimplemented routes or the browser/device matrix.
- **Findings/Activation Limit:** zero P0/P1/blocking P2 in unit scope. Credentialed Google/Facebook consent and registered-redirect smoke is `blocked` until pre-production credentials exist: advisory for UNIT-01 completion, blocking for production provider activation.

### UNIT-02 Catalog And Book-Page Execution (historical visual baseline)

- **Result:** `passed` for UNIT-02 behavior/persistence at implementation revision `a441ab415d2818872599f01efae856acebf75b42`; its V2 visual verdict is superseded by UNIT-02-C1.
- **Canonical Evidence:** `forge/runs/UNIT-02/20260722T011333Z-a441ab415d28/run.json` and its 92-file run tree (86 files under `evidence/`, 5 eval results and `run.json`); evidence secret scan `passed`, no trace/HAR artifacts or credential/privacy-sentinel leaks.
- **Passed Acceptance Scope:** ACC-08; ST-01; WF-02 and S-02 side of WF-04; UX-03/04/07; the catalog-owned cover/tile/search/Genre/Discount portion of INT-04; S-01/S-02 portions of RES-01/02/03/06 and A11Y-01/02/04/06/08. Search by title/Author, Genre and Discount filters, featured/price sorting, stable pagination, dated Discount `[start,end)`, integer-kopiyka UAH presentation, sample, paged reviews, loading/empty/error/long-results and known-unavailable Book are implemented. The Cart control is a semantic header handoff only; its destination and Cart behavior remain unpassed until UNIT-05. Purchase/review submission and publishing-side preview also remain with later owning units.
- **Functional Evidence:** 70/70 Vitest; standard E2E 1/1 and visual 1/1; UNIT-02 E2E 5/5; UNIT-02 visual 10/10. Dedicated real PostgreSQL proof reverses/reapplies `0003_catalog_read_model`, preserves migrations 0001/0002, seeds 7 deterministic fixture Books only through guarded acknowledgement, exposes 6 public Books across 2 pages and proves public DTO separation plus Discount boundaries.
- **Historical Visual/Responsive Evidence:** 53 distinct V2 receipt files remain immutable implementation history, but they no longer pass active V3 visual IDs. Their behavior/E2E/PostgreSQL evidence is not rewritten.
- **Findings/Limit:** zero P0/P1/blocking P2 in original behavior scope. The guarded deterministic UNIT-02 catalog seed remains an explicit bootstrap path, while UNIT-04 publication transactions now populate the same versioned projection boundary; neither fact makes the overall content pipeline release-ready.

### UNIT-02-C1 V3 Correction Execution

- **Result:** `passed` for correction scope at implementation revision `3f77594bcb615847bdd71846374184cd2070d305`.
- **Canonical Evidence:** `forge/runs/UNIT-02-C1/20260722T115720Z-338d4450e107/run.json`; active baseline target bundle `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724`, tree `7b13c9e123694cf800ccda987aa64a7f98e625d671161a838b4f94e315feba97`, reference VQA `ffae4a71e0db785033aad606e91b1557ef46d56d86690f8e09ae6cc81906323c`.
- **Passed Correction Scope:** every Book Cover rendered by affected shared/public primitives has `border-radius: 0`; S-01 uses seven distinct approved realistic cover artworks with different baked-in titles and no live title overlay; all five first-row covers are visible through their bottom edge; hero subcopy is exactly `Електронні книжки EPUB і MOBI миттєво у вашу бібліотеку.`; public ribbon is `35%` platform / `65% — автору`; active logo is the transparent-background SVG hash above and renders without a backing plate.
- **Formula Boundary:** public and Author-facing presentation shows only `35/65`. Manager/rewards implementation must separately prove `29%` net platform revenue + `6%` platform tax component + `65%` Author, with `29+6+65=100`; UNIT-02-C1 does not claim the future rewards ledger is implemented.
- **Historical Next Unit:** UNIT-03, now completed; UNIT-04 is also complete and the current next executable unit is UNIT-05.

### UNIT-03 Publishing And Conversion Execution

- **Result:** `passed` within UNIT-03 scope at implementation revision `6fb52daf3ff11630454c13a76adfd7875c749e8f`; canonical evidence `forge/runs/UNIT-03/20260722T151115Z-6fb52daf3ff1/run.json`, findings `[]`.
- **Passed Acceptance Scope:** ACC-02/03/04; UJ-01 only from S-10/S-11/S-12 wizard through separate confirmations and `BookSubmitted`; conversion/draft-preservation portion of UJ-03; ST-04 only for S-10/S-11/S-12; S-11 portion of WF-03; S-12 side of WF-04; UX-04; INT-02; affected RES-01/04/06 and A11Y-01…A11Y-06/A11Y-08. DOCX, TXT and bounded Google Docs input produce validated EPUB and legacy MOBI; inline Illustrations, meaning hashes, fallback/upload Cover, Genre, integer-kopiyka price, sample bound to the completed current `PreviewArtifact`, and immutable submission are proved.
- **State/Recovery Scope:** unsupported or malformed uploads and Google Docs validation recover inline without draft loss; `conversion_failed` is announced and retry reaches `ready` on the same draft; stale jobs cannot overwrite the current revision; rights and five-year-license confirmations remain separate; submission writes one immutable `BookVersion`, two declarations and one `BookSubmitted` event.
- **Storage/Security Scope:** `PrivateObjectStorage` is proved with the private local adapter and dedicated loopback PostgreSQL database `ukiebook_unit03`; multipart bodies are bounded by declared-size overhead and actual file size, and Google Docs JSON is body-bounded before parsing. This is not a production S3 deployment claim.
- **Functional Evidence:** Calibre `9.11.0`, adapter `calibre-legacy-mobi-v1`, validators `epub-container.v1` and `legacy-mobi-header.v1`; 19 test files passed/2 skipped, 105 tests passed/2 skipped; 3/3 UNIT-03 E2E; production build/typecheck/lint/repository boundaries and `npm audit --audit-level=high` with 0 vulnerabilities passed.
- **Visual/Accessibility Evidence:** 30 HiDPI screenshots cover S-10/S-11/S-12 at 390/430/768/1280/1440; 7 keyboard/focus/200%-reflow receipts; measured minimum text contrast 5.742:1, placeholder 6.075:1, UI control 3.346:1, all measured targets ≥44×44px, mobile input text 16px, no horizontal overflow or console/page errors. A separate external-Chrome inspection on the stable loopback runtime covered S-10, all six S-11 steps and completed S-12 desktop/mobile Book/Page tabs, confirmed the transparent SVG logo and square `0px` Cover, and left the three inspected tabs open with no console errors or horizontal overflow. The canonical bundle's extension comparison is screenshot/state evidence; it does not contain a separate `VIS-TOKENS`/`VIS-GLASS` computed-style artifact and does not claim a pixel target for these new screens. This is scoped evidence, not a release-wide WCAG or browser/device claim.
- **Explicit Limit:** this UNIT-03 receipt alone does not pass Manager Manual Review, moderation decisions, publication activation, S-13/S-18 lifecycle or the public catalog projection. Those downstream concerns are separately passed only by the canonical UNIT-04 receipt below.

### UNIT-04 Moderation And Publication Execution

- **Verification Status:** `passed` at revision `4552048aeb2ba6da16b47ac289058b14d5641869`; canonical evidence `forge/runs/UNIT-04/20260722T190601Z-4552048aeb2b/run.json`, `findings: []`.
- **Passed Scope:** migration `0005`; idempotent `BookSubmitted` relay; safe clear auto-publication; flagged/provider-outage Manual Review; immutable screening/decision/publication audit; closed ReasonCategory and removal-ground contracts; separate active-publication pointer; atomic Catalog activation/removal; publication-gated public Cover; S-13 lifecycle; S-18 type-specific decisions; S-02 unavailable. BookUpdate/Review are decision/event contracts only—producer and downstream application remain later owning units.
- **Functional Evidence:** dedicated PostgreSQL `ukiebook_unit04` passed rollback/reapply plus 16 relay/screening/decision/concurrency/publication/removal vectors; invalid Origin/CSRF and unauthorized Author decisions left state unchanged; 109 tests passed/3 skipped, E2E 4/4, all 12 canonical commands exited 0, repository/secret hygiene passed and `npm audit` found 0 vulnerabilities.
- **Visual Evidence:** 50/50 revision-bound screenshots cover 14 S-13/S-18/S-02-unavailable states at 390/430/768/1280/1440; visual digest `5a0f37449f4cb4a942b580857045a07eff39f9010292050dbdcbd6cca855d47d`; zero console/page errors and maximum horizontal overflow 0. External Chrome inspection confirmed loaded square-corner Covers on S-13/S-18/S-02. This is Aurora V3 extension coverage, not S-01 pixel-lock.
- **Accessibility Evidence (8/8):** `s13-keyboard-order-focus-activation`, `s13-reflow-200`, `s18-queue-keyboard-list-detail`, `s18-reason-validation-focus`, `s18-removal-dialog-focus-trap-return`, `s18-mobile-list-detail-back`, `s18-reflow-200`, `s02-unavailable-reflow-200`; 350 target samples measured at least 44×44 CSS px, control contrast minimum 3.206, placeholder 4.608, text 14.025 and mobile inputs 16px. This is not a complete WCAG/cross-browser/device release claim.

## Product Acceptance

| Check ID | Applicability | Check | Severity / Release Effect | Source | Required Evidence | Rationale |
|---|---|---|---|---|---|---|
| ACC-01 | identity, S-03, protected routes | Only Google/Facebook sign-in; Guest can browse S-01/S-02; transaction routes require auth; public profile data is separate from payout data | P1 / blocking | FR-AUTH-1..4 | auth e2e + negative RBAC/API checks | auth/privacy boundary and primary journeys |
| ACC-02 | publishing input | DOCX/TXT/Google Docs accepted; unsupported/broken file gets inline recovery; only technical cleanup occurs | P1 / blocking | FR-PUB-1/2 | fixture imports + diff of normalized content | prevents silent editorial change |
| ACC-03 | publishing output | Reflowable content preserves structure/Illustrations; valid EPUB and MOBI produced | P1 / blocking | FR-PUB-3/7 | `conversion_pipeline` fixture report and validators | core Author value |
| ACC-04 | S-11/S-12 | Cover upload/fallback, Genre, UAH price, sample and Попередній перегляд видання work; submit requires separate rights and five-year-license confirmations | P1 / blocking | FR-PUB-4..9, FR-LIC-2/3 | author e2e + negative submit tests + captures | prevents uninformed legal/product submission |
| ACC-05 | moderation, S-13/S-18 | AI routes risky Book/Update/review to Manual Review; Author sees only Reason Category for own material; internal rules never leak | P1 / blocking | FR-MOD-1..5 | routing tests + response inspection | trust/security boundary |
| ACC-06 | Book availability | Platform removal under FR-LIC-4 creates audited action and S-02 unavailable state | P1 / blocking | FR-LIC-4 | Manager scenario + public response | requirement otherwise had no operational path |
| ACC-07 | update flow | Update costs 250 UAH from future Payout, waits for accrual if needed, re-moderates and updates prior Buyer files; Founder Author is exempt | P1 / blocking | FR-UPD-1..3, FR-FND-4 | payout/update propagation tests | money and owned-content integrity |
| ACC-08 | catalog, S-01/S-02 | search title/Author/Genre/Discount; Book Page content/sample/rating; dated Discount boundaries and actual price | P1 / blocking | FR-CAT-1..4 | browser e2e + boundary-time tests | public discovery and price truth |
| ACC-09 | cart/mono | multi-book Cart; mono card/Apple Pay/Google Pay; failed checkout preserves Cart; duplicate webhook creates one sale | P1 / blocking | FR-PAY-1..5, AD-3 | sandbox e2e + idempotency tests | primary payment path |
| ACC-10 | Library/email | paid Books appear immediately; email lists them; EPUB/MOBI can be re-downloaded; approved latest version is served | P1 / blocking | FR-PAY-4, FR-LIB-1..3 | e2e + captured email + object authorization tests | purchased value delivery |
| ACC-11 | reviews/refunds | only verified Buyer can review; review moderates; Buyer can request Refund; Manager decision updates status and compensates accrual | P1 / blocking | FR-REV-1/2, FR-REF-1..3 | negative review tests + refund e2e | trust and money correction |
| ACC-12 | rewards | current public `35% platform / 65% Author` rule uses actually paid discounted price and integer kopiykas; manager allocation is `29%` net platform revenue + `6%` platform tax component + `65%` Author; no Buyer personal data | P0 / blocking | FR-REW-1..6, AD-2/7 | money vectors + exact-bps (`2900+600+6500=10000`) ledger reproduction + API/UI visibility inspection | financial invariant; external legal/tax release review remains separate from the operator-confirmed percentage truth |
| ACC-13 | payouts | monthly row per Author, 100 UAH threshold/carry, Manager confirms actual Payout one-by-one, per-Book Payout status shown | P0 / blocking | FR-PYT-1..4, FR-REW-6 | payout rule suite + S-15/S-19 e2e | payout integrity |
| ACC-14 | Founder Author | exactly one Founder Author; atomic transfer; 100% Payout; hidden from Author surfaces | P1 / blocking | FR-FND-1..4 | concurrency/transaction + RBAC/UI tests | singleton financial exception |
| ACC-15 | localization/scope | Ukrainian UI, UAH, responsive web; no internal reader/fixed layout/out-of-scope features | P2 / blocking if violated | NFR-1/2; Out of Scope | route/content audit | prevents scope drift |

## UNIT-04 Scoped Checks

These checks instantiate the global IDs only for the bounded UNIT-04 slice. Every `passed` result below is bound to `forge/runs/UNIT-04/20260722T190601Z-4552048aeb2b/run.json`; it does not expand the unit beyond the scope stated above.

| Check ID | Applicability | Check | Severity / Release Effect | Source | Required Evidence | Rationale | Result |
|---|---|---|---|---|---|---|---|
| U04-PG-01 | schema/runtime | Real PostgreSQL rolls migration `0005_moderation_publication` down/up and proves relay idempotency, immutable screening/decision/audit rows, decision concurrency and one active publication version | P1 / blocking | AD-5/7/11/12; migration `0005` | canonical dedicated-loopback PostgreSQL receipt bound to full revision | SQLite/PGlite or code inspection cannot prove PostgreSQL triggers, locks and transactions | passed |
| U04-MOD-01 | Book submission | One `BookSubmitted` creates one case/job; clear publishes; flagged and adapter error enter Manual Review; provider error never auto-publishes | P1 / blocking | FR-MOD-1/2; AD-5/12 | real-PG vectors + worker/relay integration receipt | safe-fail is the publication safety boundary | passed |
| U04-DEC-01 | Book/BookUpdate/review decisions | Book/Update rejection requires a closed ReasonCategory; Review `do_not_publish` has no ReasonCategory; every case has one revision-checked, idempotent Manager decision | P1 / blocking | FR-MOD-2..5; wireframes S-18 | real-PG contract/concurrency vectors + S-18 E2E | prevents stale/double/wrong-type decisions and user-facing policy leakage | passed |
| U04-PUB-01 | publication/Catalog/Cover | Immutable `BookVersion.status` stays `submitted`; separate pointer activates one version; activation/removal atomically updates audit + versioned Catalog provenance; public Cover resolves only through publication | P1 / blocking | FR-CAT-3, FR-LIC-4; AD-11/12 | database rows/events + public/negative Cover requests + E2E | prevents half-published state and private object URL exposure | passed |
| U04-SEC-01 | `/admin/moderation`, actions, DTO/events | Guest redirects; Author is denied route and decision; invalid Origin and invalid CSRF mutate nothing; internal AI signals appear only in Manager case detail and never Author/public/event output | P1 / blocking | FR-MOD-3, NFR-3; architecture Security | negative unit/E2E + unchanged database row counts + payload scans | role, CSRF and non-disclosure boundary | passed |
| U04-S13-01 | S-13 `/author/books/{id}` | submitted/manual/rejected/published/removed states; rejected Book shows only neutral ReasonCategory; public link follows publication availability; no AI signal/criteria | P1 / blocking | screen-map S-13; wireframes S-13 | Author E2E + state captures | closes Author moderation feedback without exposing Manager data | passed |
| U04-S18-01 | S-18 `/admin/moderation` | mixed queue and type filter; Book/Update/review detail and decisions; AI-unavailable notice; required ReasonCategory focus; removal ground + explicit confirmation; empty queue | P1 / blocking | screen-map S-18; wireframes S-18 | Manager E2E + state captures + database decisions/audit | closes the operational Manual Review loop | passed |
| U04-S02-01 | S-02 removed Book | After confirmed FR-LIC-4 removal, Guest sees stable `Книжка недоступна`; price, Cart CTA and sample action are absent; Book is absent from browse/search | P1 / blocking | FR-LIC-4; screen-map S-02 | removal E2E + public response + projection query | public availability must match authoritative state | passed |
| U04-A11Y-01 | S-13/S-18/S-02 | All 8 named keyboard/focus/dialog/mobile/reflow checks pass; visible targets are ≥44×44, labels/descriptions resolve, applicable inputs are ≥16px and measured contrast meets thresholds | P2 / blocking | design-brief Accessibility Floor; A11Y-01..08 | 8 revision-bound accessibility receipts + per-capture measurements | screenshots alone do not prove keyboard/dialog/reflow behavior | passed |
| U04-MOBILE-01 | S-18 at 390/430 | Queue becomes list→detail; selecting a case opens readable detail and `До черги` restores the list; no horizontal overflow or covered actions | P2 / blocking | wireframes Responsive Notes; RES-05 | mobile interaction receipt + captures | Manager mobile cannot be a squeezed desktop split pane | passed |

| Check ID | Baseline ID / Target Hash | Route / State / Viewport | Severity / Release Effect | Permitted Variance | Expected Evidence | Rationale | Result |
|---|---|---|---|---|---|---|---|
| U04-VIS-50 | `AVB-UKIEBOOK-AURORA-7B-V3` / `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724` | S-13 five lifecycle states; S-18 mixed/type-selected/provider-error/category-error/removal/empty; S-02 unavailable; core widths 390/768/1280 plus coverage at 430/1440; exactly 50 captures | P2 / blocking | Aurora Author/Manager/Public extension; real data/state copy; no S-01 pixel target | hashed revision-bound responsive matrix; 50 distinct files; zero console/page errors; overflow/touch/a11y measurements | proves complete visual state matrix without inventing pixel targets | passed |

## User Journey Checks

| Check ID | Applicability | Check | Severity / Release Effect | Source | Required Evidence | Rationale |
|---|---|---|---|---|---|---|
| UJ-01 | Author 1–9 | OAuth → profile → wizard → Попередній перегляд видання → rights/license → submission → Author status → Catalog; Author never sees Manager UI | P1 / blocking | User Journey Author; Route Map | e2e trace/video | primary Author journey |
| UJ-02 | Buyer 1–7 | Catalog → Book Page → Cart → auth → mono → Library/files | P1 / blocking | User Journey Buyer | e2e trace/video | primary Buyer journey |
| UJ-03 | failure paths | conversion failure preserves draft; payment failure preserves Cart; moderation rejection returns Author Reason Category | P1 / blocking | Journey Failure Path | scenario tests | recovery without data/value loss |
| UJ-04 | support paths | Discount, Book Update, Refund decision/compensation and prior-Buyer latest version complete end-to-end | P1 / blocking | Supporting Journeys | cross-module e2e | recurring MVP operations |
| UJ-05 | Manager | moderation, Payouts, Refunds and Authors are independent nav branches; singleton transfer and Book removal are auditable | P1 / blocking | Supporting Journeys; screen-map | role e2e + audit rows | operational closure |

## Screen And State Checks

Canonical state source: `docs/screen-map.md`. Each check requires captures at relevant viewports plus interaction/API evidence for transitions.

| Check ID | Applicability | Check | Severity / Release Effect | Source | Evidence | Rationale |
|---|---|---|---|---|---|---|
| ST-01 | S-01/S-02 | loading/empty/error/long results, unavailable Book, sample, Discount on/off, review pagination | P2 / blocking | screen-map | state captures + e2e | primary discovery |
| ST-02 | S-03/S-04/S-06 | OAuth error/return, empty Cart, auth requirement, checkout success/failure | P1 / blocking | screen-map | e2e | transaction continuity |
| ST-03 | S-07/S-08/S-09 | empty Library, latest version, download error, review eligibility/pending/published/not-published, Refund statuses | P1 / blocking | screen-map | e2e + captures | owned value/support |
| ST-04 | S-10/S-11/S-12 | first Book, all publishing statuses, draft/error, separate confirmations, Попередній перегляд видання/conversion error | P1 / blocking | screen-map | author scenarios | primary Author path |
| ST-05 | S-13/S-14 | moderation/Discount/Update/250 UAH queue/Founder exemption | P1 / blocking | screen-map | scenarios + captures | post-publish management |
| ST-06 | S-15/S-16/S-17 | no sales, per-Book Payout status, carry, missing payout details, reward model, public-name first entry | P1 / blocking | screen-map | scenarios + data inspection | reward/profile closure |
| ST-07 | S-18 | empty queue, type-specific decisions, Book removal confirmation/audit, downstream status updates | P1 / blocking | screen-map | Manager e2e | moderation closure |
| ST-08 | S-19 | month empty, awaiting/paid/carried, row below threshold no action, Founder 100% | P0 / blocking | screen-map | payout suite + captures | financial integrity |
| ST-09 | S-20 | empty/request/approve/deny; decision updates Library and ledger/payout | P1 / blocking | screen-map | Refund e2e | money correction |
| ST-10 | S-21 | list/card/off/on/existing-Founder conflict/atomic transfer/cancel | P1 / blocking | screen-map | concurrency + UI | singleton integrity |
| ST-11 | all protected | Guest redirects; Author denied `/admin/*`; non-Buyer review hidden | P1 / blocking | Access rules | negative e2e | access control |

## Wireframe Consistency Checks

| Check ID | Applicability | Check | Severity / Release Effect | Source | Evidence | Rationale |
|---|---|---|---|---|---|---|
| WF-01 | all | One primary action hierarchy; P-1…P-6 behave consistently | P2 / advisory unless journey meaning changes | wireframes | screen review | comprehension consistency |
| WF-02 | S-01 | locked header→hero→shelf→tiles→formula order; functional results only after/through existing controls | P2 / blocking | wireframes S-01; Baseline | screenshot diff | explicit 1:1 requirement |
| WF-03 | S-11/S-14/S-19/S-21 | legal/financial/destructive consequences precede action; separate confirmations and singleton conflict are visible | P1 / blocking | wireframes | flow captures | informed action |
| WF-04 | S-12/S-02 | Сторінка книжки in Попередній перегляд видання structurally matches actual S-02 without becoming internal reader | P2 / blocking | wireframes | paired captures | Author trust |

## UX/UI Checks

| Check ID | Applicability | Check | Severity / Release Effect | Source | Evidence | Rationale |
|---|---|---|---|---|---|---|
| UX-01 | all | canonical terms and Ukrainian copy; no Попередній перегляд видання/Безкоштовний фрагмент collision | P2 / blocking if meaning changes | canonical-terms | copy audit | domain clarity |
| UX-02 | money surfaces | UAH and tabular numbers; public/Author formula is `35/65`; manager-only decomposition is `29+6+65`; legal/tax release status is not misrepresented as uncertainty about the confirmed percentages | P2 / blocking | design-brief; PRD | captures/copy review + role visibility checks | financial comprehension |
| UX-03 | S-01 | Aurora Pastel 7b tokens, Golos hierarchy, square-corner 2:3 baked-artwork covers, glass, mesh, `35/65` formula, exact hero sentence, fully visible shelf and target hover | P2 / blocking | Approved Baseline | visual diffs + computed styles/assets/geometry | explicit operator selection |
| UX-04 | S-02…S-17 | Aurora extension remains recognizable without inventing pixel targets | P2 / blocking for hierarchy/meaning drift | Design/Experience Spine | component/token/state review | system continuity |
| UX-05 | S-18…S-21 | Aurora type/color/status semantics with quieter, denser Manager layout | P2 / blocking for supported viewport/meaning | Design Spine | captures | operational usability |
| UX-06 | S-03/legal/moderation | provider-brand OAuth, readable license/rights, neutral Reason Category | P1 / blocking | design-brief | content/accessibility review | trust boundaries |
| UX-07 | all branded surfaces | active `UkieBook-logo-transparent.svg` keeps the official silhouette/proportions/internal line structure, renders with transparent background and no backing plate; raster-backed SVG is not misrepresented as path-vector artwork | P2 / blocking | operator correction; design-brief | exact source hash + alpha/background inspection + rendered captures at required sizes | brand identity |

## Visual Regression Checks

Common Baseline ID: `AVB-UKIEBOOK-AURORA-7B-V3`; Target Hash: `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724`. Reference evidence: `forge/design/evidence/AVB-UKIEBOOK-AURORA-7B-V3.visual-qa.json` SHA-256 `ffae4a71e0db785033aad606e91b1557ef46d56d86690f8e09ae6cc81906323c`.

| Check ID | Baseline ID / Target Hash | Applicability / Route / State / Viewport | Severity / Release Effect | Permitted Variance | Expected Evidence | Rationale | Result |
|---|---|---|---|---|---|---|---|
| VIS-S01-1280-DEFAULT | `AVB-UKIEBOOK-AURORA-7B-V3` / `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724` | S-01 `/`, default, 1280×900 | P2 / blocking | real approved data/assets, semantic controls, allowed a11y corrections only | fresh full-page capture + diff to V3 HTML/reference capture | locked 1:1 correction scope | passed by UNIT-02-C1 at `3f77594bcb615847bdd71846374184cd2070d305` |
| VIS-S01-1280-HOVER | `AVB-UKIEBOOK-AURORA-7B-V3` / `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724` | S-01 `/`, cover and tile hover, 1280×900 | P2 / blocking | layered transform implementation, same V3 visual outcome | before/after capture + keyboard focus equivalent | target interaction | passed by UNIT-02-C1 |
| VIS-S01-RESPONSIVE | `AVB-UKIEBOOK-AURORA-7B-V3` / `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724` | S-01 default/loading/empty/error/results, 390/430/768/1440 | P2 / blocking | approved reflow: scroll-snap shelf, menu, stacked formula/filter drawer; cover corners remain square | captures + overflow/interaction checks | reference CSS is not the mobile contract | passed by UNIT-02-C1 |
| VIS-AURORA-PUBLIC | `AVB-UKIEBOOK-AURORA-7B-V3` / `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724` | S-02…S-09, applicable states, 390/768/1280 | P2 / blocking | design-spine extension, real content/state structure | token audit + representative state captures | no pixel target; system contract applies | S-02 scoped passed by UNIT-02-C1, with the unavailable/removed state extended and passed by UNIT-04; S-03 prior behavior remains UNIT-01 history and requires V3 visual receipt when affected; S-04…S-09 blocked |
| VIS-AURORA-AUTHOR | `AVB-UKIEBOOK-AURORA-7B-V3` / `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724` | S-10…S-17, applicable states, 390/768/1280 | P2 / blocking | calmer forms/tables within Aurora | token/component/state evidence | preserve brand and task clarity | S-10/S-11/S-12 scoped passed by UNIT-03 with 30 receipts; S-13 scoped passed by UNIT-04; S-14…S-16 remain blocked; S-17 prior behavior remains UNIT-01 history |
| VIS-AURORA-MANAGER | `AVB-UKIEBOOK-AURORA-7B-V3` / `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724` | S-18…S-21, applicable states, 390/768/1280 | P2 / blocking for meaning/viewport; otherwise advisory | denser, quieter operational surfaces | state captures + token/status audit | operational consistency | S-18 scoped passed by UNIT-04; S-19…S-21 remain blocked |
| VIS-TOKENS | `AVB-UKIEBOOK-AURORA-7B-V3` / `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724` | all visible routes, default and semantic states, 390/768/1280/1440 | P2 / blocking for hierarchy or brand drift | only source-backed contrast corrections and documented state colors | production token export/computed-style matrix + representative captures against V3 values | dedicated proof for Aurora palette, gradients, type, radii, spacing and shadows | S-01/S-02 scoped by UNIT-02-C1; UNIT-03 did not change shared token definitions and passed S-10/S-11/S-12 extension captures, contrast and external-Chrome inspection, but does not claim a separate token computed-style receipt; rerun on any shared-token change; remaining routes per owning unit |
| VIS-GLASS | `AVB-UKIEBOOK-AURORA-7B-V3` / `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724` | glass cards/panels on applicable public, Author and Manager routes, default/hover/focus, 390/768/1280 | P2 / blocking for hierarchy or system drift | density may change only where the extension contract permits it | computed background/border/blur/radius/shadow + component captures matched to V3 glass evidence | glassmorphism is a named cross-screen invariant | S-01/S-02 scoped by UNIT-02-C1; UNIT-03 reviewed S-10/S-11/S-12 and UNIT-04 reviewed S-02-unavailable/S-13/S-18 glass application in their extension matrices and external Chrome, without claiming a separate computed background/border/blur/radius/shadow artifact; rerun when the shared glass primitive changes; prior S-03/S-17 behavior history remains; other routes blocked |
| VIS-COVER | `AVB-UKIEBOOK-AURORA-7B-V3` / `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724` | every Book Cover, default/hover/loading, 390/768/1280/1440 | P2 / blocking | real Covers remain 2:3, every corner radius is exactly `0`, artwork title is baked into image and no live title overlay is allowed | computed radius/aspect assertions; seven distinct approved S-01 source hashes/URLs and image captures; DOM overlay absence | square-corner realistic Cover hero treatment is a named invariant | S-01/S-02 scoped passed by UNIT-02-C1 with seven distinct artworks; affected S-10/S-11/S-12 Cover geometry scoped passed by UNIT-03; affected S-02-unavailable/S-13/S-18 square-cover instances scoped passed by UNIT-04; later routes blocked |
| VIS-SHELF | `AVB-UKIEBOOK-AURORA-7B-V3` / `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724` | S-01 first row, default/hover, 1280×900 and responsive viewports | P2 / blocking | responsive reflow only; no bottom clipping of any of the five covers | cover/container bounding boxes, overflow computed styles, screenshots before/after hover | explicit operator correction | passed by UNIT-02-C1 |
| VIS-HERO-COPY | `AVB-UKIEBOOK-AURORA-7B-V3` / `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724` | S-01 hero, all states/viewports | P2 / blocking | line wrapping only; text is byte-for-byte `Електронні книжки EPUB і MOBI миттєво у вашу бібліотеку.` | DOM text assertion + captures | explicit operator correction | passed by UNIT-02-C1 |
| VIS-FORMULA | `AVB-UKIEBOOK-AURORA-7B-V3` / `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724` | S-01 public ribbon and applicable S-15 explanation, default/responsive, 390/768/1280/1440 | P2 / blocking for S-01 or financial meaning | responsive stacking may change layout, never labels, color mapping or `35% platform / 65% Author` meaning; manager `29+6` never appears as public segments | computed `35:65` segment proportions/colors/type/radius + text/role assertions + captures against V3 formula evidence | visual and financial-comprehension invariant | S-01 passed by UNIT-02-C1; S-15/manager allocation remains blocked until rewards unit |
| VIS-BRAND-LOGO | `AVB-UKIEBOOK-AURORA-7B-V3` / `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724` | all rendered logo instances, default/focus/high-density, 390/768/1280/1440 | P2 / blocking | active transparent SVG only; no backing plate; locked brand geometry preserved | source SHA-256 `db838dd4ad696f63cccb6aa86ab98e53dc5c6e13c1778ac340f62c5e4514617f`, alpha/background inspection + captures against V3 | explicit transparent-logo correction; raster-backed container is not claimed as path-vector | S-01/S-02 passed by UNIT-02-C1; S-10/S-11/S-12 rendered instances scoped passed by UNIT-03; S-02-unavailable/S-13/S-18 rendered the unchanged shared official asset in UNIT-04 extension review, without a separate source-hash/alpha receipt; other visible routes require a current V3 receipt when touched |

## Responsive Checks

| Check ID | Applicability | Check | Severity / Release Effect | Source | Evidence | Rationale |
|---|---|---|---|---|---|---|
| RES-01 | all | 390/430/768/1280/1440 no horizontal page overflow or inaccessible controls | P2 / blocking | design-brief | viewport automation + captures | supported web target |
| RES-02 | S-01 | exact V3 at 1280; deterministic shelf/header/formula/results reflow on mobile; five-cover first row never clips at the bottom and cover corners remain square | P2 / blocking | Baseline + wireframes | visual/overflow/bounding-box tests | explicit correction plus responsive contract |
| RES-03 | S-02/S-04/S-07 | one-column priority, sticky CTA where specified, readable Cart/Library rows | P2 / blocking | wireframes | captures + e2e | primary Buyer path |
| RES-04 | S-11…S-17 | step indicator, full-screen Попередній перегляд видання, forms/consequences/CTA remain reachable | P2 / blocking | wireframes | mobile Author e2e | primary Author path |
| RES-05 | S-18…S-21 | master-detail becomes list→detail; tables become labeled stacks | P2 / blocking | wireframes | captures | Manager mobile readability |
| RES-06 | all | 200% zoom/reflow keeps labels, status and CTA usable | P2 / blocking | accessibility floor | zoom captures/keyboard | accessibility |

## Accessibility Checks

| Check ID | Applicability | Check | Severity / Release Effect | Source | Evidence | Rationale |
|---|---|---|---|---|---|---|
| A11Y-01 | all | text/UI contrast meets 4.5:1/3:1; S-01 muted, placeholder and hero-gradient exceptions corrected minimally | P2 / blocking | design-brief; reference VQA | automated/manual contrast report | known baseline gap |
| A11Y-02 | all interactive | visible focus, keyboard order/activation, semantic controls and landmarks | P1 / blocking | design-brief | DOM audit + keyboard recording | reference uses non-semantic div/span |
| A11Y-03 | forms | persistent labels/instructions, textual errors, error focus/summary | P2 / blocking | design-brief | form walkthrough | task completion |
| A11Y-04 | touch | targets ≥44×44px with safe spacing; visible 40px cart receives ≥44px hitbox | P2 / blocking | design-brief | computed hitboxes | known baseline gap |
| A11Y-05 | mobile forms | input text ≥16px; no forced zoom/covered field | P2 / blocking | design-brief | device capture | iOS usability |
| A11Y-06 | covers/icons | cover alt = title + Author; production icons are labeled SVG/components, not emoji | P2 / blocking | design-brief | DOM inspection | meaningful non-text content |
| A11Y-07 | dialogs/drawers | focus trap/return, Escape where safe, screen-reader name/description | P1 / blocking | design-brief | keyboard/AT walkthrough | financial/legal actions |
| A11Y-08 | motion/states | information remains clear without motion; reduced-motion keeps final state | P2 / blocking | design-brief | media-emulation capture | motion cannot carry meaning |

## Interaction And State-Change Checks

| Check ID | Applicability | Check | Severity / Release Effect | Source | Evidence | Rationale |
|---|---|---|---|---|---|---|
| INT-01 | payments/submits/payouts | loading disables duplicate action; repeat click/webhook remains idempotent | P1 / blocking | AD-3/7; design-brief | concurrency tests | money/data integrity |
| INT-02 | uploads/conversion | drag-over/progress/error/retry and draft preservation | P1 / blocking | AD-4; wireframes | scenario tests | no Author data loss |
| INT-03 | moderation/refund/update | downstream surfaces update from authoritative state and announce change | P1 / blocking | architecture boundaries | integration tests | cross-module consistency |
| INT-04 | S-01 | cover/tile hover does not erase base rotate or cause shelf clipping; search/nav/cart are functional and keyboard-equivalent; hover/focus never adds a live title overlay | P2 / blocking | Baseline | interaction trace + DOM/style assertions | exact visual + real behavior |

## Browser And Device Checks

| Check ID | Applicability | Check | Severity / Release Effect | Source | Evidence | Rationale |
|---|---|---|---|---|---|---|
| BD-01 | latest stable Chrome/Safari/Firefox desktop; Safari iOS; Chrome Android | Buyer and Author critical journeys | P1 / blocking | adaptive-web context | browser matrix runs | practical supported floor |
| BD-02 | payment-capable devices | Apple Pay in supported Safari context and Google Pay in supported Chrome context through mono sandbox | P1 / blocking | FR-PAY-3 | provider sandbox evidence | named payment methods |

## Evidence Requirements

Every run records Check ID, applicability, implementation revision, timestamp, executor, result, source, evidence paths and findings with severity/release effect/rationale. Visual evidence records Baseline ID/hash, route, state, viewport, content fixture and permitted variance. Financial results reproduce sums from ledger events; UI screenshots alone never pass them. Evidence format follows `docs/dod-evals.md`.

## Evidence Limits

- This checklist and approved design prove intended truth, not runtime implementation.
- Reference Playwright captures prove the V3 HTML target and its component correction invariants; they do not alone pass production VIS, accessibility, responsive or behavior checks.
- V3 proves the active transparent-background SVG in the locked brand geometry at reference sizes. Each production route still needs its applicable rendered receipt; the absence of an opaque logo plate is an explicit assertion, not an inference from the `.svg` extension.
- The active SVG is raster-backed and therefore proves neither path-vector geometry nor infinite-scale vector quality; QA must describe it accurately while checking transparency and visual identity.
- Screenshots alone do not prove keyboard, AT, auth, payment, persistence, privacy, conversion or ledger behavior.
- UNIT-03 combines screenshots with real PostgreSQL, conversion, E2E and accessibility receipts, but only for S-10/S-11/S-12 through `BookSubmitted`; it does not pre-pass production S3, moderation, publication, Catalog projection, full WCAG or the release browser/device matrix.
- UNIT-04 separately passes only the S-13/S-18/S-02-unavailable moderation/publication slice at its recorded revision. It does not claim S-01 pixel-lock, complete WCAG/cross-browser/device release coverage, Update/Review producer/application flows, Discount/250 UAH, rewards/founder, Cart/payment or Library completion.
- mono sandbox does not confirm production tariffs; OQ-2 closes only with current provider evidence.

## Regression Risks

| Trigger | Mandatory rerun |
|---|---|
| publishing/converter change | ACC-02..04, UJ-01, ST-04, INT-02 |
| commerce/rewards/formula change | ACC-09/11..14, UJ-02/04/05, ST-06/08/09, UX-02, VIS-FORMULA, INT-01/03; exact `2900+600+6500=10000` vectors |
| identity/RBAC change | ACC-01/12/14, ST-11, A11Y-02 |
| S-01/CSS/token/copy change | VIS-S01-*, VIS-TOKENS, VIS-GLASS, VIS-COVER, VIS-SHELF, VIS-HERO-COPY, VIS-FORMULA, VIS-BRAND-LOGO, RES-01/02, A11Y-01/02/04/08 |
| shared glass/Cover/formula primitive change | affected VIS-AURORA-*, VIS-GLASS, VIS-COVER/VIS-SHELF or VIS-FORMULA plus affected responsive/accessibility checks |
| official transparent SVG, its placement or logo surface background change | UX-07, VIS-BRAND-LOGO, VIS-S01-1280-DEFAULT, affected responsive captures and source/alpha checks |
| Baseline ID/hash change | all VIS/UX/RES checks and every affected development-plan unit |
| canonical terms/route-state change | UX-01, affected ST/UJ/WF checks |

## Release Readiness

Blockers: product implementation units UNIT-05…UNIT-10 and the unimplemented portions of S-04…S-09/S-14…S-16/S-19…S-21 plus complete release-journey evidence are not complete; later-owned S-13 Discount/Update states remain unimplemented. Credentialed Google/Facebook smoke blocks production provider activation; legal/tax review (OQ-1), mono production terms (OQ-2), and production font license/provenance remain open. UNIT-00 through UNIT-04 are current only within their recorded scopes. MOBI and moderation/publication proofs are closed; next executable unit is UNIT-05 for Cart, mono payment, `PaidSale`, E-01, auth return-to and failed-payment recovery.

blocked

## Open Questions

- OQ-QA1 closed for foundation automation: Playwright/browser binaries are pinned by `package-lock.json`. The cross-browser/device release matrix remains owned by UNIT-09/UNIT-10 and must be evidenced there rather than inferred from UNIT-00 Chromium smoke.
