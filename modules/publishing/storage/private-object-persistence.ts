import { randomUUID } from "node:crypto";

import type { SqlExecutor } from "../../platform/sql-port";
import type {
  PublishingPrivateObject,
  PublishingPrivateObjectKind,
} from "../types";
import type { PrivateObjectStorage } from "./private-object-storage";

interface PrivateObjectRow extends Record<string, unknown> {
  id: string;
  owner_user_id: string;
  object_kind: PublishingPrivateObjectKind;
  storage_key: string;
  sha256: string;
  byte_length: number | string;
  media_type: string;
  original_name: string | null;
  created_at: Date | string;
}

function mapPrivateObject(row: PrivateObjectRow): PublishingPrivateObject {
  return {
    byteLength: Number(row.byte_length),
    createdAt: new Date(row.created_at).toISOString(),
    id: row.id,
    kind: row.object_kind,
    mediaType: row.media_type,
    originalName: row.original_name,
    ownerUserId: row.owner_user_id,
    sha256: row.sha256,
    storageKey: row.storage_key,
  };
}

function extensionForKind(kind: PublishingPrivateObjectKind, mediaType: string): string {
  if (kind === "epub") return "epub";
  if (kind === "mobi") return "mobi";
  if (kind === "preview" || kind === "normalized") return "json";
  if (mediaType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return "docx";
  }
  if (mediaType === "text/plain") return "txt";
  if (mediaType === "image/jpeg") return "jpg";
  if (mediaType === "image/webp") return "webp";
  return "png";
}

async function registerPrivateObject(
  executor: SqlExecutor,
  input: Omit<PublishingPrivateObject, "createdAt" | "id">,
): Promise<PublishingPrivateObject> {
  const inserted = await executor.query<PrivateObjectRow>(
    `
      INSERT INTO publishing_private_objects (
        id, owner_user_id, object_kind, storage_key, sha256,
        byte_length, media_type, original_name
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (storage_key) DO NOTHING
      RETURNING *
    `,
    [
      randomUUID(),
      input.ownerUserId,
      input.kind,
      input.storageKey,
      input.sha256,
      input.byteLength,
      input.mediaType,
      input.originalName,
    ],
  );
  if (inserted.rows[0]) return mapPrivateObject(inserted.rows[0]);
  const existing = await executor.query<PrivateObjectRow>(
    "SELECT * FROM publishing_private_objects WHERE storage_key = $1",
    [input.storageKey],
  );
  const row = existing.rows[0];
  if (!row) throw new Error("Unable to recover private object metadata");
  const recovered = mapPrivateObject(row);
  if (
    recovered.ownerUserId !== input.ownerUserId ||
    recovered.kind !== input.kind ||
    recovered.sha256 !== input.sha256 ||
    recovered.byteLength !== input.byteLength ||
    recovered.mediaType !== input.mediaType
  ) {
    throw new Error("Private object content-address conflict");
  }
  return recovered;
}

export async function persistPrivateBuffer(
  executor: SqlExecutor,
  storage: PrivateObjectStorage,
  input: {
    readonly authorId: string;
    readonly bytes: Buffer;
    readonly kind: PublishingPrivateObjectKind;
    readonly mediaType: string;
    readonly originalName: string | null;
  },
): Promise<PublishingPrivateObject> {
  const stored = await storage.putImmutable({
    bytes: input.bytes,
    extension: extensionForKind(input.kind, input.mediaType),
    kind: input.kind,
    ownerUserId: input.authorId,
  });
  return registerPrivateObject(executor, {
    byteLength: stored.byteLength,
    kind: input.kind,
    mediaType: input.mediaType,
    originalName: input.originalName,
    ownerUserId: input.authorId,
    sha256: stored.sha256,
    storageKey: stored.storageKey,
  });
}
