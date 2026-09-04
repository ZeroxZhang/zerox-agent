import { ChatSessionGoalSummary, ChatTaskStatusEvent, SendChatMessageInput, SendChatMessageResult } from "../../shared/chat";
import { ChatServiceOptions, ChatTurnInternalOptions, SendChatMessageRuntimeOptions } from "../chatService";
import { createLegacyPersistStage } from "./legacyPersistStage";
import { appendRawHistoryEntry } from "./modulemessages";
import { extractExplicitGoalAmendmentObjective, formatLockedPlanReply, formatPlanContinuationReply, isAbortError } from "./moduleruntime";
import { createChatStatusEmitter, getNowMs } from "./streamingStatus";

export type LegacyPlanInputStageRt = {
  options: ChatServiceOptions;
  sessionId: () => string;
  requestId: string;
  activeGoal: () => ChatSessionGoalSummary | null;
  chatRunContext: () => { workspaceId?: string | null } | null;
  userMessage: Parameters<typeof extractExplicitGoalAmendmentObjective>[0];
  modelUserMessage: Parameters<NonNullable<ChatServiceOptions["planService"]>["continueWithInput"]>[1];
  preexistingInputRoutingPlan: Awaited<ReturnType<NonNullable<ChatServiceOptions["planService"]>["getInputRoutingPlan"]>> | null;
  input: SendChatMessageInput;
  runtimeOptions: SendChatMessageRuntimeOptions;
  createId: () => string;
  internalOptions: ChatTurnInternalOptions;
  planService: NonNullable<ChatServiceOptions["planService"]>;
  emitStatus: ReturnType<typeof createChatStatusEmitter>;
  persistStage: ReturnType<typeof createLegacyPersistStage>;
  emitTerminalStreamEvent: (event: { type: "completed" | "failed" | "canceled"; message?: string; finalMessageId?: string; domainStateAvailable?: false }) => Promise<void>;
};

export const legacyPlanInputContinue = Symbol("legacy-plan-input-continue");

