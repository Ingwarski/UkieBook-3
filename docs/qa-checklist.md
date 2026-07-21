# QA Checklist

## Source References

- `docs/prd.md` v1.1 — FR/NFR, User Stories, E2E acceptance scenarios.
- `docs/user-journey.md` — primary Buyer/Author and supporting/Manager journeys.
- `docs/screen-map.md` — canonical S-01…S-21 routes/states.
- `docs/wireframes.md` — structural deltas and responsive behavior.
- `docs/design-brief.md` — approved Baseline `AVB-UKIEBOOK-AURORA-7B-V2`; target bundle hash `c66b23c55e68649e67e029d47c8e69d3bef3791f8c4c6677aa0a6cef2259c51d`; permitted variance.
- `UkieBook-logo.jpg` — official logo operator override; SHA-256 `5cdd21d3ba038632528fc17a13068e3792d03a029779251cd738aaada4aa0ad3`.
- `UkieBook-logo-exact.svg` — official equivalent SVG container; SHA-256 `abb3acf8cfa673161e6547ca725f7b337b29185a7eb6918218f887faadc66d98`; embeds the official JPEG byte-for-byte and has no vector primitives.
- `forge/design/evidence/UkieBook-logo-svg-equivalence.json` — XML, byte-equivalence, static-safety and browser-render evidence; Baseline impact `none`.
- `forge/design/evidence/AVB-UKIEBOOK-AURORA-7B-V2.visual-qa.json` — reference QA for the immutable V2 target, including exact geometry, rendered official logo and component captures; not production implementation evidence.
- `docs/architecture.md` — AD-2/3/4/6/7/8/9 and security boundaries.
- `docs/dod-evals.md` — reusable gates, severity and result contract.
- `docs/guardrails.md` — evidence policy.
- `docs/project-context.md` — consumed section 7 (platform/viewports) and section 13 (risk applicability).

All implementation-dependent checks below have `Result: blocked` until fresh implementation evidence exists. Baseline approval removes the design-approval blocker; it does not pass runtime checks.

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
| ACC-12 | rewards | current 6/65.8/28.2 rule uses actually paid discounted price, integer kopiykas, no Buyer personal data | P0 / blocking | FR-REW-1..6, AD-2/7 | money vectors + ledger reproduction + API inspection | financial invariant; formula provisional legally, exact technically until upstream changes |
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
| UX-02 | money surfaces | UAH and tabular numbers; formula labeled provisional only in appropriate legal/help context, not misrepresented | P2 / blocking | design-brief; PRD | captures/copy review | financial comprehension |
| UX-03 | S-01 | Aurora Pastel 7b tokens, Golos hierarchy, 2:3 covers, glass, mesh, formula and target hover | P2 / blocking | Approved Baseline | visual diffs | explicit operator selection |
| UX-04 | S-02…S-17 | Aurora extension remains recognizable without inventing pixel targets | P2 / blocking for hierarchy/meaning drift | Design/Experience Spine | component/token/state review | system continuity |
| UX-05 | S-18…S-21 | Aurora type/color/status semantics with quieter, denser Manager layout | P2 / blocking for supported viewport/meaning | Design Spine | captures | operational usability |
| UX-06 | S-03/legal/moderation | provider-brand OAuth, readable license/rights, neutral Reason Category | P1 / blocking | design-brief | content/accessibility review | trust boundaries |
| UX-07 | all branded surfaces | official UkieBook logo silhouette, proportions and internal line structure remain visually identical to the official JPG; the exact raster-backed SVG container is acceptable, but no invented redraw | P2 / blocking | operator override; design-brief | selected asset hash + equivalence evidence when SVG is used + rendered captures at required sizes | brand identity |

## Visual Regression Checks

Common Baseline ID: `AVB-UKIEBOOK-AURORA-7B-V2`; Target Hash: `c66b23c55e68649e67e029d47c8e69d3bef3791f8c4c6677aa0a6cef2259c51d`. Reference evidence: `forge/design/evidence/AVB-UKIEBOOK-AURORA-7B-V2.visual-qa.json`.

