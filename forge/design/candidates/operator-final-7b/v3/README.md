# UkieBook Aurora 7b — operator correction v3

This immutable candidate supersedes `operator-final-7b/v2` only for the corrections explicitly directed by the operator on 2026-07-22.

- Approval mode: `selected-and-approved-by-operator-scoped-correction`; no new alternatives or redundant approval prompt.
- Public formula: two visible shares, `35%` platform and `65% — автору`. The internal manager split of the platform share is `29%` net platform revenue plus `6%`; that breakdown is not exposed in this public S-01 ribbon.
- Hero copy: `Електронні книжки EPUB і MOBI миттєво у вашу бібліотеку.`
- Covers: all visible covers use the final 1024×1536 artwork assets with title and author baked into the image; no live cover-copy overlay is used.
- Cover geometry: every shelf and tile cover has square corners (`0px`).
- Shelf correction: the first five-book shelf is 294px high with 24px bottom padding, keeping every image bottom inside the shelf.
- Brand: the public header and favicon use the frozen `assets/UkieBook-logo-transparent.svg`, copied byte-for-byte from `public/brand/UkieBook-logo-transparent.svg`; it is a transparent PNG-backed SVG distribution asset with no opaque background treatment or blend-mode workaround.
- Immutable local asset bundle: the transparent SVG plus all seven files under `assets/covers/`, copied byte-for-byte from `public/books/covers/final/`, including the distinct unavailable-book cover `tini-nad-lymanom.png`. The HTML has no mutable production-asset dependency.
- Unchanged scope: Aurora palette and mesh, desktop header/hero hierarchy, glass tiles, cover dimensions and transforms, formula container, typography, shadows, and hover meaning remain inherited from v2.

The HTML is a visual target for production reimplementation, not application logic. V1 and V2 remain unchanged as superseded history.
