import { describe, expect, it } from "vitest";

import { requireDedicatedUnit05DatabaseUrl } from "../../scripts/unit05-database-guard";

describe("UNIT-05 dedicated database guard", () => {
  it("accepts only credentialed loopback PostgreSQL URLs for ukiebook_unit05", () => {
    const valid =
      "postgresql://unit05:secret@127.0.0.1:55436/ukiebook_unit05";
    expect(requireDedicatedUnit05DatabaseUrl(valid)).toBe(valid);

    expect(() =>
      requireDedicatedUnit05DatabaseUrl(
        "postgresql://unit05:secret@db.example.com:5432/ukiebook_unit05",
      ),
    ).toThrow(/loopback/u);
    expect(() =>
      requireDedicatedUnit05DatabaseUrl(
        "postgresql://unit05:secret@127.0.0.1:55436/ukiebook_production",
      ),
    ).toThrow(/exact database/u);
    expect(() =>
      requireDedicatedUnit05DatabaseUrl(
        "postgresql://127.0.0.1:55436/ukiebook_unit05",
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
        requireDedicatedUnit05DatabaseUrl(
          `postgresql://unit05:secret@127.0.0.1:55436/ukiebook_unit05${override}`,
        ),
      ).toThrow(/override parameters/u);
    }
  });
});