| Check ID | Baseline ID / Target Hash | Applicability / Route / State / Viewport | Severity / Release Effect | Permitted Variance | Expected Evidence | Rationale | Result |
|---|---|---|---|---|---|---|---|
| VIS-S01-1280-DEFAULT | `AVB-UKIEBOOK-AURORA-7B-V2` / `c66b23c55e68649e67e029d47c8e69d3bef3791f8c4c6677aa0a6cef2259c51d` | S-01 `/`, default, 1280×900 | P2 / blocking | real data/covers, semantic controls, allowed a11y corrections only | fresh full-page capture + diff to V2 HTML/reference capture | locked 1:1 scope | blocked |
| VIS-S01-1280-HOVER | `AVB-UKIEBOOK-AURORA-7B-V2` / `c66b23c55e68649e67e029d47c8e69d3bef3791f8c4c6677aa0a6cef2259c51d` | S-01 `/`, cover and tile hover, 1280×900 | P2 / blocking | layered transform implementation, same visual outcome | before/after capture + keyboard focus equivalent | target interaction | blocked |
| VIS-S01-RESPONSIVE | `AVB-UKIEBOOK-AURORA-7B-V2` / `c66b23c55e68649e67e029d47c8e69d3bef3791f8c4c6677aa0a6cef2259c51d` | S-01 default/loading/empty/error/results, 390/430/768/1440 | P2 / blocking | approved reflow: scroll-snap shelf, menu, stacked formula/filter drawer | captures + overflow/interaction checks | reference CSS is not mobile-ready | blocked |
| VIS-AURORA-PUBLIC | `AVB-UKIEBOOK-AURORA-7B-V2` / `c66b23c55e68649e67e029d47c8e69d3bef3791f8c4c6677aa0a6cef2259c51d` | S-02…S-09, applicable states, 390/768/1280 | P2 / blocking | design-spine extension, real content/state structure | token audit + representative state captures | no pixel target; system contract applies | blocked |
| VIS-AURORA-AUTHOR | `AVB-UKIEBOOK-AURORA-7B-V2` / `c66b23c55e68649e67e029d47c8e69d3bef3791f8c4c6677aa0a6cef2259c51d` | S-10…S-17, applicable states, 390/768/1280 | P2 / blocking | calmer forms/tables within Aurora | token/component/state evidence | preserve brand and task clarity | blocked |
| VIS-AURORA-MANAGER | `AVB-UKIEBOOK-AURORA-7B-V2` / `c66b23c55e68649e67e029d47c8e69d3bef3791f8c4c6677aa0a6cef2259c51d` | S-18…S-21, applicable states, 390/768/1280 | P2 / blocking for meaning/viewport; otherwise advisory | denser, quieter operational surfaces | state captures + token/status audit | operational consistency | blocked |
| VIS-TOKENS | `AVB-UKIEBOOK-AURORA-7B-V2` / `c66b23c55e68649e67e029d47c8e69d3bef3791f8c4c6677aa0a6cef2259c51d` | all visible routes, default and semantic states, 390/768/1280/1440 | P2 / blocking for hierarchy or brand drift | only source-backed contrast corrections and documented state colors | production token export/computed-style matrix + representative captures against V2 values | dedicated proof for Aurora palette, gradients, type, radii, spacing and shadows | blocked |
| VIS-GLASS | `AVB-UKIEBOOK-AURORA-7B-V2` / `c66b23c55e68649e67e029d47c8e69d3bef3791f8c4c6677aa0a6cef2259c51d` | glass cards/panels on applicable public, Author and Manager routes, default/hover/focus, 390/768/1280 | P2 / blocking for hierarchy or system drift | density may change only where the extension contract permits it | computed background/border/blur/radius/shadow + component captures matched to V2 glass evidence | glassmorphism is a named cross-screen invariant | blocked |
| VIS-COVER | `AVB-UKIEBOOK-AURORA-7B-V2` / `c66b23c55e68649e67e029d47c8e69d3bef3791f8c4c6677aa0a6cef2259c51d` | every Book Cover, default/hover/loading, 390/768/1280/1440 | P2 / blocking where hierarchy or supported viewport breaks | real Covers replace placeholders; aspect ratio, radius and hero depth remain | dimension/aspect assertions + production captures against V2 cover evidence | 2:3 Cover hero treatment is a named invariant | blocked |
| VIS-FORMULA | `AVB-UKIEBOOK-AURORA-7B-V2` / `c66b23c55e68649e67e029d47c8e69d3bef3791f8c4c6677aa0a6cef2259c51d` | S-01 formula ribbon and applicable S-15 explanation, default/responsive, 390/768/1280/1440 | P2 / blocking for S-01 or financial meaning | responsive stacking may change layout, never labels, color mapping or 6/65.8/28.2 meaning | computed segment proportions/colors/type/radius + captures against V2 formula evidence | formula ribbon is both a visual and financial-comprehension invariant | blocked |
| VIS-BRAND-LOGO | `AVB-UKIEBOOK-AURORA-7B-V2` / `c66b23c55e68649e67e029d47c8e69d3bef3791f8c4c6677aa0a6cef2259c51d` | all rendered logo instances, default/focus/high-density, 390/768/1280/1440 | P2 / blocking | official JPG or proven byte-identical SVG container; any optimized/transparent/true-vector derivative only when visually identical; locked S-01 93.703125×26px brand slot preserved | selected source/derivative hashes + SVG equivalence receipt where applicable + pixel/shape comparison + captures against integrated V2 logo evidence | explicit official-logo override is rendered in the immutable target; container format alone is not a visual change | blocked |

