import { describe, expect, it } from "vitest";
import type {
  ToolApprovalDecisionPayload,
  ToolApprovalRequestPayload,
} from "../shared/toolApproval";
import {
  applyToolApprovalProjectionEvent,
  createToolApprovalProjectionState,
} from "./toolApprovalProjection";

describe("tool approval projection", () => {
  it("restores a pending request from a subscribe-first snapshot", () => {
    const state = applyToolApprovalProjectionEvent(
      createToolApprovalProjectionState(),
      { type: "snapshot", requests: [request("approval-1")] },
    );
    expect(state.pending.map((entry) => entry.id)).toEqual(["approval-1"]);
  });

  it("does not resurrect a decision when a stale snapshot arrives later", () => {
    let state = applyToolApprovalProjectionEvent(
      createToolApprovalProjectionState(),
      { type: "decision", decision: decision("approval-1") },
    );
    state = applyToolApprovalProjectionEvent(state, {
      type: "snapshot",
      requests: [request("approval-1")],
    });
    expect(state.pending).toEqual([]);
    expect(state.terminalRevisionById["approval-1"]).toBe(2);
  });

  it("merges a request published after snapshot capture without dropping it", () => {
    let state = createToolApprovalProjectionState();
    state = applyToolApprovalProjectionEvent(state, {
      type: "request",
      request: request("approval-new"),
    });
    state = applyToolApprovalProjectionEvent(state, {
      type: "snapshot",
      requests: [request("approval-old")],
    });
    expect(state.pending.map((entry) => entry.id)).toEqual([
      "approval-new",
      "approval-old",
    ]);
  });
});

function request(id: string): ToolApprovalRequestPayload {
  return {
    id,
    revision: 1,
    taskId: "task-1",
    taskName: "Safe task",
    request: { toolName: "file_read", args: { path: "/tmp/a" } },
    deniedReason: "approval required",
    argsSummary: { path: "/tmp/a" },
    risk: {
      level: "normal",
      reason: "local read",
      category: "none",
      requiresConfirmation: false,
      affectedTargets: [],
    },
    createdAt: "2026-08-18T00:00:00.000Z",
  };
}

function decision(id: string): ToolApprovalDecisionPayload {
  return {
    id,
    revision: 2,
    decisionId: `decision:${id}`,
    taskId: "task-1",
    taskName: "Safe task",
    toolName: "file_read",
    approved: false,
    automatic: false,
    risk: request(id).risk,
    createdAt: "2026-08-18T00:00:01.000Z",
  };
}
