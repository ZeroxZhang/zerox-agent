import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalizeGoalContract,
  isGoalContractSnapshot,
} from "../shared/goalPlanContract";
import {
  createGoalContractRef,
  deriveGoalContractFromPlan,
  goalContractMatchesRef,
} from "./goalPlanContractService";

describe("goalPlanContractService", () => {
  it("derives a stable semantic contract and SHA-256 reference", () => {
    const snapshot = deriveGoalContractFromPlan({
      planId: "plan_1",
      createdAt: "2026-08-03T00:00:00.000Z",
      taskContract: {
        objective: "Ship P70",
        audience: "maintainers",
        deliverables: ["implementation", "tests", "tests"],
        inScope: ["Goal", "Plan"],
        outOfScope: ["cloud workers"],
        constraints: ["Do not bypass permissions"],
        successCriteria: ["All focused tests pass"],
        assumptions: ["debug branch"],
      },
    });
    const reference = createGoalContractRef(snapshot);

    expect(snapshot.deliverables).toEqual(["implementation", "tests"]);
    expect(snapshot.constraints[0]).toMatchObject({
      strength: "hard",
      dimension: "permission",
    });
    expect(reference.sha256).toBe(
      createHash("sha256")
        .update(canonicalizeGoalContract(snapshot))
        .digest("hex"),
    );
    expect(goalContractMatchesRef(snapshot, reference)).toBe(true);
  });

  it("detects semantic contract drift", () => {
    const snapshot = deriveGoalContractFromPlan({
      planId: "plan_1",
      createdAt: "2026-08-03T00:00:00.000Z",
      taskContract: {
        objective: "Ship P70",
        audience: "maintainers",
        inScope: [],
        outOfScope: [],
        constraints: [],
        successCriteria: ["Tests pass"],
        assumptions: [],
      },
    });
    const reference = createGoalContractRef(snapshot);

    expect(
      goalContractMatchesRef(
        { ...snapshot, objective: "Silently reduce scope" },
        reference,
      ),
    ).toBe(false);
  });

  it("fails closed for invalid constraint and stop-policy values", () => {
    const snapshot = deriveGoalContractFromPlan({
      planId: "plan_validation",
      createdAt: "2026-08-03T00:00:00.000Z",
      taskContract: {
        objective: "Validate the contract",
        audience: "maintainers",
        inScope: [],
        outOfScope: [],
        constraints: ["Preserve permissions"],
        successCriteria: ["Contract is valid"],
        assumptions: [],
      },
    });

    expect(isGoalContractSnapshot(snapshot)).toBe(true);
    expect(
      isGoalContractSnapshot({
        ...snapshot,
        constraints: [{ ...snapshot.constraints[0], dimension: "invalid" }],
      }),
    ).toBe(false);
    expect(
      isGoalContractSnapshot({
        ...snapshot,
        stopPolicy: { ...snapshot.stopPolicy, onExternalBlock: "ignore" },
      }),
    ).toBe(false);
  });
});
