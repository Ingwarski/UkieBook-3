# DoD And Evals

## Source References

- `docs/prd.md` — критерії поведінки (FR/NFR) як джерело acceptance-умов.
- `docs/product-idea.md` — «Важливі перевірки перед реалізацією» (юрист/бухгалтер, тарифи mono) — джерело release-гейтів.
- `docs/guardrails.md` — поведінкова політика доказів (Verification Rules, Evidence Requirements) — цей файл застосовує її як контракт завершеності.
- `docs/architecture.md` — верифікаційні потреби: лідж (AD-2/7), ідемпотентні вебхуки (AD-3), асинхронний конвеєр (AD-4), safe-fail модерації (AD-5), runtime/commands (AD-6), Baseline reimplementation (AD-8), сепарація даних.
- `docs/design-brief.md` — AA-підлога й approved Baseline `AVB-UKIEBOOK-AURORA-7B-V2`, bundle hash `c66b23c55e68…`, mixed exact/extension Visual DoD Scope та інтегрований official-logo override.
- `docs/screen-map.md`, `docs/wireframes.md`, `docs/user-journey.md` — покриття екранів/станів/потоків для UX-гейтів.
- `docs/project-context.md` — спожито: розд. 13 (ризики → пріоритети верифікації).
- `package.json`, lockfile, runtime sources and `forge/runs/UNIT-00/20260721T202102Z-f6e503b242d5/` — UNIT-00 bootstrap implementation and revision-bound evidence. Stable package gates are now executable; this does not mark later product/system/release gates passed.

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
| `build` | Production build збирається | guardrails Verification Rules; AD-6 | кожен юніт після bootstrap | свіжий `npm run build` лог | exit 0 | будь-яка помилка | після кожної зміни | automated; UNIT-00 passed at `f6e503b242d5a5eca59972dece1657f4d207b3e3` |
| `typecheck_lint` | Статична коректність | guardrails; AD-6 | кожен юніт після bootstrap | свіжі `npm run typecheck` і `npm run lint` логи | 0 помилок | помилки | після кожної зміни | automated; UNIT-00 passed at `f6e503b242d5a5eca59972dece1657f4d207b3e3` |
| `tests` | Автотести юніта й регресії | guardrails; AD-2/3/4/7 | кожен юніт після bootstrap | свіжий `npm test`; для affected journeys також `npm run test:e2e` | усі застосовні прогони зелені | будь-який failed/blocked застосовний тест | після кожного фіксу | automated; UNIT-00 unit/foundation E2E passed at `f6e503b242d5a5eca59972dece1657f4d207b3e3` |

### Unit Checks

| Gate | Purpose | Source References | Applies To | Required Evidence | Pass Condition | Fail Or Block Condition | Rerun Rule | Automation Status |
|---|---|---|---|---|---|---|---|---|
| `money_formula` | Розподіл 6/65,8/28,2 від фактично сплаченої ціни, включно зі знижками | FR-REW-2/3 | rewards | тест-кейси сум (зокрема граничні копійки) | точні суми | розбіжність ≥ 1 коп. | після змін rewards | not available yet |
| `ledger_reproducibility` | Кожна сума в S-15/S-19 відтворюється з подій ліджа | AD-2; FR-PYT-2 | rewards | звірка похідних рядків із подіями | збіг | розбіжність | після змін rewards | not available yet |
| `paid_sale_only` | Нарахування лише з підтверджених оплат; повернення компенсуються | FR-PAY-5, FR-REF-3 | commerce→rewards | тести подій оплати/повернення | інваріант тримається | нарахування без оплати | після змін commerce | not available yet |
| `payout_rules` | Поріг 100 грн, перенесення, утримання 250 грн, черга накопичення, засновник 100% | FR-PYT-4, FR-UPD-2, FR-FND-2 | rewards | тест-кейси payout-рядків | правила точні | відхилення | після змін rewards | not available yet |
| `conversion_pipeline` | DOCX/TXT/GDocs → адаптивне видання → EPUB+MOBI з ілюстраціями в потоці | FR-PUB-1/2/3/7; AD-4 | publishing | прогін на еталонних рукописах | файли валідні, структура збережена | зламаний вихід | після змін конвеєра | not available yet |
| `moderation_flow` | Ризикове → ручна черга; категорія причини назовні; внутрішні правила не витікають | FR-MOD-2/3; AD-5 | moderation | тести маршрутизації кейсів + перевірка відповідей API/UI | маршрутизація і приховування коректні | витік правил або обхід черги | після змін moderation | not available yet |
| `access_separation` | Ролеві guard-и; ПД покупців не в авторських звітах; засновник прихований від автора | FR-REW-6, FR-FND-3, NFR-3; architecture Security | identity, rewards | тести доступу за ролями; інспекція відповідей | заборонене недоступне | будь-який витік | після змін доступу | not available yet |
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
| `screen_states_coverage` | Стани кожного зачепленого екрана відповідають screen-map | screen-map Screen States | фронтенд-юніти | QA-чекліст (посилання на qa-checklist IDs) | всі стани присутні | відсутній обовʼязковий стан | після змін екрана | manual (до появи e2e) |
| `accessibility_floor` | AA-підлога: контраст, фокус, клавіатура, підписи, цілі ≥44px | design-brief Accessibility Floor | фронтенд-юніти | перевірки контрасту + клавіатурний прохід | відповідає | порушення AA | після змін UI | manual |
| `responsive_viewports` | 390/430/768/1280/1440 без горизонтального скролу й втрати пріоритетів | design-brief Responsive; wireframes Responsive Notes | фронтенд-юніти | скріншоти вʼюпортів | структура за wireframes | зламаний вʼюпорт | після змін layout | manual |
| `vis_tokens` | Aurora source token export and browser computed styles match active Baseline values | design-brief Approved Baseline; AD-8; QA `VIS-TOKENS` | UNIT-00 foundation fixture and later shared-token changes | `npm run test:visual` capture + structured computed-style evidence | exact source-token values, Baseline ID/hash and no blocking finding | value/hash drift or missing browser proof | after shared token/fixture changes or Baseline replacement | automated for the UNIT-00 fixture; passed |

