# DoD And Evals

## Source References

- `docs/prd.md` — критерії поведінки (FR/NFR) як джерело acceptance-умов.
- `docs/product-idea.md` — «Важливі перевірки перед реалізацією» (юрист/бухгалтер, тарифи mono) — джерело release-гейтів.
- `docs/guardrails.md` — поведінкова політика доказів (Verification Rules, Evidence Requirements) — цей файл застосовує її як контракт завершеності.
- `docs/architecture.md` — верифікаційні потреби: лідж (AD-2/7), ідемпотентні вебхуки (AD-3), асинхронний конвеєр (AD-4), safe-fail модерації (AD-5), runtime/commands (AD-6), Baseline reimplementation (AD-8), сепарація даних/public catalog projection (AD-11) і separate active publication pointer + append-only evidence (AD-12).
- `docs/design-brief.md` — AA-підлога й approved Baseline `AVB-UKIEBOOK-AURORA-7B-V3`, bundle hash `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724`, mixed exact/extension Visual DoD Scope та correction contract.
- `docs/screen-map.md`, `docs/wireframes.md`, `docs/user-journey.md` — покриття екранів/станів/потоків для UX-гейтів.
- `docs/project-context.md` — спожито: розд. 13 (ризики → пріоритети верифікації).
- `package.json`, lockfile, runtime sources and `forge/runs/UNIT-00/20260721T202102Z-f6e503b242d5/` — UNIT-00 bootstrap implementation and revision-bound evidence.
- `forge/runs/UNIT-01/20260721T221049Z-ab030a00f213/` — UNIT-01 revision-bound evidence for S-03/S-17 identity, session/role/profile boundaries, real PostgreSQL concurrency, browser flows and Aurora extension visual checks. Live credentialed Google/Facebook consent is explicitly `blocked` for provider activation and is not represented as passed.
- `forge/runs/UNIT-02/20260722T011333Z-a441ab415d28/` — historical UNIT-02 behavior/persistence evidence and superseded V2 visual receipt; the correction does not rewrite this immutable run.
- `forge/runs/UNIT-02-C1/20260722T115720Z-338d4450e107/run.json` at revision `3f77594bcb615847bdd71846374184cd2070d305` — active UNIT-02-C1 evidence for V3 target/evidence hashes plus transparent SVG logo, all square Book Cover corners, seven distinct baked-artwork sources, first shelf row not clipped, exact hero sentence and public `35/65` ribbon.
- `forge/runs/UNIT-03/20260722T151115Z-6fb52daf3ff1/run.json` at revision `6fb52daf3ff11630454c13a76adfd7875c749e8f` — canonical UNIT-03 evidence for S-10/S-11/S-12, real DOCX/TXT/bounded Google Docs conversion to validated EPUB+legacy MOBI, private-artifact and immutable `BookVersion`/`BookSubmitted` boundaries, failure/retry, 3/3 E2E, 30 visual screenshots, 7 accessibility receipts, 105 passed/2 skipped tests and zero high-severity npm audit findings. That receipt alone ends at Author submission; the downstream moderation/publication slice is separately passed by UNIT-04. Next executable unit is UNIT-05.
- `forge/runs/UNIT-04/20260722T190601Z-4552048aeb2b/run.json` at revision `4552048aeb2ba6da16b47ac289058b14d5641869` — canonical UNIT-04 evidence for real PostgreSQL migration `0005_moderation_publication`, safe clear/flagged/outage routing, immutable decisions/audit, S-13/S-18/S-02 unavailable, 4/4 E2E, 50 visual screenshots, 8 accessibility receipts, 109 passed/3 skipped tests, 0 audit vulnerabilities and `findings: []`.

## Definition Of Done Model

Рівні DoD:
1. Продукт (реліз MVP) — Release Checks нижче.
2. Feature Unit (одиниця development-plan) — Feature Unit DoD.
3. SDD-артефакт — валідація оркестратора (межа власника, трасованість, структура, хеш у маніфесті) за guardrails.