export function createLegacyPlanInputStage(rt: LegacyPlanInputStageRt) {
  async function run(): Promise<SendChatMessageResult | typeof legacyPlanInputContinue> {
        const inputRoutingPlan =
          rt.preexistingInputRoutingPlan ??
          (await rt.planService.getInputRoutingPlan(rt.sessionId()));
        if (inputRoutingPlan) {
          if (rt.internalOptions.skipUserMessageAppend) {
            const reply =
              "当前会话已进入只读 Plan Mode，这个更早的 Skill 输入已作废；没有启动 Skill、普通 Agent 或写入工具。请直接在 Plan 输入框补充要求。";
            await rt.emitStatus.sendRequired({
              state: "paused",
              message: "旧 Skill 输入已作废，当前会话保持只读规划",
              toolCallsExecuted: 0,
            });
            await rt.persistStage.persistAssistantReply({
              content: reply,
              goalEventRef: `plan-invalidated-skill-input:${inputRoutingPlan.id}:${inputRoutingPlan.revision}`,
              settlementStatus: "paused",
            });
            return {
              ok: true,
              reply,
              sessionId: rt.sessionId(),
              relatedMemories: [],
              memoryId: null,
              turnSettlementStatus: "paused",
              plan: inputRoutingPlan,
            };
          }
          const amendmentObjective = extractExplicitGoalAmendmentObjective(
            rt.userMessage,
          );
          if (
            amendmentObjective &&
            inputRoutingPlan.purpose === "runtime_replan" &&
            inputRoutingPlan.goalId
          ) {
            if (!rt.options.proposeGoalAmendment) {
              return {
                ok: false,
                message: "当前运行时未启用受控 Goal 修订服务。",
              };
            }
            rt.emitStatus.send({
              state: "reasoning",
              message: "正在创建目标修订提案，当前 Goal 和活动 Plan 保持不变",
              toolCallsExecuted: 0,
            });
            const amendment = await rt.options.proposeGoalAmendment(
              inputRoutingPlan.goalId,
              amendmentObjective,
              rt.userMessage,
            );
            if (!amendment.ok) {
              rt.emitStatus.send({
                state: "failed",
                message: amendment.message,
                toolCallsExecuted: 0,
              });
              await rt.emitTerminalStreamEvent({
                type: "failed",
                message: amendment.message,
              });
              return { ok: false, message: amendment.message };
            }
            const reply = `${amendment.message} 当前 Goal 和活动 Plan 尚未改变；请在 Goal 详情中批准或拒绝。`;
            await rt.emitStatus.sendRequired({
              state: "paused",
              message: "目标修订提案等待明确批准",
              toolCallsExecuted: 0,
            });
            await rt.persistStage.persistAssistantReply({
              content: reply,
              goalEventRef: `goal-amendment:${amendment.proposal.id}`,
              settlementStatus: "paused",
            });
            appendRawHistoryEntry({
              historyIndexStore: rt.options.historyIndexStore,
              createId: rt.createId,
              sessionId: rt.sessionId(),
              requestId: rt.requestId,
              role: "assistant",
              content: reply,
              workspaceId: rt.chatRunContext()?.workspaceId ?? rt.input.workspaceId,
              createdAt: new Date(getNowMs(rt.options.now)).toISOString(),
            });
            return {
              ok: true,
              reply,
              sessionId: rt.sessionId(),
              relatedMemories: [],
              memoryId: null,
              turnSettlementStatus: "paused",
              plan: inputRoutingPlan,
              ...(rt.activeGoal()?.id === inputRoutingPlan.goalId
                ? { activeGoal: rt.activeGoal() ?? undefined }
                : {}),
            };
          }
          const canRevisePlan =
            inputRoutingPlan.status === "awaiting_input" ||
            inputRoutingPlan.status === "awaiting_confirmation" ||
            (inputRoutingPlan.status === "paused" &&
              Boolean(inputRoutingPlan.finalArtifact));
          if (!canRevisePlan) {
            const reply = formatLockedPlanReply(inputRoutingPlan);
            await rt.emitStatus.sendRequired({
              state: "paused",
              message: "计划仍处于只读状态，请先处理计划恢复入口",
              toolCallsExecuted: 0,
            });
            await rt.persistStage.persistAssistantReply({
              content: reply,
              goalEventRef: `plan-locked:${inputRoutingPlan.id}:${inputRoutingPlan.revision}`,
              settlementStatus: "paused",
            });
            return {
              ok: true,
              reply,
              sessionId: rt.sessionId(),
              relatedMemories: [],
              memoryId: null,
              turnSettlementStatus: "paused",
              plan: inputRoutingPlan,
            };
          }
          rt.emitStatus.send({
            state: "reasoning",
            message: "正在把补充或修改意见纳入只读计划并重新执行规划辩论",
            toolCallsExecuted: 0,
          });
          let continuation;
          try {
            continuation = await rt.planService.continueWithInput(
              inputRoutingPlan.id,
              rt.modelUserMessage,
              rt.runtimeOptions.signal,
              rt.input.planAutonomyMode,
            );
          } catch (error) {
            if (isAbortError(error, rt.runtimeOptions.signal)) {
              rt.emitStatus.send({
                state: "canceled",
                message: "规划已中断",
                toolCallsExecuted: 0,
              });
              await rt.emitTerminalStreamEvent({
                type: "canceled",
                message: "已中断任务。",
              });
              return { ok: false, code: "CANCELED", retryable: true, message: "已中断任务。" };
            }
            const message = "继续规划失败，已安全停止。";
            rt.emitStatus.send({
              state: "failed",
              message,
              toolCallsExecuted: 0,
            });
            await rt.emitTerminalStreamEvent({ type: "failed", message });
            return { ok: false, message };
          }
          if (!continuation.ok) {
            rt.emitStatus.send({
              state: "failed",
              message: continuation.message,
              toolCallsExecuted: 0,
            });
            await rt.emitTerminalStreamEvent({
              type: "failed",
              message: continuation.message,
            });
            return { ok: false, message: continuation.message };
          }
          const plan = continuation.plan;
          const reply = formatPlanContinuationReply(plan);
          const planContinuationState =
            plan.status === "awaiting_confirmation" ? "completed" : "paused";
          const planContinuationEvent: Omit<
            ChatTaskStatusEvent,
            "sessionId" | "createdAt" | "elapsedMs"
          > = {
            state: planContinuationState,
            message:
              plan.status === "awaiting_confirmation"
                ? "计划已更新，等待确认"
                : "计划仍需补充信息或处理门禁",
            toolCallsExecuted: 0,
          };
          if (planContinuationState === "paused") {
            await rt.emitStatus.sendRequired(planContinuationEvent);
          } else {
            rt.emitStatus.send(planContinuationEvent);
          }
          await rt.persistStage.persistAssistantReply({
            content: reply,
            goalEventRef: `plan-input:${plan.id}:${plan.revision}`,
            settlementStatus:
              plan.status === "awaiting_confirmation" ? "succeeded" : "paused",
          });
          appendRawHistoryEntry({
            historyIndexStore: rt.options.historyIndexStore,
            createId: rt.createId,
            sessionId: rt.sessionId(),
            requestId: rt.requestId,
            role: "assistant",
            content: reply,
            workspaceId: rt.chatRunContext()?.workspaceId ?? rt.input.workspaceId,
            createdAt: new Date(getNowMs(rt.options.now)).toISOString(),
          });
          return {
            ok: true,
            reply,
            sessionId: rt.sessionId(),
            relatedMemories: [],
            memoryId: null,
            turnSettlementStatus:
              plan.status === "awaiting_confirmation" ? "succeeded" : "paused",
            plan,
          };
        }
      return legacyPlanInputContinue;
  }
  return { run };
}