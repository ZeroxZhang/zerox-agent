import { describe, expect, it } from "vitest";
import { createAgentEvalFixtures } from "./agentEvalFixtures";
import { runAgentEvals } from "./agentEvalRunner";
import type {
  AgentTrajectoryEvent,
  AgentTrajectoryEventType,
} from "../../shared/agentTrajectory";

describe("agent eval runner", () => {
  it("scores the deterministic golden fixture set", async () => {
    const report = await runAgentEvals(createAgentEvalFixtures());

    expect(report).toEqual({
      total: 10,
      passed: 10,
      failed: 0,
      passRate: 1,
      toolSuccessRate: 0.8182,
      recoverabilityRate: 1,
      failures: [],
    });
  });

  it("includes workspace isolation, native code engineering, and multi-agent lineage fixtures", () => {
    const fixtures = createAgentEvalFixtures();

    expect(fixtures.map((fixture) => fixture.id)).toEqual(
      expect.arrayContaining([
        "workspace-escape-denied",
        "code-engineering-native-tools",
        "reflection-after-test-failure",
        "episode-eval-candidate",
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
      fixtures.find((fixture) => fixture.id === "code-engineering-native-tools"),
    ).toMatchObject({
      requiredEventTypes: [
        "tool_call",
        "native_tool_invocation",
        "native_tool_observation",
        "tool_result",
        "final_summary",
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

  it("matches asserted payloads against the corresponding repeated event type", async () => {
    const report = await runAgentEvals([
      {
        id: "repeated-native-events",
        description: "Repeated native events require payload matching.",
        events: createEvents("repeated-native-events", [
          ["tool_call", { toolName: "code_search" }],
          [
            "native_tool_invocation",
            { toolName: "code_search", nativeKind: "code" },
          ],
          ["tool_call", { toolName: "git_status" }],
          [
            "native_tool_invocation",
            { toolName: "git_status", nativeKind: "git" },
          ],
          ["tool_result", { toolName: "git_status", ok: true }],
          ["final_summary", {}],
        ]),
        requiredEventTypes: [
          "tool_call",
          "native_tool_invocation",
          "tool_result",
          "final_summary",
        ],
        assertions: [
          {
            type: "native_tool_invocation",
            payload: { toolName: "git_status", nativeKind: "git" },
            after: "tool_call",
          },
        ],
      },
    ]);

    expect(report.failures).toEqual([]);
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

  it("fails when asserted event order is wrong", async () => {
    const report = await runAgentEvals([
      {
        id: "bad-order",
        description: "Bad event order",
        events: createEvents("bad-order", [
          ["workspace_escape_denied", {}],
          ["tool_call", {}],
        ]),
        requiredEventTypes: ["tool_call", "workspace_escape_denied"],
        assertions: [
          { type: "workspace_escape_denied", after: "tool_call" },
        ],
      },
    ]);

    expect(report).toMatchObject({
      total: 1,
      passed: 0,
      failed: 1,
      failures: [
        {
          fixtureId: "bad-order",
          reason:
            '"workspace_escape_denied" must occur after "tool_call".',
        },
      ],
    });
  });
});

function createEvents(
  runId: string,
  entries: Array<[AgentTrajectoryEventType, Record<string, unknown>]>,
): AgentTrajectoryEvent[] {
  return entries.map(([type, payload], index) => ({
    id: `${runId}_${index + 1}`,
    runId,
    type,
    sequence: index + 1,
    payload,
    redaction: {
      containsApiKey: false,
      containsFileContent: false,
      containsUserText: false,
    },
    createdAt: "2026-06-07T00:00:00.000Z",
  }));
}