«Done» будь-якого рівня = всі застосовні обовʼязкові гейти `passed` зі свіжими доказами. Самооцінка агента доказом не є (guardrails: доказ перед твердженням).

## Acceptance Criteria Vs Definition Of Done

- Acceptance criteria («чи те зробили») — належать PRD/journey: конкретні FR-умови юніта.
- Definition of Done («чи закінчено за стандартом») — цей файл: гейти, докази, класифікація знахідок.
- Юніт може задовольняти acceptance і не бути Done (немає доказів гейтів), і навпаки — ніколи.

## Global Definition Of Done

Робота будь-якого юніта Done лише коли:
1. Застосовні Hard Gates — `passed` свіжим запуском.
2. Застосовні System/UX-перевірки — `passed` або явно непридатні з причиною.
3. Для видимого користувачу фронтенду — `approved_visual_baseline_fidelity` `passed` проти активного Baseline.
4. Жодного відкритого P0/P1 і жодного P2 з release effect `blocking` у скоупі юніта.
5. Докази збережені й відтворювані (Eval Result Format).

## Feature Unit Definition Of Done

- Acceptance-умови юніта (посилання на FR) перевірені доказом, не прочитанням коду.
- Стани зі screen-map для порушених екранів реалізовані або явно відкладені рішенням плану.
- Заборони guardrails не порушені (перевірка Forbidden-списку для зачепленого скоупу).
- Мокап/скріншот — лише візуальний доказ; функціональність доводиться реальним станом/даними/діями (guardrails: Evidence Requirements).

## Verification Profile

### Hard Gates

| Gate | Purpose | Source References | Applies To | Required Evidence | Pass Condition | Fail Or Block Condition | Rerun Rule | Automation Status |
|---|---|---|---|---|---|---|---|---|
| `build` | Production build збирається | guardrails Verification Rules; AD-6 | кожен юніт після bootstrap | свіжий `npm run build` лог | exit 0 | будь-яка помилка | після кожної зміни | automated; UNIT-00…UNIT-02 historical runs and UNIT-02-C1 passed; UNIT-03 and UNIT-04 builds passed in their canonical runs, most recently revision `4552048aeb2ba6da16b47ac289058b14d5641869` |
| `typecheck_lint` | Статична коректність | guardrails; AD-6 | кожен юніт після bootstrap | свіжі `npm run typecheck` і `npm run lint` логи | 0 помилок | помилки | після кожної зміни | automated; UNIT-03 and UNIT-04 typecheck/lint/repository boundaries passed, most recently in `forge/runs/UNIT-04/20260722T190601Z-4552048aeb2b/run.json` |
| `tests` | Автотести юніта й регресії | guardrails; AD-2/3/4/7/11 | кожен юніт після bootstrap | свіжий `npm test`; для affected journeys також `npm run test:e2e` | усі застосовні прогони зелені | будь-який failed/blocked застосовний тест | після кожного фіксу | automated; UNIT-04 records 21 test files passed/3 skipped, 109 tests passed/3 skipped, 4/4 E2E and 1/1 visual suite; `npm audit` reports 0 vulnerabilities |

### Unit Checks

