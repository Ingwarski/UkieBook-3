# Design Brief

## Source References

- `docs/prd.md` v1.2 — продуктова поведінка, ролі, acceptance boundaries, correction formula та явне рішення про 1:1 design use.
- `docs/user-journey.md` — довірчі моменти, climax beats, failure paths.
- `docs/screen-map.md` — канонічні S-01…S-21, маршрути й стани.
- `docs/wireframes.md` — структура, включно з post-approval reconciliation S-01.
- `docs/project-context.md` — спожито: розд. 3–4 (аудиторія), 7 (platform), 11 (visual constraint), 13 (responsive/reference risk).
- `docs/canonical-terms.md` — ролі, domain objects, screen/flow names, approved UI labels.
- `docs/guardrails.md` — authority, evidence limits і permitted-variance boundaries.
- `forge/design/README.md` — high-fidelity handoff «Аврора · пастельна», варіант 7b.
- `forge/design/ukiebook-catalog.html` and `forge/design/screenshot-catalog.png` — immutable v1 target retained as superseded history.
- `forge/design/candidates/operator-final-7b/v3/ukiebook-catalog.html` — active correction target S-01: square-corner covers, seven unique baked-artwork cover assets, uncropped shelf, corrected copy/formula and transparent SVG logo.
- `forge/design/evidence/AVB-UKIEBOOK-AURORA-7B-V3.visual-qa.json` — active geometry, component and browser evidence.
- `UkieBook-logo-transparent.svg` / `public/brand/UkieBook-logo-transparent.svg` — офіційний transparent-background SVG container, SHA-256 `db838dd4ad696f63cccb6aa86ab98e53dc5c6e13c1778ac340f62c5e4514617f`; контейнер містить raster image і не заявляється як path-vector artwork.
- `UkieBook-logo.jpg`, `UkieBook-logo-exact.svg`, V1/V2 candidates/evidence — immutable superseded history, не активні production assets.
- Явне рішення оператора 2026-07-21: фінальний мокап використовується 1:1 з подальшим додаванням функціональності; correction-команда 2026-07-22 точно замінює formula/copy/logo/cover/shelf contract без нового циклу дизайн-апруву.

## Design Brief

UkieBook виглядає як тепла сучасна українська книгарня: пастельна «аврора», легкі glass-поверхні й яскраві Обкладинки як головне джерело кольору. Сигнатурний мотив довіри — стрічка публічної формули `35% платформі / 65% автору`; внутрішній менеджерський розклад — `29%` чистого заробітку платформи + `6%` податкового компонента платформи + `65%` автору. Фінальний S-01 V3 не є натхненням для редизайну: його desktop-композиція, типографічна ієрархія, токени, квадратнокутні cover artworks, тіні й hover є locked visual target. Решта продукту додає реальну поведінку й нові поверхні в тій самій системі.

## Decision Log

| Рішення | Статус | Підстава |
|---|---|---|
| `operator-final-7b/v3` «Аврора · пастельна» — активний correction candidate / `AVB-UKIEBOOK-AURORA-7B-V3` | approved | Точна correction-команда оператора 2026-07-22; freeze receipts зафіксовано у `forge/runs/UNIT-02-C1/20260722T115720Z-338d4450e107/run.json` |
| `operator-final-7b/v1`, `operator-final-7b/v2` і Baselines V1/V2 збережені незмінними як history | superseded | V3 має окремий immutable target/evidence і не переписує попередню історію |
| S-01 desktop default/hover відтворюється 1:1; функціональний Каталог продовжується після locked composition або через наявні controls | approved | Оператор + wireframes S-01 |
| S-02…S-21 наслідують Aurora tokens/patterns, але не мають удаваного pixel-reference coverage | approved | Handoff прямо каже, що ці екрани ще треба збудувати |
| HTML — visual reference для reimplementation, не production code і не доказ функціональності | approved | `forge/design/README.md` About the Design Files |
| Production semantics/a11y/responsive corrections дозволені в чітко названих межах | approved variance | guardrails; measured reference limits |
| `UkieBook-logo-transparent.svg` є активним офіційним логотипом без background; production інтегрує саме transparent SVG container без зміни locked brand geometry | scoped operator override | Пряма correction-команда оператора 2026-07-22 |
| Усі Обкладинки мають квадратні кути; S-01 використовує сім різних реалістичних baked-artwork covers із різними назвами без live-text overlay; перший shelf-row не кліпається знизу | scoped operator override | Пряма correction-команда оператора 2026-07-22 |
| Попередні запропоновані D/E/F і A/B/C не є baseline та більше не керують дизайном | superseded exploration | Явно наданий фінальний 7b |
| Публічна формула — `35% платформі / 65% автору`; менеджерська декомпозиція — `35 = 29 net platform + 6 platform tax component`; інваріант `29 + 6 + 65 = 100` | approved current product rule; release legality remains separately gated | Пряма correction-команда оператора 2026-07-22; product-idea, PRD |

