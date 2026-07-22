import type { PricePresentation } from "./types";

export interface CatalogPriceInput {
  readonly basePriceKopiykas: number;
  readonly discountPriceKopiykas: number | null;
  readonly discountStartsAt: Date | string | null;
  readonly discountEndsAt: Date | string | null;
}
function assertKopiykas(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer number of kopiykas`);
  }
}

export function formatUah(kopiykas: number): string {
  assertKopiykas(kopiykas, "price");
  const hryvnias = kopiykas / 100;
  const hasKopiykas = kopiykas % 100 !== 0;
  return `${new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: hasKopiykas ? 2 : 0,
    minimumFractionDigits: hasKopiykas ? 2 : 0,
  }).format(hryvnias)} грн`;
}

function toDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Discount timestamp is invalid");
  return date;
}

export function presentPrice(
  input: CatalogPriceInput,
  asOf: Date,
): PricePresentation {
  assertKopiykas(input.basePriceKopiykas, "base price");
  const startsAt = toDate(input.discountStartsAt);
  const endsAt = toDate(input.discountEndsAt);
  const discounted = input.discountPriceKopiykas;
  if (discounted !== null) assertKopiykas(discounted, "discount price");

  const completeDiscount = discounted !== null && startsAt !== null && endsAt !== null;
  const isActive =
    completeDiscount &&
    discounted < input.basePriceKopiykas &&
    asOf.getTime() >= startsAt.getTime() &&
    asOf.getTime() < endsAt.getTime();
  const actualPriceKopiykas = isActive ? discounted : input.basePriceKopiykas;
  const percentage = isActive
    ? Math.round((1 - discounted / input.basePriceKopiykas) * 100)
    : 0;

  return {
    actualPriceKopiykas,
    basePriceKopiykas: input.basePriceKopiykas,
    currency: "UAH",
    discount: isActive
      ? {
          endsAt: endsAt.toISOString(),
          label: `−${percentage}%`,
          startsAt: startsAt.toISOString(),
        }
      : null,
    formattedActualPrice: formatUah(actualPriceKopiykas),
    formattedBasePrice: formatUah(input.basePriceKopiykas),
  };
}
