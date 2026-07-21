# Design Brief

## Source References

- `docs/prd.md` v1.1 — продуктова поведінка, ролі, acceptance boundaries і явне рішення про 1:1 design use.
- `docs/user-journey.md` — довірчі моменти, climax beats, failure paths.
- `docs/screen-map.md` — канонічні S-01…S-21, маршрути й стани.
- `docs/wireframes.md` — структура, включно з post-approval reconciliation S-01.
- `docs/project-context.md` — спожито: розд. 3–4 (аудиторія), 7 (platform), 11 (visual constraint), 13 (responsive/reference risk).
- `docs/canonical-terms.md` — ролі, domain objects, screen/flow names, approved UI labels.
- `docs/guardrails.md` — authority, evidence limits і permitted-variance boundaries.
- `forge/design/README.md` — high-fidelity handoff «Аврора · пастельна», варіант 7b.
- `forge/design/ukiebook-catalog.html` — primary live visual target S-01.
- `forge/design/screenshot-catalog.png` — supporting 924×540 crop.
- `UkieBook-logo.jpg` — офіційний logo asset, наданий оператором; JPEG 1254×1254, SHA-256 `5cdd21d3ba038632528fc17a13068e3792d03a029779251cd738aaada4aa0ad3`.
- Явне рішення оператора 2026-07-21: цей мокап фінальний, має бути використаний 1:1 з подальшим додаванням потрібної функціональності.

## Design Brief

UkieBook виглядає як тепла сучасна українська книгарня: пастельна «аврора», легкі glass-поверхні й яскраві Обкладинки як головне джерело кольору. Сигнатурний мотив довіри — стрічка робочої формули `6 / 65,8 / 28,2`. Фінальний S-01 не є натхненням для редизайну: його desktop-композиція, типографічна ієрархія, токени, геометрія, тіні й hover є locked visual target. Решта продукту додає реальну поведінку й нові поверхні в тій самій системі.

## Decision Log

| Рішення | Статус | Підстава |
|---|---|---|
| `operator-final-7b/v1` «Аврора · пастельна» — активний imported final design | approved | Пряма команда оператора; handoff README |
| S-01 desktop default/hover відтворюється 1:1; функціональний Каталог продовжується після locked composition або через наявні controls | approved | Оператор + wireframes S-01 |
| S-02…S-21 наслідують Aurora tokens/patterns, але не мають удаваного pixel-reference coverage | approved | Handoff прямо каже, що ці екрани ще треба збудувати |
| HTML — visual reference для reimplementation, не production code і не доказ функціональності | approved | `forge/design/README.md` About the Design Files |
| Production semantics/a11y/responsive corrections дозволені в чітко названих межах | approved variance | guardrails; measured reference limits |
| `UkieBook-logo.jpg` є офіційним логотипом; production інтегрує його без зміни locked S-01 geometry | scoped operator override | Пряма команда оператора 2026-07-21 |
| Попередні запропоновані D/E/F і A/B/C не є baseline та більше не керують дизайном | superseded exploration | Явно наданий фінальний 7b |
| Робоча формула 6/65,8/28,2 показується як у baseline, але не вважається юридично підтвердженою до OQ-1 | provisional product copy | product-idea, PRD OQ-1 |

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

Напрям: `Aurora Pastel 7b`. Теплий `color-bg`, м'який mesh-gradient у верхній зоні, glass surfaces, мінімальний brand accent, насичені 2:3 Обкладинки як heroes. Офіційний знак — чорно-біле поєднання електронного пристрою й відкритої книжки з `UkieBook-logo.jpg`; його силует, пропорції та внутрішня лінійна структура є авторитетними. Boldness витрачається на hero headline, Обкладинки та formula ribbon; форми, списки, юридичні й Менеджерські екрани утримуються від зайвого декору.

### Colors

Семантичні ролі живуть у `Design Tokens`. Status colors для `draft`, `converting`, `manual_review_pending`, `published`, `rejected`, payout states додаються як AA-сумісні похідні й не змінюють базову палітру. Formula colors зберігають 6/65,8/28,2 grouping.

### Typography

- UI/body: `Golos Text`, 400/500/600/700/800, із `system-ui, sans-serif` fallback; ліцензію підтвердити до production self-hosting.
- Reading surfaces: `Literata` або інший перевірений кириличний serif лише для Попереднього перегляду видання/Безкоштовного фрагмента; fallback `Georgia, serif`.
- H1 S-01: 56px/1.02, weight 700, letter-spacing `-0.035em` на 1280 target.
- Prices/formula/tables: `font-variant-numeric: tabular-nums`.
- Production mobile inputs: не менше 16px; body здебільшого 14–16px.