| Gate | Purpose | Source References | Applies To | Required Evidence | Pass Condition | Fail Or Block Condition | Rerun Rule | Automation Status |
|---|---|---|---|---|---|---|---|---|
| `money_formula` | Публічний розподіл `35% платформі / 65% автору` від фактично сплаченої ціни; менеджерський `35 = 29 net platform + 6 platform tax component`; `29+6+65=100` | FR-REW-2/3 | rewards, formula presentation | integer-kopiyka vectors including discounts/refunds/rounding; exact-bps assertions `2900+600+6500=10000`; UI visibility split | correct rounded monetary amounts; `platform_share_bps=3500`, `author_share_bps=6500`; manager sees `2900/600/6500`; public/Author never exposes internal `29+6` as extra ribbon segments | будь-яка розбіжність ≥1 коп., old percentage, or public/internal meaning leak | після змін rewards/formula copy | presentation part covered by UNIT-02-C1; ledger calculation not available until rewards unit |
| `ledger_reproducibility` | Кожна сума в S-15/S-19 відтворюється з подій ліджа | AD-2; FR-PYT-2 | rewards | звірка похідних рядків із подіями | збіг | розбіжність | після змін rewards | not available yet |
| `paid_sale_only` | Нарахування лише з підтверджених оплат; повернення компенсуються | FR-PAY-5, FR-REF-3 | commerce→rewards | тести подій оплати/повернення | інваріант тримається | нарахування без оплати | після змін commerce | not available yet |
| `payout_rules` | Поріг 100 грн, перенесення, утримання 250 грн, черга накопичення, засновник 100% | FR-PYT-4, FR-UPD-2, FR-FND-2 | rewards | тест-кейси payout-рядків | правила точні | відхилення | після змін rewards | not available yet |
| `conversion_pipeline` | DOCX/TXT/GDocs → адаптивне видання → EPUB+MOBI з ілюстраціями в потоці | FR-PUB-1/2/3/7; AD-4 | publishing | прогін на еталонних рукописах | файли валідні, структура збережена | зламаний вихід | після змін конвеєра | automated; UNIT-03 passed with Calibre `9.11.0` / `calibre-legacy-mobi-v1`, validators `epub-container.v1` + `legacy-mobi-header.v1`, meaning hashes, inline Illustrations for DOCX/Google Docs, stale-job rejection, conversion failure/retry and dedicated real PostgreSQL proof |
| `moderation_flow` | `BookSubmitted` → screening; clear auto-publishes; flagged/provider outage → Manual Review; type-correct Manager decision; ReasonCategory only where defined; internal signals do not cross Manager boundary | FR-MOD-1..5; AD-5/12 | moderation | UNIT-04 real-PostgreSQL proof + routing/unit tests + S-13/S-18 E2E and response/event inspection | idempotent relay; safe and risky paths correct; Book/Update rejection requires closed ReasonCategory; Review non-publication carries none; no internal-signal leak | auto-publish on error, queue bypass, wrong decision contract, missing/extra reason or disclosure | після moderation adapter/policy/case/decision changes | passed for UNIT-04 at `forge/runs/UNIT-04/20260722T190601Z-4552048aeb2b/run.json`; Update/Review producers/application remain later scopes |
| `identity_integration` | Google/Facebook code flow, one-time claim, persistent provider mapping, hashed sessions, atomic first-Author profile+role+rotation | FR-AUTH-1..3; AD-10 | identity, author-profile | protocol-simulator integration + real PostgreSQL migration/concurrency evidence + browser S-03→S-17 proof | обидва providers проходять; replay/concurrency інваріанти тримаються; роль виникає лише з профілем | duplicate identity/session, replay success, роль без профілю або stale session accepted | після змін identity/profile/migration | automated; UNIT-01 passed |
| `auth_security` | PKCE/state/nonce/signature, safe return, CSRF/Origin, expiry/revoke, no provider/browser token persistence, secret hygiene | NFR-3; AD-10; guardrails | identity and protected mutations | negative adapter/unit/browser vectors + schema/bundle/evidence scans | небезпечні вектори fail closed без identity rows чи secret leak | bypass, token/secret leak, unsafe redirect або неконтрольована mutation | після змін auth/config/guards | automated; UNIT-01 passed |
| `catalog_read_model` | Public S-01/S-02 projection obeys search/filter/sort/pagination, price/Discount boundaries, sample/reviews and unavailable/privacy rules; publication activation/removal carries version/event provenance | FR-CAT-1..4, FR-LIC-4; AD-11/12 | catalog and catalog-publisher integration | real PostgreSQL reversible migration + guarded seed receipt + publication lifecycle proof + repository/browser scenarios | deterministic reads; unavailable excluded from browse and exposes no price/sample; activation/removal matches active version and projection provenance; public Author DTO only | unstable/incorrect result, half-published state, private-field leak, production fixture path or price/time-boundary drift | після catalog query/projection/publisher/migration changes | UNIT-02 query/read behavior passed; UNIT-04 activation/removal portion passed in its canonical receipt |
| `publication_lifecycle` | Preserve immutable reviewed artifacts while exactly one active version drives public Catalog/Cover state; removal is confirmed and audited | FR-MOD-1..3, FR-LIC-4, FR-CAT-3; AD-11/12 | Book moderation, publication and removal | migration `0005` rollback/reapply on real PostgreSQL; replay/concurrency vectors; publication/audit/projection rows; S-13/S-18/S-02 E2E | `BookVersion.status` remains `submitted`; one `book_publications.active_book_version_id`; activation is replay-safe; FR-LIC-4 removal requires explicit confirmation + closed removal ground and atomically yields audited `unavailable` projection/S-02; public Cover resolves only through publication | mutable reviewed version, two active versions, duplicate decision/audit, partial Catalog transition, unconfirmed/ungrounded removal or private Cover URL exposure | after migration/publication/removal/public-Cover changes | passed for UNIT-04 at `forge/runs/UNIT-04/20260722T190601Z-4552048aeb2b/run.json` |
| `access_separation` | Ролеві guard-и; sensitive data and internal moderation signals remain within their role boundaries; mutation Origin/CSRF fails closed | FR-MOD-3, FR-REW-6, FR-FND-3, NFR-3; architecture Security | identity, moderation, rewards | negative role/API/UI tests; invalid Origin and session-CSRF vectors; DTO/event/response inspection | Guest redirects from Manager; Author receives denial and cannot decide; invalid Origin/CSRF leaves case unchanged; public/Author outputs omit internal AI signals | unauthorized read/write, state mutation after invalid proof, internal signal/ПД leak | після access/route/action/DTO changes | UNIT-01 identity and UNIT-04 moderation portions passed; rewards/founder portions remain later |
| `webhook_idempotency` | Повторний вебхук mono не дублює продаж/нарахування | AD-3 | commerce | тест повторної доставки | одна подія | дубль | після змін інтеграції | not available yet |
| `foundation_integration` | Real PostgreSQL migration/rollback/reapply, transaction+outbox+job atomicity, competing claims, idempotency conflicts and lease recovery | AD-6/7; UNIT-00 | platform foundation and changes to DB/job primitives | `npm run verify:unit00` + database/worker evidence | all real-PostgreSQL scenarios pass against the implementation revision | substitute database, missing rollback/atomicity/concurrency proof, or blocking finding | after platform migration/job/runtime changes | automated; UNIT-00 passed |

