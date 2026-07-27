import "server-only";

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { TransactionalEmailAdapter } from "../adapter";
import type { PurchaseEmailMessage, SentEmailReceipt } from "../types";

interface CaptureEnvelope {
  readonly capturedAt: string;
  readonly message: PurchaseEmailMessage;
  readonly providerMessageId: string;
}

/**
 * Durable, idempotent email capture used by the UNIT-05 browser journey.
 * Runtime selection keeps this adapter unreachable outside APP_ENV=test.
 */
export class FileCapturedEmailAdapter implements TransactionalEmailAdapter {
  private readonly root: string;

  constructor(root: string) {
    const normalized = root.trim();
    if (!normalized) throw new Error("Email capture root must not be empty");
    this.root = path.resolve(normalized);
  }

  async send(message: PurchaseEmailMessage): Promise<SentEmailReceipt> {
    const digest = createHash("sha256")
      .update(message.idempotencyKey)
      .digest("hex");
    const providerMessageId = `file-captured:${digest}`;
    const target = path.join(this.root, `${digest}.json`);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const envelope: CaptureEnvelope = {
      capturedAt: new Date().toISOString(),
      message,
      providerMessageId,
    };
    try {
      await writeFile(target, `${JSON.stringify(envelope, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "EEXIST"
      ) {
        throw error;
      }
      const existing = JSON.parse(await readFile(target, "utf8")) as {
        readonly message?: { readonly idempotencyKey?: unknown };
        readonly providerMessageId?: unknown;
      };
      if (
        existing.message?.idempotencyKey !== message.idempotencyKey ||
        existing.providerMessageId !== providerMessageId
      ) {
        throw new Error("Email capture idempotency conflict");
      }
    }
    return { providerMessageId };
  }
}