## Audience And Context

Україномовні Автори, Покупці та Менеджери працюють у desktop/mobile browser. Категорія поєднує consumer e-commerce, кабінет Автора й щільні службові поверхні. Покупецький хром лишається теплим і емоційним; юридичні, фінансові й moderation-зони — спокійні й точні.

## Product Experience Goal

- Покупець: «це жива й затишна українська книгарня, де легко вибрати й безпечно купити».
- Автор: «мій Рукопис став справжньою Книжкою, а Винагорода пояснена без прихованих правил».
- Менеджер: «та сама впізнавана система, але щільна, швидка й без декоративних перешкод».

## Concern Scan

- Accessibility: WCAG 2.2 AA — implementation floor; static reference має відомі contrast/semantics/touch-target прогалини, описані в Baseline variance.
- Platform: responsive web; no native apps.
- Localization: українська й повна кирилиця; UAH і tabular numerals.
- OAuth: Google/Facebook controls за brand guidelines, без перефарбовування.
- Legal/financial copy: повні наслідки, окремі confirmations, без дрібного шрифту.
- Motion: лише функціональні 150–200ms hover/lift transitions; meaning не залежить від motion.
- Dark mode: не визначений baseline і не входить у MVP.
- Offline: screen-map визначає застосовні error/offline states; baseline не додає offline product scope.
- AI: ШІ-модерація — signal; Ручна перевірка і Категорія причини лишаються явно відмінними.

## Design Spine

### Brand And Style

Напрям: `Aurora Pastel 7b`. Теплий `color-bg`, м'який mesh-gradient у верхній зоні, glass surfaces, мінімальний brand accent, насичені 2:3 Обкладинки як heroes. Активний офіційний знак — чорно-біле поєднання електронного пристрою й відкритої книжки у `UkieBook-logo-transparent.svg`, без background; його силует, пропорції та внутрішня лінійна структура є авторитетними. SVG є transparent raster-backed container, а не path-vector master. Boldness витрачається на hero headline, різні реалістичні cover artworks та formula ribbon; форми, списки, юридичні й Менеджерські екрани утримуються від зайвого декору.

### Colors

Семантичні ролі живуть у `Design Tokens`. Status colors для `draft`, `converting`, `manual_review_pending`, `published`, `rejected`, payout states додаються як AA-сумісні похідні й не змінюють базову палітру. Formula colors зберігають двосегментне grouping `35% platform / 65% author`; `29% + 6%` є внутрішніми числовими полями manager surfaces, не додатковими сегментами публічної стрічки.

### Typography

- UI/body: `Golos Text`, 400/500/600/700/800, із `system-ui, sans-serif` fallback; ліцензію підтвердити до production self-hosting.
- Reading surfaces: `Literata` або інший перевірений кириличний serif лише для Попереднього перегляду видання/Безкоштовного фрагмента; fallback `Georgia, serif`.
- H1 S-01: 56px/1.02, weight 700, letter-spacing `-0.035em` на 1280 target.
- Prices/formula/tables: `font-variant-numeric: tabular-nums`.
- Production mobile inputs: не менше 16px; body здебільшого 14–16px.

### Layout And Spacing

- S-01 target container: 1220px max, centered, 24px outer margin at 1280 capture, 14px page radius.
- Header: `16px 40px`, gap 26px; hero `46px 40px 18px`; shelf uses the exact V3 height/padding that keeps all five covers fully visible through their bottom edges, gap 26px; tiles `34px 40px 8px`, gap 18px; formula `26px 40px 40px` outer placement.
- Handoff calls the scale “base-4”, but several exact target values (9/14/18/22/26/30/34) are not multiples of four. Exact S-01 values win; new surfaces prefer a 4px rhythm without rewriting locked values.
- New screen content uses max-width 1220px and preserves whitespace-first separation before borders/shadows.

### Elevation And Depth

- Glass: white 70–80% + 10px backdrop blur + hairline.
- Hero Obкладинки: `0 24px 44px rgba(178,107,214,.24)`.
- Tiles/formula: `0 8px 22px rgba(178,107,214,.10)`.
- No nested card-in-card or shadow on every list row; modal/drawer may use one stronger elevation tier.

### Shapes

