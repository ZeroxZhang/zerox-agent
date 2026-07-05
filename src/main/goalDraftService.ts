import type { GoalSelectedSkill, Milestone } from "../shared/agentGoal";
import {
  normalizeGoalDraftCriteria,
  type GoalDraft,
  type GoalDraftDiscardResult,
  type GoalDraftEdit,
} from "../shared/goalTranslation";
import type { SkillInputValue } from "../shared/skillExecutionContract";
import type { AgentGoalTranslator } from "./agentGoalTranslator";

export type GoalDraftService = {
  createFromChat(input: {
    sessionId: string;
    originMessageId: string | null;
    message: string;
    selectedSkill?: GoalSelectedSkill;
    selectedSkillInputValues?: Record<string, SkillInputValue>;
    signal?: AbortSignal;
  }): Promise<GoalDraft>;
  get(draftId: string): GoalDraft | null;
  markConfirmed(draftId: string, edit?: GoalDraftEdit): GoalDraft | null;
  discard(draftId: string): GoalDraftDiscardResult;
};

export function createGoalDraftService(options: {
  translator: AgentGoalTranslator;
  now?: () => string;
}): GoalDraftService {
  const drafts = new Map<string, GoalDraft>();
  const now = options.now ?? (() => new Date().toISOString());

  return {
    async createFromChat(input) {
      const draft = await options.translator.translate(input);
      drafts.set(draft.id, draft);
      return draft;
    },

    get(draftId) {
      return drafts.get(draftId) ?? null;
    },

    markConfirmed(draftId, edit) {
      const draft = drafts.get(draftId);
      if (!draft || draft.status !== "draft") {
        return null;
      }
      const editedDraft = applyGoalDraftEdit(draft, edit, now());
      const confirmedDraft: GoalDraft = {
        ...editedDraft,
        status: "confirmed",
        updatedAt: now(),
      };
      drafts.set(draftId, confirmedDraft);
      return confirmedDraft;
    },

    discard(draftId) {
      const draft = drafts.get(draftId);
      if (!draft) {
        return { ok: false, message: "目标草案不存在。" };
      }
      if (draft.status !== "draft") {
        return { ok: false, message: "目标草案已处理，不能重复丢弃。" };
      }
      const discardedDraft: GoalDraft = {
        ...draft,
        status: "discarded",
        updatedAt: now(),
      };
      drafts.set(draftId, discardedDraft);
      return {
        ok: true,
        draft: discardedDraft,
        message: "目标草案已丢弃，未创建目标。",
      };
    },
  };
}

function applyGoalDraftEdit(
  draft: GoalDraft,
  edit: GoalDraftEdit | undefined,
  updatedAt: string,
): GoalDraft {
  if (!edit) {
    return { ...draft, updatedAt };
  }

  const normalizedDescription =
    edit.normalizedDescription?.trim() || draft.normalizedDescription;
  const normalizedCriteria = normalizeGoalDraftCriteria(
    edit.successCriteria ?? draft.successCriteria,
  );
  return {
    ...draft,
    normalizedDescription,
    successCriteria: normalizedCriteria.successCriteria,
    acceptanceCoverage: normalizedCriteria.acceptanceCoverage,
    warnings: normalizedCriteria.warnings,
    ...(edit.milestones
      ? { milestones: normalizeMilestones(edit.milestones, normalizedCriteria.successCriteria) }
      : {}),
    updatedAt,
  };
}

function normalizeMilestones(
  milestones: Milestone[],
  successCriteria: GoalDraft["successCriteria"],
): Milestone[] {
  return milestones.map((milestone, index) => ({
    ...milestone,
    id: milestone.id.trim() || `milestone_${index + 1}`,
    description: milestone.description.trim(),
    successCriteria: milestone.successCriteria.length
      ? milestone.successCriteria
      : successCriteria,
    state: index === 0 ? "ready" : milestone.state,
    runIds: milestone.runIds ?? [],
    attempts: milestone.attempts ?? 0,
  }));
}
