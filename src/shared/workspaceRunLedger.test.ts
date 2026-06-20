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
});
