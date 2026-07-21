import type { PGlite } from "@electric-sql/pglite";

import type {
  SqlDatabase,
  SqlQueryResult,
  SqlRow,
} from "../modules/platform/sql-port";

export function adaptPGlite(database: PGlite): SqlDatabase {
  return {
    async query<Row extends SqlRow = SqlRow>(
      text: string,
      parameters: readonly unknown[] = [],
    ): Promise<SqlQueryResult<Row>> {
      const result = await database.query(text, [...parameters]);

      return {
        rows: result.rows as Row[],
        rowCount: result.affectedRows ?? null,
      };
    },
    async close(): Promise<void> {
      await database.close();
    },
  };
}
