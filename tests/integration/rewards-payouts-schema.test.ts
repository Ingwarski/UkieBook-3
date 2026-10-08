import { randomUUID } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyMigrations } from "../../db/migrate";
import { adaptPGlite } from "../../db/pglite";
import type { SqlDatabase } from "../../db/query";

describe("UNIT-07 rewards and payouts schema", () => {
  let database: SqlDatabase;
  let authorId: string;
  let managerId: string;

  beforeEach(async () => {
    database = adaptPGlite(await PGlite.create());
    await applyMigrations(database);
    authorId = randomUUID();
    managerId = randomUUID();
    await database.query("INSERT INTO users (id) VALUES ($1), ($2)", [
      authorId,
      managerId,
    ]);
    await database.query(
      "INSERT INTO author_profiles (user_id, public_name) VALUES ($1, 'Test Author')",
      [authorId],
    );
  });

  afterEach(async () => {
    await database.close?.();
  });

  it.each(["standard", "founder"] as const)(
    "appends another %s rule version without rewriting its predecessor",
    async (kind) => {
      await database.query(
        `
          INSERT INTO reward_allocation_rules (
            id, rule_kind, platform_net_revenue_bps, platform_tax_component_bps,
            author_share_bps, public_platform_share_bps, effective_at
          )
          SELECT $1, rule_kind, platform_net_revenue_bps, platform_tax_component_bps,
                 author_share_bps, public_platform_share_bps, $2::timestamptz
          FROM reward_allocation_rules WHERE id = $3
        `,
        [`${kind}-v2`, "2026-10-01T00:00:00Z", `${kind}-v1`],
      );
      const versions = await database.query<{ id: string }>(
        "SELECT id FROM reward_allocation_rules WHERE rule_kind = $1 ORDER BY effective_at, id",
        [kind],
      );
      expect(versions.rows.map((row) => row.id)).toEqual([
        `${kind}-v1`,
        `${kind}-v2`,
      ]);
      await expect(
        database.query(
          "UPDATE reward_allocation_rules SET effective_at = CURRENT_TIMESTAMP WHERE id = $1",
          [`${kind}-v1`],
        ),
      ).rejects.toThrow(/append-only/);
      await expect(
        database.query("DELETE FROM reward_allocation_rules WHERE id = $1", [
          `${kind}-v1`,
        ]),
      ).rejects.toThrow(/append-only/);
    },
  );

  async function insertPayout(
    status: "awaiting_payment" | "paid" | "carried",
    amount: number,
  ): Promise<string> {
    const id = randomUUID();
    const gross = Math.round((amount * 10000) / 6500);
    const tax = Math.round((gross * 600) / 10000);
    await database.query(
      `
        INSERT INTO reward_payout_rows (
          id, period_start, author_user_id, reward_model, sales_count,
          gross_sales_kopiykas, platform_net_kopiykas, platform_tax_kopiykas,
          author_accrual_kopiykas, amount_due_kopiykas, status,
          confirmed_by_manager_user_id, confirmed_at
        ) VALUES (
          $1, '2026-09-01', $2, 'fop', 1, $3, $4, $5, $6, $6, $7,
          $8, CASE WHEN $7 = 'paid' THEN CURRENT_TIMESTAMP ELSE NULL END
        )
      `,
      [
        id,
        authorId,
        gross,
        gross - tax - amount,
        tax,
        amount,
        status,
        status === "paid" ? managerId : null,
      ],
    );
    return id;
  }

  it.each(["awaiting_payment", "paid"] as const)(
    "rejects a directly inserted %s payout one kopiyka below the minimum",
    async (status) => {
      await expect(insertPayout(status, 9999)).rejects.toThrow(/check constraint/);
    },
  );

  it.each(["awaiting_payment", "paid"] as const)(
    "accepts a directly inserted %s payout at exactly 100 UAH",
    async (status) => {
      await expect(insertPayout(status, 10000)).resolves.toEqual(expect.any(String));
    },
  );

  it("carries a payout below 100 UAH", async () => {
    await expect(insertPayout("carried", 9999)).resolves.toEqual(expect.any(String));
  });

  it("rejects carrying a payout that reaches 100 UAH", async () => {
    await expect(insertPayout("carried", 10000)).rejects.toThrow(/check constraint/);
  });

  it("allows confirmation at the minimum and preserves the paid snapshot", async () => {
    const id = await insertPayout("awaiting_payment", 10000);
    await database.query(
      `
        UPDATE reward_payout_rows
        SET status = 'paid', confirmed_by_manager_user_id = $2,
            confirmed_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [id, managerId],
    );
    const payout = await database.query<{ status: string }>(
      "SELECT status FROM reward_payout_rows WHERE id = $1",
      [id],
    );
    expect(payout.rows[0]?.status).toBe("paid");
    await expect(
      database.query(
        "UPDATE reward_payout_rows SET author_accrual_kopiykas = 9999, amount_due_kopiykas = 9999 WHERE id = $1",
        [id],
      ),
    ).rejects.toThrow(/immutable/);
  });
});
