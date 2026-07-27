export const UNIT05_FIXTURE_IDS = {
  authorUserId: "50505050-5050-4050-8050-505050505001",
  buyerUserId: "50505050-5050-4050-8050-505050505002",
  books: {
    discounted: "50505050-5050-4050-8050-505050505101",
    fullPrice: "50505050-5050-4050-8050-505050505102",
    unavailable: "50505050-5050-4050-8050-505050505103",
  },
  versions: {
    discounted: "50505050-5050-4050-8050-505050505201",
    fullPrice: "50505050-5050-4050-8050-505050505202",
    unavailable: "50505050-5050-4050-8050-505050505203",
  },
} as const;

export const UNIT05_FIXTURE_BOOKS = {
  discounted: {
    actualPriceKopiykas: 14_900,
    author: "Олена Вітрова",
    basePriceKopiykas: 19_900,
    coverPath: "/books/covers/final/piznie-lito.png",
    title: "Пізнє літо",
  },
  fullPrice: {
    actualPriceKopiykas: 24_900,
    author: "Олена Вітрова",
    basePriceKopiykas: 24_900,
    coverPath: "/books/covers/final/misto-na-vodi.png",
    title: "Місто на воді",
  },
  unavailable: {
    actualPriceKopiykas: 9_900,
    author: "Олена Вітрова",
    basePriceKopiykas: 9_900,
    coverPath: "/books/covers/final/tini-nad-lymanom.png",
    title: "Тіні над лиманом",
  },
} as const;

export const UNIT05_EXPECTED_CART_TOTAL_KOPIYKAS =
  UNIT05_FIXTURE_BOOKS.discounted.actualPriceKopiykas +
  UNIT05_FIXTURE_BOOKS.fullPrice.actualPriceKopiykas;

export const UNIT05_VISUAL_STATE_IDS = [
  "s04:empty",
  "s04:populated",
  "s04:auth-required",
  "s04:error",
  "s05:redirecting",
  "s06:pending",
  "s06:success",
  "s06:failure",
] as const;
