import path from "node:path";
import type { Goal, SuccessCriterion } from "../shared/agentGoal";
import type { AgentRunContext } from "../shared/agentWorkspace";
import { isPathInsideDirectory, normalizeBoundaryPath } from "../shared/agentWorkspace";

const explicitAbsolutePathPattern =
  /(?:~\/[^\s"'<>，。；；、,，）)]+|\/(?:Volumes|Users|tmp|var|private|opt|home|mnt|media)\/[^\s"'<>，。；；、,，）)]+)/g;

export function applyGoalOutputRootsToRunContext(
  runContext: AgentRunContext,
  goal: Goal,
): AgentRunContext {
  const outputRoots = extractGoalOutputRoots(goal).filter(
    (root) => !isPathInsideDirectory(root, runContext.workspaceRoot),
  );
  if (outputRoots.length === 0) {
    return runContext;
  }

  return {
    ...runContext,
    sandbox: {
      ...runContext.sandbox,
      extraReadRoots: mergeRoots(runContext.sandbox.extraReadRoots, outputRoots),
      extraWriteRoots: mergeRoots(runContext.sandbox.extraWriteRoots, outputRoots),
    },
  };
}

export function extractGoalOutputRoots(goal: Goal): string[] {
  return mergeRoots(
    [],
    [
      ...extractOutputRootsFromText(goal.description),
      ...extractOutputRootsFromCriteria(goal.successCriteria),
      ...goal.milestones.flatMap((milestone) =>
        extractOutputRootsFromCriteria(milestone.successCriteria),
      ),
    ],
  );
}

function extractOutputRootsFromCriteria(criteria: SuccessCriterion[]): string[] {
  return criteria.flatMap((criterion) =>
    criterion.acceptanceChecks.flatMap((check) => {
      const requestedPath = String(check.params.path ?? "").trim();
      if (!isExplicitPath(requestedPath)) {
        return [];
      }
      const outputRoot = normalizeOutputRoot(requestedPath, "file");
      return outputRoot ? [outputRoot] : [];
    }),
  );
}

function extractOutputRootsFromText(text: string): string[] {
  return [...text.matchAll(explicitAbsolutePathPattern)]
    .map((match) => normalizeOutputRoot(match[0], "unknown"))
    .filter((root): root is string => Boolean(root));
}

function normalizeOutputRoot(
  rawPath: string,
  hint: "file" | "unknown",
): string | null {
  const cleaned = rawPath.trim().replace(/[。；;、,，）)]+$/g, "");
  if (!isExplicitPath(cleaned)) {
    return null;
  }

  const candidate =
    hint === "file" || path.extname(cleaned)
      ? path.dirname(cleaned)
      : cleaned;
  const normalized = normalizeBoundaryPath(candidate);
  const parts = normalized.split("/").filter(Boolean);
  return parts.length >= 2 ? normalized : null;
}

function isExplicitPath(value: string): boolean {
  return value.startsWith("~/") || path.isAbsolute(value);
}

function mergeRoots(existing: string[], additions: string[]): string[] {
  const merged: string[] = [];
  for (const root of [...existing, ...additions]) {
    const normalized = normalizeBoundaryPath(root);
    if (normalized && !merged.includes(normalized)) {
      merged.push(normalized);
    }
  }
  return merged;
}
