import { describe, expect, it } from "vitest";
import type { ResolvedModelBinding } from "../shared/modelSettings";
import type { PlanRecord } from "../shared/planMode";
import {
  resolveGoalExecutionModelBinding,
  selectPlanExecutionModelBinding,
  selectRuntimeDirectProfileId,
} from "./goalExecutionModel";

describe("goal execution model continuity", () => {
  it("uses the final synthesizer binding for Debate execution", () => {
    const a = binding("profile-a", "model-a");
    const c = binding("profile-c", "model-c");

    expect(
      selectPlanExecutionModelBinding({
        frozenModelAssignments: { a, c },
      }),
    ).toBe(c);
  });

  it("inherits Debate C as the runtime Direct profile without falling back to A or B", () => {
    const a = binding("profile-a", "model-a");
    const c = binding("profile-c", "model-c");

    expect(
      selectRuntimeDirectProfileId(
        { mode: "debate", frozenModelAssignments: { a, c } },
        {},
      ),
    ).toBe("profile-c");
    expect(
      selectRuntimeDirectProfileId(
        { mode: "debate", frozenModelAssignments: { a } },
        { executionModelBinding: binding("fallback", "fallback-model") },
      ),
    ).toBeUndefined();
  });

  it("recovers a legacy Goal binding from its verified source Plan", async () => {
    const c = binding("profile-c", "deepseek-v4-flash");
    const resolved = await resolveGoalExecutionModelBinding(
      {
        sourcePlanRef: {
          planId: "plan-1",
          revision: 24,
          sha256: "projection-sha",
        },
      },
      async () =>
        ({
          projection: { sha256: "projection-sha" },
          frozenModelAssignments: { c },
        }) as PlanRecord,
    );

    expect(resolved).toBe(c);
  });

  it("does not inherit a binding from a drifted Plan projection", async () => {
    const resolved = await resolveGoalExecutionModelBinding(
      {
        sourcePlanRef: {
          planId: "plan-1",
          revision: 24,
          sha256: "confirmed-sha",
        },
      },
      async () =>
        ({
          projection: { sha256: "changed-sha" },
          frozenModelAssignments: {
            c: binding("profile-c", "deepseek-v4-flash"),
          },
        }) as PlanRecord,
    );

    expect(resolved).toBeUndefined();
  });
});

function binding(profileId: string, modelId: string): ResolvedModelBinding {
  return {
    profileId,
    connectionId: `connection-${profileId}`,
    providerKind: "deepseek",
    modelId,
    revision: 1,
    connectionRevision: 1,
    profileRevision: 1,
    baseUrl: "https://api.deepseek.com",
    capabilities: {
      tools: true,
      vision: false,
      pdf: false,
      streaming: true,
      parallelToolCalls: true,
    },
    generation: {
      temperature: 0.2,
      maxTokens: 8192,
      thinkingEnabled: false,
      thinkingBudgetTokens: 8192,
    },
  };
}
