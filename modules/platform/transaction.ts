import type { SqlConnection, SqlDatabase } from "./sql-port";
import { withSqlTransaction } from "./sql-port";
import {
  enqueueDurableJob,
  type DurableJob,
  type DurableJobInput,
} from "./durable-jobs";
import {
  appendOutboxEvent,
  type OutboxEvent,
  type OutboxEventInput,
} from "./outbox";

export interface DomainTransaction {
  readonly connection: SqlConnection;
  emit(input: OutboxEventInput): Promise<OutboxEvent>;
  enqueue(input: DurableJobInput): Promise<DurableJob>;
}

function createDomainTransaction(connection: SqlConnection): DomainTransaction {
  return {
    connection,
    emit: (input) => appendOutboxEvent(connection, input),
    enqueue: (input) => enqueueDurableJob(connection, input),
  };
}

export function withDomainTransaction<Result>(
  database: SqlDatabase,
  operation: (transaction: DomainTransaction) => Promise<Result>,
): Promise<Result> {
  return withSqlTransaction(database, (connection) =>
    operation(createDomainTransaction(connection)),
  );
}