### Layout And Spacing

- S-01 target container: 1220px max, centered, 24px outer margin at 1280 capture, 14px page radius.
- Header: `16px 40px`, gap 26px; hero `46px 40px 18px`; shelf height 270px/gap 26px; tiles `34px 40px 8px`, gap 18px; formula `26px 40px 40px` outer placement.
- Handoff calls the scale “base-4”, but several exact target values (9/14/18/22/26/30/34) are not multiples of four. Exact S-01 values win; new surfaces prefer a 4px rhythm without rewriting locked values.
- New screen content uses max-width 1220px and preserves whitespace-first separation before borders/shadows.

### Elevation And Depth

- Glass: white 70–80% + 10px backdrop blur + hairline.
- Hero Obкладинки: `0 24px 44px rgba(178,107,214,.24)`.
- Tiles/formula: `0 8px 22px rgba(178,107,214,.10)`.
- No nested card-in-card or shadow on every list row; modal/drawer may use one stronger elevation tier.

### Shapes

- Shelf covers 16px; thumbnails 12px; 2:3 always.
- Tiles 22px; formula 26px; page 14px; pill/circle 999px.
- Touch hitbox can exceed visible 40px cart circle to reach 44px without changing the visible target.

### Component Appearance

- Public header P-1: official `UkieBook-logo.jpg` mark integrated with the UkieBook wordmark while preserving the locked header height, spacing and navigation geometry; `Каталог · Жанри · Знижки · Авторам`; glass search; circular cart/badge. Production controls use semantic links/buttons/input.
- Book tile P-2: Obкладинка hero + title + Автор + UAH; real images retain 2:3 and target radii.
- Formula ribbon: label + three segments 6 / 65,8 / 28,2 with central gradient.
- Buttons outside S-01: filled `color-accent` primary, glass/outline secondary, semantic danger only for destructive Manager actions.
- Forms: visible labels, inline errors, consequence block immediately before financial/legal CTA.
- Tables: quiet surface, right-aligned tabular numbers; mobile becomes labeled stacks.
- Status badges: stable meaning across Author/Manager surfaces; color is never the sole cue.

### Visual Do's And Don'ts

- Do: preserve Aurora palette, mesh, glass, 2:3 covers, typographic hierarchy, formula motif, warm/direct Ukrainian copy.
- Do: let real covers provide saturated color; keep operational screens calmer.
- Don't: substitute generic shadcn/MUI styling, blue SaaS chrome, dark-first theme, heavy gradients everywhere, emoji as production icons, or nested cards.
- Don't: insert filters or authentication chrome between locked S-01 hero/shelf/tiles/formula zones.
- Don't: copy the HTML's non-semantic `div`/`span` controls or mobile squeeze as production behavior.

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
| `color-formula-tax` | `#F7E7DE` |
| `color-formula-platform` | `#F6E4D2`; text `#9A6438` |
| `mesh-aurora` | three radial gradients exactly from `forge/design/README.md`/HTML |
| `font-ui` | `Golos Text, system-ui, sans-serif` |
| `font-reading` | `Literata, Georgia, serif` after license/provenance check |
| `radius-cover/thumb/tile/formula/page/pill` | `16 / 12 / 22 / 26 / 14 / 999px` |
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

Reimplement `operator-final-7b/v1` in the production component system. Match S-01 desktop HTML/screenshot exactly for composition, tokens, typography, cover geometry, glass surfaces, formula and hover. Use `UkieBook-logo.jpg` as the official logo source and integrate it within the locked header geometry. A transparent or optimized derivative may be produced from that file, but its silhouette, proportions and internal line structure must remain visually identical. Add real routes, semantic controls, states, data and responsive layouts from screen-map/wireframes. Extend Aurora—not a generic design system—to S-02…S-21. Do not copy prototype code as application logic or claim runtime behavior from it.

## Approved Visual Baseline

