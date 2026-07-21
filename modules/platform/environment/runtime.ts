import { z } from "zod";

export const SERVER_ENV_BUNDLE_MARKER = "UKIEBOOK_SERVER_ENV_ONLY_v1";

const serverEnvironmentSchema = z.object({
  APP_REVISION: z.string().trim().min(1).default("development"),
  DATABASE_URL: z.string().trim().url(),
  JOB_LEASE_SECONDS: z.coerce.number().int().positive().default(60),
  JOB_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(5),
  SCHEDULER_TICK_MS: z.coerce.number().int().min(1_000).default(60_000),
  WORKER_ID: z.string().trim().min(1).default("local-worker"),
});

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

export function readServerEnvironment(
  source: Record<string, string | undefined> = process.env,
): ServerEnvironment {
  return serverEnvironmentSchema.parse(source);
}
