import path from "node:path";
import type { Goal, SuccessCriterion } from "../shared/agentGoal";
import type { AgentRunContext } from "../shared/agentWorkspace";
import {
  isPathInsideLocationRoot,
  normalizeLocationBoundaryPath,
  normalizeLocationPath,
  type LocationResourceEnvironment,
} from "../shared/locationResource";

const explicitAbsolutePathPattern =
  /(?<!["'`])(?<path>~\/[^\s"'<>，。；；、,，）)]+|\/(?:Volumes|Users|tmp|var|private|opt|home|mnt|media)\/[^\s"'<>，。；；、,，）)]+)/g;
const explicitQuotedPathPattern =
  /["'`](?<path>~\/[^"'`<>]+|\/(?:Volumes|Users|tmp|var|private|opt|home|mnt|media)\/[^"'`<>]+)["'`]/g;
const explicitBareAliasPathPattern =
  /(?<![A-Za-z0-9_/.-])(?<path>(?:Desktop|Downloads|桌面|下载)\/[^\s"'<>，。；；、,，）)]+)/g;
const englishStandaloneDestinationPattern =
  /\b(?:save|write|export|put|place|store|create)\b[\s\S]{0,80}?\b(?:to|in|on|under|into)\s+(?<alias>Desktop|Downloads)(?=$|[\s"')）:：,，;；。])/gi;
const chineseStandaloneDestinationPattern =
  /(?:保存到|保存至|导出到|导出至|写入到|写入至|放到|放在|输出到|输出至)\s*(?<alias>Desktop|Downloads|桌面|下载)(?=$|[\s"')）:：,，;；。])/g;

export function applyGoalOutputRootsToRunContext(
  runContext: AgentRunContext,
  goal: Goal,
): AgentRunContext {
  const locationEnv = {
    ...runContext.locationEnv,
    workspaceRoot: runContext.workspaceRoot,
  };
  const outputRoots = extractGoalOutputRoots(goal, locationEnv).filter(
    (root) => !isPathInsideLocationRoot(root, runContext.workspaceRoot, locationEnv),
  );
  const referenceRoots = extractGoalReferenceRoots(goal, locationEnv).filter(
    (root) => !isPathInsideLocationRoot(root, runContext.workspaceRoot, locationEnv),
  );
  if (outputRoots.length === 0 && referenceRoots.length === 0) {
    return runContext;
  }

  return {
    ...runContext,
    sandbox: {
      ...runContext.sandbox,
      extraReadRoots: mergeRoots(
        runContext.sandbox.extraReadRoots,
        [...outputRoots, ...referenceRoots],
      ),
      extraWriteRoots: mergeRoots(runContext.sandbox.extraWriteRoots, outputRoots),
    },
  };
}

export function extractGoalReferenceRoots(
  goal: Goal,
  locationEnv: LocationResourceEnvironment = {},
): string[] {
  return mergeRoots(
    [],
    goal.milestones.flatMap((milestone) =>
      extractOutputRootsFromText(milestone.description, locationEnv),
    ),
    locationEnv,
  );
}

export function extractGoalOutputRoots(
  goal: Goal,
  locationEnv: LocationResourceEnvironment = {},
): string[] {
  return mergeRoots(
    [],
    [
      ...extractOutputRootsFromText(
        goal.goalContractSnapshot?.objective ?? goal.description,
        locationEnv,
      ),
      ...extractOutputRootsFromCriteria(goal.successCriteria, locationEnv),
      ...goal.milestones.flatMap((milestone) =>
        extractOutputRootsFromCriteria(milestone.successCriteria, locationEnv),
      ),
    ],
    locationEnv,
  );
}

function extractOutputRootsFromCriteria(
  criteria: SuccessCriterion[],
  locationEnv: LocationResourceEnvironment,
): string[] {
  return criteria.flatMap((criterion) =>
    criterion.acceptanceChecks.flatMap((check) => {
      const destinationRoot = extractOutputRootFromDestination(
        check.params.destination,
        locationEnv,
      );
      if (destinationRoot) {
        return [destinationRoot];
      }

      const requestedPath = String(check.params.path ?? "").trim();
      if (!isOutputPathCandidate(requestedPath)) {
        return [];
      }
      const outputRoot = normalizeOutputRoot(requestedPath, "file", locationEnv);
      return outputRoot ? [outputRoot] : [];
    }),
  );
}

function extractOutputRootFromDestination(
  destination: unknown,
  locationEnv: LocationResourceEnvironment,
): string | null {
  const destinationPath = getStructuredDestinationPath(destination);
  if (!destinationPath) {
    return null;
  }

  return normalizeOutputRoot(destinationPath, "file", locationEnv);
}

function getStructuredDestinationPath(destination: unknown): string | null {
  if (!isRecord(destination)) {
    return null;
  }

  if (
    destination.kind === "desktop" &&
    typeof destination.filename === "string" &&
    destination.filename.trim()
  ) {
    return `Desktop/${destination.filename.trim()}`;
  }

  if (
    destination.kind === "downloads" &&
    typeof destination.filename === "string" &&
    destination.filename.trim()
  ) {
    return `Downloads/${destination.filename.trim()}`;
  }

  if (
    destination.kind === "path" &&
    typeof destination.path === "string" &&
    destination.path.trim()
  ) {
    return destination.path.trim();
  }

  return null;
}

function extractOutputRootsFromText(
  text: string,
  locationEnv: LocationResourceEnvironment,
): string[] {
  const explicitRoots = [
    ...text.matchAll(explicitQuotedPathPattern),
    ...text.matchAll(explicitAbsolutePathPattern),
    ...text.matchAll(explicitBareAliasPathPattern),
  ]
    .map((match) => normalizeOutputRoot(match.groups?.path ?? "", "unknown", locationEnv))
    .filter((root): root is string => Boolean(root));
  const standaloneRoots = [
    ...text.matchAll(englishStandaloneDestinationPattern),
    ...text.matchAll(chineseStandaloneDestinationPattern),
  ]
    .map((match) =>
      normalizeOutputRoot(match.groups?.alias ?? "", "directory", locationEnv),
    )
    .filter((root): root is string => Boolean(root));

  return [...explicitRoots, ...standaloneRoots];
}

function normalizeOutputRoot(
  rawPath: string,
  hint: "file" | "unknown" | "directory",
  locationEnv: LocationResourceEnvironment,
): string | null {
  const cleaned = stripAttachedNaturalLanguageSuffix(rawPath)
    .trim()
    .replace(/[。；;、,，）)]+$/g, "");
  if (!isOutputPathCandidate(cleaned)) {
    return null;
  }

  const normalizedPath = normalizeLocationPath(cleaned, locationEnv);
  const normalized =
    hint !== "directory" &&
    !isExactOutputDirectoryAlias(cleaned) &&
    (hint === "file" || path.extname(cleaned))
      ? path.posix.dirname(normalizedPath)
      : normalizedPath;
  const parts = normalized.split("/").filter(Boolean);
  return parts.length >= 2 ? normalized : null;
}

function isExactOutputDirectoryAlias(value: string): boolean {
  return /^(?:Desktop|Downloads|桌面|下载|~\/(?:Desktop|Downloads|桌面|下载))$/.test(
    value,
  );
}

function stripAttachedNaturalLanguageSuffix(rawPath: string): string {
  return rawPath.replace(
    /(?<=[A-Za-z0-9._~-])(?:目录下的文件|目录下|目录中的文件|目录里的文件|目录中|目录里|文件夹下的文件|文件夹下|文件夹中的文件|文件夹里的文件|文件夹中|文件夹里|下的文件|里的文件|中的文件|目录|文件夹).*$/u,
    "",
  );
}

function isOutputPathCandidate(value: string): boolean {
  return (
    value.startsWith("~/") ||
    path.isAbsolute(value) ||
    /^(?:Desktop|Downloads|桌面|下载)(?:\/|$)/.test(value)
  );
}

function mergeRoots(
  existing: string[],
  additions: string[],
  locationEnv: LocationResourceEnvironment = {},
): string[] {
  const merged: string[] = [];
  for (const root of [...existing, ...additions]) {
    const normalized = normalizeLocationBoundaryPath(root, locationEnv);
    if (normalized && !merged.includes(normalized)) {
      merged.push(normalized);
    }
  }
  return merged;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
