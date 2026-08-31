import {
  createConversationRequestFingerprint,
  hasConsistentToolApprovalInvocationIdentity,
  type ToolApprovalIntent,
  type ToolApprovalInvocationIdentity,
} from "../shared/conversationCausalSpine";
import {
  createToolInvocation,
  transitionToolInvocation,
} from "../shared/toolInvocationLedger";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";
import type { ChatTaskStatusEvent } from "../shared/chat";
import type { AgentTrajectoryStore } from "./agentTrajectoryStore";
import type { ChatSessionStore } from "./chatSessionStore";
import type { WorkspaceRunStore } from "./workspaceRunStore";

export type InterruptedToolApprovalReconciliation = Readonly<{
  approvalCount: number;
  trajectoryCount: number;
  workspaceCount: number;
  chatCount: number;
}>;

export async function reconcileInterruptedToolApprovals(options: {
  approvals: readonly ToolApprovalIntent[];
  trajectoryStore: Pick<
    AgentTrajectoryStore,
    "list" | "appendIfAbsent" | "flushShadowWrites"
  >;
  workspaceRunStore: Pick<
    WorkspaceRunStore,
    "getRun" | "listEvents" | "settleLifecycle"
  >;
  chatSessionStore: Pick<
    ChatSessionStore,
    "get" | "appendActivityEvent" | "flush"
  >;
}): Promise<InterruptedToolApprovalReconciliation> {
  let trajectoryCount = 0;
  let workspaceCount = 0;
  let chatCount = 0;
  for (const approval of options.approvals) {
    if (
      approval.state !== "interrupted"
      || approval.decision?.outcome !== "interrupted"
    ) {
      throw new Error(
        `Startup approval reconciliation requires interrupted authority: ${approval.id}`,
      );
    }
    if (!hasConsistentToolApprovalInvocationIdentity(approval.causalRef)) {
      throw new Error(
        `Interrupted approval has inconsistent ToolInvocation identity: ${approval.id}`,
      );
    }
    const identity = await resolveInvocationIdentity(
      approval,
      options.trajectoryStore,
      options.workspaceRunStore,
    );
    const decidedAt = approval.decision.decidedAt;
    const reason = "Main process restarted while tool approval was pending.";
    const terminal = transitionToolInvocation(
      createToolInvocation({
        ...identity,
        args: {},
      }),
      {
        status: "aborted",
        at: decidedAt,
        reason,
        ok: false,
        error: reason,
        approvalId: approval.id,
      },
    );
    const trajectoryRunId = approval.causalRef.trajectoryRunId
      ?? approval.causalRef.toolInvocationRunId
      ?? identity.runId;
    if (trajectoryRunId !== identity.runId) {
      throw new Error(
        `Interrupted approval trajectory owner conflicts with ToolInvocation: ${approval.id}`,
      );
    }
    const existingTrajectory = await options.trajectoryStore.list(
      trajectoryRunId,
    );
    const priorTrajectory = [...existingTrajectory].reverse().find(
      (event) => event.payload.toolInvocationId === identity.id,
    );
    const publicationKey = `startup-approval-interruption:${approval.id}`;
    const trajectoryResult = await options.trajectoryStore.appendIfAbsent(
      trajectoryRunId,
      publicationKey,
      {
        id: `trajectory_${recoveryFingerprint(approval, "trajectory")}`,
        runId: trajectoryRunId,
        type: "tool_invocation",
        sequence: 0,
        ...(priorTrajectory?.runContext
          ? { runContext: priorTrajectory.runContext }
          : {}),
        payload: {
          publicationKey,
          toolInvocationId: terminal.id,
          toolCallId: terminal.toolCallId,
          toolName: terminal.toolName,
          toolSource: terminal.source,
          invocationStatus: terminal.status,
          ok: false,
          error: terminal.error,
          approvalId: approval.id,
          history: terminal.history,
          recoveryReason: "main_process_restarted",
        },
        redaction: {
          containsApiKey: false,
          containsFileContent: false,
          containsUserText: false,
        },
        createdAt: decidedAt,
      },
    );
    assertAbortedTrajectory(trajectoryResult.event, identity, approval.id);
    if (trajectoryResult.appended) trajectoryCount += 1;

    const workspaceRunId = approval.causalRef.workspaceRunId;
    if (workspaceRunId) {
      const workspaceRun = await options.workspaceRunStore.getRun(workspaceRunId);
      if (!workspaceRun) {
        throw new Error(
          `Interrupted approval workspace owner is missing: ${approval.id}`,
        );
      }
      const workspaceEventId =
        `workspace_${recoveryFingerprint(approval, "workspace")}`;
      const existingWorkspaceEvent = (
        await options.workspaceRunStore.listEvents(workspaceRunId)
      ).find((event) => event.id === workspaceEventId);
      const workspaceResult = await options.workspaceRunStore.settleLifecycle({
        workspaceRunId,
        event: {
          id: workspaceEventId,
          type: "tool_invocation",
          toolInvocationId: terminal.id,
          toolCallId: terminal.toolCallId,
          toolName: terminal.toolName,
          toolSource: terminal.source,
          invocationStatus: "aborted",
          ok: false,
          error: reason,
          approvalId: approval.id,
          message: reason,
          payload: {
            runId: terminal.runId,
            history: terminal.history,
            recoveryReason: "main_process_restarted",
          },
          causalRef: {
            turnId:
              approval.causalRef.turnId
              ?? `turn-${approval.causalRef.requestId ?? approval.id}`,
            sourceSequence: 0,
          },
          createdAt: decidedAt,
        },
        snapshotStatus:
          ["succeeded", "failed", "canceled"].includes(workspaceRun.status)
            ? workspaceRun.status
            : "canceled",
        summary: reason,
      });
      if (
        workspaceResult.event.type !== "tool_invocation"
        || workspaceResult.event.toolInvocationId !== identity.id
        || workspaceResult.event.invocationStatus !== "aborted"
      ) {
        throw new Error(
          `Interrupted approval workspace projection is not aborted: ${approval.id}`,
        );
      }
      if (!existingWorkspaceEvent) workspaceCount += 1;
    }

    const sessionId = approval.causalRef.sessionId;
    if (sessionId) {
      const session = await options.chatSessionStore.get(sessionId);
      if (!session) {
        throw new Error(
          `Interrupted approval Chat owner is missing: ${approval.id}`,
        );
      }
      const settlementId = `startup-approval-interruption:${approval.id}`;
      const existingChatEvent = session.activity?.statusEvents.find(
        (event) => event.settlementId === settlementId,
      );
      if (existingChatEvent) {
        assertAbortedChatEvent(existingChatEvent, identity, approval.id);
      } else {
        const sequence = Math.max(
          0,
          ...(session.activity?.statusEvents.map((event) => event.sequence ?? 0)
            ?? []),
        ) + 1;
        const event: ChatTaskStatusEvent = {
          sessionId,
          settlementId,
          domainStateAvailable: true,
          ...(approval.causalRef.requestId
            ? { requestId: approval.causalRef.requestId }
            : {}),
          sequence,
          ...(approval.causalRef.turnId
            ? { turnId: approval.causalRef.turnId }
            : {}),
          state: "tool_invocation",
          message: reason,
          createdAt: decidedAt,
          elapsedMs: 0,
          toolCallId: identity.toolCallId,
          toolInvocationId: identity.id,
          approvalId: approval.id,
          toolName: identity.toolName,
          toolSource: identity.source,
          invocationStatus: "aborted",
          ok: false,
          payload: { recoveryReason: "main_process_restarted" },
        };
        const updated = await options.chatSessionStore.appendActivityEvent(
          sessionId,
          event,
        );
        if (!updated) {
          throw new Error(
            `Interrupted approval Chat projection could not be persisted: ${approval.id}`,
          );
        }
        chatCount += 1;
      }
    }
  }
  await Promise.all([
    options.trajectoryStore.flushShadowWrites(),
    options.chatSessionStore.flush(),
  ]);
  return {
    approvalCount: options.approvals.length,
    trajectoryCount,
    workspaceCount,
    chatCount,
  };
}

