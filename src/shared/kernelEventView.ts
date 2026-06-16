import type {
  KernelEvent,
  KernelRunMode,
  RunView,
} from "./kernelContract";

export type KernelTimelineSummary = {
  tone: "info" | "success" | "warn" | "error";
  title: string;
  detail: string;
};

export function reduceKernelEventsToRunViews(events: KernelEvent[]): RunView[] {
  const runs = new Map<string, RunView>();

  for (const event of events) {
    const current = runs.get(event.runId) ?? createEmptyRunView(event.runId);
    const next = reduceRunView(current, event);
    runs.set(event.runId, next);
  }

  return [...runs.values()];
}

export function summarizeKernelEventForTimeline(
  event: KernelEvent,
): KernelTimelineSummary {
  switch (event.type) {
    case "turn_start":
      return {
        tone: "info",
        title: "Turn started",
        detail: `turn ${event.turn}/${event.maxTurns}`,
      };
    case "tool_call":
      return {
        tone: "info",
        title: "Tool call",
        detail: event.tool,
      };
    case "compaction":
      return {
        tone: "info",
        title: "Context compacted",
        detail: `${event.beforeTokens} -> ${event.afterTokens} tokens, checkpoint ${basename(event.checkpointRef)}`,
      };
    case "checkpoint_written":
      return {
        tone: "info",
        title: "Checkpoint written",
        detail: `turn ${event.turn}, ${basename(event.ref)}`,
      };
    case "judge_verdict":
      return {
        tone: event.decision.stop
          ? event.decision.impossible
            ? "error"
            : "success"
          : "warn",
        title: "Judge verdict",
        detail: event.decision.reason,
      };
    case "retry":
      return {
        tone: "warn",
        title: "Retry scheduled",
        detail: `attempt ${event.attempt}/${event.maxRetries} after ${event.afterMs}ms`,
      };
    case "run_end":
      return {
        tone: event.status === "succeeded"
          ? "success"
          : event.status === "failed" || event.status === "canceled"
            ? "error"
            : "warn",
        title: "Run ended",
        detail: event.reason,
      };
  }
}

function createEmptyRunView(runId: string): RunView {
  return {
    runId,
    mode: "chat",
    turn: 0,
    maxTurns: 0,
    status: "running",
    contextUsageRatio: 0,
  };
}

function reduceRunView(view: RunView, event: KernelEvent): RunView {
  switch (event.type) {
    case "turn_start":
      return {
        ...view,
        turn: event.turn,
        maxTurns: event.maxTurns,
        status: "running",
      };
    case "judge_verdict":
      return {
        ...view,
        mode: "goal",
        lastJudgeVerdict: event.decision,
      };
    case "compaction":
      return {
        ...view,
        contextUsageRatio:
          event.beforeTokens > 0 ? event.afterTokens / event.beforeTokens : 0,
      };
    case "run_end":
      return {
        ...view,
        status: event.status,
      };
    case "tool_call":
    case "checkpoint_written":
    case "retry":
      return inferMode(view, event);
  }
}

function inferMode(view: RunView, event: KernelEvent): RunView {
  const mode: KernelRunMode =
    event.type === "checkpoint_written" && event.ref.includes("goal")
      ? "goal"
      : view.mode;
  return mode === view.mode ? view : { ...view, mode };
}

function basename(ref: string): string {
  return ref.split(/[\\/]/).filter(Boolean).at(-1) ?? ref;
}
