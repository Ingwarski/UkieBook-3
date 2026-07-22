# DoD And Evals

## Source References

- `docs/prd.md` — критерії поведінки (FR/NFR) як джерело acceptance-умов.
- `docs/product-idea.md` — «Важливі перевірки перед реалізацією» (юрист/бухгалтер, тарифи mono) — джерело release-гейтів.
- `docs/guardrails.md` — поведінкова політика доказів (Verification Rules, Evidence Requirements) — цей файл застосовує її як контракт завершеності.
- `docs/architecture.md` — верифікаційні потреби: лідж (AD-2/7), ідемпотентні вебхуки (AD-3), асинхронний конвеєр (AD-4), safe-fail модерації (AD-5), runtime/commands (AD-6), Baseline reimplementation (AD-8), сепарація даних і public catalog projection (AD-11).
- `docs/design-brief.md` — AA-підлога й approved Baseline `AVB-UKIEBOOK-AURORA-7B-V3`, bundle hash `e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724`, mixed exact/extension Visual DoD Scope та correction contract.
- `docs/screen-map.md`, `docs/wireframes.md`, `docs/user-journey.md` — покриття екранів/станів/потоків для UX-гейтів.
- `docs/project-context.md` — спожито: розд. 13 (ризики → пріоритети верифікації).
- `package.json`, lockfile, runtime sources and `forge/runs/UNIT-00/20260721T202102Z-f6e503b242d5/` — UNIT-00 bootstrap implementation and revision-bound evidence.
- `forge/runs/UNIT-01/20260721T221049Z-ab030a00f213/` — UNIT-01 revision-bound evidence for S-03/S-17 identity, session/role/profile boundaries, real PostgreSQL concurrency, browser flows and Aurora extension visual checks. Live credentialed Google/Facebook consent is explicitly `blocked` for provider activation and is not represented as passed.
- `forge/runs/UNIT-02/20260722T011333Z-a441ab415d28/` — historical UNIT-02 behavior/persistence evidence and superseded V2 visual receipt; the correction does not rewrite this immutable run.
- `__C1_RUN_PATH__` at revision `__C1_REVISION__` — active UNIT-02-C1 evidence for V3 target/evidence hashes plus transparent SVG logo, all square Book Cover corners, seven distinct baked-artwork sources, first shelf row not clipped, exact hero sentence and public `35/65` ribbon. Next executable feature unit remains UNIT-03.

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
| `build` | Production build збирається | guardrails Verification Rules; AD-6 | кожен юніт після bootstrap | свіжий `npm run build` лог | exit 0 | будь-яка помилка | після кожної зміни | automated; UNIT-00…UNIT-02 historical runs passed; active UNIT-02-C1 result is revision-bound in `__C1_RUN_PATH__` |
| `typecheck_lint` | Статична коректність | guardrails; AD-6 | кожен юніт після bootstrap | свіжі `npm run typecheck` і `npm run lint` логи | 0 помилок | помилки | після кожної зміни | automated; UNIT-00…UNIT-02 historical runs passed; active UNIT-02-C1 result is revision-bound in `__C1_RUN_PATH__` |
| `tests` | Автотести юніта й регресії | guardrails; AD-2/3/4/7/11 | кожен юніт після bootstrap | свіжий `npm test`; для affected journeys також `npm run test:e2e` | усі застосовні прогони зелені | будь-який failed/blocked застосовний тест | після кожного фіксу | automated; original UNIT-02 counts remain historical; active correction regression/browser/visual results are recorded in `__C1_RUN_PATH__` |

### Unit Checks

