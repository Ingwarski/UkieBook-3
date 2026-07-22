import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PublishingPrivateObjectKind } from "../types";

export interface PrivateObjectWrite {
  readonly ownerUserId: string;
  readonly kind: PublishingPrivateObjectKind;
  readonly bytes: Buffer;
  readonly extension: string;
}

export interface StoredPrivateObjectWrite {
  readonly storageKey: string;
  readonly sha256: string;
  readonly byteLength: number;
}

export interface PrivateObjectStorage {
  putImmutable(input: PrivateObjectWrite): Promise<StoredPrivateObjectWrite>;
  read(storageKey: string): Promise<Buffer>;
}

function safeSegment(value: string, label: string): string {
  if (!/^[a-zA-Z0-9._-]+$/u.test(value) || value === "." || value === "..") {
    throw new Error(`Invalid private object ${label}`);
  }
  return value;
}

function resolveWithinRoot(root: string, storageKey: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, storageKey);
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("Private object path escaped its configured root");
  }
  return resolved;
}

export class LocalPrivateObjectStorage implements PrivateObjectStorage {
  readonly #root: string;

  constructor(root: string) {
    this.#root = path.resolve(root);
  }

  async putImmutable(input: PrivateObjectWrite): Promise<StoredPrivateObjectWrite> {
    if (input.bytes.byteLength === 0) {
      throw new Error("Private objects must not be empty");
    }
    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    const extension = safeSegment(input.extension.replace(/^\./u, ""), "extension");
    const storageKey = [
      safeSegment(input.ownerUserId, "owner"),
      safeSegment(input.kind, "kind"),
      `${sha256}.${extension}`,
    ].join("/");
    const target = resolveWithinRoot(this.#root, storageKey);
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await writeFile(target, input.bytes, { flag: "wx" });
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") {
        throw error;
      }
      const present = await readFile(target);
      const presentHash = createHash("sha256").update(present).digest("hex");
      if (presentHash !== sha256) {
        throw new Error("Immutable private object content conflict");
      }
    }
    return { byteLength: input.bytes.byteLength, sha256, storageKey };
  }

  read(storageKey: string): Promise<Buffer> {
    return readFile(resolveWithinRoot(this.#root, storageKey));
  }
}