### System Checks

| Gate | Purpose | Source References | Applies To | Required Evidence | Pass Condition | Fail Or Block Condition | Rerun Rule | Automation Status |
|---|---|---|---|---|---|---|---|---|
| `journey_author_e2e` | Наскрізна публікація: завантаження → Попередній перегляд видання → окремі права/ліцензія → модерація → Каталог | journey Автора 3–9 | реліз, зміни publishing/moderation | revision-bound combined evidence: UNIT-03 submit receipt + UNIT-04 real-state/E2E lifecycle proof | safe and risky paths reach authoritative S-13 and public states; rejection exposes only ReasonCategory; Автор не потрапляє в Manager UI | розрив шляху/обхід підтверджень або рольової межі | перед релізом; після змін шляху | UNIT-03 submission segment and UNIT-04 moderation/publication segment passed at their canonical revisions; a combined release-candidate rerun remains required |
| `journey_buyer_e2e` | Наскрізна покупка: кошик → вхід → mono → бібліотека → файли | journey покупця 1–7 | реліз, зміни commerce | e2e-прогін (тестовий режим mono) | шлях проходиться | розрив | перед релізом | not available yet |
| `update_propagation` | Схвалене оновлення доставляє нові файли попереднім покупцям | FR-UPD-3, FR-LIB-3 | publishing+library | тест версійності бібліотеки | остання версія видається | стара версія | після змін оновлень | not available yet |

### UX/UI Checks

