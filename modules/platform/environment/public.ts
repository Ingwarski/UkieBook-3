import { z } from "zod";

const publicEnvironmentSchema = z.object({
  NEXT_PUBLIC_APP_ENV: z.string().trim().min(1).default("development")
});

export type PublicEnvironment = z.infer<typeof publicEnvironmentSchema>;

export function readPublicEnvironment(
  source: Record<string, string | undefined> = process.env
): PublicEnvironment {
  return publicEnvironmentSchema.parse({
    NEXT_PUBLIC_APP_ENV: source.NEXT_PUBLIC_APP_ENV
  });
}
