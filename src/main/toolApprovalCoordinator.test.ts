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
            level: "normal",
            reason:
              "The operation is not in the Policy B forced-confirmation class.",
            category: "none",
            requiresConfirmation: false,
            affectedTargets: [],
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

  it("auto-approves read-only tool requests and emits risk decisions for monitoring", async () => {
    const sent: Array<{ channel: string; payload: unknown }> = [];
    const coordinator = createToolApprovalCoordinator({
      createId: () => "approval_read",
      now: () => "2026-06-14T12:00:00.000Z",
      sendToRenderers(channel, payload) {
        sent.push({ channel, payload });
      },
    });

    coordinator.setAutoApprovalEnabled(true);
    await expect(
      coordinator.requestUserApproval({
        ...createRequest(),
        deniedReason: "file_read 路径不在允许列表内。",
        request: {
          toolName: "file_read",
          args: { path: "/tmp/report.txt" },
        },
      }),
    ).resolves.toEqual({
      approved: true,
      reason: "自动授权已开启，已同意本次 file_read (只读工具)。",
      automatic: true,
    });

    expect(sent).toContainEqual({
      channel: "toolApproval:decision",
      payload: expect.objectContaining({
        id: "approval_read",
        approved: true,
        automatic: true,
      }),
    });
  });

  it("approves a pending read-only request when auto approval is enabled", async () => {
    const sent: Array<{ channel: string; payload: unknown }> = [];
    const coordinator = createToolApprovalCoordinator({
      createId: () => "approval_waiting",
      now: () => "2026-06-14T12:00:00.000Z",
      sendToRenderers(channel, payload) {
        sent.push({ channel, payload });
      },
    });

    // Use a read-only tool so it gets auto-approved when auto-approval is enabled.
    const approval = coordinator.requestUserApproval({
      ...createRequest(),
      request: {
        toolName: "file_list",
        args: { path: "/tmp" },
      },
    });

    expect(sent).toContainEqual({
      channel: "toolApproval:request",
      payload: expect.objectContaining({ id: "approval_waiting" }),
    });

    coordinator.setAutoApprovalEnabled(true);

    await expect(approval).resolves.toEqual({
      approved: true,
      reason: "自动授权已开启，已同意本次 file_list (只读工具)。",
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
