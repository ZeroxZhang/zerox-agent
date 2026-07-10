import { createHash } from "node:crypto";
import type {
  AcceptanceCheckKind,
  Goal,
  GoalAcceptanceCertificate,
  GoalAcceptanceCheckResult,
  GoalEvidenceManifest,
} from "../shared/agentGoal";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const REDACTED_SECRET = "[REDACTED]";
const BUILTIN_CHECK_KINDS = new Set<AcceptanceCheckKind>([
  "file_exists",
  "command_exit_code",
  "test_passes",
  "assertion",
  "model_review",
]);

export type CreateGoalAcceptanceCertificateInput = {
  goal: Pick<Goal, "id" | "planVersion" | "successCriteria">;
  acceptedAt: string;
  runIds: readonly string[];
  checkResults: readonly GoalAcceptanceCheckResult[];
  evidenceManifest: GoalEvidenceManifest;
  provenanceRefs?: Readonly<Record<string, readonly string[]>>;
  judge?: {
    providerId?: string;
    model: string;
    promptVersion: string;
    evaluatedMessageIds: readonly string[];
  };
};

export type GoalAcceptanceCertificateVerification =
  | { ok: true }
  | { ok: false; reason: string };

export function createGoalCriteriaHash(
  goal: Pick<Goal, "successCriteria">,
): string {
  const criteria = goal.successCriteria
    .map((criterion) => ({
      id: criterion.id,
      description: criterion.description,
      acceptanceChecks: criterion.acceptanceChecks
        .map((check) => ({
          id: check.id,
          kind: check.kind,
          description: check.description,
          params: check.params,
          requiresEvidence: check.requiresEvidence,
        }))
        .sort(compareStableDefinitions),
    }))
    .sort(compareStableDefinitions);

  return sha256(stableJson(criteria));
}

export function createGoalAcceptanceCertificate(
  input: CreateGoalAcceptanceCertificateInput,
): GoalAcceptanceCertificate {
  const checkResults = dedupeStableEntries(
    input.checkResults.map((result) => ({
      checkId: result.checkId,
      kind: result.kind,
      passed: result.passed,
      code: result.code,
      ...(result.failureClass ? { failureClass: result.failureClass } : {}),
      evidenceRefs: uniqueSortedStrings(result.evidenceRefs),
      detail: result.detail,
    })),
    (result) => stableJson([result.checkId, result.kind]),
    "check result",
  ).sort(compareCheckResults);

  const evidence = dedupeStableEntries(
    input.evidenceManifest.artifacts.map((artifact) => ({
      ref: artifact.ref,
      ...(artifact.path !== undefined ? { path: artifact.path } : {}),
      ...(artifact.sha256 !== undefined ? { sha256: artifact.sha256 } : {}),
      ...(artifact.sizeBytes !== undefined
        ? { sizeBytes: artifact.sizeBytes }
        : {}),
      provenanceRefs: uniqueSortedStrings(
        input.provenanceRefs?.[artifact.ref] ?? [],
      ),
    })),
    (entry) => stableJson([entry.ref, entry.path ?? null]),
    "evidence entry",
  ).sort(compareEvidence);

  const unsigned: Omit<GoalAcceptanceCertificate, "certificateHash"> = {
    version: 1,
    goalId: input.goal.id,
    acceptedAt: input.acceptedAt,
    protocolVersion: 2,
    criteriaHash: createGoalCriteriaHash(input.goal),
    planVersion: input.goal.planVersion,
    runIds: uniqueSortedStrings(input.runIds),
    checkResults,
    evidence,
    ...(input.judge
      ? {
          judge: {
            ...(input.judge.providerId !== undefined
              ? { providerId: input.judge.providerId }
              : {}),
            model: input.judge.model,
            promptVersion: input.judge.promptVersion,
            evaluatedMessageIds: uniqueSortedStrings(
              input.judge.evaluatedMessageIds,
            ),
          },
        }
      : {}),
  };

  return {
    ...unsigned,
    certificateHash: createCertificateDigest(unsigned),
  };
}