- Shelf covers and every other Book Cover/thumbnail: `0px` corner radius; 2:3 always.
- Tiles 22px; formula 26px; page 14px; pill/circle 999px.
- Touch hitbox can exceed visible 40px cart circle to reach 44px without changing the visible target.

### Component Appearance

- Public header P-1: official mark from `UkieBook-logo-transparent.svg`, rendered without a logo background and integrated with the UkieBook wordmark in the locked brand slot; V3 proves the corrected header/nav/hero/shelf/cards/formula desktop boxes; `Каталог · Жанри · Знижки · Авторам`; glass search; circular cart/badge. Production controls use semantic links/buttons/input.
- Book tile P-2: square-corner 2:3 Obкладинка hero + semantic title + Автор + UAH. S-01 has seven unique realistic artwork assets whose different titles are baked into the images; no live title text is drawn over cover images. The first shelf row shows all five covers through the bottom edge at the reference viewport.
- Hero subcopy: exactly `Електронні книжки EPUB і MOBI миттєво у вашу бібліотеку.`
- Formula ribbon: label `Прозора формула: з кожних 100 грн` + two proportional segments `35%` platform / `65% — автору`; the rendered widths preserve `35:65`.
- Buttons outside S-01: filled `color-accent` primary, glass/outline secondary, semantic danger only for destructive Manager actions.
- Forms: visible labels, inline errors, consequence block immediately before financial/legal CTA.
- Tables: quiet surface, right-aligned tabular numbers; mobile becomes labeled stacks.
- Status badges: stable meaning across Author/Manager surfaces; color is never the sole cue.

### Visual Do's And Don'ts

- Do: preserve Aurora palette, mesh, glass, square-corner 2:3 covers, typographic hierarchy, corrected `35/65` formula motif, warm/direct Ukrainian copy.
- Do: let real covers provide saturated color; keep operational screens calmer.
- Do: use seven distinct baked-artwork cover assets on S-01, keep the first five fully visible, and render the transparent SVG logo without a backing plate.
- Don't: substitute generic shadcn/MUI styling, blue SaaS chrome, dark-first theme, heavy gradients everywhere, emoji as production icons, or nested cards.
- Don't: insert filters or authentication chrome between locked S-01 hero/shelf/tiles/formula zones.
- Don't: copy the HTML's non-semantic `div`/`span` controls or mobile squeeze as production behavior.
- Don't: round any Book Cover corner, overlay live title typography onto an artwork, repeat one placeholder design as if it were a different cover, clip the first shelf row, restore old formula/copy, or restore an opaque logo background.

### Design Tokens

| Token | Value / contract |
|---|---|
| `color-bg` | `#FFF7F3` |
| `color-page-outer` | `#ECE7E2` for the framed desktop reference; production full-page use may omit outer frame |
| `color-text` | `#2E2621` |
| `color-text-muted` | target `#857468`; production may darken minimally to pass AA |
| `color-accent` | `#B26BD6` |
| `gradient-brand` | `#E08AB0 → #B26BD6 55% → #E8A04B` |
| `color-glass` | `rgba(255,255,255,.70)` |
| `color-glass-strong` | `rgba(255,255,255,.80)` |
| `color-hairline` | `rgba(46,38,33,.05–.06)` |
| `color-formula-platform` | `#F6E4D2`; text `#8C572C`; public segment width `35%` |
| `gradient-formula-author` | `#9851B8 → #B95085`; white text; public segment width `65%` |
| `mesh-aurora` | three radial gradients exactly from `forge/design/README.md`/HTML |
| `font-ui` | `Golos Text, system-ui, sans-serif` |
| `font-reading` | `Literata, Georgia, serif` after license/provenance check |
| `radius-cover/thumb/tile/formula/page/pill` | `0 / 0 / 22 / 26 / 14 / 999px` |
| `shadow-cover` | `0 24px 44px rgba(178,107,214,.24)` |
| `shadow-surface` | `0 8px 22px rgba(178,107,214,.10)` |
| `motion-fast` | `180ms ease-out` |

## Experience Spine

### Foundation

Adaptive web; Ukrainian; UAH; Guest/Buyer/Author/Manager access exactly from screen-map. Public discovery retains Aurora emotion; Author work uses guided steps; Manager work favors density and auditability.

### Information Architecture Implications

P-1 keeps Каталог, Жанри, Знижки, Авторам, search and cart. Authenticated access to Бібліотека/profile is added without replacing the baseline hierarchy. Author and Manager areas use role navigation defined by screen-map, not hidden routes.

### Voice And Tone

Warm and concise in discovery; precise in payment/legal areas; neutral in moderation. Always use canonical terms. Formula copy explicitly remains a current working product model until release review; no UI claims legal/accounting validation.

