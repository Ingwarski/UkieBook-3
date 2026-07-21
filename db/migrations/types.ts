import type { SqlExecutor } from "../../modules/platform/sql-port";

export interface Migration {
  readonly checksum: string;
  readonly id: string;
  readonly up: (connection: SqlExecutor) => Promise<void>;
  readonly down: (connection: SqlExecutor) => Promise<void>;
}

export async function runStatements(
  connection: SqlExecutor,
  statements: readonly string[],
): Promise<void> {
  for (const statement of statements) {
    await connection.query(statement);
  }
}