export function verifyGoalAcceptanceCertificate(
  goal: Goal,
): GoalAcceptanceCertificateVerification {
  if (goal.acceptanceProtocolVersion !== 2) {
    return failure("Goal acceptance protocol mismatch; protocol v2 is required.");
  }

  const certificate = goal.acceptanceCertificate;
  if (!certificate || !isRecord(certificate)) {
    return failure("Protocol v2 achieved goal requires a certificate.");
  }
  if (!isSha256(certificate.certificateHash)) {
    return failure("Certificate hash must be a lowercase SHA256 digest.");
  }

  const { certificateHash: _certificateHash, ...unsigned } = certificate;
  if (createCertificateDigest(unsigned) !== certificate.certificateHash) {
    return failure("Certificate hash verification failed.");
  }

  if (certificate.version !== 1) {
    return failure("Certificate version mismatch.");
  }
  if (certificate.protocolVersion !== 2) {
    return failure("Certificate protocol mismatch.");
  }
  if (certificate.goalId !== goal.id) {
    return failure("Certificate goal identity mismatch.");
  }
  if (
    !Number.isSafeInteger(certificate.planVersion) ||
    certificate.planVersion < 0 ||
    certificate.planVersion !== goal.planVersion
  ) {
    return failure("Certificate plan version mismatch.");
  }
  if (!isSha256(certificate.criteriaHash)) {
    return failure("Certificate criteria hash must be a lowercase SHA256 digest.");
  }
  if (certificate.criteriaHash !== createGoalCriteriaHash(goal)) {
    return failure("Certificate criteria hash mismatch.");
  }
  if (!isNonemptyString(certificate.acceptedAt) || !isValidDate(certificate.acceptedAt)) {
    return failure("Certificate accepted timestamp is malformed.");
  }

  const runVerification = verifyStringSet(certificate.runIds, "run id");
  if (!runVerification.ok) return runVerification;

  const checkVerification = verifyCheckCoverage(goal, certificate.checkResults);
  if (!checkVerification.ok) return checkVerification;

  const evidenceVerification = verifyEvidence(certificate.evidence);
  if (!evidenceVerification.ok) return evidenceVerification;

  const judgeVerification = verifyJudge(
    certificate.judge,
    goal.successCriteria.some((criterion) =>
      criterion.acceptanceChecks.some((check) => check.kind === "model_review"),
    ),
  );
  if (!judgeVerification.ok) return judgeVerification;

  return { ok: true };
}

function verifyCheckCoverage(
  goal: Goal,
  results: unknown,
): GoalAcceptanceCertificateVerification {
  if (!Array.isArray(results)) {
    return failure("Certificate check results are malformed.");
  }

  const expectedChecks = goal.successCriteria.flatMap(
    (criterion) => criterion.acceptanceChecks,
  );
  const expectedById = new Map<string, (typeof expectedChecks)[number]>();
  for (const check of expectedChecks) {
    if (!isNonemptyString(check.id)) {
      return failure("Goal contains a malformed check id.");
    }
    if (expectedById.has(check.id)) {
      return failure(`Goal contains duplicate check id: ${check.id}.`);
    }
    expectedById.set(check.id, check);
  }

  const seenIds = new Set<string>();
  for (const result of results) {
    if (!isRecord(result) || !isNonemptyString(result.checkId)) {
      return failure("Certificate contains a malformed check result id.");
    }
    if (seenIds.has(result.checkId)) {
      return failure(`Certificate contains duplicate check id: ${result.checkId}.`);
    }
    seenIds.add(result.checkId);

    if (!isAcceptanceCheckKind(result.kind)) {
      return failure(`Certificate check kind is malformed for ${result.checkId}.`);
    }
    const expected = expectedById.get(result.checkId);
    if (!expected) {
      return failure(`Certificate contains unknown check id: ${result.checkId}.`);
    }
    if (expected.kind !== result.kind) {
      return failure(
        `Certificate contains an unknown check/kind pairing for ${result.checkId}.`,
      );
    }
    if (result.passed !== true) {
      return failure(`Certificate contains failed check: ${result.checkId}.`);
    }
    if (!isNonemptyString(result.code) || typeof result.detail !== "string") {
      return failure(`Certificate check structure is malformed for ${result.checkId}.`);
    }
    if (
      result.failureClass !== undefined &&
      !isNonemptyString(result.failureClass)
    ) {
      return failure(`Certificate check failure class is malformed for ${result.checkId}.`);
    }
    const refsVerification = verifyStringSet(
      result.evidenceRefs,
      `check evidence ref for ${result.checkId}`,
    );
    if (!refsVerification.ok) return refsVerification;
  }

  const missing = [...expectedById.keys()].filter((checkId) => !seenIds.has(checkId));
  if (missing.length > 0) {
    return failure(`Certificate is missing check coverage: ${missing.sort().join(", ")}.`);
  }
  return { ok: true };
}

function verifyEvidence(evidence: unknown): GoalAcceptanceCertificateVerification {
  if (!Array.isArray(evidence)) {
    return failure("Certificate evidence is malformed.");
  }

  const identities = new Set<string>();
  for (const entry of evidence) {
    if (!isRecord(entry) || !isNonemptyString(entry.ref)) {
      return failure("Certificate evidence ref is malformed.");
    }
    if (entry.path !== undefined && !isNonemptyString(entry.path)) {
      return failure(`Certificate evidence path is malformed for ${entry.ref}.`);
    }
    if (entry.sha256 !== undefined && !isSha256(entry.sha256)) {
      return failure(`Certificate evidence hash is malformed for ${entry.ref}.`);
    }
    if (
      entry.sizeBytes !== undefined &&
      (typeof entry.sizeBytes !== "number" ||
        !Number.isSafeInteger(entry.sizeBytes) ||
        entry.sizeBytes < 0)
    ) {
      return failure(`Certificate evidence size is malformed for ${entry.ref}.`);
    }
    const provenanceVerification = verifyStringSet(
      entry.provenanceRefs,
      `provenance ref for ${entry.ref}`,
    );
    if (!provenanceVerification.ok) return provenanceVerification;

    const identity = stableJson([entry.ref, entry.path ?? null]);
    if (identities.has(identity)) {
      return failure(`Certificate contains duplicate evidence entry: ${entry.ref}.`);
    }
    identities.add(identity);
  }
  return { ok: true };
}

