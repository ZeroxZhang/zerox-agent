import type { AgentExecutionArtifact, AgentExecutionStatus } from "./agentExecution";
import type { AgentToolName } from "./toolPermissions";
import type { AgentTrajectoryEvent } from "./agentTrajectory";
import type { AgentRunContext, AgentRole } from "./agentWorkspace";

export type AgentHandoffRole = Extract<
  AgentRole,
  "researcher" | "executor" | "reviewer"
>;

export type AgentHandoffBudget = {
  toolCallBudget: number;
  wallClockBudgetMs?: number;
  revisionBudget?: number;
};

export type AgentHandoffReviewGate = {
  required: boolean;
  reviewerRole: "primary" | "reviewer";
  checklist: string[];
};

export type AgentHandoffContract = {
  handoffId: string;
  parentRunId: string;
  childRole: AgentHandoffRole;
  objective: string;
  allowedTools: AgentToolName[];
  workspaceRoot: string;
  budget: AgentHandoffBudget;
  expectedArtifacts: AgentExecutionArtifact["kind"][];
  reviewGate: AgentHandoffReviewGate;
};

export type AgentHandoffContractInput = {
  handoffId?: string;
  parentRunId: string;
  childRole: string;
  objective: string;
  allowedTools: AgentToolName[];
  budget: AgentHandoffBudget;
  expectedArtifacts: AgentExecutionArtifact["kind"][];
  reviewGate: AgentHandoffReviewGate;
};

export type AgentChildHandoffOutput = {
  handoffId: string;
  childRunId: string;
  status: AgentExecutionStatus;
  summary: string;
  artifacts: AgentExecutionArtifact[];
  trajectoryEventIds: string[];
  openQuestions: string[];
  recommendedNextAction: "accept" | "reject" | "request_revision" | "continue";
};

export type AgentHandoffReviewDecisionName =
  | "accepted"
  | "rejected"
  | "revision_requested";

export type AgentHandoffReviewDecision = {
  handoffId: string;
  parentRunId: string;
  childRunId: string;
  decision: AgentHandoffReviewDecisionName;
  reviewerRole: "primary" | "reviewer";
  notes: string;
  createdAt: string;
};

export type AgentHandoffReviewCard = {
  handoffId: string;
  childRole: AgentHandoffRole;
  objective: string;
  status:
    | "pending"
    | "running"
    | "completed"
    | AgentHandoffReviewDecisionName;
  childRunId?: string;
  reviewDecision?: AgentHandoffReviewDecisionName;
  artifactLabels: string[];
  openQuestions: string[];
  recommendedNextAction?: AgentChildHandoffOutput["recommendedNextAction"];
  checklist: string[];
};

const handoffRoles = new Set<string>(["researcher", "executor", "reviewer"]);
const reviewDecisions = new Set<string>([
  "accepted",
  "rejected",
  "revision_requested",
]);

export function createAgentHandoffContract(
  parentContext: AgentRunContext,
  input: AgentHandoffContractInput,
): AgentHandoffContract {
  if (parentContext.depth > 0 || parentContext.parentRunId) {
    throw new Error("P2 handoff supports one child level.");
  }

  if (!handoffRoles.has(input.childRole)) {
    throw new Error("childRole must be researcher, executor, or reviewer.");
  }

  const objective = input.objective.trim();
  if (!objective) {
    throw new Error("handoff objective is required.");
  }

  const allowedTools = uniqueTools(input.allowedTools);
  if (!allowedTools.length) {
    throw new Error("handoff allowedTools must include at least one tool.");
  }

  if (!Number.isFinite(input.budget.toolCallBudget) || input.budget.toolCallBudget < 1) {
    throw new Error("handoff toolCallBudget must be at least 1.");
  }

  if (!input.expectedArtifacts.length) {
    throw new Error("handoff expectedArtifacts must include at least one artifact kind.");
  }

  return {
    handoffId: input.handoffId?.trim() || `handoff_${Date.now()}`,
    parentRunId: input.parentRunId,
    childRole: input.childRole as AgentHandoffRole,
    objective,
    allowedTools,
    workspaceRoot: parentContext.workspaceRoot,
    budget: {
      toolCallBudget: Math.floor(input.budget.toolCallBudget),
      ...(input.budget.wallClockBudgetMs
        ? { wallClockBudgetMs: Math.floor(input.budget.wallClockBudgetMs) }
        : {}),
      ...(input.budget.revisionBudget
        ? { revisionBudget: Math.floor(input.budget.revisionBudget) }
        : {}),
    },
    expectedArtifacts: [...new Set(input.expectedArtifacts)],
    reviewGate: {
      required: Boolean(input.reviewGate.required),
      reviewerRole:
        input.reviewGate.reviewerRole === "reviewer" ? "reviewer" : "primary",
      checklist: input.reviewGate.checklist
        .map((item) => item.trim())
        .filter(Boolean),
    },
  };
}

