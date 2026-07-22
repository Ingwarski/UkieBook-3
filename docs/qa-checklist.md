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

Product-route, journey and release checks below remain `blocked` until their owning units produce fresh implementation evidence. UNIT-00 platform foundation, UNIT-01 identity/profile, UNIT-02 behavior/persistence and UNIT-02-C1 V3 visual correction recorded next are scoped exceptions; Baseline approval removes the design-approval blocker but does not pass unimplemented product runtime checks.

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
- **Findings/Limit:** zero P0/P1/blocking P2 in original behavior scope. Catalog data is a guarded deterministic bootstrap projection until UNIT-03/UNIT-04 publication events populate it; this is an explicit integration seam, not a release-ready content pipeline.

### UNIT-02-C1 V3 Correction Execution

- **Result:** `passed` for correction scope at implementation revision `3f77594bcb615847bdd71846374184cd2070d305`.
- **Canonical Evidence:** `forge/runs/UNIT-02-C1/20260722T115720Z-338d4450e107/run.json`; active baseline target bundle `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724`, tree `7b13c9e123694cf800ccda987aa64a7f98e625d671161a838b4f94e315feba97`, reference VQA `ffae4a71e0db785033aad606e91b1557ef46d56d86690f8e09ae6cc81906323c`.
- **Passed Correction Scope:** every Book Cover rendered by affected shared/public primitives has `border-radius: 0`; S-01 uses seven distinct approved realistic cover artworks with different baked-in titles and no live title overlay; all five first-row covers are visible through their bottom edge; hero subcopy is exactly `Електронні книжки EPUB і MOBI миттєво у вашу бібліотеку.`; public ribbon is `35%` platform / `65% — автору`; active logo is the transparent-background SVG hash above and renders without a backing plate.
- **Formula Boundary:** public and Author-facing presentation shows only `35/65`. Manager/rewards implementation must separately prove `29%` net platform revenue + `6%` platform tax component + `65%` Author, with `29+6+65=100`; UNIT-02-C1 does not claim the future rewards ledger is implemented.
- **Next Unit:** UNIT-03.

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
| VIS-AURORA-PUBLIC | `AVB-UKIEBOOK-AURORA-7B-V3` / `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724` | S-02…S-09, applicable states, 390/768/1280 | P2 / blocking | design-spine extension, real content/state structure | token audit + representative state captures | no pixel target; system contract applies | S-02 scoped passed by UNIT-02-C1; S-03 prior behavior remains UNIT-01 history and requires V3 visual receipt when affected; S-04…S-09 blocked |
| VIS-AURORA-AUTHOR | `AVB-UKIEBOOK-AURORA-7B-V3` / `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724` | S-10…S-17, applicable states, 390/768/1280 | P2 / blocking | calmer forms/tables within Aurora | token/component/state evidence | preserve brand and task clarity | S-17 prior behavior remains UNIT-01 history and requires V3 visual receipt when affected; S-10…S-16 blocked |
| VIS-AURORA-MANAGER | `AVB-UKIEBOOK-AURORA-7B-V3` / `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724` | S-18…S-21, applicable states, 390/768/1280 | P2 / blocking for meaning/viewport; otherwise advisory | denser, quieter operational surfaces | state captures + token/status audit | operational consistency | blocked |
| VIS-TOKENS | `AVB-UKIEBOOK-AURORA-7B-V3` / `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724` | all visible routes, default and semantic states, 390/768/1280/1440 | P2 / blocking for hierarchy or brand drift | only source-backed contrast corrections and documented state colors | production token export/computed-style matrix + representative captures against V3 values | dedicated proof for Aurora palette, gradients, type, radii, spacing and shadows | S-01/S-02 correction scoped by UNIT-02-C1; remaining routes per owning unit |
| VIS-GLASS | `AVB-UKIEBOOK-AURORA-7B-V3` / `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724` | glass cards/panels on applicable public, Author and Manager routes, default/hover/focus, 390/768/1280 | P2 / blocking for hierarchy or system drift | density may change only where the extension contract permits it | computed background/border/blur/radius/shadow + component captures matched to V3 glass evidence | glassmorphism is a named cross-screen invariant | S-01/S-02 scoped by UNIT-02-C1; prior S-03/S-17 behavior history remains; remaining routes blocked |
| VIS-COVER | `AVB-UKIEBOOK-AURORA-7B-V3` / `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724` | every Book Cover, default/hover/loading, 390/768/1280/1440 | P2 / blocking | real Covers remain 2:3, every corner radius is exactly `0`, artwork title is baked into image and no live title overlay is allowed | computed radius/aspect assertions; seven distinct approved S-01 source hashes/URLs and image captures; DOM overlay absence | square-corner realistic Cover hero treatment is a named invariant | S-01/S-02 scoped passed by UNIT-02-C1 with seven distinct artworks; later routes blocked |
| VIS-SHELF | `AVB-UKIEBOOK-AURORA-7B-V3` / `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724` | S-01 first row, default/hover, 1280×900 and responsive viewports | P2 / blocking | responsive reflow only; no bottom clipping of any of the five covers | cover/container bounding boxes, overflow computed styles, screenshots before/after hover | explicit operator correction | passed by UNIT-02-C1 |
| VIS-HERO-COPY | `AVB-UKIEBOOK-AURORA-7B-V3` / `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724` | S-01 hero, all states/viewports | P2 / blocking | line wrapping only; text is byte-for-byte `Електронні книжки EPUB і MOBI миттєво у вашу бібліотеку.` | DOM text assertion + captures | explicit operator correction | passed by UNIT-02-C1 |
| VIS-FORMULA | `AVB-UKIEBOOK-AURORA-7B-V3` / `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724` | S-01 public ribbon and applicable S-15 explanation, default/responsive, 390/768/1280/1440 | P2 / blocking for S-01 or financial meaning | responsive stacking may change layout, never labels, color mapping or `35% platform / 65% Author` meaning; manager `29+6` never appears as public segments | computed `35:65` segment proportions/colors/type/radius + text/role assertions + captures against V3 formula evidence | visual and financial-comprehension invariant | S-01 passed by UNIT-02-C1; S-15/manager allocation remains blocked until rewards unit |
| VIS-BRAND-LOGO | `AVB-UKIEBOOK-AURORA-7B-V3` / `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724` | all rendered logo instances, default/focus/high-density, 390/768/1280/1440 | P2 / blocking | active transparent SVG only; no backing plate; locked brand geometry preserved | source SHA-256 `db838dd4ad696f63cccb6aa86ab98e53dc5c6e13c1778ac340f62c5e4514617f`, alpha/background inspection + captures against V3 | explicit transparent-logo correction; raster-backed container is not claimed as path-vector | S-01/S-02 passed by UNIT-02-C1; other visible routes require current V3 receipt when touched |

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

Blockers: product implementation units UNIT-03…UNIT-10 and the unimplemented portions of S-04…S-16/S-18…S-21 plus end-to-end journey evidence are not complete; credentialed Google/Facebook smoke blocks production provider activation; the MOBI engine is unproven; legal/tax review (OQ-1), mono production terms (OQ-2), and production font license/provenance remain open. UNIT-00, UNIT-01 behavior, UNIT-02 behavior/persistence and UNIT-02-C1 V3 correction are current only within their recorded scopes. Next executable unit is UNIT-03.

blocked

## Open Questions

- OQ-QA1 closed for foundation automation: Playwright/browser binaries are pinned by `package-lock.json`. The cross-browser/device release matrix remains owned by UNIT-09/UNIT-10 and must be evidenced there rather than inferred from UNIT-00 Chromium smoke.
