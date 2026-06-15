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
      total: 22,
      passed: 22,
      failed: 0,
      passRate: 1,
      toolSuccessRate: 0.7895,
      recoverabilityRate: 1,
      failures: [],
    });
  });

  it("includes goal-mode bounded-autonomy fixtures", () => {
    const fixtures = createAgentEvalFixtures();
    const goalFixtures = fixtures.filter((fixture) =>
      fixture.id.startsWith("goal-"),
    );

    expect(goalFixtures.map((fixture) => fixture.id)).toEqual([
      "goal-achieved-within-budget",
      "goal-stopped-by-budget",
      "goal-stalled-detection",
      "goal-replan-on-acceptance-failure",
      "goal-review-gate-blocks",
      "goal-context-compaction-preserves-anchors",
      "goal-transcript-judge-before-acceptance",
    ]);
    expect(goalFixtures).toHaveLength(7);
    expect(
      goalFixtures.every((fixture) =>
        fixture.requiredEventTypes.includes("acceptance_checked"),
      ),
    ).toBe(true);
    expect(
      fixtures.find((fixture) => fixture.id === "goal-stopped-by-budget"),
    ).toMatchObject({
      assertions: expect.arrayContaining([
        {
          type: "goal_stopped",
          payload: {
            status: "stopped_budget",
            budgetStopBeforeDispatch: true,
          },
          after: "checkpoint_written",
        },
      ]),
    });
    expect(
      fixtures.find((fixture) => fixture.id === "goal-review-gate-blocks"),
    ).toMatchObject({
      assertions: expect.arrayContaining([
        {
          type: "goal_review_requested",
          payload: { reviewPolicy: "review_each_milestone" },
          after: "acceptance_checked",
        },
        {
          type: "milestone_started",
          payload: { milestoneId: "milestone_after_review" },
          after: "goal_review_requested",
        },
      ]),
    });
    expect(
      fixtures.find(
        (fixture) =>
          fixture.id === "goal-context-compaction-preserves-anchors",
      ),
    ).toMatchObject({
      assertions: expect.arrayContaining([
        {
          type: "context_compacted",
          payload: { anchorsPreserved: true },
          after: "goal_planned",
        },
      ]),
    });
    expect(
      fixtures.find(
        (fixture) =>
          fixture.id === "goal-transcript-judge-before-acceptance",
      ),
    ).toMatchObject({
      requiredEventTypes: expect.arrayContaining([
        "goal_judged",
        "acceptance_checked",
      ]),
      assertions: expect.arrayContaining([
        {
          type: "goal_judged",
          payload: { ok: true, impossible: false },
          after: "final_summary",
        },
        {
          type: "acceptance_checked",
          payload: { accepted: true },
          after: "goal_judged",
        },
      ]),
    });
  });

  it("includes workspace isolation, native code engineering, and multi-agent lineage fixtures", () => {
    const fixtures = createAgentEvalFixtures();

    expect(fixtures.map((fixture) => fixture.id)).toEqual(
      expect.arrayContaining([
        "workspace-escape-denied",
        "code-engineering-native-tools",
        "reflection-after-test-failure",
        "reflection-retry-budget-exhausted",
        "context-compaction-before-model-request",
        "tool-result-checkpoint-before-next-tool",
        "model-retry-before-response",
        "episode-eval-candidate",
        "research-writing-native-tools",
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
      fixtures.find((fixture) => fixture.id === "research-writing-native-tools"),
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
      fixtures.find((fixture) => fixture.id === "reflection-after-test-failure"),
    ).toMatchObject({
      requiredEventTypes: [
        "tool_call",
        "tool_result",
        "reflection_added",
        "final_summary",
      ],
      assertions: expect.arrayContaining([
        {
          type: "final_summary",
          payload: { status: "succeeded" },
          after: "reflection_added",
        },
      ]),
    });
    expect(
      fixtures.find(
        (fixture) => fixture.id === "reflection-retry-budget-exhausted",
      ),
    ).toMatchObject({
      requiredEventTypes: [
        "tool_call",
        "tool_result",
        "reflection_added",
        "failure_classified",
      ],
      assertions: expect.arrayContaining([
        {
          type: "reflection_added",
          payload: { failureClass: "budget_exhausted" },
          after: "tool_result",
        },
        {
          type: "failure_classified",
          payload: { reflectionFailureClass: "budget_exhausted" },
          after: "reflection_added",
        },
      ]),
    });
    expect(
      fixtures.find(
        (fixture) => fixture.id === "context-compaction-before-model-request",
      ),
    ).toMatchObject({
      requiredEventTypes: [
        "context_compacted",
        "model_request",
        "model_response",
        "final_summary",
      ],
      assertions: expect.arrayContaining([
        {
          type: "model_request",
          after: "context_compacted",
        },
      ]),
    });
    expect(
      fixtures.find(
        (fixture) => fixture.id === "tool-result-checkpoint-before-next-tool",
      ),
    ).toMatchObject({
      requiredEventTypes: [
        "tool_call",
        "tool_result",
        "checkpoint_written",
        "final_summary",
      ],
      assertions: expect.arrayContaining([
        {
          type: "checkpoint_written",
          payload: { toolCallCount: 1 },
          after: "tool_result",
        },
        {
          type: "checkpoint_written",
          payload: { toolCallCount: 2 },
          after: "tool_result",
        },
      ]),
    });
    expect(
      fixtures.find((fixture) => fixture.id === "model-retry-before-response"),
    ).toMatchObject({
      requiredEventTypes: [
        "model_request",
        "model_retry",
        "model_response",
        "final_summary",
      ],
      assertions: expect.arrayContaining([
        {
          type: "model_retry",
          payload: { attempt: 1, maxRetries: 2 },
          after: "model_request",
        },
        {
          type: "model_response",
          after: "model_retry",
        },
      ]),
    });
    expect(
      fixtures.find((fixture) => fixture.id === "multi-agent-lineage"),
    ).toMatchObject({
      requiredEventTypes: [
        "run_context_created",
        "child_handoff_created",
        "child_run_scheduled",
        "child_handoff_completed",
        "child_handoff_reviewed",
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
