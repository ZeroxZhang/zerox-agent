import { describe, expect, it } from "vitest";
import {
  createWorkspaceRunEvent,
  getNextWorkspaceRunEventSeq,
  isWorkspaceRunEventSequenceMonotonic,
  projectChatTrajectoryEvents,
  type WorkspaceRun,
  type WorkspaceRunEvent,
} from "./workspaceRunLedger";

describe("workspace run ledger model", () => {
  const run: WorkspaceRun = {
    workspaceRunId: "workspace_run_1",
    sessionId: "session_1",
    requestId: "request_1",
    workspaceId: "workspace_building_agent",
    status: "running",
    createdAt: "2026-06-21T00:00:00.000Z",
    updatedAt: "2026-06-21T00:00:00.000Z",
    startedAt: "2026-06-21T00:00:00.000Z",
  };

  it("models workspace run identity, status, and timestamps", () => {
    expect(run).toMatchObject({
      workspaceRunId: "workspace_run_1",
      sessionId: "session_1",
      requestId: "request_1",
      workspaceId: "workspace_building_agent",
      status: "running",
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z",
    });
  });

  it("calculates stable monotonic event sequence numbers", () => {
    const first = createWorkspaceRunEvent({
      run,
      input: {
        type: "status",
        status: "running",
        message: "started",
      },
      id: "event_1",
      seq: getNextWorkspaceRunEventSeq([]),
      createdAt: "2026-06-21T00:00:01.000Z",
    });
    const third: WorkspaceRunEvent = {
      ...first,
      id: "event_3",
      seq: 3,
      message: "still running",
      createdAt: "2026-06-21T00:00:03.000Z",
    };

    expect(first.seq).toBe(1);
    expect(third.seq).toBe(3);
    expect(getNextWorkspaceRunEventSeq([first, third])).toBe(4);
    expect(isWorkspaceRunEventSequenceMonotonic([first, third])).toBe(true);
    expect(
      isWorkspaceRunEventSequenceMonotonic([
        first,
        third,
        { ...third, id: "event_duplicate" },
      ]),
    ).toBe(false);
  });

  it("projects chat trajectory events with tool refs and source event ids", () => {
    const call = createWorkspaceRunEvent({
      run,
      input: {
        type: "tool_call",
        toolCallId: "tool_call_1",
        toolName: "shell",
        args: { cmd: "npm test" },
      },
      id: "event_tool_call",
      seq: 1,
      createdAt: "2026-06-21T00:00:01.000Z",
    });
    const result = createWorkspaceRunEvent({
      run,
      input: {
        type: "tool_result",
        toolCallId: "tool_call_1",
        toolName: "shell",
        ok: true,
        resultRef: "tool-result-refs/workspace_run_1_tool_call_1.json",
      },
      id: "event_tool_result",
      seq: 2,
      createdAt: "2026-06-21T00:00:02.000Z",
    });

    const trajectory = projectChatTrajectoryEvents([call, result]);

    expect(trajectory).toHaveLength(2);
    expect(trajectory[1]).toMatchObject({
      workspaceRunId: "workspace_run_1",
      sessionId: "session_1",
      requestId: "request_1",
      type: "tool_result",
      toolCallId: "tool_call_1",
      toolName: "shell",
      resultRef: "tool-result-refs/workspace_run_1_tool_call_1.json",
      sourceEventId: "event_tool_result",
    });
  });

  it("projects v2.8 tool invocation, checkpoint boundary, and memory scope events", () => {
    const invocation = createWorkspaceRunEvent({
      run,
      input: {
        type: "tool_invocation",
        toolInvocationId: "tool_invocation_1",
        toolCallId: "call_1",
        toolName: "skill_load",
        toolSource: "built-in",
        invocationStatus: "waiting_approval",
      },
      id: "event_invocation",
      seq: 1,
      createdAt: "2026-06-25T00:00:01.000Z",
    });
    const boundary = createWorkspaceRunEvent({
      run,
      input: {
        type: "checkpoint_boundary",
        checkpointId: "checkpoint_1",
        strategy: "boundary",
        preservedTailMessages: 12,
        protectedToolResults: ["call_1"],
      },
      id: "event_boundary",
      seq: 2,
      createdAt: "2026-06-25T00:00:02.000Z",
    });
    const memoryScope = createWorkspaceRunEvent({
      run,
      input: {
        type: "memory_scope",
        scopes: ["session:session_1", "workspace:workspace_building_agent"],
        rawHistoryEnabled: true,
      },
      id: "event_memory_scope",
      seq: 3,
      createdAt: "2026-06-25T00:00:03.000Z",
    });

    const trajectory = projectChatTrajectoryEvents([
      invocation,
      boundary,
      memoryScope,
    ]);

    expect(trajectory).toEqual([
      expect.objectContaining({
        type: "tool_invocation",
        toolCallId: "call_1",
        toolName: "skill_load",
        invocationStatus: "waiting_approval",
      }),
      expect.objectContaining({
        type: "checkpoint_boundary",
        checkpointId: "checkpoint_1",
      }),
      expect.objectContaining({
        type: "memory_scope",
        memoryScopes: ["session:session_1", "workspace:workspace_building_agent"],
      }),
    ]);
  });
});
