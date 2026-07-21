import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  evalResultSchema,
  writeEvalResult
} from "@/modules/platform/evidence/eval-result";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true })
    )
  );
});

describe("Eval Result writer", () => {
  it("writes the DoD-owned result format atomically", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ukiebook-eval-"));
    temporaryDirectories.push(directory);

    const result = {
      evidence: ["forge/runs/UNIT-00/example/build.txt"],
      findings: [],
      gate: "build",
      implementation_revision: "abcdef1234567890",
      owner: "platform foundation",
      rerun_of: null,
      status: "passed" as const,
      timestamp: "2026-07-21T22:30:00+03:00",
      unit: "UNIT-00"
    };

    const target = await writeEvalResult(directory, result);
    const stored = JSON.parse(await readFile(target, "utf8"));

    expect(evalResultSchema.parse(stored)).toEqual(result);
  });

  it("rejects a passed result without evidence", () => {
    expect(() =>
      evalResultSchema.parse({
        evidence: [],
        findings: [],
        gate: "tests",
        implementation_revision: "abcdef1234567890",
        owner: "platform foundation",
        rerun_of: null,
        status: "passed",
        timestamp: "2026-07-21T22:30:00+03:00",
        unit: "UNIT-00"
      })
    ).toThrow();
  });

  it("rejects a gate name that could escape the evidence directory", () => {
    expect(() =>
      evalResultSchema.parse({
        evidence: ["forge/runs/UNIT-00/example/security.txt"],
        findings: [],
        gate: "../../outside",
        implementation_revision: "abcdef1234567890",
        owner: "platform foundation",
        rerun_of: null,
        status: "passed",
        timestamp: "2026-07-21T22:30:00+03:00",
        unit: "UNIT-00",
      }),
    ).toThrow();
  });
});