| Gate | Purpose | Source References | Applies To | Required Evidence | Pass Condition | Fail Or Block Condition | Rerun Rule | Automation Status |
|---|---|---|---|---|---|---|---|---|
| `screen_states_coverage` | Стани кожного зачепленого екрана відповідають screen-map | screen-map Screen States | фронтенд-юніти | QA-чекліст IDs + state-bound E2E/captures | всі стани присутні | відсутній обовʼязковий стан | після змін екрана | passed for UNIT-04: 14 S-13/S-18/S-02-unavailable states and 50 receipts; later screens remain with their owning units |
| `accessibility_floor` | AA-підлога: контраст, фокус, клавіатура, підписи, цілі ≥44px | design-brief Accessibility Floor | фронтенд-юніти | виміряний contrast/targets/labels + keyboard/focus/reflow receipts | застосовні вимірювання проходять; state/dialog/list-detail зміни доступні без миші | blocking threshold/focus/label/reflow failure | після змін UI | passed for UNIT-04 with 8 named receipts, 350 touch-target samples at least 44×44, minimum control contrast 3.206, placeholder 4.608, text 14.025 and mobile inputs 16px; no complete WCAG/release-browser claim |
| `responsive_viewports` | 390/430/768/1280/1440 без горизонтального скролу й втрати пріоритетів | design-brief Responsive; wireframes Responsive Notes | фронтенд-юніти | скріншоти вʼюпортів + mobile interaction receipts | структура за wireframes; S-18 mobile is explicit list→detail→back | зламаний вʼюпорт, недоступний control або відсутній mobile return | після змін layout | passed for UNIT-04 with 50 captures across five widths, mobile S-18 list/detail/back, 200% reflow and maximum overflow 0 |
| `vis_tokens` | Aurora source token export and browser computed styles match active Baseline values | design-brief Approved Baseline; AD-8; QA `VIS-TOKENS` | UNIT-00 foundation fixture and later shared-token changes | `npm run test:visual` capture + structured computed-style evidence | exact source-token values, Baseline ID/hash and no blocking finding | value/hash drift or missing browser proof | after shared token/fixture changes or Baseline replacement | automated and passed for the UNIT-00 fixture and scoped UNIT-02 public surfaces. UNIT-03 did not change shared token definitions and passed S-10/S-11/S-12 extension screenshots, measured contrast and external-Chrome review, but its canonical bundle does not claim a separate token/glass computed-style artifact; any shared-token or glass-primitive change must rerun the dedicated proof |
| `vis_correction_v3` | Enforce the exact operator correction on every affected public catalog rendering | design-brief V3 Baseline; wireframes S-01; QA `VIS-COVER`, `VIS-FORMULA`, `VIS-BRAND-LOGO`, `VIS-SHELF`, `VIS-HERO-COPY` | UNIT-02-C1 and every later shared-cover/header/formula change | target + production screenshots and computed styles; asset-source uniqueness; image-pixel/DOM separation; logo transparency/source hash; shelf geometry | all Book Covers `border-radius:0`; seven distinct approved artworks with baked titles and no overlay; five shelf covers fully visible; exact hero sentence; public bar `35:65`; active SVG source SHA-256 `db838dd4ad696f63cccb6aa86ab98e53dc5c6e13c1778ac340f62c5e4514617f` and no backing plate | any rounded cover, duplicate/placeholder art presented as distinct, live title overlay, bottom clipping, copy/formula drift or opaque logo background | after cover/header/hero/formula/layout asset or token change | active evidence `forge/runs/UNIT-02-C1/20260722T115720Z-338d4450e107/run.json` |

#### `approved_visual_baseline_fidelity` (параметризований гейт)