function verifyJudge(
  judge: unknown,
  required: boolean,
): GoalAcceptanceCertificateVerification {
  if (judge === undefined) {
    return required
      ? failure("Certificate is missing required judge metadata.")
      : { ok: true };
  }
  if (
    !isRecord(judge) ||
    !isNonemptyString(judge.model) ||
    !isNonemptyString(judge.promptVersion) ||
    (judge.providerId !== undefined && !isNonemptyString(judge.providerId))
  ) {
    return failure("Certificate judge metadata is malformed.");
  }
  return verifyStringSet(judge.evaluatedMessageIds, "judge evaluated message id");
}

function verifyStringSet(
  value: unknown,
  label: string,
): GoalAcceptanceCertificateVerification {
  if (!Array.isArray(value)) {
    return failure(`Certificate ${label} set is malformed.`);
  }
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isNonemptyString(entry)) {
      return failure(`Certificate ${label} is malformed.`);
    }
    if (seen.has(entry)) {
      return failure(`Certificate contains duplicate ${label}: ${entry}.`);
    }
    seen.add(entry);
  }
  return { ok: true };
}

function createCertificateDigest(
  certificate: Omit<GoalAcceptanceCertificate, "certificateHash">,
): string {
  return sha256(stableJson(certificate));
}

function dedupeStableEntries<T>(
  entries: T[],
  identity: (entry: T) => string,
  label: string,
): T[] {
  const unique = new Map<string, T>();
  for (const entry of entries) {
    const key = identity(entry);
    const existing = unique.get(key);
    if (existing && stableJson(existing) !== stableJson(entry)) {
      throw new Error(`Conflicting ${label} entries share one stable identity.`);
    }
    unique.set(key, entry);
  }
  return [...unique.values()];
}

function compareStableDefinitions(left: unknown, right: unknown): number {
  const leftRecord = isRecord(left) ? left : {};
  const rightRecord = isRecord(right) ? right : {};
  const idOrder = String(leftRecord.id ?? "").localeCompare(
    String(rightRecord.id ?? ""),
  );
  return idOrder || stableJson(left).localeCompare(stableJson(right));
}

function compareCheckResults(
  left: GoalAcceptanceCheckResult,
  right: GoalAcceptanceCheckResult,
): number {
  return (
    left.checkId.localeCompare(right.checkId) ||
    left.kind.localeCompare(right.kind) ||
    stableJson(left).localeCompare(stableJson(right))
  );
}

function compareEvidence(
  left: GoalAcceptanceCertificate["evidence"][number],
  right: GoalAcceptanceCertificate["evidence"][number],
): number {
  return (
    left.ref.localeCompare(right.ref) ||
    (left.path ?? "").localeCompare(right.path ?? "") ||
    stableJson(left).localeCompare(stableJson(right))
  );
}

function uniqueSortedStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value, new WeakSet<object>()));
}

function canonicalize(value: unknown, ancestors: WeakSet<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Certificate hashing requires finite numbers.");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new TypeError("Cannot hash circular arrays.");
    ancestors.add(value);
    try {
      return value.map((entry) => canonicalize(entry, ancestors));
    } finally {
      ancestors.delete(value);
    }
  }
  if (!isRecord(value)) {
    throw new TypeError("Certificate hashing requires JSON-compatible values.");
  }
  if (ancestors.has(value)) throw new TypeError("Cannot hash circular objects.");
  ancestors.add(value);
  try {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          isSecretLikeKey(key)
            ? REDACTED_SECRET
            : canonicalize(value[key], ancestors),
        ]),
    );
  } finally {
    ancestors.delete(value);
  }
}

function isSecretLikeKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return [
    "apikey",
    "authorization",
    "bearer",
    "token",
    "password",
    "passwd",
    "secret",
    "cookie",
    "credential",
    "privatekey",
    "accesskey",
    "sessionkey",
  ].some((secretKey) => normalized.includes(secretKey));
}

function isAcceptanceCheckKind(value: unknown): value is AcceptanceCheckKind {
  return (
    typeof value === "string" &&
    (BUILTIN_CHECK_KINDS.has(value as AcceptanceCheckKind) ||
      /^validator:\S+$/.test(value))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function isValidDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function failure(reason: string): GoalAcceptanceCertificateVerification {
  return { ok: false, reason };
}
