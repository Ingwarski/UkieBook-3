export type SqlRow = Record<string, unknown>;

export interface SqlQueryResult<Row extends SqlRow = SqlRow> {
  readonly rows: Row[];
  readonly rowCount: number | null;
}

export interface SqlExecutor {
  query<Row extends SqlRow = SqlRow>(
    text: string,
    parameters?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>>;
}

export interface SqlConnection extends SqlExecutor {
  release?(): void;
}

export interface SqlDatabase extends SqlExecutor {
  connect?(): Promise<SqlConnection>;
  close?(): Promise<void>;
}

export async function withSqlTransaction<Result>(
  database: SqlDatabase,
  operation: (connection: SqlConnection) => Promise<Result>,
): Promise<Result> {
  const connection = database.connect
    ? await database.connect()
    : (database as SqlConnection);
  let transactionStarted = false;

  try {
    await connection.query("BEGIN");
    transactionStarted = true;

    const result = await operation(connection);
    await connection.query("COMMIT");
    transactionStarted = false;

    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.query("ROLLBACK");
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "The transaction and its rollback both failed",
        );
      }
    }

    throw error;
  } finally {
    connection.release?.();
  }
}