async function resolveInvocationIdentity(
  approval: ToolApprovalIntent,
  trajectoryStore: Pick<AgentTrajectoryStore, "list">,
  workspaceRunStore: Pick<WorkspaceRunStore, "listEvents">,
): Promise<ToolApprovalInvocationIdentity> {
  if (approval.causalRef.toolInvocationIdentity) {
    return approval.causalRef.toolInvocationIdentity;
  }
  const invocationId = approval.causalRef.toolInvocationId;
  const runId = approval.causalRef.toolInvocationRunId
    ?? approval.causalRef.trajectoryRunId;
  if (invocationId && runId) {
    const event = [...await trajectoryStore.list(runId)].reverse().find(
      (candidate) => candidate.payload.toolInvocationId === invocationId,
    );
    if (event) {
      return identityFromProjection(
        invocationId,
        runId,
        event.payload,
        event.createdAt,
      );
    }
  }
  const workspaceRunId = approval.causalRef.workspaceRunId;
  if (invocationId && runId && workspaceRunId) {
    const event = [...await workspaceRunStore.listEvents(workspaceRunId)]
      .reverse().find(
      (candidate) =>
        candidate.type === "tool_invocation"
        && candidate.toolInvocationId === invocationId,
    );
    if (event?.type === "tool_invocation") {
      return {
        id: invocationId,
        runId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        source: event.toolSource ?? "workspace_run",
        createdAt: event.createdAt,
      };
    }
  }
  throw new Error(
    `Interrupted approval cannot recover ToolInvocation identity: ${approval.id}`,
  );
}

function identityFromProjection(
  id: string,
  runId: string,
  payload: Record<string, unknown>,
  createdAt: string,
): ToolApprovalInvocationIdentity {
  const toolCallId = stringField(payload.toolCallId);
  const toolName = stringField(payload.toolName);
  const source = stringField(payload.toolSource);
  if (!toolCallId || !toolName || !source) {
    throw new Error(`ToolInvocation projection identity is incomplete: ${id}`);
  }
  return { id, runId, toolCallId, toolName, source, createdAt };
}

function assertAbortedTrajectory(
  event: AgentTrajectoryEvent,
  identity: ToolApprovalInvocationIdentity,
  approvalId: string,
): void {
  if (
    event.payload.toolInvocationId !== identity.id
    || event.payload.invocationStatus !== "aborted"
    || event.payload.approvalId !== approvalId
  ) {
    throw new Error(
      `Interrupted approval trajectory projection is not aborted: ${approvalId}`,
    );
  }
}

function assertAbortedChatEvent(
  event: ChatTaskStatusEvent,
  identity: ToolApprovalInvocationIdentity,
  approvalId: string,
): void {
  if (
    event.toolInvocationId !== identity.id
    || event.invocationStatus !== "aborted"
    || event.approvalId !== approvalId
  ) {
    throw new Error(
      `Interrupted approval Chat projection is not aborted: ${approvalId}`,
    );
  }
}

function recoveryFingerprint(
  approval: ToolApprovalIntent,
  domain: string,
): string {
  return createConversationRequestFingerprint({
    kind: "startup_tool_approval_interruption",
    approvalId: approval.id,
    approvalRevision: approval.revision,
    domain,
  });
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
