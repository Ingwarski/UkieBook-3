import "server-only";

import type { SqlExecutor } from "../../platform/sql-port";

export interface RestrictedPayoutEnvelope {
  readonly authenticationTag: Uint8Array;
  readonly ciphertext: Uint8Array;
  readonly keyId: string;
  readonly nonce: Uint8Array;
  readonly schemaVersion: number;
  readonly userId: string;
}

/**
 * Restricted server-only boundary. UNIT-07 owns the payload schema and write path.
 * UNIT-01 creates only the encrypted envelope separation required by NFR-3.
 */
export async function loadRestrictedPayoutEnvelope(
  executor: SqlExecutor,
  userId: string,
): Promise<RestrictedPayoutEnvelope | null> {
  const result = await executor.query<{
    authentication_tag: Uint8Array;
    ciphertext: Uint8Array;
    key_id: string;
    nonce: Uint8Array;
    schema_version: number;
    user_id: string;
  }>(
    `
      SELECT user_id, schema_version, key_id, nonce, ciphertext, authentication_tag
      FROM author_payout_details
      WHERE user_id = $1
    `,
    [userId],
  );
  const row = result.rows[0];
  return row
    ? {
        authenticationTag: row.authentication_tag,
        ciphertext: row.ciphertext,
        keyId: row.key_id,
        nonce: row.nonce,
        schemaVersion: row.schema_version,
        userId: row.user_id,
      }
    : null;
}
