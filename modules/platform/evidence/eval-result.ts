import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

const findingSchema = z.object({
  release_effect: z.enum(["blocking", "advisory"]),
  severity: z.enum(["P0", "P1", "P2", "P3"]),
  summary: z.string().trim().min(1)
});

export const evalResultSchema = z.object({
  baseline_id: z.string().trim().min(1).optional(),
  evidence: z.array(z.string().trim().min(1)).min(1),
  findings: z.array(findingSchema),
  gate: z
    .string()
    .trim()
    .regex(
      /^[a-z0-9][a-z0-9_-]{0,63}$/,
      "gate must be a safe lowercase evidence filename",
    ),
  implementation_revision: z.string().trim().min(1),
  owner: z.string().trim().min(1),
  rerun_of: z.string().trim().min(1).nullable(),
  status: z.enum(["passed", "failed", "blocked"]),
  timestamp: z.iso.datetime({ offset: true }),
  unit: z.string().trim().min(1)
});

export type EvalResult = z.infer<typeof evalResultSchema>;

export async function writeEvalResult(
  directory: string,
  result: EvalResult
): Promise<string> {
  const parsed = evalResultSchema.parse(result);
  await mkdir(directory, { recursive: true });

  const resolvedDirectory = path.resolve(directory);
  const target = path.resolve(
    resolvedDirectory,
    `${parsed.gate.replaceAll("_", "-")}.json`,
  );
  if (path.dirname(target) !== resolvedDirectory) {
    throw new Error("Eval Result target escaped its evidence directory");
  }
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(parsed, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx"
  });
  await rename(temporary, target);
  return target;
}
