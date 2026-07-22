import { Buffer } from "node:buffer";

import { z } from "zod";

export const SERVER_ENV_BUNDLE_MARKER = "UKIEBOOK_SERVER_ENV_ONLY_v1";

function optionalNonEmptyString(schema: z.ZodString) {
  return z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    schema.optional(),
  );
}

const authSecretSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]+$/u, "AUTH_SECRET must be canonical base64url without padding")
  .refine((value) => {
    const decoded = Buffer.from(value, "base64url");
    return decoded.length >= 32 && decoded.toString("base64url") === value;
  }, "AUTH_SECRET must contain at least 32 random base64url bytes");

const serverEnvironmentSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ORIGIN: z.string().trim().url().default("http://localhost:3000"),
  APP_REVISION: z.string().trim().min(1).default("development"),
  AUTH_SECRET: optionalNonEmptyString(authSecretSchema),
  AUTH_TEST_PROVIDER_ORIGIN: optionalNonEmptyString(z.string().trim().url()),
  DATABASE_URL: z.string().trim().url(),
  FACEBOOK_OAUTH_CLIENT_ID: optionalNonEmptyString(z.string().trim().min(1)),
  FACEBOOK_OAUTH_CLIENT_SECRET: optionalNonEmptyString(z.string().trim().min(1)),
  GOOGLE_OAUTH_CLIENT_ID: optionalNonEmptyString(z.string().trim().min(1)),
  GOOGLE_OAUTH_CLIENT_SECRET: optionalNonEmptyString(z.string().trim().min(1)),
  GOOGLE_DOCS_EXPORT_ORIGIN: z
    .string()
    .trim()
    .url()
    .default("https://docs.google.com"),
  JOB_LEASE_SECONDS: z.coerce.number().int().positive().default(60),
  JOB_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(5),
  CALIBRE_EBOOK_CONVERT_PATH: optionalNonEmptyString(z.string().trim().min(1)),
  PRIVATE_OBJECT_ROOT: z
    .string()
    .trim()
    .min(1)
    .default(".data/private-objects"),
  PUBLISHING_MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(104_857_600)
    .default(52_428_800),
  PUBLISHING_PRICE_HINT_MIN_KOPIYKAS: z.coerce
    .number()
    .int()
    .min(0)
    .default(9_900),
  PUBLISHING_PRICE_HINT_MAX_KOPIYKAS: z.coerce
    .number()
    .int()
    .min(0)
    .default(39_900),
  SCHEDULER_TICK_MS: z.coerce.number().int().min(1_000).default(60_000),
  WORKER_ID: z.string().trim().min(1).default("local-worker"),
}).superRefine((environment, context) => {
  if (
    environment.PUBLISHING_PRICE_HINT_MAX_KOPIYKAS <
    environment.PUBLISHING_PRICE_HINT_MIN_KOPIYKAS
  ) {
    context.addIssue({
      code: "custom",
      message: "PUBLISHING_PRICE_HINT_MAX_KOPIYKAS must be at least the minimum",
      path: ["PUBLISHING_PRICE_HINT_MAX_KOPIYKAS"],
    });
  }
});

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

export function readServerEnvironment(
  source: Record<string, string | undefined> = process.env,
): ServerEnvironment {
  return serverEnvironmentSchema.parse(source);
}
