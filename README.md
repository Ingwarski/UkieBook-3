# UkieBook

![Офіційний логотип UkieBook](UkieBook-logo.jpg)

UkieBook — українська платформа самопублікацій із власною онлайн-книгарнею. Поточний репозиторій містить валідований SDD-пакет, затверджений visual baseline «Аврора · пастельна 7b», офіційний логотип і доказові матеріали дизайну.

## Поточний стан

- SDD pipeline: `development-plan-validated`
- Approved Visual Baseline: `AVB-UKIEBOOK-AURORA-7B-V2`
- `UNIT-00` завершено на revision `f6e503b242d5a5eca59972dece1657f4d207b3e3`: Next.js/TypeScript web foundation, окремі worker/scheduler runtimes, PostgreSQL migrations + transaction/outbox/durable jobs, secret/import boundaries, Aurora tokens/primitives and automated evidence runner.
- Canonical passed evidence: `forge/runs/UNIT-00/20260721T202102Z-f6e503b242d5/run.json`.
- Наступні implementation units: `UNIT-01` (identity/RBAC/profile) та fixture-backed `UNIT-02` (Aurora catalog/Book Page) можуть стартувати паралельно.
- Product journeys and S-01…S-21 production screens ще не реалізовані; release readiness remains blocked by their owning units and external release gates.

## Основні артефакти

- [Product idea](docs/product-idea.md)
- [PRD](docs/prd.md)
- [Architecture](docs/architecture.md)
- [Design brief](docs/design-brief.md)
- [QA checklist](docs/qa-checklist.md)
- [Development plan](docs/development-plan.md)
- [SDD manifest](forge/sdd-manifest.json)
- [Final design handoff](forge/design/README.md)

Офіційні файли логотипа: [`UkieBook-logo.jpg`](UkieBook-logo.jpg), SHA-256 `5cdd21d3ba038632528fc17a13068e3792d03a029779251cd738aaada4aa0ad3`, і [`UkieBook-logo-exact.svg`](UkieBook-logo-exact.svg), SHA-256 `abb3acf8cfa673161e6547ca725f7b337b29185a7eb6918218f887faadc66d98`. SVG є точним raster-backed контейнером: він містить той самий JPEG байт-у-байт, а не path-based vector artwork.
