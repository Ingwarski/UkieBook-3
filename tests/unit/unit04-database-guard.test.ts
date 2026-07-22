import { describe, expect, it } from "vitest";

import { requireDedicatedUnit04DatabaseUrl } from "../../scripts/unit04-database-guard";

describe("UNIT-04 dedicated database guard", () => {
  it("accepts only credentialed loopback PostgreSQL URLs for ukiebook_unit04", () => {
    const valid =
      "postgresql://unit04:secret@127.0.0.1:55435/ukiebook_unit04";
    expect(requireDedicatedUnit04DatabaseUrl(valid)).toBe(valid);
    expect(() =>
      requireDedicatedUnit04DatabaseUrl(
        "postgresql://unit04:secret@db.example.com:5432/ukiebook_unit04",
      ),
    ).toThrow(/loopback/u);
    expect(() =>
      requireDedicatedUnit04DatabaseUrl(
        "postgresql://unit04:secret@127.0.0.1:55435/ukiebook_production",
      ),
    ).toThrow(/exact database/u);
    expect(() =>
      requireDedicatedUnit04DatabaseUrl(
        "postgresql://127.0.0.1:55435/ukiebook_unit04",
      ),
    ).toThrow(/credentials/u);
    for (const override of [
      "?host=evil.example",
      "?host=%2Fvar%2Frun%2Fpostgresql",
      "?host=localhost&host=evil.example",
      "?database=ukiebook_unit00",
      "#host=evil.example",
    ]) {
      expect(() =>
        requireDedicatedUnit04DatabaseUrl(
          `postgresql://unit04:secret@127.0.0.1:55435/ukiebook_unit04${override}`,
        ),
      ).toThrow(/override parameters/u);
    }
  });
});