| Gate | Purpose | Source References | Applies To | Required Evidence | Pass Condition | Fail Or Block Condition | Rerun Rule | Automation Status |
|---|---|---|---|---|---|---|---|---|
| `money_formula` | Публічний розподіл `35% платформі / 65% автору` від фактично сплаченої ціни; менеджерський `35 = 29 net platform + 6 platform tax component`; `29+6+65=100` | FR-REW-2/3 | rewards, formula presentation | integer-kopiyka vectors including discounts/refunds/rounding; exact-bps assertions `2900+600+6500=10000`; UI visibility split | correct rounded monetary amounts; `platform_share_bps=3500`, `author_share_bps=6500`; manager sees `2900/600/6500`; public/Author never exposes internal `29+6` as extra ribbon segments | будь-яка розбіжність ≥1 коп., old percentage, or public/internal meaning leak | після змін rewards/formula copy | presentation part covered by UNIT-02-C1; ledger calculation not available until rewards unit |
| `ledger_reproducibility` | Кожна сума в S-15/S-19 відтворюється з подій ліджа | AD-2; FR-PYT-2 | rewards | звірка похідних рядків із подіями | збіг | розбіжність | після змін rewards | not available yet |
| `paid_sale_only` | Нарахування лише з підтверджених оплат; повернення компенсуються | FR-PAY-5, FR-REF-3 | commerce→rewards | тести подій оплати/повернення | інваріант тримається | нарахування без оплати | після змін commerce | not available yet |
| `payout_rules` | Поріг 100 грн, перенесення, утримання 250 грн, черга накопичення, засновник 100% | FR-PYT-4, FR-UPD-2, FR-FND-2 | rewards | тест-кейси payout-рядків | правила точні | відхилення | після змін rewards | not available yet |
| `conversion_pipeline` | DOCX/TXT/GDocs → адаптивне видання → EPUB+MOBI з ілюстраціями в потоці | FR-PUB-1/2/3/7; AD-4 | publishing | прогін на еталонних рукописах | файли валідні, структура збережена | зламаний вихід | після змін конвеєра | not available yet |
| `moderation_flow` | Ризикове → ручна черга; категорія причини назовні; внутрішні правила не витікають | FR-MOD-2/3; AD-5 | moderation | тести маршрутизації кейсів + перевірка відповідей API/UI | маршрутизація і приховування коректні | витік правил або обхід черги | після змін moderation | not available yet |
| `identity_integration` | Google/Facebook code flow, one-time claim, persistent provider mapping, hashed sessions, atomic first-Author profile+role+rotation | FR-AUTH-1..3; AD-10 | identity, author-profile | protocol-simulator integration + real PostgreSQL migration/concurrency evidence + browser S-03→S-17 proof | обидва providers проходять; replay/concurrency інваріанти тримаються; роль виникає лише з профілем | duplicate identity/session, replay success, роль без профілю або stale session accepted | після змін identity/profile/migration | automated; UNIT-01 passed |
| `auth_security` | PKCE/state/nonce/signature, safe return, CSRF/Origin, expiry/revoke, no provider/browser token persistence, secret hygiene | NFR-3; AD-10; guardrails | identity and protected mutations | negative adapter/unit/browser vectors + schema/bundle/evidence scans | небезпечні вектори fail closed без identity rows чи secret leak | bypass, token/secret leak, unsafe redirect або неконтрольована mutation | після змін auth/config/guards | automated; UNIT-01 passed |
| `catalog_read_model` | Public S-01/S-02 projection obeys search/filter/sort/pagination, price/Discount time boundaries, sample/reviews and unavailable/privacy rules | FR-CAT-1..4; AD-11 | catalog and catalog-publisher integration | real PostgreSQL reversible migration + guarded seed receipt + repository/browser scenarios | deterministic results; integer kopiykas; Discount `[start,end)`; unavailable excluded from browse and exposes no price/sample; public Author DTO only | unstable/incorrect result, private field leak, production fixture path or price/time-boundary drift | після змін catalog query/projection/publisher/migration | automated; UNIT-02 passed |
| `access_separation` | Ролеві guard-и; ПД покупців не в авторських звітах; засновник прихований від автора | FR-REW-6, FR-FND-3, NFR-3; architecture Security | identity, rewards | тести доступу за ролями; інспекція відповідей | заборонене недоступне | будь-який витік | після змін доступу | scoped automation: UNIT-01 identity/public-profile/payout-envelope and Author→Manager denial passed; rewards-report/founder portions not available until owning units |
| `webhook_idempotency` | Повторний вебхук mono не дублює продаж/нарахування | AD-3 | commerce | тест повторної доставки | одна подія | дубль | після змін інтеграції | not available yet |
| `foundation_integration` | Real PostgreSQL migration/rollback/reapply, transaction+outbox+job atomicity, competing claims, idempotency conflicts and lease recovery | AD-6/7; UNIT-00 | platform foundation and changes to DB/job primitives | `npm run verify:unit00` + database/worker evidence | all real-PostgreSQL scenarios pass against the implementation revision | substitute database, missing rollback/atomicity/concurrency proof, or blocking finding | after platform migration/job/runtime changes | automated; UNIT-00 passed |

