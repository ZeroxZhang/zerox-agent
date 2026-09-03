import { ChatSessionOperationResult } from "../../shared/chat";
import { projectChatSessionForTranscript } from "../../shared/chatSessionProjection";
import { ChatSessionTranscriptPage } from "../../shared/chat";
import { ChatSessionTranscriptPageOptions } from "../../shared/chat";
import { getRecoveryGoalSummary } from "../../shared/chatSessionWork";
import { getActiveGoalSummary } from "../chatService/moduleruntime";
import { ChatSessionRecord } from "../../shared/chat";
import { projectChatSessionTokenUsage } from "../chatSessionUsage";
import { PlanRecord } from "../../shared/planMode";
import { ChatSessionListItem } from "../../shared/chat";
import { isLiveGoalStatus } from "../../shared/chatSessionWork";
import { projectGoalStatusForInteraction } from "../../shared/agentGoal";
import { formatGoalTerminalMessage } from "../container";
import { isTerminalGoalStatus } from "../container";
import { Goal } from "../../shared/agentGoal";
import { ChatSessionGoalSummary } from "../../shared/chat";
import { reconcileIrreversibleGoalProgressEvent } from "./helpers";
import { GoalProgressEvent } from "../../shared/chat";
import { createAgentGoalStore } from "../agentGoalStore";
import { createChatSessionStore } from "../chatSessionStore";
import { createPlanStore } from "../planStore";

/** Outer factory accessors threaded into the chat-session runtime. */
export type ChatSessionsRuntime = {
  agentGoalStore: () => ReturnType<typeof createAgentGoalStore>;
  chatSessionStore: () => ReturnType<typeof createChatSessionStore>;
  planStore: () => ReturnType<typeof createPlanStore>;
};

