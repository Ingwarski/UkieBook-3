import { describe, expect, it } from "vitest";

import { publishingDraftResumeHref } from "../../components/publishing/resume-href";

describe("publishing draft resume routing", () => {
  const draftId = "11111111-1111-4111-8111-111111111111";

  it.each([
    ["converting", 5],
    ["conversion_failed", 5],
    ["ready", 5],
  ] as const)("routes %s drafts to S-12", (draftStatus, currentStep) => {
    expect(
      publishingDraftResumeHref({
        currentStep,
        draftId,
        draftStatus,
        status: "draft",
      }),
    ).toBe(`/author/publish/preview?draft=${draftId}`);
  });

  it("routes an ordinary open draft to its persisted wizard step", () => {
    expect(
      publishingDraftResumeHref({
        currentStep: 3,
        draftId,
        draftStatus: "draft",
        status: "draft",
      }),
    ).toBe(`/author/publish?draft=${draftId}&step=3`);
  });

  it("does not expose a resume route for a submitted book", () => {
    expect(
      publishingDraftResumeHref({
        currentStep: 6,
        draftId,
        draftStatus: "submitted",
        status: "submitted",
      }),
    ).toBeNull();
  });
});