#### `approved_visual_baseline_fidelity` (параметризований гейт)

- Gate: `approved_visual_baseline_fidelity`
- Purpose: видимий користувачу фронтенд відповідає approved visual contract з чесною exact/extension coverage.
- Source References: design-brief `Approved Visual Baseline`; guardrails Design Authority Rules; pipeline-контракт.
- Applies To: кожен frontend/full-stack/integration юніт із visible UI S-01…S-21. Exact pixel target applies only to S-01 1280 default/hover; all other scopes use approved Aurora system + owning screen/wireframe/state contracts.
- Baseline ID: `AVB-UKIEBOOK-AURORA-7B-V2`.
- Immutable Target Hash: target bundle `c66b23c55e68649e67e029d47c8e69d3bef3791f8c4c6677aa0a6cef2259c51d`; candidate tree `8aaddd35645bd9c58c095a7182fbbbd43dd8730c5cf90b489a97597431cc6505`.
- Affected Routes States And Viewports: unit parameter; exact `S-01 / default+hover 1280x900`; derived 390/430/768/1440 and all required states; S-02…S-21 system-consistency coverage at applicable viewports/states.
- Permitted Variance And Operator Overrides: exact list in design-brief Baseline; imported final design, skip-three-candidates override and official `UkieBook-logo.jpg` rendered in the locked S-01 brand slot are active.
- QA Check IDs: `VIS-S01-1280-DEFAULT`, `VIS-S01-1280-HOVER`, `VIS-S01-RESPONSIVE`, `VIS-AURORA-PUBLIC`, `VIS-AURORA-AUTHOR`, `VIS-AURORA-MANAGER`, `VIS-TOKENS`, `VIS-GLASS`, `VIS-COVER`, `VIS-FORMULA`, `VIS-BRAND-LOGO` plus affected RES/A11Y/UX IDs.
- VisualQAEvidence References: `forge/design/evidence/AVB-UKIEBOOK-AURORA-7B-V2.visual-qa.json` and implementation evidence produced per unit.
- PrototypePromotionReceipt: not applicable for the approved reference (`Prototype Reuse: none`, AD-8). It becomes required only if a later plan explicitly changes reuse to traced promote/diff.
- Required Evidence: current Baseline ID/hash; for exact S-01, screenshot comparison to immutable HTML/capture; for extension scope, token/component/state/viewport review; concrete QA IDs; VisualQAEvidence; runtime interaction proof separately.
- Pass Condition: Baseline active/current; the correct exact or extension comparison mode was used; required coverage exists; each deviation is permitted/source-backed; no blocking finding.
- Fail Or Block Condition: застарілий/заміщений базлайн; відсутній таргет чи покриття; непояснений матеріальний дрейф; відкритий P0/P1/блокувальний P2.
- Rerun Rule: після кожної зміни UI юніта; після зміни активного базлайна.
- Automation Status: manual (порівняння + евіденс), до появи візуальної регресії.

### Release Checks

| Gate | Purpose | Source References | Applies To | Required Evidence | Pass Condition | Fail Or Block Condition | Rerun Rule | Automation Status |
|---|---|---|---|---|---|---|---|---|
| `legal_tax_review` | Юрист/бухгалтер підтвердили: 5-річна ліцензія, ФОП/роялті, податкові ставки, порядок виплат і повернень | product-idea «Важливі перевірки»; OQ-1 | публічний реліз | письмове підтвердження | підтверджено | відсутнє/зауваження без розвʼязання | при зміні юр. умов | manual |
| `mono_terms_confirmed` | Остаточні умови й тарифи mono підтверджені | product-idea; OQ-2 | публічний реліз | зафіксовані умови на дату запуску | підтверджено | не підтверджено | при зміні умов | manual |
| `release_journeys` | Обидва e2e-шляхи зелені на реліз-кандидаті | journey; System Checks | публічний реліз | свіжі прогони | зелені | червоні | кожен реліз-кандидат | not available yet |
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
