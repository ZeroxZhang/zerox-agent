import type { AcceptanceCheck, SuccessCriterion } from "./agentGoal";
import type {
  AgentTaskContract,
  ChromeBookmarksTaskContract,
} from "./agentTaskContract";

export function createTaskContractSuccessCriterion(
  contract: AgentTaskContract,
): SuccessCriterion | undefined {
  if (isChromeBookmarkTaskContract(contract)) {
    return createChromeBookmarkArtifactCriterion(contract);
  }

  return undefined;
}

export function createChromeBookmarkArtifactCriterion(
  contract?: ChromeBookmarksTaskContract,
): SuccessCriterion {
  return {
    id: "criterion_chrome_bookmark_artifacts",
    description: "Chrome bookmark artifacts are written.",
    acceptanceChecks: createChromeBookmarkArtifactChecks(contract),
  };
}

export function hasTaskContractAcceptanceCriteria(
  criteria: SuccessCriterion[],
  contract: AgentTaskContract,
): boolean {
  const criterion = createTaskContractSuccessCriterion(contract);
  if (!criterion) {
    return false;
  }

  const checks = criteria.flatMap((candidate) => candidate.acceptanceChecks);
  return criterion.acceptanceChecks.every((expected) =>
    checks.some((check) => acceptanceChecksEquivalent(check, expected)),
  );
}

function isChromeBookmarkTaskContract(
  contract: AgentTaskContract,
): contract is ChromeBookmarksTaskContract {
  return contract.source.type === "chrome_bookmarks";
}

function createChromeBookmarkArtifactChecks(
  contract?: ChromeBookmarksTaskContract,
): AcceptanceCheck[] {
  const bookmarkParams: Record<string, unknown> = {
    path: "bookmark_list.md",
  };
  const evidenceParams: Record<string, unknown> = {
    path: "goalEvidence.md",
  };

  if (contract) {
    bookmarkParams.artifactRef = contract.deliverable.artifactRef;
    bookmarkParams.destination = contract.deliverable.destination;
    bookmarkParams.requireProvenance =
      contract.acceptance.provenanceRequired;
    evidenceParams.artifactRef = "artifact:goalEvidence";
    evidenceParams.requireProvenance = contract.acceptance.provenanceRequired;
    evidenceParams.destination = { kind: "desktop", filename: "goalEvidence.md" };
  }

  return [
    {
      id: "check_bookmark_list_artifact",
      kind: "file_exists",
      description: "Complete Chrome bookmark list artifact exists.",
      params: bookmarkParams,
      requiresEvidence: false,
    },
    {
      id: "check_goal_evidence_artifact",
      kind: "file_exists",
      description: "Goal evidence artifact exists.",
      params: evidenceParams,
      requiresEvidence: false,
    },
  ];
}

function acceptanceChecksEquivalent(
  left: AcceptanceCheck,
  right: AcceptanceCheck,
): boolean {
  return (
    left.id === right.id &&
    left.kind === right.kind &&
    left.requiresEvidence === right.requiresEvidence &&
    stableJsonValue(left.params) === stableJsonValue(right.params)
  );
}

function stableJsonValue(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJsonValue(entry)]),
    );
  }
  return value;
}