- Status: approved
- Baseline ID: `AVB-UKIEBOOK-AURORA-7B-V1`
- Selected Candidate And Version: imported operator-supplied `operator-final-7b/v1`
- Immutable Visual Target Reference And Hash: primary `forge/design/ukiebook-catalog.html` SHA-256 `74df41361f28626e105ffc56aced75357b80af16eff41dcc95bddf067815323d`; supporting `forge/design/screenshot-catalog.png` SHA-256 `2ae89326b6227c5dabe71f2c0ed2c7a4abfe10b1f0d7c46090ec1639b8df68dd`; two-target bundle hash `758b1a6a78db1226bf82244698d74b44c90b9b2779b072c1bada0d00abd4f5f7`
- Frozen Prototype Source Root And Tree Hash: `forge/design` top-level target set (`README.md`, `ukiebook-catalog.html`, `screenshot-catalog.png`); SHA-256 over sorted workspace-relative `shasum -a 256` lines: `950a44c329ebd4b79d088910920d05abb81a683c4e1b53f6eebda820905626f0`
- Prototype Artifact References: `forge/design/README.md`; `forge/design/ukiebook-catalog.html`; `forge/design/screenshot-catalog.png`; `forge/design/evidence/AVB-UKIEBOOK-AURORA-7B-V1.visual-qa.json`; Playwright captures under `output/playwright/`. Scoped official brand asset: `UkieBook-logo.jpg`, SHA-256 `5cdd21d3ba038632528fc17a13068e3792d03a029779251cd738aaada4aa0ad3`.
- Visual Definition Of Done Scope: exact S-01 desktop default/hover plus shared Aurora system. S-02…S-21, screen states and mobile are extension scope governed by this Design/Experience Spine + wireframes/screen-map; they are required product UI but do not pretend to have pixel targets.
- Covered Screens States And Viewports: locked exact — S-01 `/`, default and cover/tile hover, 1280×900; supporting source crop 924×540. Derived coverage — S-01 at 390/430/768/1440 and functional states; S-02…S-21 at required viewports/states through system consistency, not pixel matching.
- Approval Receipt: operator message dated 2026-07-21 (Europe/Kiev): «Ось фінальний мокап прототипу … має бути використаний 1:1»; this is explicit selection/acceptance, so no repeated approval prompt.
- Approved At: 2026-07-21
- Permitted Variance: real dynamic data and 2:3 covers; semantic links/buttons/input; production icons replacing ⌕/🛒; invisible 44px hit-area expansion or minimal size correction; visible focus; minimal measured contrast corrections preserving hue hierarchy; responsive reflow; state/error/loading content; authenticated navigation access; full catalog continuation after locked formula; lossless/visually identical logo optimization or transparent-background derivative. No variance may materially change locked desktop composition, copy, token relationships, geometry, shelf/formula motifs, official logo identity or interaction meaning.
- Operator Overrides: skip the normal three-candidate generation and register the imported final design; use it 1:1 in covered scope; add required product functionality without redesign; use `UkieBook-logo.jpg` as the official logo while preserving locked S-01 header geometry.
- Supersedes: none (prior A/B/C and D/E/F were unapproved explorations, not active baselines)
- Superseded By: —
- Downstream Invalidation: previous D/E/F design brief, proposed-baseline DoD/QA references and any plan based on them are invalid; `to-dod-evals`, `to-qa-checklist`, `to-development-plan` must consume this Baseline ID/hash.

## Validation Report

- Pass 1 — Mechanical coverage: all target and official-logo references resolve; every token used in this brief resolves; component appearance/behavior pairs exist; states are delegated to screen-map/wireframes; key Buyer/Author flows include success/failure. `0 Critical`, `0 High`, `0 Medium` unresolved findings.
- Pass 2 — Judgment: no parallel generic design system; S-01 target remains concrete; extension scope is honest. Medium resolved by permitted variance: the reference uses non-semantic controls, a visible 40×40 cart, low-contrast muted/placeholder/gradient colors, and no media queries. Low evidence limit: named original `UkieBook Design Options.dc.html` is absent; exported final target set is available and hashed. No finding blocks SDD planning.

## Confirmed Design Decisions

Aurora Pastel 7b; official `UkieBook-logo.jpg` brand mark; S-01 1:1 desktop; Obкладинки 2:3 as heroes; warm mesh + glass; Golos Text; formula ribbon; quiet operational surfaces; source-backed responsive reflow; AA implementation floor; prototype reimplemented rather than copied.

## Rejected Directions

Prior A/B/C and D/E/F explorations; flag-primary palette; dark-first chrome; generic component-library look; card-in-card; mobile squeeze of desktop HTML; emoji/glyphs as production icons.

## Out Of Scope

Dark-mode switch; native apps; internal reader; marketing-only site; new product screens beyond screen-map; prototype backend/auth/persistence/payment claims.

## Open Questions

- OQ-DB1. Verify Golos Text and selected reading-font license/provenance before production self-hosting; system fallbacks are acceptable until then.
- OQ-DB2. The exact production contrast correction values are selected during implementation from measured AA-safe variants while preserving the baseline hue hierarchy; QA evidence, not another approval, closes this.