### System Checks

| Gate | Purpose | Source References | Applies To | Required Evidence | Pass Condition | Fail Or Block Condition | Rerun Rule | Automation Status |
|---|---|---|---|---|---|---|---|---|
| `journey_author_e2e` | Наскрізна публікація: завантаження → Попередній перегляд видання → окремі права/ліцензія → модерація → Каталог | journey Автора 3–9 | реліз, зміни publishing | e2e-прогін або задокументований ручний прохід | шлях проходиться; Автор не потрапляє в Manager UI | розрив шляху/обхід підтверджень | перед релізом; після змін шляху | not available yet |
| `journey_buyer_e2e` | Наскрізна покупка: кошик → вхід → mono → бібліотека → файли | journey покупця 1–7 | реліз, зміни commerce | e2e-прогін (тестовий режим mono) | шлях проходиться | розрив | перед релізом | not available yet |
| `update_propagation` | Схвалене оновлення доставляє нові файли попереднім покупцям | FR-UPD-3, FR-LIB-3 | publishing+library | тест версійності бібліотеки | остання версія видається | стара версія | після змін оновлень | not available yet |

### UX/UI Checks

| Gate | Purpose | Source References | Applies To | Required Evidence | Pass Condition | Fail Or Block Condition | Rerun Rule | Automation Status |
|---|---|---|---|---|---|---|---|---|
| `screen_states_coverage` | Стани кожного зачепленого екрана відповідають screen-map | screen-map Screen States | фронтенд-юніти | QA-чекліст (посилання на qa-checklist IDs) | всі стани присутні | відсутній обовʼязковий стан | після змін екрана | automated for UNIT-01 S-03/S-17 and UNIT-02 S-01/S-02, including loading/empty/error/query/long-results, Discount active/inactive, sample, paged reviews and unavailable paths; other screens per owning unit |
| `accessibility_floor` | AA-підлога: контраст, фокус, клавіатура, підписи, цілі ≥44px | design-brief Accessibility Floor | фронтенд-юніти | перевірки контрасту + клавіатурний прохід | відповідає | порушення AA | після змін UI | scoped automation passed for UNIT-01 and UNIT-02 affected routes: semantic controls/landmarks, visible keyboard equivalents, ≥44px targets, contrast and 200% reflow; release-wide AT/browser audit remains per owning screens |
| `responsive_viewports` | 390/430/768/1280/1440 без горизонтального скролу й втрати пріоритетів | design-brief Responsive; wireframes Responsive Notes | фронтенд-юніти | скріншоти вʼюпортів | структура за wireframes | зламаний вʼюпорт | після змін layout | automated for UNIT-01 S-03/S-17 and UNIT-02 S-01/S-02; UNIT-02 records its applicable 390/430/768/1280/1440 geometry/state matrix with no horizontal overflow |
| `vis_tokens` | Aurora source token export and browser computed styles match active Baseline values | design-brief Approved Baseline; AD-8; QA `VIS-TOKENS` | UNIT-00 foundation fixture and later shared-token changes | `npm run test:visual` capture + structured computed-style evidence | exact source-token values, Baseline ID/hash and no blocking finding | value/hash drift or missing browser proof | after shared token/fixture changes or Baseline replacement | automated and passed for the UNIT-00 fixture and scoped UNIT-02 public production surfaces |
| `vis_correction_v3` | Enforce the exact operator correction on every affected public catalog rendering | design-brief V3 Baseline; wireframes S-01; QA `VIS-COVER`, `VIS-FORMULA`, `VIS-BRAND-LOGO`, `VIS-SHELF`, `VIS-HERO-COPY` | UNIT-02-C1 and every later shared-cover/header/formula change | target + production screenshots and computed styles; asset-source uniqueness; image-pixel/DOM separation; logo transparency/source hash; shelf geometry | all Book Covers `border-radius:0`; seven distinct approved artworks with baked titles and no overlay; five shelf covers fully visible; exact hero sentence; public bar `35:65`; active SVG source SHA-256 `db838dd4ad696f63cccb6aa86ab98e53dc5c6e13c1778ac340f62c5e4514617f` and no backing plate | any rounded cover, duplicate/placeholder art presented as distinct, live title overlay, bottom clipping, copy/formula drift or opaque logo background | after cover/header/hero/formula/layout asset or token change | active evidence `__C1_RUN_PATH__` |

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
- VisualQAEvidence References: `forge/design/evidence/AVB-UKIEBOOK-AURORA-7B-V3.visual-qa.json` SHA-256 `ffae4a71e0db785033aad606e91b1557ef46d56d86690f8e09ae6cc81906323c` and implementation evidence produced per unit; active correction run `__C1_RUN_PATH__`.
- PrototypePromotionReceipt: not applicable for the approved reference (`Prototype Reuse: none`, AD-8). It becomes required only if a later plan explicitly changes reuse to traced promote/diff.
- Required Evidence: current Baseline ID/hash; for exact S-01, screenshot comparison to immutable HTML/capture plus machine-readable checks for square cover radii, seven unique artwork sources, absence of live cover overlays, full five-cover shelf geometry, exact `Електронні книжки EPUB і MOBI миттєво у вашу бібліотеку.`, formula `35:65`, transparent logo source/hash/background; for extension scope, token/component/state/viewport review; concrete QA IDs; VisualQAEvidence; runtime interaction proof separately.
- Pass Condition: Baseline active/current; the correct exact or extension comparison mode was used; all correction invariants and required coverage exist; each deviation is permitted/source-backed; no blocking finding.
- Fail Or Block Condition: застарілий/заміщений базлайн; відсутній таргет чи покриття; непояснений матеріальний дрейф; відкритий P0/P1/блокувальний P2.
- Rerun Rule: після кожної зміни UI юніта; після зміни активного базлайна.
- Automation Status: UNIT-01 Aurora extension mode for S-03/S-17 passed at `ab030a00f213d33f62783f0287dd8e5dcfe67101`. Original UNIT-02 behavior/persistence evidence at `a441ab415d2818872599f01efae856acebf75b42` remains valid history, but its V2 visual comparison is superseded. Active S-01/S-02 visual correction is UNIT-02-C1 at revision `__C1_REVISION__`, evidence `__C1_RUN_PATH__`. Other screens and the UNIT-05-owned Cart destination/behavior remain governed by their owning units.

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

## Evidence Limits

- Статичні документи доводять намір, не поведінку: жодних тверджень WCAG/безпеки/продуктивності з самих доків.
- Мокап/скріншот/прототип — дизайн-доказ; функціональність вимагає реального стану/даних/дій і runner-доказів (guardrails Evidence Requirements).
- Approved Visual Baseline — візуальний еталон, не доказ працездатності.
- Active UNIT-02-C1 visual evidence applies only to S-01/S-02 and shared primitives as rendered there; it does not pre-pass later public, Author or Manager screens. Its V3 side-by-side comparison is review evidence, while original UNIT-02 E2E/PostgreSQL receipts separately prove behavior and persistence.
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
- No additional DoD decision blocks development planning. Upstream release gates OQ-1/OQ-2 and conversion engine proof remain explicitly scoped gates.
