import { Pool, type PoolClient } from "pg";

import type {
  SqlConnection,
  SqlDatabase,
  SqlQueryResult,
  SqlRow,
} from "../modules/platform/sql-port";

function normalizeResult<Row extends SqlRow>(result: {
  rows: unknown[];
  rowCount: number | null;
}): SqlQueryResult<Row> {
  return {
    rows: result.rows as Row[],
    rowCount: result.rowCount,
  };
}

class PostgresConnection implements SqlConnection {
  constructor(private readonly client: PoolClient) {}

  async query<Row extends SqlRow = SqlRow>(
    text: string,
    parameters: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    const result = await this.client.query(text, [...parameters]);
    return normalizeResult<Row>(result);
  }

  release(): void {
    this.client.release();
  }
}

export class PostgresDatabase implements SqlDatabase {
  readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async query<Row extends SqlRow = SqlRow>(
    text: string,
    parameters: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    const result = await this.pool.query(text, [...parameters]);
    return normalizeResult<Row>(result);
  }

  async connect(): Promise<SqlConnection> {
    return new PostgresConnection(await this.pool.connect());
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function openPostgresDatabase(connectionString: string): PostgresDatabase {
  if (connectionString.trim().length === 0) {
    throw new Error("DATABASE_URL must not be empty");
  }

  return new PostgresDatabase(connectionString);
}
