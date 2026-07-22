import { describe, it } from "vitest";

const enabled = Boolean(process.env.UNIT04_DATABASE_URL);

describe("UNIT-04 real PostgreSQL moderation/publication proof", () => {
  it.skipIf(!enabled)(
    "proves migration round-trip, relay/worker routing, decisions, publication and removal",
    async () => {
      await import("../../scripts/verify-unit04-postgres");
    },
    180_000,
  );
});