- Gate: `approved_visual_baseline_fidelity`
- Purpose: видимий користувачу фронтенд відповідає approved visual contract з чесною exact/extension coverage.
- Source References: design-brief `Approved Visual Baseline`; guardrails Design Authority Rules; pipeline-контракт.
- Applies To: кожен frontend/full-stack/integration юніт із visible UI S-01…S-21. Exact pixel target applies only to S-01 1280 default/hover; all other scopes use approved Aurora system + owning screen/wireframe/state contracts.
- Baseline ID: `AVB-UKIEBOOK-AURORA-7B-V3`.
- Immutable Target Hash: target bundle `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724`; candidate tree `7b13c9e123694cf800ccda987aa64a7f98e625d671161a838b4f94e315feba97`.
- Affected Routes States And Viewports: unit parameter; exact `S-01 / default+hover 1280x900`; derived 390/430/768/1440 and all required states; S-02…S-21 system-consistency coverage at applicable viewports/states.
- Permitted Variance And Operator Overrides: exact list in design-brief Baseline; imported final design and skip-three-candidates override remain. The correction locks `UkieBook-logo-transparent.svg` without background, square-corner covers, seven distinct baked-artwork assets, no cover-title overlay, fully visible five-cover shelf, exact hero sentence and public `35/65` bar.
- QA Check IDs: `VIS-S01-1280-DEFAULT`, `VIS-S01-1280-HOVER`, `VIS-S01-RESPONSIVE`, `VIS-AURORA-PUBLIC`, `VIS-AURORA-AUTHOR`, `VIS-AURORA-MANAGER`, `VIS-TOKENS`, `VIS-GLASS`, `VIS-COVER`, `VIS-FORMULA`, `VIS-BRAND-LOGO` plus affected RES/A11Y/UX IDs.
- VisualQAEvidence References: `forge/design/evidence/AVB-UKIEBOOK-AURORA-7B-V3.visual-qa.json` SHA-256 `ffae4a71e0db785033aad606e91b1557ef46d56d86690f8e09ae6cc81906323c` and implementation evidence produced per unit; active correction run `forge/runs/UNIT-02-C1/20260722T115720Z-338d4450e107/run.json`; S-10/S-11/S-12 extension receipt `forge/runs/UNIT-03/20260722T151115Z-6fb52daf3ff1/run.json`; S-13/S-18/S-02-unavailable extension receipt `forge/runs/UNIT-04/20260722T190601Z-4552048aeb2b/run.json`.
- PrototypePromotionReceipt: not applicable for the approved reference (`Prototype Reuse: none`, AD-8). It becomes required only if a later plan explicitly changes reuse to traced promote/diff.
- Required Evidence: current Baseline ID/hash; for exact S-01, screenshot comparison to immutable HTML/capture plus machine-readable checks for square cover radii, seven unique artwork sources, absence of live cover overlays, full five-cover shelf geometry, exact `Електронні книжки EPUB і MOBI миттєво у вашу бібліотеку.`, formula `35:65`, transparent logo source/hash/background; for extension scope, token/component/state/viewport review; concrete QA IDs; VisualQAEvidence; runtime interaction proof separately.
- Pass Condition: Baseline active/current; the correct exact or extension comparison mode was used; all correction invariants and required coverage exist; each deviation is permitted/source-backed; no blocking finding.
- Fail Or Block Condition: застарілий/заміщений базлайн; відсутній таргет чи покриття; непояснений матеріальний дрейф; відкритий P0/P1/блокувальний P2.
- Rerun Rule: після кожної зміни UI юніта; після зміни активного базлайна.
- Automation Status: UNIT-01/UNIT-02-C1/UNIT-03 retain their scoped passed receipts. UNIT-04 extension mode passed for S-13, S-18 and S-02 unavailable with 50 screenshots at 390/430/768/1280/1440 and 8 named accessibility checks; no S-01 pixel-lock claim is made. Other screens and the UNIT-05-owned Cart destination/behavior remain governed by their owning units.

### Release Checks

