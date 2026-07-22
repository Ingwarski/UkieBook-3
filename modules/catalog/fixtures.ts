import type { CoverTheme } from "./types";

export interface CatalogFixtureBook {
  readonly id: string;
  readonly title: string;
  readonly authorId: string;
  readonly authorName: string;
  readonly genreSlug: string;
  readonly description: string;
  readonly sampleTitle: string;
  readonly sampleBlocks: readonly {
    readonly kind: "heading" | "paragraph";
    readonly text: string;
  }[];
  readonly coverPath: string;
  readonly coverTheme: CoverTheme;
  readonly basePriceKopiykas: number;
  readonly discountPriceKopiykas: number | null;
  readonly discountStartsAt: string | null;
  readonly discountEndsAt: string | null;
  readonly availability: "published" | "unavailable";
  readonly catalogRank: number;
  readonly ratingAverage: number | null;
  readonly ratingCount: number;
}

export const CATALOG_GENRE_FIXTURES = [
  { label: "Історія", slug: "istoriia" },
  { label: "Нонфікшн", slug: "nonfikshn" },
  { label: "Проза", slug: "proza" },
  { label: "Поезія", slug: "poeziia" },
  { label: "Фентезі", slug: "fentezi" },
] as const;

export const CATALOG_BOOK_FIXTURES: readonly CatalogFixtureBook[] = [
  {
    authorId: "a1111111-1111-4111-8111-111111111111",
    authorName: "Тарас Білик",
    availability: "published",
    basePriceKopiykas: 26500,
    catalogRank: 3,
    coverPath: "/books/covers/final/khroniky-stepu.png",
    coverTheme: "teal",
    description:
      "Родинна історія, що проходить крізь століття українського степу. Старі мапи, усні перекази й один несподіваний лист повертають героїв до місця, де памʼять сильніша за час.",
    discountEndsAt: null,
    discountPriceKopiykas: null,
    discountStartsAt: null,
    genreSlug: "istoriia",
    id: "11111111-1111-4111-8111-111111111111",
    ratingAverage: 5,
    ratingCount: 1,
    sampleBlocks: [
      { kind: "heading", text: "Розділ перший. Лінія обрію" },
      {
        kind: "paragraph",
        text: "Степ починався за останньою білою хатою і тягнувся далі, ніж вистачало погляду. Тарас чув його ще до того, як побачив: суха трава говорила з вітром тихою мовою памʼяті.",
      },
      {
        kind: "paragraph",
        text: "У старій скрині на нього чекала мапа без підписів — лише тонкі лінії річок і одна крапка, обведена синім олівцем.",
      },
    ],
    sampleTitle: "Початок книжки",
    title: "Хроніки степу",
  },
  {
    authorId: "a2222222-2222-4222-8222-222222222222",
    authorName: "Андрій Мельник",
    availability: "published",
    basePriceKopiykas: 18000,
    catalogRank: 5,
    coverPath: "/books/covers/final/lysty-z-poltavy.png",
    coverTheme: "mustard",
    description:
      "Документальна мозаїка листів, міських історій і особистих спостережень про Полтаву. Книжка збирає приватні голоси міста у чесну розмову про дім і зміни.",
    discountEndsAt: "2026-12-01T00:00:00.000Z",
    discountPriceKopiykas: 15300,
    discountStartsAt: "2026-07-01T00:00:00.000Z",
    genreSlug: "nonfikshn",
    id: "22222222-2222-4222-8222-222222222222",
    ratingAverage: null,
    ratingCount: 0,
    sampleBlocks: [
      { kind: "heading", text: "Лист перший" },
      {
        kind: "paragraph",
        text: "Я пишу тобі з міста, де ранкове світло довго затримується на жовтих стінах. Тут кожна вулиця має кілька назв, а кожна назва — свою памʼять.",
      },
    ],
    sampleTitle: "Лист перший",
    title: "Листи з Полтави",
  },
  {
    authorId: "a3333333-3333-4333-8333-333333333333",
    authorName: "Олег Данилюк",
    availability: "published",
    basePriceKopiykas: 19500,
    catalogRank: 4,
    coverPath: "/books/covers/final/misto-na-vodi.png",
    coverTheme: "cobalt",
    description:
      "Місто прокидається у власному відображенні. Молодий архітектор шукає зниклий квартал і поступово розуміє, що вода зберігає більше відповідей, ніж міські архіви.",
    discountEndsAt: null,
    discountPriceKopiykas: null,
    discountStartsAt: null,
    genreSlug: "proza",
    id: "33333333-3333-4333-8333-333333333333",
    ratingAverage: null,
    ratingCount: 0,
    sampleBlocks: [
      { kind: "heading", text: "Вода памʼятає" },
      {
        kind: "paragraph",
        text: "О сьомій ранку будинки стояли у воді рівно, наче їх звели двічі. Один ряд — із каменю й скла, другий — із тремкого світла.",
      },
    ],
    sampleTitle: "Вода памʼятає",
    title: "Місто на воді",
  },
  {
    authorId: "a4444444-4444-4444-8444-444444444444",
    authorName: "Ірина Верес",
    availability: "published",
    basePriceKopiykas: 25000,
    catalogRank: 1,
    coverPath: "/books/covers/final/sad-kamianykh-ptakhiv.png",
    coverTheme: "coral",
    description:
      "У покинутому саду оживають камʼяні птахи, а кожна скульптура береже чужу таємницю. Атмосферний роман про втрату, повернення і сміливість називати речі своїми іменами.",
    discountEndsAt: "2027-01-01T00:00:00.000Z",
    discountPriceKopiykas: 21000,
    discountStartsAt: "2026-01-01T00:00:00.000Z",
    genreSlug: "proza",
    id: "44444444-4444-4444-8444-444444444444",
    ratingAverage: 4.8,
    ratingCount: 5,
    sampleBlocks: [
      { kind: "heading", text: "Сад за муром" },
      {
        kind: "paragraph",
        text: "Першого птаха Ірина побачила під грушею. Камʼяні крила були складені, але на землі лежала свіжа тінь, ніби він щойно прилетів.",
      },
      {
        kind: "paragraph",
        text: "Вона торкнулася холодного дзьоба — і в глибині саду відповів тихий шелест, хоча вітер давно стих.",
      },
    ],
    sampleTitle: "Сад за муром",
    title: "Сад камʼяних птахів",
  },
  {
    authorId: "a5555555-5555-4555-8555-555555555555",
    authorName: "Соломія Гнатюк",
    availability: "published",
    basePriceKopiykas: 13500,
    catalogRank: 2,
    coverPath: "/books/covers/final/piznie-lito.png",
    coverTheme: "violet",
    description:
      "Збірка віршів про світло, що залишається після довгого дня. Невеликі тексти складаються у теплий щоденник дороги, дому й пізнього літа.",
    discountEndsAt: null,
    discountPriceKopiykas: null,
    discountStartsAt: null,
    genreSlug: "poeziia",
    id: "55555555-5555-4555-8555-555555555555",
    ratingAverage: null,
    ratingCount: 0,
    sampleBlocks: [
      { kind: "heading", text: "серпень" },
      {
        kind: "paragraph",
        text: "вечір поволі складає світло / у кишені старого саду / і кожне яблуко памʼятає / як називалося сонце",
      },
    ],
    sampleTitle: "Три вірші",
    title: "Пізнє літо",
  },
  {
    authorId: "a6666666-6666-4666-8666-666666666666",
    authorName: "Леся Романюк",
    availability: "published",
    basePriceKopiykas: 22000,
    catalogRank: 6,
    coverPath: "/books/covers/final/kryzhani-maky.png",
    coverTheme: "indigo",
    description:
      "На півночі, де квіти проростають крізь кригу, юна хранителька має повернути весну до міста. Ліричне фентезі про обіцянку, памʼять і силу ніжності.",
    discountEndsAt: null,
    discountPriceKopiykas: null,
    discountStartsAt: null,
    genreSlug: "fentezi",
    id: "66666666-6666-4666-8666-666666666666",
    ratingAverage: null,
    ratingCount: 0,
    sampleBlocks: [
      { kind: "heading", text: "Перший мак" },
      {
        kind: "paragraph",
        text: "Квітка зʼявилася вночі. Пелюстки були прозорі, мов тонкий лід, а всередині жевріла синя іскра, якої не міг загасити мороз.",
      },
    ],
    sampleTitle: "Перший мак",
    title: "Крижані маки",
  },
  {
    authorId: "a7777777-7777-4777-8777-777777777777",
    authorName: "Марко Яворський",
    availability: "unavailable",
    basePriceKopiykas: 17500,
    catalogRank: 7,
    coverPath: "/books/covers/final/tini-nad-lymanom.png",
    coverTheme: "teal",
    description:
      "Архівна сторінка видання збережена для читачів, але сама книжка більше не пропонується до продажу.",
    discountEndsAt: null,
    discountPriceKopiykas: null,
    discountStartsAt: null,
    genreSlug: "proza",
    id: "77777777-7777-4777-8777-777777777777",
    ratingAverage: null,
    ratingCount: 0,
    sampleBlocks: [],
    sampleTitle: "Фрагмент недоступний",
    title: "Тіні над лиманом",
  },
];

export const CATALOG_FEATURED_SHELF_IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
] as const;

export const CATALOG_FEATURED_TILE_IDS = [
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
  "11111111-1111-4111-8111-111111111111",
  "66666666-6666-4666-8666-666666666666",
] as const;
