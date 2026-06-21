import { describe, expect, it } from "vitest";
import { createToolApprovalCoordinator } from "./toolApprovalCoordinator";
import type { ToolUserApprovalRequest } from "./toolAuthorizationService";

describe("tool approval coordinator", () => {
  it("routes approval requests to the renderer instead of a native global dialog", async () => {
    const sent: Array<{ channel: string; payload: unknown }> = [];
    const coordinator = createToolApprovalCoordinator({
      createId: () => "approval_1",
      now: () => "2026-06-14T12:00:00.000Z",
      sendToRenderers(channel, payload) {
        sent.push({ channel, payload });
      },
    });

    const approval = coordinator.requestUserApproval(createRequest());

    expect(sent).toEqual([
      {
        channel: "toolApproval:request",
        payload: expect.objectContaining({
          id: "approval_1",
          taskName: "Goal milestone",
          deniedReason: "web_fetch URL 域名不在允许列表内。",
          risk: {
            level: "high",
            reason: "web_fetch can transmit browsing context to an external host.",
          },
          argsSummary: {
            url: "https://example.com/source",
          },
        }),
      },
    ]);

    expect(
      coordinator.resolveApproval({
        id: "approval_1",
        approved: true,
      }),
    ).toBe(true);
    await expect(approval).resolves.toEqual({
      approved: true,
      reason: "用户已在应用内授权本次 web_fetch。",
    });
  });

  it("auto-approves requests and emits critical risk decisions for monitoring", async () => {
    const sent: Array<{ channel: string; payload: unknown }> = [];
    const coordinator = createToolApprovalCoordinator({
      createId: () => "approval_shell",
      now: () => "2026-06-14T12:00:00.000Z",
      sendToRenderers(channel, payload) {
        sent.push({ channel, payload });
      },
    });

    coordinator.setAutoApprovalEnabled(true);
    await expect(
      coordinator.requestUserApproval({
        ...createRequest(),
        deniedReason: "shell_exec command 不匹配已授权模板。",
        request: {
          toolName: "shell_exec",
          args: { command: "rm -rf /tmp/report-cache" },
        },
      }),
    ).resolves.toEqual({
      approved: true,
      reason: "自动授权已开启，已同意本次 shell_exec。",
      automatic: true,
    });

    expect(sent).toContainEqual({
      channel: "toolApproval:decision",
      payload: expect.objectContaining({
        id: "approval_shell",
        approved: true,
        automatic: true,
        risk: {
          level: "critical",
          reason: "shell_exec can mutate the local machine outside normal app flows.",
        },
      }),
    });
  });

  it("approves a pending in-app request when auto approval is enabled", async () => {
    const sent: Array<{ channel: string; payload: unknown }> = [];
    const coordinator = createToolApprovalCoordinator({
      createId: () => "approval_waiting",
      now: () => "2026-06-14T12:00:00.000Z",
      sendToRenderers(channel, payload) {
        sent.push({ channel, payload });
      },
    });

    const approval = coordinator.requestUserApproval(createRequest());

    expect(sent).toContainEqual({
      channel: "toolApproval:request",
      payload: expect.objectContaining({ id: "approval_waiting" }),
    });

    coordinator.setAutoApprovalEnabled(true);

    await expect(approval).resolves.toEqual({
      approved: true,
      reason: "自动授权已开启，已同意本次 web_fetch。",
      automatic: true,
    });
    expect(sent).toContainEqual({
      channel: "toolApproval:decision",
      payload: expect.objectContaining({
        id: "approval_waiting",
        approved: true,
        automatic: true,
      }),
    });
  });
});

function createRequest(): ToolUserApprovalRequest {
  return {
    taskId: "goal:goal_1",
    taskName: "Goal milestone",
    deniedReason: "web_fetch URL 域名不在允许列表内。",
    request: {
      toolName: "web_fetch",
      args: { url: "https://example.com/source" },
    },
  };
}