| Gate | Purpose | Source References | Applies To | Required Evidence | Pass Condition | Fail Or Block Condition | Rerun Rule | Automation Status |
|---|---|---|---|---|---|---|---|---|
| `legal_tax_review` | Юрист/бухгалтер підтвердили: 5-річна ліцензія, ФОП/роялті, податкові ставки, порядок виплат і повернень | product-idea «Важливі перевірки»; OQ-1 | публічний реліз | письмове підтвердження | підтверджено | відсутнє/зауваження без розвʼязання | при зміні юр. умов | manual |
| `mono_terms_confirmed` | Остаточні умови й тарифи mono підтверджені | product-idea; OQ-2 | публічний реліз | зафіксовані умови на дату запуску | підтверджено | не підтверджено | при зміні умов | manual |
| `release_journeys` | Обидва e2e-шляхи зелені на реліз-кандидаті | journey; System Checks | публічний реліз | свіжі прогони | зелені | червоні | кожен реліз-кандидат | not available yet |
| `live_oauth_provider_smoke` | Зареєстровані redirect URI, consent і callbacks працюють у credentialed Google/Facebook apps | FR-AUTH-1; AD-10 | активація production OAuth providers / публічний реліз | ручний або автоматизований smoke в credentialed pre-production | обидва provider flows завершуються без scope/redirect drift | credentials/registration відсутні або будь-який provider не проходить | перед першою активацією та після provider config changes | blocked; UNIT-01 local production adapters passed against protocol simulator, але live credentials не надані |
| `release_findings` | Нуль відкритих P0/P1 і блокувальних P2 | цей файл, Failure Classification | публічний реліз | реєстр знахідок | нуль блокувальних | є блокувальні | кожен реліз-кандидат | manual |

## Gate Matrix

| Скоуп юніта | build/typecheck/tests | unit checks | system checks | UX/UI + baseline fidelity | release checks |
|---|---|---|---|---|---|
| Бекенд-модуль без UI | ✓ | застосовні | при дотику шляхів | — | на релізі |
| Фронтенд-юніт | ✓ | — | — | ✓ (всі) | на релізі |
| Повностековий/інтеграційний | ✓ | застосовні | ✓ | ✓ | на релізі |
| SDD-артефакт | — | — | — | — | валідація оркестратора |

## Lane Or State Promotion Gates

Джерела визначають лише стани пайплайна (`forge/sdd-manifest.json`) і статус `execution_invalidated` для юнітів після заміни базлайна. Промоція юніта в Done — за Global DoD; заміна активного базлайна автоматично повертає зачеплені фронтенд-юніти з Done у `execution_invalidated` до повторного проходження `approved_visual_baseline_fidelity`. Інших інженерних lane-контрактів джерела не задають.

## Eval Result Format

```json
{
  "gate": "string",
  "unit": "string",
  "status": "passed|failed|blocked",
  "evidence": ["шлях/посилання на лог, скріншот, прогін"],
  "owner": "хто запускав",
  "timestamp": "ISO-8601",
  "implementation_revision": "full Git commit SHA",
  "baseline_id": "для visual-гейтів",
  "findings": [{ "severity": "P0|P1|P2|P3", "release_effect": "blocking|advisory", "summary": "…" }],
  "rerun_of": "попередній запуск|null"
}
```

`passed` — лише зі свіжим доказом; `blocked` — застосовний гейт неможливо запустити (відсутній базлайн, стенд, доступ) або відкритий блокер.

## Evidence Requirements

- Доказ = свіжий запуск/перегляд із прочитаним повним результатом (guardrails).
- Візуальні докази: скріншоти/записи з привʼязкою до маршруту, стану, вʼюпорта, теми і Baseline ID (VisualQAEvidence-форма pipeline-контракту).
- Фінансові докази: відтворення сум із подій ліджа, не з UI.
- Докази зберігаються поруч із юнітом (шляхи фіксує development-plan) і посилаються з eval-результату.
- UNIT-04 publication/moderation claim additionally requires one revision-bound bundle combining reversible real PostgreSQL migration `0005`, relay/screening/decision/concurrency/publication vectors, negative Guest/Author/Origin/CSRF/internal-signal checks, S-13/S-18/S-02 E2E, exactly 50 visual receipts and all 8 named accessibility receipts. `forge/runs/UNIT-04/20260722T190601Z-4552048aeb2b/run.json` satisfies this contract; partial future runs cannot be combined into a pass without the canonical clean-revision verifier.

## Evidence Limits