export function createHandoffReviewDecision(
  input: Omit<AgentHandoffReviewDecision, "createdAt"> & { createdAt?: string },
): AgentHandoffReviewDecision {
  if (!reviewDecisions.has(input.decision)) {
    throw new Error("handoff review decision must be accepted, rejected, or revision_requested.");
  }

  return {
    handoffId: input.handoffId,
    parentRunId: input.parentRunId,
    childRunId: input.childRunId,
    decision: input.decision,
    reviewerRole: input.reviewerRole === "reviewer" ? "reviewer" : "primary",
    notes: input.notes.trim(),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function summarizeHandoffReviewCards(
  events: AgentTrajectoryEvent[],
): AgentHandoffReviewCard[] {
  const cards = new Map<string, AgentHandoffReviewCard>();

  function getCard(handoffId: string): AgentHandoffReviewCard | null {
    if (cards.has(handoffId)) {
      return cards.get(handoffId) ?? null;
    }

    return null;
  }

  function getOnlyCard(): AgentHandoffReviewCard | null {
    return cards.size === 1 ? [...cards.values()][0] ?? null : null;
  }

  for (const event of events) {
    if (event.type === "child_handoff_created") {
      const handoff = readHandoff(event.payload);
      if (!handoff) {
        continue;
      }

      cards.set(handoff.handoffId, {
        handoffId: handoff.handoffId,
        childRole: handoff.childRole,
        objective: handoff.objective,
        status: "pending",
        artifactLabels: [],
        openQuestions: [],
        checklist: handoff.reviewGate.checklist,
      });
    }

    if (event.type === "child_run_scheduled") {
      const handoffId = readString(event.payload.handoffId);
      const card = handoffId ? getCard(handoffId) : getOnlyCard();
      if (!card) {
        continue;
      }
      card.status = "running";
      card.childRunId = readString(event.payload.childRunId) ?? card.childRunId;
    }

    if (event.type === "child_handoff_completed") {
      const output = readOutput(event.payload);
      if (!output) {
        continue;
      }

      const card = getCard(output.handoffId) ?? getOnlyCard();
      if (!card) {
        continue;
      }
      card.status = "completed";
      card.childRunId = output.childRunId;
      card.artifactLabels = output.artifacts.map((artifact) => artifact.label);
      card.openQuestions = output.openQuestions;
      card.recommendedNextAction = output.recommendedNextAction;
    }

    if (event.type === "child_handoff_reviewed") {
      const decision = readDecision(event.payload);
      if (!decision) {
        continue;
      }

      const card = getCard(decision.handoffId) ?? getOnlyCard();
      if (!card) {
        continue;
      }
      card.status = decision.decision;
      card.childRunId = decision.childRunId;
      card.reviewDecision = decision.decision;
    }
  }

  return [...cards.values()];
}

function uniqueTools(values: AgentToolName[]): AgentToolName[] {
  return [...new Set(values)];
}

function readHandoff(payload: Record<string, unknown>): AgentHandoffContract | null {
  const raw = isRecord(payload.handoff) ? payload.handoff : payload;
  const childRole = readString(raw.childRole);
  if (!childRole || !handoffRoles.has(childRole)) {
    return null;
  }

  const handoffId = readString(raw.handoffId);
  const parentRunId = readString(raw.parentRunId);
  const objective = readString(raw.objective);
  if (!handoffId || !parentRunId || !objective) {
    return null;
  }

  return {
    handoffId,
    parentRunId,
    childRole: childRole as AgentHandoffRole,
    objective,
    allowedTools: readStringArray(raw.allowedTools) as AgentToolName[],
    workspaceRoot: readString(raw.workspaceRoot) ?? "",
    budget: isRecord(raw.budget)
      ? { toolCallBudget: Number(raw.budget.toolCallBudget ?? 0) }
      : { toolCallBudget: 0 },
    expectedArtifacts: readStringArray(
      raw.expectedArtifacts,
    ) as AgentExecutionArtifact["kind"][],
    reviewGate: isRecord(raw.reviewGate)
      ? {
          required: Boolean(raw.reviewGate.required),
          reviewerRole:
            raw.reviewGate.reviewerRole === "reviewer" ? "reviewer" : "primary",
          checklist: readStringArray(raw.reviewGate.checklist),
        }
      : {
          required: Boolean(raw.reviewGateRequired),
          reviewerRole: "primary",
          checklist: [],
        },
  };
}

function readOutput(payload: Record<string, unknown>): AgentChildHandoffOutput | null {
  const raw = isRecord(payload.output) ? payload.output : payload;
  const handoffId = readString(raw.handoffId);
  const childRunId = readString(raw.childRunId);
  if (!handoffId || !childRunId) {
    return null;
  }

  return {
    handoffId,
    childRunId,
    status: normalizeStatus(raw.status),
    summary: readString(raw.summary) ?? "",
    artifacts: Array.isArray(raw.artifacts)
      ? raw.artifacts
          .filter(isRecord)
          .map((artifact) => {
            const artifactPath = readString(artifact.path);
            const contentType = readString(artifact.contentType);

            return {
              id: readString(artifact.id) ?? "",
              kind: normalizeArtifactKind(artifact.kind),
              label: readString(artifact.label) ?? "Artifact",
              ...(artifactPath ? { path: artifactPath } : {}),
              ...(contentType ? { contentType } : {}),
              createdAt:
                readString(artifact.createdAt) ?? new Date(0).toISOString(),
            };
          })
      : [],
    trajectoryEventIds: readStringArray(raw.trajectoryEventIds),
    openQuestions: readStringArray(raw.openQuestions),
    recommendedNextAction: normalizeNextAction(raw.recommendedNextAction),
  };
}

function readDecision(
  payload: Record<string, unknown>,
): AgentHandoffReviewDecision | null {
  const raw = isRecord(payload.decision) ? payload.decision : payload;
  const handoffId = readString(raw.handoffId);
  const parentRunId = readString(raw.parentRunId);
  const childRunId = readString(raw.childRunId);
  const decision = readString(raw.decision);
  if (!handoffId || !parentRunId || !childRunId || !decision) {
    return null;
  }

  return createHandoffReviewDecision({
    handoffId,
    parentRunId,
    childRunId,
    decision: reviewDecisions.has(decision)
      ? (decision as AgentHandoffReviewDecisionName)
      : "revision_requested",
    reviewerRole: raw.reviewerRole === "reviewer" ? "reviewer" : "primary",
    notes: readString(raw.notes) ?? "",
    ...(readString(raw.createdAt)
      ? { createdAt: readString(raw.createdAt) ?? undefined }
      : {}),
  });
}

function normalizeStatus(value: unknown): AgentExecutionStatus {
  return value === "queued" ||
    value === "running" ||
    value === "waiting_for_approval" ||
    value === "paused" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "canceled"
    ? value
    : "failed";
}

function normalizeArtifactKind(value: unknown): AgentExecutionArtifact["kind"] {
  return value === "file" ||
    value === "text" ||
    value === "tool_result" ||
    value === "other"
    ? value
    : "other";
}

function normalizeNextAction(
  value: unknown,
): AgentChildHandoffOutput["recommendedNextAction"] {
  return value === "accept" ||
    value === "reject" ||
    value === "request_revision" ||
    value === "continue"
    ? value
    : "continue";
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
