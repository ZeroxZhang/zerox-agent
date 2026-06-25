import { describe, expect, it } from "vitest";
import {
  createToolInvocation,
  transitionToolInvocation,
  toWorkspaceRunToolInvocationInput,
} from "./toolInvocationLedger";

describe("tool invocation ledger", () => {
  it("tracks the full visible-to-completed tool lifecycle", () => {
    const proposed = createToolInvocation({
      id: "tool_invocation_1",
      runId: "run_1",
      toolCallId: "call_1",
      toolName: "file_read",
      source: "built-in",
      args: { path: "/repo/README.md" },
      createdAt: "2026-06-25T00:00:00.000Z",
    });
    const visible = transitionToolInvocation(proposed, {
      status: "visible",
      at: "2026-06-25T00:00:01.000Z",
      reason: "available to chat runtime",
    });
    const authorized = transitionToolInvocation(visible, {
      status: "authorized",
      at: "2026-06-25T00:00:02.000Z",
      reason: "ToolAuthorizationService allowed the call.",
    });
    const running = transitionToolInvocation(authorized, {
      status: "running",
      at: "2026-06-25T00:00:03.000Z",
    });
    const completed = transitionToolInvocation(running, {
      status: "completed",
      at: "2026-06-25T00:00:04.000Z",
      ok: true,
      resultRef: "tool-result-refs/run_1_call_1_file_read.json",
    });

    expect(completed.status).toBe("completed");
    expect(completed.history.map((entry) => entry.status)).toEqual([
      "proposed",
      "visible",
      "authorized",
      "running",
      "completed",
    ]);
    expect(toWorkspaceRunToolInvocationInput(completed)).toMatchObject({
      type: "tool_invocation",
      toolCallId: "call_1",
      toolName: "file_read",
      invocationStatus: "completed",
      ok: true,
      resultRef: "tool-result-refs/run_1_call_1_file_read.json",
    });
  });

  it("rejects illegal status regressions", () => {
    const proposed = createToolInvocation({
      id: "tool_invocation_1",
      runId: "run_1",
      toolCallId: "call_1",
      toolName: "file_read",
      source: "built-in",
      args: {},
      createdAt: "2026-06-25T00:00:00.000Z",
    });
    const completed = transitionToolInvocation(proposed, {
      status: "completed",
      at: "2026-06-25T00:00:01.000Z",
      ok: true,
    });

    expect(() =>
      transitionToolInvocation(completed, {
        status: "running",
        at: "2026-06-25T00:00:02.000Z",
      }),
    ).toThrow(/Cannot transition tool invocation/);
  });
});