### Component Behavior

- Shelf cover hover: lift 16px while preserving its base rotate/offset through layered transforms.
- Tile hover: lift 4px; links change to accent.
- Buttons expose hover/focus/active/disabled/loading; repeat click cannot duplicate payment/submission/payout actions.
- Search is a real labeled input; nav and cards are keyboard-operable links; cart is a button/link with accessible name and count.
- Modals/drawers trap focus, close with Escape where safe, return focus, and explain consequences.

### State Patterns

The state list belongs to screen-map and structure to wireframes. Default, loading, empty, error, success, long-content, permission, offline and disabled states reuse target geometry. Skeletons mirror the zone; empty/error messages are inline with a constructive action. S-01's locked shell remains recognizable while result content changes.

### Interaction Primitives

150–200ms ease-out for hover/lift/focus feedback; no page transition animation. Motion never carries state meaning alone. `prefers-reduced-motion` may remove nonessential movement while preserving final position and information; this is an accessibility implementation detail, not a redesign.

### Accessibility Floor

WCAG 2.2 AA implementation target: semantic landmarks/controls, 4.5:1 normal text and 3:1 large/UI text, visible focus, full keyboard operation, labels and textual errors, touch targets at least 44×44px, mobile input text at least 16px, zoom/reflow to 200%, cover alt = title + Автор. Reference-only exceptions must be corrected within permitted variance and evidenced; static files do not prove compliance.

### Key Flow Implications

- Buyer: discovery → S-02 → cart → OAuth/mono → library, with failure preserving cart.
- Author: first entry → profile → wizard → Попередній перегляд видання → separate rights/license confirmations → status in Author surface; never routed into Manager UI.
- Manager: moderation, payouts, refunds and Authors are sibling navigation branches.
- Trust motifs: formula ribbon can recur on S-15; financial/legal consequences are placed before CTA.

## Responsive And Platform Behavior

- 1440/1280: S-01 page max 1220 and locked target composition; exact 1280 reference is primary comparison.
- 768: header condenses; shelf stays horizontal; tiles 2 columns; formula remains horizontal if labels do not collide.
- 430/390: deterministic scroll-snap shelf with 2–3 visible covers; compact nav menu; search/cart one click away; tiles 2 columns; formula stacks; filters in drawer; no clipped controls or horizontal page overflow.
- S-02 and forms become one column; tables become labeled stacks; dialogs become accessible full-width/bottom-sheet surfaces where appropriate.
- Mobile is a derived approved adaptation, not a request to reproduce the non-responsive reference squeeze.

## Design Handoff Prompt

Reimplement `operator-final-7b/v3` in the production component system. Match the active S-01 desktop target exactly for composition, tokens, typography, transparent-logo brand slot, square-corner cover geometry, seven unique baked-artwork covers, uncropped shelf, corrected hero copy, `35/65` formula, glass surfaces and hover. Use `UkieBook-logo-transparent.svg` as the active official logo source; it is a transparent-background raster-backed SVG container and must not gain a backing plate or be misrepresented as path-vector artwork. Add real routes, semantic controls, states, data and responsive layouts from screen-map/wireframes. Extend Aurora—not a generic design system—to S-02…S-21. Do not copy prototype code as application logic or claim runtime behavior from it.

## Approved Visual Baseline

