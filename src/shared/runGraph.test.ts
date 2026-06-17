import { describe, expect, test } from "vitest";
import { KERNEL_EVENT_VERSION, type KernelEvent } from "./kernelContract";
import { projectRunGraph, type RunGraphView } from "./runGraph";
import type { AgentRunRecord } from "./agentRuns";
import type { AgentTrajectoryEvent } from "./agentTrajectory";

const baseTime = "2026-06-17T00:00:00.000Z";

describe("projectRunGraph", () => {
  test("projects runtime, turn, tool, checkpoint, and summary nodes from trajectory and kernel events", () => {
    const graph = projectRunGraph({
      run: createRun(),
      trajectoryEvents: [
        trajectory("event_model", 2, "model_request", { turn: 0 }),
        trajectory("event_tool_call", 4, "tool_call", {
          toolCallId: "call_1",
          toolName: "file_read",
        }),
        trajectory("event_tool_result", 5, "tool_result", {
          toolCallId: "call_1",
          toolName: "file_read",
          ok: true,
        }),
        trajectory("event_checkpoint", 6, "checkpoint_written", {
          checkpointId: "checkpoint_1",
          status: "running",
        }),
        trajectory("event_summary", 7, "final_summary", {
          status: "succeeded",
          summary: "Read the file.",
        }),
      ],
      kernelEvents: [
        {
          v: KERNEL_EVENT_VERSION,
          type: "turn_start",
          runId: "run_1",
          turn: 1,
          maxTurns: 4,
          createdAt: baseTime,
        },
        {
          v: KERNEL_EVENT_VERSION,
          type: "run_end",
          runId: "run_1",
          status: "succeeded",
          reason: "final summary",
          createdAt: baseTime,
        },
      ],
    });

    expect(nodeKinds(graph)).toEqual([
      "runtime_run",
      "turn",
      "model_request",
      "tool_call",
      "checkpoint",
      "summary",
    ]);
    expect(graph.nodes.find((node) => node.id === "tool:call_1")).toMatchObject({
      kind: "tool_call",
      status: "succeeded",
      title: "file_read",
      result: {
        status: "succeeded",
        evidenceRefs: ["trajectory:event_tool_result"],
      },
    });
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        {
          id: "edge:run:run_1:contains:tool:call_1",
          fromNodeId: "run:run_1",
          toNodeId: "tool:call_1",
          relation: "contains",
        },
        {
          id: "edge:tool:call_1:produced:checkpoint:checkpoint_1",
          fromNodeId: "tool:call_1",
          toNodeId: "checkpoint:checkpoint_1",
          relation: "produced",
        },
      ]),
    );
  });

  test("projects review, acceptance, and workspace sandbox gates from trajectory evidence", () => {
    const graph = projectRunGraph({
      run: createRun({ status: "paused" }),
      trajectoryEvents: [
        trajectory("event_goal_review", 1, "goal_review_requested", {
          goalId: "goal_1",
          milestoneId: "milestone_1",
        }),
        trajectory("event_acceptance", 2, "acceptance_checked", {
          goalId: "goal_1",
          milestoneId: "milestone_1",
          accepted: false,
          checkId: "check_release_notes",
        }),
        trajectory("event_escape", 3, "workspace_escape_denied", {
          toolName: "file_write",
          path: "/tmp/outside/report.md",
          reason: "path outside workspace",
        }),
      ],
      kernelEvents: [],
    });

    expect(graph.gates).toEqual([
      {
        id: "gate:goal_review:goal_1:milestone_1",
        kind: "goal_review",
        status: "waiting",
        title: "Goal review requested",
        sourceRefs: ["trajectory:event_goal_review"],
      },
      {
        id: "gate:acceptance:check_release_notes",
        kind: "acceptance",
        status: "blocked",
        title: "Acceptance check failed",
        sourceRefs: ["trajectory:event_acceptance"],
      },
      {
        id: "gate:workspace_sandbox:event_escape",
        kind: "workspace_sandbox",
        status: "blocked",
        title: "Workspace sandbox denied file_write",
        sourceRefs: ["trajectory:event_escape"],
      },
    ]);
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        {
          id: "edge:run:run_1:blocked_by:gate:workspace_sandbox:event_escape",
          fromNodeId: "run:run_1",
          toNodeId: "gate:workspace_sandbox:event_escape",
          relation: "blocked_by",
        },
      ]),
    );
    expect(expectDanglingEdges(graph)).toEqual([]);
  });

  test("matches goal-runtime tool results that do not include toolCallId", () => {
    const graph = projectRunGraph({
      run: createRun(),
      trajectoryEvents: [
        trajectory("event_tool_call", 1, "tool_call", {
          toolName: "file_write",
        }),
        trajectory("event_tool_result", 2, "tool_result", {
          toolName: "file_write",
          ok: true,
        }),
        trajectory("event_checkpoint", 3, "checkpoint_written", {
          checkpointId: "checkpoint_after_write",
        }),
      ],
      kernelEvents: [],
    });

    expect(graph.nodes.find((node) => node.id === "tool:event_tool_call")).toMatchObject({
      kind: "tool_call",
      status: "succeeded",
      result: {
        status: "succeeded",
        evidenceRefs: ["trajectory:event_tool_result"],
      },
    });
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        {
          id: "edge:tool:event_tool_call:produced:checkpoint:checkpoint_after_write",
          fromNodeId: "tool:event_tool_call",
          toNodeId: "checkpoint:checkpoint_after_write",
          relation: "produced",
        },
      ]),
    );
    expect(expectDanglingEdges(graph)).toEqual([]);
  });

  test("ignores unrelated run events and keeps same-millisecond kernel evidence distinct", () => {
    const graph = projectRunGraph({
      run: createRun({ status: "running" }),
      trajectoryEvents: [
        trajectory("event_model", 1, "model_request", { turn: 1 }),
        trajectory(
          "event_other_escape",
          2,
          "workspace_escape_denied",
          {
            toolName: "file_write",
          },
          "run_other",
        ),
      ],
      kernelEvents: [
        kernelTurnStart(1),
        kernelTurnStart(2),
        {
          v: KERNEL_EVENT_VERSION,
          type: "run_end",
          runId: "run_other",
          status: "failed",
          reason: "other run failed",
          createdAt: baseTime,
        },
      ],
    });

    expect(graph.gates).toEqual([]);
    expect(graph.nodes.find((node) => node.id === "run:run_1")).toMatchObject({
      status: "running",
    });
    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "turn:1" }),
        expect.objectContaining({ id: "turn:2" }),
      ]),
    );
    expect(
      graph.evidence.filter((item) => item.source === "kernel").map((item) => item.ref),
    ).toHaveLength(2);
    expect(new Set(graph.evidence.map((item) => item.ref)).size).toBe(
      graph.evidence.length,
    );
    expect(expectDanglingEdges(graph)).toEqual([]);
  });

  test("projects goal and milestone nodes with stable dependency edges", () => {
    const graph = projectRunGraph({
      run: createRun({ taskId: "goal:goal_1", taskName: "Release prep" }),
      trajectoryEvents: [
        trajectory("event_goal", 1, "goal_planned", {
          goalId: "goal_1",
          description: "Release prep",
        }),
        trajectory("event_milestone", 2, "milestone_started", {
          goalId: "goal_1",
          milestoneId: "milestone_research",
          description: "Collect local evidence",
        }),
      ],
      kernelEvents: [],
    });

    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "goal:goal_1",
          kind: "goal",
          status: "planned",
          title: "Release prep",
        }),
        expect.objectContaining({
          id: "milestone:milestone_research",
          kind: "milestone",
          status: "running",
          title: "Collect local evidence",
        }),
      ]),
    );
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        {
          id: "edge:goal:goal_1:contains:milestone:milestone_research",
          fromNodeId: "goal:goal_1",
          toNodeId: "milestone:milestone_research",
          relation: "contains",
        },
        {
          id: "edge:run:run_1:contains:goal:goal_1",
          fromNodeId: "run:run_1",
          toNodeId: "goal:goal_1",
          relation: "contains",
        },
      ]),
    );
  });
});

function nodeKinds(graph: RunGraphView) {
  return graph.nodes.map((node) => node.kind);
}

function expectDanglingEdges(graph: RunGraphView) {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  return graph.edges.filter(
    (edge) => !nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId),
  );
}

function createRun(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
  return {
    id: "run_1",
    taskId: "task_1",
    taskName: "Read file",
    skillName: "local-file-organizer",
    status: "succeeded",
    summary: "Read the file.",
    events: [],
    startedAt: baseTime,
    finishedAt: baseTime,
    ...overrides,
  };
}

function trajectory(
  id: string,
  sequence: number,
  type: AgentTrajectoryEvent["type"],
  payload: Record<string, unknown>,
  runId = "run_1",
): AgentTrajectoryEvent {
  return {
    id,
    runId,
    type,
    sequence,
    payload,
    redaction: {
      containsApiKey: false,
      containsFileContent: false,
      containsUserText: false,
    },
    createdAt: baseTime,
  };
}

function kernelTurnStart(turn: number): KernelEvent {
  return {
    v: KERNEL_EVENT_VERSION,
    type: "turn_start",
    runId: "run_1",
    turn,
    maxTurns: 4,
    createdAt: baseTime,
  };
}
