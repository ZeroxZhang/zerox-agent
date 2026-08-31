import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONVERSATION_CAUSAL_SCHEMA_VERSION } from "../shared/conversationCausalSpine";
import type { ToolApprovalIntent } from "../shared/conversationCausalSpine";
import { createAgentTrajectoryStore } from "./agentTrajectoryStore";
import { createChatSessionStore } from "./chatSessionStore";
import { reconcileInterruptedToolApprovals } from "./interruptedToolApprovalReconciler";
import { createWorkspaceRunStore } from "./workspaceRunStore";

describe("interrupted ToolApproval reconciliation", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })
    ));
  });

  it("idempotently terminates the same invocation in Trajectory Workspace and Chat", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "approval-recovery-"));
    roots.push(root);
    const trajectoryStore = createAgentTrajectoryStore({ configDir: root });
    const workspaceRunStore = createWorkspaceRunStore({ configDir: root });
    let chatId = 0;
    const chatSessionStore = createChatSessionStore({
      configDir: root,
      createId: () => (++chatId === 1 ? "session_1" : `message_${chatId}`),
    });
    const createdAt = "2026-08-31T08:00:00.000Z";
    const decidedAt = "2026-08-31T08:01:00.000Z";
    await chatSessionStore.appendMessage({
      sessionId: "session_1",
      requestId: "request_1",
      role: "user",
      content: "Run one bounded tool.",
    });
    await workspaceRunStore.createRun({
      workspaceRunId: "workspace_1",
      sessionId: "session_1",
      requestId: "request_1",
      createdAt,
    });
    await workspaceRunStore.settleLifecycle({
      workspaceRunId: "workspace_1",
      event: {
        id: "workspace_waiting",
        type: "tool_invocation",
        toolInvocationId: "invocation_1",
        toolCallId: "call_1",
        toolName: "file_list",
        toolSource: "built-in",
        invocationStatus: "waiting_approval",
        approvalId: "approval_1",
        createdAt,
      },
      snapshotStatus: "waiting_for_approval",
    });
    await trajectoryStore.appendNext!("trajectory_1", {
      id: "trajectory_waiting",
      runId: "trajectory_1",
      type: "tool_invocation",
      sequence: 0,
      payload: {
        toolInvocationId: "invocation_1",
        toolCallId: "call_1",
        toolName: "file_list",
        toolSource: "built-in",
        invocationStatus: "waiting_approval",
        approvalId: "approval_1",
      },
      redaction: {
        containsApiKey: false,
        containsFileContent: false,
        containsUserText: false,
      },
      createdAt,
    });
    const approval: ToolApprovalIntent = {
      schemaVersion: CONVERSATION_CAUSAL_SCHEMA_VERSION,
      id: "approval_1",
      revision: 2,
      state: "interrupted",
      requestFingerprint: "fingerprint_1",
      taskId: "task_1",
      taskName: "Task",
      toolName: "file_list",
      safeArgsSummary: { path: "[workspace]" },
      risk: {
        level: "high",
        category: "workspace_escape",
        requiresConfirmation: true,
      },
      causalRef: {
        sessionId: "session_1",
        requestId: "request_1",
        turnId: "turn-request_1",
        trajectoryRunId: "trajectory_1",
        workspaceRunId: "workspace_1",
        toolInvocationId: "invocation_1",
        toolInvocationRunId: "trajectory_1",
        toolInvocationIdentity: {
          id: "invocation_1",
          runId: "trajectory_1",
          toolCallId: "call_1",
          toolName: "file_list",
          source: "built-in",
          createdAt,
        },
      },
      ownerProcessEpoch: "process_old",
      createdAt,
      updatedAt: decidedAt,
      expiresAt: "2026-08-31T08:02:00.000Z",
      decision: {
        decisionId: "startup-interrupt:process_new:approval_1",
        outcome: "interrupted",
        automatic: true,
        reasonCode: "main_process_restarted",
        decidedAt,
      },
    };

    await expect(reconcileInterruptedToolApprovals({
      approvals: [approval],
      trajectoryStore,
      workspaceRunStore,
      chatSessionStore,
    })).resolves.toEqual({
      approvalCount: 1,
      trajectoryCount: 1,
      workspaceCount: 1,
      chatCount: 1,
    });
    const trajectory = await trajectoryStore.list("trajectory_1");
    expect(trajectory.at(-1)?.payload).toMatchObject({
      toolInvocationId: "invocation_1",
      invocationStatus: "aborted",
      approvalId: "approval_1",
      recoveryReason: "main_process_restarted",
    });
    await expect(workspaceRunStore.getRun("workspace_1")).resolves
      .toMatchObject({ status: "canceled" });
    expect((await workspaceRunStore.listEvents("workspace_1")).at(-1))
      .toMatchObject({
        type: "tool_invocation",
        toolInvocationId: "invocation_1",
        invocationStatus: "aborted",
      });
    expect((await chatSessionStore.get("session_1"))?.activity?.statusEvents.at(-1))
      .toMatchObject({
        toolInvocationId: "invocation_1",
        invocationStatus: "aborted",
        approvalId: "approval_1",
      });

    await expect(reconcileInterruptedToolApprovals({
      approvals: [approval],
      trajectoryStore,
      workspaceRunStore,
      chatSessionStore,
    })).resolves.toEqual({
      approvalCount: 1,
      trajectoryCount: 0,
      workspaceCount: 0,
      chatCount: 0,
    });
  });

  it("fails closed when no frozen or persisted invocation identity exists", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "approval-recovery-"));
    roots.push(root);
    const approval = {
      schemaVersion: CONVERSATION_CAUSAL_SCHEMA_VERSION,
      id: "approval_missing",
      revision: 2,
      state: "interrupted",
      requestFingerprint: "fingerprint_missing",
      taskId: "task_missing",
      taskName: "Task",
      toolName: "file_list",
      safeArgsSummary: {},
      risk: {
        level: "high",
        category: "workspace_escape",
        requiresConfirmation: true,
      },
      causalRef: {},
      ownerProcessEpoch: "process_old",
      createdAt: "2026-08-31T08:00:00.000Z",
      updatedAt: "2026-08-31T08:01:00.000Z",
      expiresAt: "2026-08-31T08:02:00.000Z",
      decision: {
        decisionId: "startup-interrupt:process_new:approval_missing",
        outcome: "interrupted",
        automatic: true,
        reasonCode: "main_process_restarted",
        decidedAt: "2026-08-31T08:01:00.000Z",
      },
    } as const satisfies ToolApprovalIntent;
    await expect(reconcileInterruptedToolApprovals({
      approvals: [approval],
      trajectoryStore: createAgentTrajectoryStore({ configDir: root }),
      workspaceRunStore: createWorkspaceRunStore({ configDir: root }),
      chatSessionStore: createChatSessionStore({ configDir: root }),
    })).rejects.toThrow("cannot recover ToolInvocation identity");
  });
});
