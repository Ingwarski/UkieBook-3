# UNIT-02 Design QA

## Scope

- Approved Baseline: `AVB-UKIEBOOK-AURORA-7B-V2`
- Immutable target bundle hash: `c66b23c55e68649e67e029d47c8e69d3bef3791f8c4c6677aa0a6cef2259c51d`
- Exact target: S-01 `/` at 1280×900 in default, shelf-hover, tile-hover, shelf-focus, tile-focus and reduced-motion states.
- Aurora extension: S-02 `/books/{id}` at 390×844, 768×900 and 1280×900 in Discount active/inactive, sample-open, reviews-page-2, unavailable and loading states, plus the open mobile menu.
- Responsive S-01: 390×844, 430×844, 768×900 and 1440×900 in default, empty, Discount, query, long-results, loading and repository-error states.

## Review Binding

- Reviewed implementation revision: `e6b5b8f0092cf82faa2c672aa87966fb4f223f56`
- Reviewed comparison SHA-256: `8574b19e9cdcffa5f59a005e9b6aa4b91ab0873446892e557c6b3d0881e1c48b`
- Reviewed visual receipt count: `53`
- Reviewed visual receipt digest SHA-256: `265f74b3efa0cb1b01f5abd70d6f176ebdf264b4764540989bb5148b85ed65c6`
- Reviewed visual matrix SHA-256: `426148783b16d870f999869db71c2868340d91f9ade30853701c6114cd80ab4d`
- Reviewed at: `2026-07-22T01:11:57Z`

The review binding is fail-closed: the verifier regenerates the comparison, recomputes every screenshot hash and the ordered 53-receipt digest, requires the reviewed revision to be an ancestor, and rejects runtime or normative artifact changes after review.

## Side-By-Side Comparison

The canonical target and production S-01 were captured at the same 1280×900 viewport and placed into one compositor-safe comparison image:

- target capture: `output/playwright/unit02-target-final-1280.png`
- implementation capture: `output/playwright/unit02-s01-final-1280.png`
- combined comparison: `output/playwright/unit02-design-compare-final.png`
- S-02 desktop: `output/playwright/unit02-s02-final-1280.png`
- S-02 mobile: `output/playwright/unit02-s02-final-390.png`

The target/current pixel audit found aligned internal rows: navigation `56–65 / 56–65`, hero `151–202 / 152–202`, and subtitle `276–288 / 276–287`. Locked geometry also matches the target contract:

| Region | Target contract and production measurement |
|---|---|
| header | `x=30, y=24, w=1220, h=72` |
| hero | `x=30, y=96, w=1220, h=212.219` |
| shelf | `x=30, y=308.219, w=1220, h=270` |
| popular tiles | `x=30, y=578.219, w=1220, h=172` |
| formula ribbon | `x=70, y=776.219, w=1140, h=98` |

The final implementation preserves the Aurora mesh, glass surfaces, typography hierarchy, 2:3 cover geometry, shelf/tile interaction displacement, formula proportions `6 / 65.8 / 28.2`, spacing, radii and shadows.

## Permitted Variance Review

- The official `UkieBook-logo.jpg` is rendered in the locked brand slot; the supplied SVG is retained as the exact raster-backed equivalent source asset.
- Six generated production cover artworks replace prototype color-card placeholders while preserving every 2:3 slot and title/author overlay.
- Phosphor design-system icons replace prototype text or emoji glyphs.
- Semantic controls and hit areas are at least 44 CSS px where required.
- Contrast-safe semantic text/action colors stay within the approved accessibility variance.
- S-02, responsive reflow and runtime states extend Aurora according to the design brief and wireframes; they do not claim a nonexistent pixel target.

## State And Interaction Review

- S-01 search, Genre, Discount, sorting, reset and pagination preserve URL state and work with realistic PostgreSQL-backed data.
- S-01 loading, empty and repository-error presentations retain the locked visual shell.
- S-02 shows correct current/old price behavior, active Discount date, free sample, review pagination, unavailable Book and semantic not-found presentation.
- Mobile navigation exposes search and all links without header clipping; no page-level horizontal overflow was measured.
- Cover text, hero gradient, navigation, formula, reset and back-link contrast checks pass at AA thresholds.
- All required controls, cover cards, pagination and primary actions are operable links or semantic form controls; focus rings and reduced-motion behavior are verified.
- The canonical default explicitly waits for the logo, all five shelf artworks and all four tile thumbnails to complete and decode before capture.
- The final 53-receipt matrix records zero console or page errors and zero screenshot-hash mismatches.

## Iteration History

1. Established exact S-01 section geometry and the Aurora S-02 extension.
2. Replaced placeholder art with six 2:3 production covers and bound the official JPG/SVG logo assets.
3. Corrected Discount pricing, mobile search/menu behavior, sample disclosure, unavailable/not-found semantics and mobile CTA hierarchy.
4. Added responsive, loading, empty, error, interaction, focus, reduced-motion, contrast and PostgreSQL-backed state coverage.
5. Removed screenshot-helper false negatives and compositor scroll drift; exact receipts now use pristine 1280×900 viewport captures.
6. Added image decode gates, canonical baseline hash validation, comparison/receipt provenance, destructive-database URL guards and final repository-stability checks.

## Findings

- P0: none.
- P1: none.
- Blocking P2: none.
- Advisory P2/P3: Golos Text and Literata are self-hosted from their packaged OFL builds; recheck third-party notices when the production distribution bundle is assembled.

final result: passed