## Responsive Checks

| Check ID | Applicability | Check | Severity / Release Effect | Source | Evidence | Rationale |
|---|---|---|---|---|---|---|
| RES-01 | all | 390/430/768/1280/1440 no horizontal page overflow or inaccessible controls | P2 / blocking | design-brief | viewport automation + captures | supported web target |
| RES-02 | S-01 | exact 1280; deterministic shelf/header/formula/results reflow on mobile | P2 / blocking | Baseline + wireframes | visual/overflow tests | known reference limitation |
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
| INT-04 | S-01 | cover/tile hover does not erase base rotate; search/nav/cart are functional and keyboard-equivalent | P2 / blocking | Baseline | interaction trace | exact visual + real behavior |

## Browser And Device Checks

| Check ID | Applicability | Check | Severity / Release Effect | Source | Evidence | Rationale |
|---|---|---|---|---|---|---|
| BD-01 | latest stable Chrome/Safari/Firefox desktop; Safari iOS; Chrome Android | Buyer and Author critical journeys | P1 / blocking | adaptive-web context | browser matrix runs | practical supported floor |
| BD-02 | payment-capable devices | Apple Pay in supported Safari context and Google Pay in supported Chrome context through mono sandbox | P1 / blocking | FR-PAY-3 | provider sandbox evidence | named payment methods |

## Evidence Requirements

Every run records Check ID, applicability, implementation revision, timestamp, executor, result, source, evidence paths and findings with severity/release effect/rationale. Visual evidence records Baseline ID/hash, route, state, viewport, content fixture and permitted variance. Financial results reproduce sums from ledger events; UI screenshots alone never pass them. Evidence format follows `docs/dod-evals.md`.

## Evidence Limits

- This checklist and approved design prove intended truth, not runtime implementation.
- Reference Playwright captures prove the V2 HTML target, component invariants and integrated official logo render with zero console errors/warnings; they do not pass production VIS, accessibility, responsive or behavior checks.
- V2 proves the official JPEG renders at 26×26px inside the locked 93.703125×26px S-01 brand slot; it does not prove that a later production transparent/optimized derivative preserves the mark at every required size.
- The supplied SVG proves an equivalent container option only: it embeds that JPEG byte-for-byte and contains no path-based vector geometry, so it does not prove infinite-scale or transparent-vector quality.
- Screenshots alone do not prove keyboard, AT, auth, payment, persistence, privacy, conversion or ledger behavior.
- mono sandbox does not confirm production tariffs; OQ-2 closes only with current provider evidence.

## Regression Risks

| Trigger | Mandatory rerun |
|---|---|
| publishing/converter change | ACC-02..04, UJ-01, ST-04, INT-02 |
| commerce/rewards change | ACC-09/11..14, UJ-02/04/05, ST-08/09, INT-01/03 |
| identity/RBAC change | ACC-01/12/14, ST-11, A11Y-02 |
| S-01/CSS/token change | VIS-S01-*, VIS-TOKENS, VIS-GLASS, VIS-COVER, VIS-FORMULA, VIS-BRAND-LOGO, RES-01/02, A11Y-01/02/04/08 |
| shared glass/Cover/formula primitive change | affected VIS-AURORA-*, VIS-GLASS, VIS-COVER or VIS-FORMULA plus affected responsive/accessibility checks |
| either official logo container, derivative or placement change | UX-07, VIS-BRAND-LOGO, VIS-S01-1280-DEFAULT, affected responsive captures |
| Baseline ID/hash change | all VIS/UX/RES checks and every affected development-plan unit |
| canonical terms/route-state change | UX-01, affected ST/UJ/WF checks |

## Release Readiness

Blockers: no production implementation or runtime evidence exists; build/test scripts are not bootstrapped; MOBI engine is unproven; legal/tax review (OQ-1), mono production terms (OQ-2), and production font license/provenance remain open. Approved Baseline is current and is not a blocker.

blocked

## Open Questions

- OQ-QA1. Exact browser version numbers are selected at repository bootstrap from the then-current stable releases; the browser families/device classes above are the SDD contract.