- Статичні документи доводять намір, не поведінку: жодних тверджень WCAG/безпеки/продуктивності з самих доків.
- Мокап/скріншот/прототип — дизайн-доказ; функціональність вимагає реального стану/даних/дій і runner-доказів (guardrails Evidence Requirements).
- Approved Visual Baseline — візуальний еталон, не доказ працездатності.
- Active UNIT-02-C1 visual evidence applies only to S-01/S-02 and shared primitives as rendered there; it does not pre-pass later public, Author or Manager screens. Its V3 side-by-side comparison is review evidence, while original UNIT-02 E2E/PostgreSQL receipts separately prove behavior and persistence.
- UNIT-03 evidence applies only to S-10/S-11/S-12 and ends at Author submission plus `BookSubmitted`. Its local `PrivateObjectStorage` receipt does not prove production S3 deployment; its visual/accessibility matrix does not prove complete WCAG, cross-browser/device release coverage, UNIT-04 moderation, publication activation or a populated public catalog projection.
- UNIT-04 evidence applies only to the recorded moderation/publication slice. It does not claim S-01 pixel-lock, complete WCAG/cross-browser/device release coverage, Update/Review producer/application flows, Discount/250 UAH, rewards/founder, Cart/payment or Library completion.
- Прогін у тестовому режимі mono не доводить продакшн-тарифи (OQ-2 закривається лише `mono_terms_confirmed`).

## Failure And Blocker Classification

Канонічні значення (release effect призначається окремо, не виводиться з severity):

| Severity | Значення | Дефолтний Release Effect |
|---|---|---|
| P0 | Катастрофічна шкода або повна непридатність системи (втрата грошей/даних, витік ПД) | blocking |
| P1 | Зламана первинна подорож, ключова здатність чи релізний інваріант без прийнятного обходу (покупка неможлива; файли не видаються; нарахування хибні) | blocking |
| P2 | Локальний, але значущий дефект/регресія/дрейф; продукт загалом придатний або є обхід | blocking чи advisory — за явною класифікацією |
| P3 | Полірування/косметика без матеріального впливу | advisory |

Кожна знахідка записує: Severity, Release Effect, Applicability (скоуп/маршрут/стан), Source (гейт/перевірка), Evidence, Rationale. Advisory P2/P3 видимі як follow-up і не блокують Done та не потребують затвердження оператора.

## Rerun And Recovery Rules

- Після фіксу — повторний запуск саме того гейта, що падав, плюс залежні (fix у rewards → `money_formula` + `ledger_reproducibility` + `tests`).
- `blocked` знімається лише усуненням причини блокування, не очікуванням.
- Заміна базлайна → масовий rerun `approved_visual_baseline_fidelity` для зачеплених юнітів (оркеструє pipeline).
- Флакі-результат = `failed` до доведення стабільності повторними прогонами.

## PR Merge And Completion Rules

Git repository and GitHub remote are initialized. Мінімальний source-backed контракт (guardrails Verification Rules):
- Заява про завершення юніта (у PR чи без нього) вимагає прикладеного eval-результату з `passed` для застосовних гейтів.
- Мердж у головну гілку заборонений із відкритим P0/P1/блокувальним P2 у скоупі змін.
- Completion evidence is committed beside the implementation and remains bound to its full revision; a later documentation-only reconciliation must not rewrite the original run's source/revision receipt.

## Out Of Scope

Concrete CI-provider configuration or maintenance of implemented scripts; QA-checklist items (owner: qa-checklist); implementation units (owner: development-plan); product requirements. This artifact defines evidence contracts but does not create code/config.

## Open Questions

- OQ-DE1 closed: the stack and stable npm command contract are implemented; external hosted CI configuration is deferred to UNIT-10 and is not required for local unit evidence.
- OQ-DE2 closed: Playwright-backed `npm run test:visual` is operational; UNIT-00 `vis_tokens` is passed, while unimplemented product-route comparisons remain `blocked` by their own applicability.
- No additional DoD decision blocks development planning. Conversion and UNIT-04 moderation/publication proofs are closed; upstream release gates OQ-1/OQ-2 and UNIT-05…UNIT-10 stay explicit.
