import type {
  AiModerationResult,
  ModerationScreeningInput,
} from "./types";

export interface AiModerationAdapter {
  readonly adapterId: string;
  screen(input: ModerationScreeningInput): Promise<AiModerationResult>;
}

export class AiModerationProviderError extends Error {
  readonly code: string;

  constructor(code: string, message = "AI moderation provider unavailable") {
    super(message);
    this.name = "AiModerationProviderError";
    this.code = code;
  }
}

export class UnavailableAiModerationAdapter implements AiModerationAdapter {
  readonly adapterId = "unavailable-safe-fail-v1";

  async screen(input: ModerationScreeningInput): Promise<never> {
    void input;
    throw new AiModerationProviderError("PROVIDER_UNAVAILABLE");
  }
}

export class DeterministicFakeAiModerationAdapter implements AiModerationAdapter {
  readonly adapterId = "deterministic-fake-v1";
  readonly #evaluate: (input: ModerationScreeningInput) => AiModerationResult;

  constructor(
    evaluate: (input: ModerationScreeningInput) => AiModerationResult = () => ({
      result: "clear",
    }),
  ) {
    this.#evaluate = evaluate;
  }

  async screen(input: ModerationScreeningInput): Promise<AiModerationResult> {
    return this.#evaluate(input);
  }
}
