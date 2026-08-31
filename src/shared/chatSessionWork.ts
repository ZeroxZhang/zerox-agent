import type {
  ChatSessionActivitySnapshot,
  ChatSessionGoalSummary,
  ChatSessionRecord,
  ChatSessionWorkSummary,
  ChatTaskStatusEvent,
} from "./chat";

const liveGoalStatuses = new Set<ChatSessionGoalSummary["status"]>([
  "planning",
  "executing",
  "waiting_for_review",
  "waiting_for_acceptance",
  "waiting_for_model",
]);

const recoverableGoalStatuses = new Set<ChatSessionGoalSummary["status"]>([
  "stopped_stalled",
  "stopped_blocked",
  "failed",
]);

export function isLiveGoalStatus(
  status: ChatSessionGoalSummary["status"],
): boolean {
  return liveGoalStatuses.has(status);
}

export function isRecoverableGoalStatus(
  status: ChatSessionGoalSummary["status"],
): boolean {
  return recoverableGoalStatuses.has(status);
}

export function getActiveGoalSummary(
  session: Pick<ChatSessionRecord, "activeGoalId" | "goalSummaries">,
): ChatSessionGoalSummary | undefined {
  const summary = session.goalSummaries?.find(
    (goal) => goal.id === session.activeGoalId,
  );
  return summary && isLiveGoalStatus(summary.status) ? summary : undefined;
}

export function getRecoveryGoalSummary(
  session: Pick<ChatSessionRecord, "goalSummaries">,
): ChatSessionGoalSummary | undefined {
  return (session.goalSummaries ?? [])
    .filter((goal) => isRecoverableGoalStatus(goal.status))
    .sort(compareGoalSummariesNewestFirst)[0];
}

export function getActionableGoalSummary(
  session: Pick<
    ChatSessionRecord,
    "activeGoalId" | "goalSummaries"
  >,
): ChatSessionGoalSummary | undefined {
  return (
    getActiveGoalSummary(session) ??
    getRecoveryGoalSummary(session) ??
    (session.goalSummaries ?? [])
      .filter((goal) => goal.status === "stopped_budget")
      .sort(compareGoalSummariesNewestFirst)[0]
  );
}

export function deriveChatSessionWork(
  session: Pick<
    ChatSessionRecord,
    | "activeGoalId"
    | "goalSummaries"
    | "activity"
    | "createdAt"
    | "updatedAt"
  >,
): ChatSessionWorkSummary {
  const activeGoal = getActiveGoalSummary(session);
  if (activeGoal) {
    return {
      source: "goal",
      relationship: "active",
      goalId: activeGoal.id,
      status: activeGoal.status,
      updatedAt: activeGoal.updatedAt ?? session.updatedAt,
    };
  }

  const recoveryGoal = getRecoveryGoalSummary(session);
  const chatWork = deriveChatWork(session.activity);
  const recoveryUpdatedAt = recoveryGoal?.updatedAt;
  if (
    chatWork &&
    (!recoveryGoal ||
      !recoveryUpdatedAt ||
      compareTimestamps(chatWork.updatedAt, recoveryUpdatedAt) >= 0)
  ) {
    return chatWork;
  }

  if (recoveryGoal) {
    return {
      source: "goal",
      relationship: "recovery",
      goalId: recoveryGoal.id,
      status: recoveryGoal.status,
      updatedAt: recoveryGoal.updatedAt ?? session.createdAt,
    };
  }

  if (chatWork) {
    return chatWork;
  }

  return {
    source: "idle",
    status: "idle",
    updatedAt: session.updatedAt,
  };
}

function deriveChatWork(
  activity: ChatSessionActivitySnapshot | undefined,
): Extract<ChatSessionWorkSummary, { source: "chat" }> | undefined {
  const latest = activity?.statusEvents.at(-1);
  if (!latest) {
    return undefined;
  }
  return {
    source: "chat",
    status: mapChatEventToWorkStatus(latest),
    updatedAt: latest.createdAt || activity?.updatedAt || new Date(0).toISOString(),
  };
}

function mapChatEventToWorkStatus(
  event: ChatTaskStatusEvent,
): Extract<ChatSessionWorkSummary, { source: "chat" }>["status"] {
  if (event.state === "completed") return "completed";
  if (event.state === "failed") return "failed";
  if (event.state === "canceled") return "canceled";
  if (
    event.state === "tool_invocation" &&
    (event.invocationStatus === "waiting_approval" ||
      event.invocationStatus === "waiting_for_approval")
  ) {
    return "waiting_for_approval";
  }
  if (event.state === "paused" || event.state === "waiting_for_input") {
    return "paused";
  }
  return "working";
}

function compareGoalSummariesNewestFirst(
  left: ChatSessionGoalSummary,
  right: ChatSessionGoalSummary,
): number {
  return compareTimestamps(right.updatedAt, left.updatedAt);
}

function compareTimestamps(
  left: string | undefined,
  right: string | undefined,
): number {
  return toTimestamp(left) - toTimestamp(right);
}

function toTimestamp(value: string | undefined): number {
  const timestamp = value ? new Date(value).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}