export function createChatSessionsRuntime(rt: ChatSessionsRuntime) {
  const agentGoalStore = rt.agentGoalStore;
  const chatSessionStore = rt.chatSessionStore;
  const planStore = rt.planStore;
  async function syncGoalProgressToChatSession(event: GoalProgressEvent) {
    if (!event.sessionId) {
      return;
    }

    const goal = await agentGoalStore().get(event.goalId);
    if (!goal) {
      return;
    }

    const reconciledEvent = reconcileIrreversibleGoalProgressEvent(event, goal);
    const syncedGoal =
      goal.status === reconciledEvent.status
        ? goal
        : { ...goal, status: reconciledEvent.status };
    await attachGoalSummaryIfChanged(
      reconciledEvent.sessionId!,
      toChatGoalSummary(syncedGoal),
    );
    await appendGoalTerminalMessageIfNeeded(
      reconciledEvent.sessionId!,
      syncedGoal,
      reconciledEvent,
    );
  }

  async function attachGoalSummaryIfChanged(
    sessionId: string,
    summary: ChatSessionGoalSummary,
  ): Promise<boolean> {
    const session = await chatSessionStore().getMetadata(sessionId);
    if (!session) {
      return false;
    }

    const existingSummary = session.goalSummaries?.find(
      (candidate) => candidate.id === summary.id,
    );
    if (
      existingSummary?.description === summary.description &&
      existingSummary.status === summary.status &&
      Boolean(existingSummary.updatedAt)
    ) {
      await clearActiveChatGoalIfTerminal(sessionId, summary);
      return false;
    }

    await chatSessionStore().attachGoal(sessionId, summary);
    await clearActiveChatGoalIfTerminal(sessionId, summary);
    return true;
  }

  async function clearActiveChatGoalIfTerminal(
    sessionId: string,
    summary: ChatSessionGoalSummary,
  ) {
    if (shouldClearActiveChatGoal(summary.status)) {
      await chatSessionStore().clearActiveGoal(sessionId, summary.id);
    }
  }

  async function appendGoalTerminalMessageIfNeeded(
    sessionId: string,
    goal: Goal,
    event: GoalProgressEvent,
  ) {
    if (!isTerminalGoalStatus(goal.status)) {
      return;
    }

    const goalEventRef = `goal-terminal:${goal.id}:${goal.status}`;
    const session = await chatSessionStore().get(sessionId);
    if (!session) {
      return;
    }
    if (
      session.messages.some((message) => message.goalEventRef === goalEventRef)
    ) {
      return;
    }

    await chatSessionStore().appendMessage({
      sessionId,
      role: "assistant",
      content: formatGoalTerminalMessage(goal, event.message),
      goalId: goal.id,
      goalEventRef,
    });
  }

  function toChatGoalSummary(goal: Goal): ChatSessionGoalSummary {
    return {
      id: goal.id,
      description: goal.description,
      status: projectGoalStatusForInteraction(goal),
      updatedAt: goal.updatedAt,
    };
  }

  function shouldClearActiveChatGoal(status: Goal["status"]): boolean {
    return !isLiveGoalStatus(status);
  }

  async function reconcileChatSessionGoalSummary(
    sessionId: string,
    activeGoal: ChatSessionGoalSummary | undefined,
  ): Promise<ChatSessionGoalSummary | undefined> {
    if (!activeGoal) {
      return undefined;
    }

    const goal = await agentGoalStore().get(activeGoal.id);
    return reconcileLoadedChatSessionGoalSummary(
      sessionId,
      activeGoal,
      goal,
    );
  }

  async function reconcileLoadedChatSessionGoalSummary(
    sessionId: string,
    activeGoal: ChatSessionGoalSummary,
    goal: Goal | null,
  ): Promise<ChatSessionGoalSummary | undefined> {
    if (!goal) {
      return activeGoal;
    }

    const summary = toChatGoalSummary(goal);
    await attachGoalSummaryIfChanged(sessionId, summary);
    return isLiveGoalStatus(summary.status) ? summary : undefined;
  }

  async function listChatSessions(): Promise<ChatSessionListItem[]> {
    const sessions = await chatSessionStore().list();
    const summaryGoalIds = [
      ...new Set(
        sessions.flatMap((session) =>
          [session.activeGoal?.id, session.recoveryGoal?.id].filter(
            (goalId): goalId is string => Boolean(goalId),
          ),
        ),
      ),
    ];
    const summaryGoals = summaryGoalIds.length
      ? await agentGoalStore().getMany(summaryGoalIds)
      : [];
    const summaryGoalsById = new Map(
      summaryGoals.map((goal) => [goal.id, goal]),
    );
    await Promise.all(
      sessions.map(async (session) => {
        const activeGoal = session.activeGoal;
        const recoveryGoal = session.recoveryGoal;
        if (activeGoal) {
          await reconcileLoadedChatSessionGoalSummary(
            session.id,
            activeGoal,
            summaryGoalsById.get(activeGoal.id) ?? null,
          );
        }
        if (recoveryGoal && recoveryGoal.id !== activeGoal?.id) {
          await reconcileLoadedChatSessionGoalSummary(
            session.id,
            recoveryGoal,
            summaryGoalsById.get(recoveryGoal.id) ?? null,
          );
        }
      }),
    );
    const [refreshedSessions, metadata, plans] = await Promise.all([
      chatSessionStore().list(),
      chatSessionStore().listMetadata(),
      planStore().listAll(),
    ]);
    const metadataBySession = new Map(
      metadata.map((session) => [session.id, session]),
    );
    const plansBySession = new Map<string, PlanRecord[]>();
    for (const plan of plans) {
      const sessionPlans = plansBySession.get(plan.sessionId) ?? [];
      sessionPlans.push(plan);
      plansBySession.set(plan.sessionId, sessionPlans);
    }
    const goalIds = [
      ...new Set(
        metadata.flatMap((session) => session.goalIds ?? []),
      ),
    ];
    const goals = await agentGoalStore().getMany(goalIds);
    const goalsById = new Map(goals.map((goal) => [goal.id, goal]));
    return refreshedSessions.map((session) => {
      const sessionMetadata = metadataBySession.get(session.id);
      if (!sessionMetadata) return session;
      const tokenUsage = projectChatSessionTokenUsage({
        chatUsage: sessionMetadata.tokenUsage,
        plans: plansBySession.get(session.id) ?? [],
        goals: (sessionMetadata.goalIds ?? [])
          .map((goalId) => goalsById.get(goalId))
          .filter((goal): goal is Goal => Boolean(goal)),
      });
      return {
        ...session,
        ...(tokenUsage ? { tokenUsage } : {}),
      };
    });
  }

  async function getChatSession(
    sessionId: string,
  ): Promise<ChatSessionRecord | null> {
    const metadata = await chatSessionStore().getMetadata(sessionId);
    if (!metadata) return null;
    const activeGoal = getActiveGoalSummary(metadata as never);
    const recoveryGoal = getRecoveryGoalSummary(metadata as never);
    if (activeGoal) {
      await reconcileChatSessionGoalSummary(sessionId, activeGoal);
    }
    if (recoveryGoal && recoveryGoal.id !== activeGoal?.id) {
      await reconcileChatSessionGoalSummary(sessionId, recoveryGoal);
    }

    const repairedSession = await chatSessionStore().get(sessionId);
    if (!repairedSession) return repairedSession;
    return enrichChatSessionRecordUsage(repairedSession);
  }

  async function getChatSessionTranscriptPage(
    sessionId: string,
    pageOptions?: ChatSessionTranscriptPageOptions,
  ): Promise<ChatSessionTranscriptPage | null> {
    const metadata = await chatSessionStore().getMetadata(sessionId);
    if (!metadata) return null;
    const activeGoal = getActiveGoalSummary(metadata as never);
    const recoveryGoal = getRecoveryGoalSummary(metadata as never);
    if (activeGoal) {
      await reconcileChatSessionGoalSummary(sessionId, activeGoal);
    }
    if (recoveryGoal && recoveryGoal.id !== activeGoal?.id) {
      await reconcileChatSessionGoalSummary(sessionId, recoveryGoal);
    }
    const transcriptPage = await chatSessionStore().getTranscriptPage(
      sessionId,
      pageOptions,
    );
    if (!transcriptPage) return null;
    return {
      ...transcriptPage,
      session: await enrichChatSessionRecordUsage(transcriptPage.session),
    };
  }

  async function enrichChatSessionRecordUsage(
    session: ChatSessionRecord,
  ): Promise<ChatSessionRecord> {
    const [plans, goals] = await Promise.all([
      planStore().listBySession(session.id),
      Promise.all(
        (session.goalIds ?? []).map((goalId) =>
          agentGoalStore().get(goalId),
        ),
      ),
    ]);
    const tokenUsage = projectChatSessionTokenUsage({
      chatUsage: session.tokenUsage,
      plans,
      goals: goals.filter((goal): goal is Goal => Boolean(goal)),
    });
    return projectChatSessionForTranscript({
      ...session,
      ...(tokenUsage ? { tokenUsage } : {}),
    });
  }

  async function archiveChatSession(
    sessionId: string,
  ): Promise<ChatSessionOperationResult> {
    try {
      const session = await chatSessionStore().archive(sessionId);
      if (!session) {
        return { ok: false, message: "会话不存在，无法归档。" };
      }

      return { ok: true, session };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "无法归档会话。",
      };
    }
  }

  async function restoreChatSession(
    sessionId: string,
  ): Promise<ChatSessionOperationResult> {
    try {
      const session = await chatSessionStore().restore(sessionId);
      if (!session) {
        return { ok: false, message: "会话不存在，无法恢复。" };
      }

      return { ok: true, session };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "无法恢复会话。",
      };
    }
  }

  async function renameChatSession(
    sessionId: string,
    title: string,
  ): Promise<ChatSessionOperationResult> {
    try {
      const session = await chatSessionStore().rename(sessionId, title);
      if (!session) {
        return {
          ok: false,
          message: "会话不存在。",
        };
      }
      return { ok: true, session };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : "无法重命名会话。",
      };
    }
  }

  async function deleteChatSession(
    sessionId: string,
  ): Promise<ChatSessionOperationResult> {
    try {
      const deleted = await chatSessionStore().delete(sessionId);
      if (!deleted) {
        return { ok: false, message: "会话不存在，无法删除。" };
      }

      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "无法删除会话。",
      };
    }
  }
  return {
    syncGoalProgressToChatSession,
    attachGoalSummaryIfChanged,
    clearActiveChatGoalIfTerminal,
    appendGoalTerminalMessageIfNeeded,
    toChatGoalSummary,
    shouldClearActiveChatGoal,
    reconcileChatSessionGoalSummary,
    reconcileLoadedChatSessionGoalSummary,
    listChatSessions,
    getChatSession,
    getChatSessionTranscriptPage,
    enrichChatSessionRecordUsage,
    archiveChatSession,
    restoreChatSession,
    renameChatSession,
    deleteChatSession,
  };
}
