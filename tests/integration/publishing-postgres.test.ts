import { describe, it } from "vitest";

const enabled = Boolean(
  process.env.UNIT03_DATABASE_URL && process.env.CALIBRE_EBOOK_CONVERT_PATH,
);

describe("UNIT-03 real PostgreSQL publishing proof", () => {
  it.skipIf(!enabled)(
    "proves migrations, conversion worker, recovery, immutability and private boundaries",
    async () => {
      await import("../../scripts/verify-unit03-postgres");
    },
    180_000,
  );
});
