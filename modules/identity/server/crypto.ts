import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const TOKEN_BYTES = 32;

function authKey(secret: string, purpose: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/u.test(secret)) {
    throw new Error("AUTH_SECRET must be canonical base64url without padding");
  }
  const material = Buffer.from(secret, "base64url");
  if (
    material.length < TOKEN_BYTES ||
    material.toString("base64url") !== secret
  ) {
    throw new Error("AUTH_SECRET must contain at least 32 random base64url bytes");
  }
  return Buffer.from(hkdfSync("sha256", material, Buffer.alloc(0), purpose, 32));
}

export function randomOpaqueToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function sealAuthValue(value: string, secret: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", authKey(secret, "ukiebook-auth-flow-v1"), nonce);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", nonce.toString("base64url"), ciphertext.toString("base64url"), tag.toString("base64url")].join(".");
}

export function openAuthValue(sealed: string, secret: string): string {
  const [version, nonceText, ciphertextText, tagText, extra] = sealed.split(".");
  if (version !== "v1" || !nonceText || !ciphertextText || !tagText || extra) {
    throw new Error("Invalid sealed auth value");
  }
  const nonce = Buffer.from(nonceText, "base64url");
  const tag = Buffer.from(tagText, "base64url");
  if (nonce.length !== 12 || tag.length !== 16) {
    throw new Error("Invalid sealed auth value");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    authKey(secret, "ukiebook-auth-flow-v1"),
    nonce,
  );
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function csrfTokenForSession(sessionToken: string, secret: string): string {
  return createHmac("sha256", authKey(secret, "ukiebook-csrf-v1"))
    .update(sessionToken, "utf8")
    .digest("base64url");
}

export function verifyCsrfToken(
  candidate: string,
  sessionToken: string,
  secret: string,
): boolean {
  const expected = csrfTokenForSession(sessionToken, secret);
  const left = Buffer.from(candidate, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
