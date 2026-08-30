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

  it("preserves the durable approval id across history and Workspace projection", () => {
    const proposed = createToolInvocation({
      id: "tool_invocation_approval",
      runId: "trajectory_run_1",
      toolCallId: "call_approval",
      toolName: "shell_exec",
      source: "built-in",
      args: { command: "npm test" },
      createdAt: "2026-08-18T00:00:00.000Z",
    });
    const waiting = transitionToolInvocation(proposed, {
      status: "waiting_approval",
      approvalId: "approval_durable_1",
      at: "2026-08-18T00:00:01.000Z",
    });

    expect(waiting).toMatchObject({
      approvalId: "approval_durable_1",
      history: [
        expect.objectContaining({ status: "proposed" }),
        expect.objectContaining({
          status: "waiting_approval",
          approvalId: "approval_durable_1",
        }),
      ],
    });
    expect(toWorkspaceRunToolInvocationInput(waiting)).toMatchObject({
      approvalId: "approval_durable_1",
      payload: {
        runId: "trajectory_run_1",
        history: expect.arrayContaining([
          expect.objectContaining({ approvalId: "approval_durable_1" }),
        ]),
      },
    });
  });

  it("redacts credentials before args, reasons, and errors enter the durable ledger", () => {
    const canaries = [
      "ledger-key-canary",
      "ledger-bearer-canary",
      "ledger-error-canary",
      "ledger-prefixed-json-canary",
      "ledger-quoted-value-canary",
      "ledger-cli-flag-canary",
      "ledger-encoded-key-canary",
    ];
    const proposed = createToolInvocation({
      id: "tool_invocation_secret_safe",
      runId: "run_secret_safe",
      toolCallId: "call_secret_safe",
      toolName: "shell_exec",
      source: "built-in",
      args: {
        apiKey: canaries[0],
        command:
          `curl -H 'Authorization: Bearer ${canaries[1]}' --api-key ${canaries[5]} `
          + `https://example.test?api%5Fkey=${canaries[6]}`,
      },
      createdAt: "2026-08-24T00:00:00.000Z",
    });
    const failed = transitionToolInvocation(proposed, {
      status: "error",
      at: "2026-08-24T00:00:01.000Z",
      reason: `Bearer ${canaries[1]}`,
      error:
        `api_key=${canaries[2]}; boom {"client\\u005fsecret":"${canaries[3]}"} tail; X-Api-Key: "${canaries[4]}"`,
    });

    const serialized = JSON.stringify({
      failed,
      workspace: toWorkspaceRunToolInvocationInput(failed),
    });
    expect(serialized).toContain("[redacted]");
    for (const canary of canaries) {
      expect(serialized).not.toContain(canary);
    }
  });
});