- Status: approved
- Baseline ID: `AVB-UKIEBOOK-AURORA-7B-V3`
- Selected Candidate And Version: operator-scoped correction `operator-final-7b/v3`
- Immutable Visual Target Reference And Hash: `forge/design/candidates/operator-final-7b/v3/ukiebook-catalog.html` SHA-256 `01f6ab68ed967ef03c7230842d1ede7c948643bb7d24a65c4eb45ac7498093f9`; ordered target bundle hash `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724`. The bundle includes the target HTML, its candidate-local seven cover assets, and the active official `UkieBook-logo-transparent.svg` SHA-256 `db838dd4ad696f63cccb6aa86ab98e53dc5c6e13c1778ac340f62c5e4514617f` according to the freeze receipt.
- Frozen Prototype Source Root And Tree Hash: `forge/design/candidates/operator-final-7b/v3`; SHA-256 tree receipt `7b13c9e123694cf800ccda987aa64a7f98e625d671161a838b4f94e315feba97`.
- Prototype Artifact References: V3 candidate README/HTML/assets; `forge/design/evidence/AVB-UKIEBOOK-AURORA-7B-V3.visual-qa.json` SHA-256 `ffae4a71e0db785033aad606e91b1557ef46d56d86690f8e09ae6cc81906323c`; correction verification run `forge/runs/UNIT-02-C1/20260722T115720Z-338d4450e107/run.json`; V1/V2 artifacts remain immutable historical evidence.
- Visual Definition Of Done Scope: exact S-01 desktop default/hover including transparent-logo integration, square-corner covers, seven unique baked artworks, first-row no-clipping, exact hero sentence and `35/65` formula, plus shared Aurora system and individually addressable token/glass/cover/formula invariants. S-02…S-21, screen states and mobile are extension scope governed by this Design/Experience Spine + wireframes/screen-map; they are required product UI but do not pretend to have pixel targets.
- Covered Screens States And Viewports: locked exact — S-01 `/`, default and cover/tile hover, 1280×900; supporting source crop 924×540. Derived coverage — S-01 at 390/430/768/1440 and functional states; S-02…S-21 at required viewports/states through system consistency, not pixel matching.
- Approval Receipt: original whole-design approval 2026-07-21 plus exact operator correction 2026-07-22: all Book Covers square-cornered; distinct realistic baked-title artwork; public `35/65`, internal `29+6+65`; exact hero sentence; first shelf row uncropped; transparent SVG logo. The correction is directive acceptance and does not require a redundant approval prompt.
- Approved At: 2026-07-22; immutable receipt finalized by UNIT-02-C1 at revision `3f77594bcb615847bdd71846374184cd2070d305` and run `forge/runs/UNIT-02-C1/20260722T115720Z-338d4450e107/run.json`.
- Permitted Variance: real dynamic data using the seven approved distinct 2:3 artworks; semantic links/buttons/input; production icons replacing glyphs; invisible 44px hit-area expansion or minimal size correction; visible focus; minimal measured contrast corrections preserving hue hierarchy; responsive reflow; state/error/loading content; authenticated navigation access; full catalog continuation after locked formula. No variance may materially change locked desktop composition, exact hero copy, `35/65` meaning, token relationships, square cover geometry, baked artwork identity, shelf visibility, formula motif, transparent official logo identity or interaction meaning.
- Operator Overrides: skip the normal three-candidate generation; preserve 7b V3 1:1 in covered scope; add required functionality without redesign; use the transparent-background SVG in the locked brand slot; never round covers, add live title overlays, repeat placeholder cover art, clip the first shelf row or expose `29+6` on the public ribbon.
- Supersedes: `AVB-UKIEBOOK-AURORA-7B-V2`; V1/V2 and prior A/B/C and D/E/F remain historical/unapproved as applicable.
- Superseded By: —
- Downstream Invalidation: the 2026-07-22 correction transitively invalidates every active V2 baseline/formula/cover/logo receipt. All 13 SDD owner artifacts are reconciled to V3; original UNIT-02 visual results are historical and UNIT-02-C1 is the active correction receipt. Next executable feature unit remains UNIT-03.

## Validation Report

- Pass 1 — Mechanical coverage: V3 target, tree, evidence and UNIT-02-C1 receipts are hash-addressed through the freeze placeholders above; exact copy/formula, logo hash, square radii, seven distinct artworks and shelf geometry have explicit independent checks. Final receipt substitution is atomic and must leave no placeholder before commit.
- Pass 2 — Judgment: no parallel generic design system; S-01 target remains concrete; correction scope is exact and extension scope is honest. Remaining reference limitations are carried into production gates: demo semantics, touch target, measured contrast and responsive derivation. No correction finding changes the next-unit boundary: UNIT-03.

## Confirmed Design Decisions

Aurora Pastel 7b V3; official transparent-background `UkieBook-logo-transparent.svg`; exact hero sentence; all square-corner 2:3 covers; seven distinct realistic baked-title artworks; first shelf row fully visible; public `35/65` formula and internal manager-only `29+6+65`; S-01 1:1 desktop; separately verifiable tokens/glass/covers/formula/logo; warm mesh + glass; Golos Text; quiet operational surfaces; source-backed responsive reflow; AA implementation floor; prototype reimplemented rather than copied.

## Rejected Directions

Prior A/B/C and D/E/F explorations; flag-primary palette; dark-first chrome; generic component-library look; card-in-card; mobile squeeze of desktop HTML; emoji/glyphs as production icons.

## Out Of Scope

Dark-mode switch; native apps; internal reader; marketing-only site; new product screens beyond screen-map; prototype backend/auth/persistence/payment claims.

## Open Questions

- OQ-DB1. Verify Golos Text and selected reading-font license/provenance before production self-hosting; system fallbacks are acceptable until then.
- OQ-DB2. The exact production contrast correction values are selected during implementation from measured AA-safe variants while preserving the baseline hue hierarchy; QA evidence, not another approval, closes this.
