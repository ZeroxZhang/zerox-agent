import { describe, expect, it } from "vitest";
import { createAgentEvalFixtures } from "./agentEvalFixtures";
import { runAgentEvals } from "./agentEvalRunner";

describe("agent eval runner", () => {
  it("scores the deterministic golden fixture set", async () => {
    const report = await runAgentEvals(createAgentEvalFixtures());

    expect(report).toEqual({
      total: 7,
      passed: 7,
      failed: 0,
      passRate: 1,
      toolSuccessRate: 0.8,
      recoverabilityRate: 1,
      failures: [],
    });
  });

  it("includes workspace isolation and multi-agent lineage fixtures", () => {
    const fixtures = createAgentEvalFixtures();

    expect(fixtures.map((fixture) => fixture.id)).toEqual(
      expect.arrayContaining([
        "workspace-escape-denied",
        "multi-agent-lineage",
      ]),
    );
    expect(
      fixtures.find((fixture) => fixture.id === "workspace-escape-denied"),
    ).toMatchObject({
      requiredEventTypes: [
        "run_context_created",
        "tool_call",
        "workspace_escape_denied",
        "failure_classified",
      ],
    });
    expect(
      fixtures.find((fixture) => fixture.id === "multi-agent-lineage"),
    ).toMatchObject({
      requiredEventTypes: [
        "run_context_created",
        "child_run_scheduled",
        "final_summary",
      ],
    });
  });

  it("reports fixture failures with reasons", async () => {
    const [fixture] = createAgentEvalFixtures();
    const report = await runAgentEvals([
      {
        ...fixture,
        requiredEventTypes: ["tool_call", "tool_result", "final_summary"],
        events: fixture.events.filter((event) => event.type !== "tool_result"),
      },
    ]);

    expect(report).toMatchObject({
      total: 1,
      passed: 0,
      failed: 1,
      passRate: 0,
      failures: [
        {
          fixtureId: fixture.id,
          reason: 'Missing required trajectory event "tool_result".',
        },
      ],
    });
  });
});
