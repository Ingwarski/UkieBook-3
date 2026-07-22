import { describe, expect, it } from "vitest";

import {
  AiModerationProviderError,
  DeterministicFakeAiModerationAdapter,
  UnavailableAiModerationAdapter,
} from "../../modules/moderation/adapter";
import {
  MODERATION_JOB_TYPE,
  MODERATION_QUEUE,
  MODERATION_SCHEMA_VERSION,
  REASON_CATEGORY_OPTIONS,
  REMOVAL_GROUND_OPTIONS,
  isReasonCategoryCode,
  isRemovalGround,
  reasonCategoryOption,
  type ModerationScreeningInput,
} from "../../modules/moderation/types";

const input: ModerationScreeningInput = {
  artifactHashes: ["a".repeat(64)],
  bookId: "40404040-4040-4040-8040-404040404001",
  bookVersionId: "40404040-4040-4040-8040-404040404002",
  caseId: "40404040-4040-4040-8040-404040404003",
  description: "Опис",
  policyVersion: 1,
  schemaVersion: MODERATION_SCHEMA_VERSION,
  text: "Текст",
  title: "Книжка",
};

describe("UNIT-04 moderation contract", () => {
  it("keeps durable routing and reason/removal dictionaries explicit", () => {
    expect(MODERATION_JOB_TYPE).toBe("moderation.screen.v1");
    expect(MODERATION_QUEUE).toBe("publishing");
    expect(REASON_CATEGORY_OPTIONS).toHaveLength(6);
    expect(REMOVAL_GROUND_OPTIONS).toHaveLength(3);
    expect(isReasonCategoryCode("platform_requirements")).toBe(true);
    expect(isReasonCategoryCode("internal_ai_signal")).toBe(false);
    expect(isRemovalGround("copyright_violation")).toBe(true);
    expect(isRemovalGround("author_reason")).toBe(false);
    expect(reasonCategoryOption("technical_issue")).toEqual({
      code: "technical_issue",
      copyVersion: 1,
      label: "Технічна проблема видання",
    });
  });

  it("provides deterministic clear/flagged injection and an explicit safe-fail adapter", async () => {
    await expect(new DeterministicFakeAiModerationAdapter().screen(input)).resolves.toEqual({
      result: "clear",
    });
    await expect(
      new DeterministicFakeAiModerationAdapter(() => ({
        result: "flagged",
        signals: [{ code: "risk", label: "Risk", severity: "warning" }],
      })).screen(input),
    ).resolves.toMatchObject({ result: "flagged" });
    await expect(new UnavailableAiModerationAdapter().screen(input)).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      name: "AiModerationProviderError",
    } satisfies Partial<AiModerationProviderError>);
  });
});
