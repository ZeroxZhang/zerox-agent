import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAgentEvalFixtures } from "./agentEvalFixtures";
import {
  createAdversarialAgentEvalCases,
  runAdversarialAgentEvals,
} from "./agentEvalAdversary";

describe("agent eval adversary", () => {
  it("creates deterministic cases for each supported mutation kind", () => {
    const cases = createAdversarialAgentEvalCases(createAgentEvalFixtures());

    expect(cases.map((testCase) => testCase.mutation)).toEqual(
      expect.arrayContaining([
        "remove_required_event",
        "wrong_payload",
        "wrong_order",
        "tamper_goal_budget",
        "remove_acceptance_check",
      ]),
    );
  });

  it("creates goal-specific adversarial cases for budget and acceptance tampering", () => {
    const cases = createAdversarialAgentEvalCases(createAgentEvalFixtures());

    expect(cases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceFixtureId: "goal-stopped-by-budget",
          mutation: "tamper_goal_budget",
        }),
        expect.objectContaining({
          sourceFixtureId: "goal-achieved-within-budget",
          mutation: "remove_acceptance_check",
        }),
      ]),
    );
  });

  it("passes only when every adversarial fixture is rejected", async () => {
    const report = await runAdversarialAgentEvals(createAgentEvalFixtures());

    expect(report.passed).toBe(true);
    expect(report.checked).toBeGreaterThan(0);
    expect(report.escaped).toEqual([]);
    expect(report.evalReport).toMatchObject({
      total: report.checked,
      passed: 0,
      failed: report.checked,
    });
  });

  it("does not mutate the original fixtures", async () => {
    const fixtures = createAgentEvalFixtures();
    const before = JSON.stringify(fixtures);

    createAdversarialAgentEvalCases(fixtures);
    await runAdversarialAgentEvals(fixtures);

    expect(JSON.stringify(fixtures)).toBe(before);
  });

  it("wires the harness score script through adversarial evals", () => {
    const script = readFileSync(
      path.join(process.cwd(), "scripts/run-harness-score.mjs"),
      "utf8",
    );

    expect(script).toContain("runAdversarialAgentEvals");
    expect(script).toContain("adversarial:");
    expect(script).toContain("goalFixtureCount");
    expect(script).toContain("goalPassRate");
    expect(script).toContain("goal:");
    expect(script).toContain("!adversarial.passed");
  });
});
