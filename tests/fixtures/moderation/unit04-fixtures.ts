export const UNIT04_FIXTURE_IDS = {
  authorUserId: "40404040-4040-4040-8040-404040404001",
  managerUserId: "40404040-4040-4040-8040-404040404002",
  books: {
    submitted: "40404040-4040-4040-8040-404040404101",
    manual: "40404040-4040-4040-8040-404040404102",
    rejected: "40404040-4040-4040-8040-404040404103",
    published: "40404040-4040-4040-8040-404040404104",
    removed: "40404040-4040-4040-8040-404040404105",
    update: "40404040-4040-4040-8040-404040404106",
    review: "40404040-4040-4040-8040-404040404107",
    providerError: "40404040-4040-4040-8040-404040404108",
  },
  cases: {
    manual: "40404040-4040-4040-8040-404040404201",
    removal: "40404040-4040-4040-8040-404040404202",
    update: "40404040-4040-4040-8040-404040404203",
    review: "40404040-4040-4040-8040-404040404204",
    providerError: "40404040-4040-4040-8040-404040404205",
  },
  versions: {
    submitted: "40404040-4040-4040-8040-404040404301",
    manual: "40404040-4040-4040-8040-404040404302",
    rejected: "40404040-4040-4040-8040-404040404303",
    published: "40404040-4040-4040-8040-404040404304",
    removed: "40404040-4040-4040-8040-404040404305",
    update: "40404040-4040-4040-8040-404040404306",
    review: "40404040-4040-4040-8040-404040404307",
    providerError: "40404040-4040-4040-8040-404040404308",
  },
} as const;

export const UNIT04_FIXTURE_TITLES = {
  submitted: "Листи до світанку",
  manual: "Тіні над водою",
  rejected: "Крихка памʼять",
  published: "Сад після дощу",
  removed: "Заборонена течія",
  update: "Оновлення: Сад після дощу",
  review: "Відгук про Сад після дощу",
  providerError: "Місто без сигналу",
} as const;

export const UNIT04_VISUAL_STATE_IDS = [
  "s13:submitted",
  "s13:manual-review",
  "s13:rejected",
  "s13:published",
  "s13:removed",
  "s18:mixed-queue",
  "s18:book-selected",
  "s18:book-update-selected",
  "s18:review-selected",
  "s18:ai-unavailable",
  "s18:empty",
  "s18:removal-dialog",
  "s18:category-error",
  "s02:unavailable-after-removal",
] as const;
