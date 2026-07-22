import { describe, expect, it } from "vitest";

import { requireDedicatedUnit02DatabaseUrl } from "../../scripts/unit02-database-guard";

describe("UNIT-02 dedicated database guard", () => {
  it("accepts only credentialed loopback PostgreSQL URLs for ukiebook_unit02", () => {
    const valid = "postgresql://unit02:secret@127.0.0.1:55435/ukiebook_unit02";
    expect(requireDedicatedUnit02DatabaseUrl(valid)).toBe(valid);
    expect(() =>
      requireDedicatedUnit02DatabaseUrl(
        "postgresql://unit02:secret@db.example.com:5432/ukiebook_unit02",
      ),
    ).toThrow(/loopback/u);
    expect(() =>
      requireDedicatedUnit02DatabaseUrl(
        "postgresql://unit02:secret@127.0.0.1:55435/ukiebook_production",
      ),
    ).toThrow(/exact database/u);
    expect(() =>
      requireDedicatedUnit02DatabaseUrl("postgresql://127.0.0.1:55435/ukiebook_unit02"),
    ).toThrow(/credentials/u);
  });
});
