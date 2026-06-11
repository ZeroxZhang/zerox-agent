import { describe, expect, it } from "vitest";
import {
  computeAgentCapabilityScore,
  defineNativeToolDescriptor,
  type NativeToolDescriptor,
} from "./nativeCapabilities";

describe("native capabilities", () => {
  it("normalizes native descriptors with stable defaults", () => {
    const descriptor = defineNativeToolDescriptor({
      id: "git_status",
      kind: "git",
      label: "Git status",
      description: "Read workspace git status.",
      riskLevel: "low",
      permissionScope: { files: "read", shell: "none", web: "none" },
      observableEvents: ["native_tool_invocation", "native_tool_observation"],
    });

    expect(descriptor).toEqual<NativeToolDescriptor>({
      id: "git_status",
      kind: "git",
      label: "Git status",
      description: "Read workspace git status.",
      riskLevel: "low",
      permissionScope: { files: "read", shell: "none", web: "none" },
      observableEvents: ["native_tool_invocation", "native_tool_observation"],
      enabled: true,
    });
  });

  it("scores native capability coverage and review backlog", () => {
    const score = computeAgentCapabilityScore({
      nativeToolCount: 4,
      expectedNativeToolCount: 8,
      evalPassRate: 1,
      retrySuccessRate: 0.5,
      childHandoffSuccessRate: 0,
      pendingEvalCandidates: 3,
      pendingLearningCandidates: 2,
    });

    expect(score.categories.map((category) => category.id)).toEqual([
      "native_tool_coverage",
      "verification",
      "retry_recovery",
      "handoff",
      "review_governance",
    ]);
    expect(score.categories).toContainEqual(
      expect.objectContaining({
        id: "native_tool_coverage",
        score: 5,
      }),
    );
    expect(score.summary).toContain("4/8 native tools");
    expect(score.tone).toBe("warn");
  });
});
