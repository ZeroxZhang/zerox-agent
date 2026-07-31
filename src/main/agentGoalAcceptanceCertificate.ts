import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";
import type {
  AcceptanceCheck,
  AcceptanceCheckKind,
  Goal,
  GoalAcceptanceCertificate,
  GoalAcceptanceCheckResult,
  GoalEvidenceManifest,
  SuccessCriterion,
} from "../shared/agentGoal";
import {
  redactAndBoundAcceptanceSummary,
  redactAndBoundEvidenceRef,
} from "./agentGoalRedaction";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_CANONICAL_DEPTH = 64;
const MAX_CANONICAL_NODES = 20_000;
const MAX_CANONICAL_ARRAY_LENGTH = 10_000;
const MAX_CANONICAL_STRING_LENGTH = 262_144;
const MAX_CANONICAL_BYTES = 1_048_576;
const CREATE_INPUT_KEYS = new Set([
  "goal",
  "acceptedAt",
  "runIds",
  "checkResults",
  "evidenceManifest",
  "provenanceRefs",
  "judge",
]);
const JUDGE_INPUT_KEYS = new Set([
  "providerId",
  "model",
  "promptVersion",
  "evaluatedMessageIds",
]);

const SECRET_PARAM_KEYS = new Set([
  "apikey",
  "accesskey",
  "accesstoken",
  "authorization",
  "bearer",
  "bearertoken",
  "clientsecret",
  "cookie",
  "credential",
  "credentials",
  "password",
  "passwd",
  "privatekey",
  "refreshtoken",
  "secret",
  "sessionkey",
  "token",
]);
const SECRET_PARAM_SUFFIXES = [
  "apikey",
  "accesskey",
  "accesstoken",
  "bearertoken",
  "clientsecret",
  "privatekey",
  "refreshtoken",
  "sessionkey",
] as const;

const BUILTIN_CHECK_KINDS = new Set<AcceptanceCheckKind>([
  "file_exists",
  "command_exit_code",
  "test_passes",
  "assertion",
  "model_review",
]);

type CanonicalState = {
  ancestors: WeakSet<object>;
  nodes: number;
  rejectSecretKeys: boolean;
};

type CertificateEvidence = GoalAcceptanceCertificate["evidence"][number];

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

export class GoalAcceptanceCertificateInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoalAcceptanceCertificateInputError";
  }
}

export function createGoalCriteriaHash(
  goal: Pick<Goal, "successCriteria">,
): string {
  return protectCreation("Goal criteria are not certificate-safe.", () =>
    createGoalCriteriaHashInternal(goal),
  );
}

export function createGoalAcceptanceCertificate(
  input: CreateGoalAcceptanceCertificateInput,
): GoalAcceptanceCertificate {
  return protectCreation("Certificate input is not certificate-safe.", () =>
    createGoalAcceptanceCertificateInternal(input),
  );
}

export function verifyGoalAcceptanceCertificate(
  goal: Goal,
): GoalAcceptanceCertificateVerification {
  try {
    return verifyGoalAcceptanceCertificateInternal(goal);
  } catch (error) {
    const inputError = toInputError(
      error,
      "Certificate data is not plain bounded JSON.",
    );
    return failure(`Certificate input is invalid: ${inputError.message}`);
  }
}

function createGoalCriteriaHashInternal(
  goal: Pick<Goal, "successCriteria">,
): string {
  const criteria = cloneCanonical(
    goal.successCriteria,
    "goal success criteria",
    true,
  ) as SuccessCriterion[];
  const identity = criteria
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

  return sha256(stableJson(identity));
}

function createGoalAcceptanceCertificateInternal(
  input: CreateGoalAcceptanceCertificateInput,
): GoalAcceptanceCertificate {
  assertExactDataEnvelope(
    input,
    "Certificate creation input",
    CREATE_INPUT_KEYS,
  );
  const runIds = normalizeStringSet(input.runIds, "run id", 1);
  const criteriaHash = createGoalCriteriaHashInternal(input.goal);
  const goalChecks = getGoalChecks(input.goal);
  const semantic = goalChecks.some((check) => check.kind === "model_review");

  const rawResults = cloneCanonical(
    input.checkResults,
    "certificate check results",
  ) as GoalAcceptanceCheckResult[];
  const checkResults = dedupeStableEntries(
    rawResults.map((result) => ({
      checkId: result.checkId,
      kind: result.kind,
      passed: result.passed,
      code: result.code,
      ...(result.failureClass ? { failureClass: result.failureClass } : {}),
      evidenceRefs: normalizeRedactedStringSet(
        result.evidenceRefs,
        `check evidence ref for ${result.checkId}`,
      ),
      detail: redactAndBoundAcceptanceSummary(result.detail),
    })),
    (result) => stableJson([result.checkId, result.kind]),
    "check result",
  ).sort(compareCheckResults);

  const provenanceMap = input.provenanceRefs
    ? cloneCanonical(
        input.provenanceRefs,
        "certificate provenance map",
      ) as Record<string, string[]>
    : {};
  const artifacts = cloneCanonical(
    input.evidenceManifest.artifacts,
    "certificate evidence manifest artifacts",
  ) as GoalEvidenceManifest["artifacts"];
  const evidence = dedupeStableEntries(
    artifacts.map((artifact) => ({
      ref: redactAndBoundEvidenceRef(artifact.ref),
      ...(artifact.path !== undefined
        ? { path: redactAndBoundEvidenceRef(artifact.path) }
        : {}),
      ...(artifact.sha256 !== undefined ? { sha256: artifact.sha256 } : {}),
      ...(artifact.sizeBytes !== undefined
        ? { sizeBytes: artifact.sizeBytes }
        : {}),
      provenanceRefs: normalizeRedactedStringSet(
        provenanceMap[artifact.ref] ?? [],
        `provenance ref for ${artifact.ref}`,
      ),
    })),
    evidenceIdentity,
    "evidence entry",
  );
  evidence.sort(compareEvidence);

  const judge = normalizeJudge(input.judge, semantic);
  const groundingVerification = verifyEvidenceReferences(
    input.goal,
    checkResults,
    evidence,
    judge,
    runIds,
  );
  if (!groundingVerification.ok) {
    throw new GoalAcceptanceCertificateInputError(
      groundingVerification.reason,
    );
  }
  const unsigned: Omit<GoalAcceptanceCertificate, "certificateHash"> = {
    version: 1,
    goalId: requireNonemptyString(input.goal.id, "goal id"),
    acceptedAt: requireNonemptyString(input.acceptedAt, "accepted timestamp"),
    protocolVersion: 2,
    criteriaHash,
    planVersion: requireSafeNonnegativeInteger(
      input.goal.planVersion,
      "plan version",
    ),
    runIds,
    checkResults,
    evidence,
    ...(judge ? { judge } : {}),
  };

  return {
    ...unsigned,
    certificateHash: createCertificateDigest(unsigned),
  };
}

function normalizeRedactedStringSet(
  values: readonly string[],
  label: string,
  minimumLength = 0,
): string[] {
  return normalizeStringSet(
    values.map(redactAndBoundEvidenceRef),
    label,
    minimumLength,
  );
}

function verifyGoalAcceptanceCertificateInternal(
  goal: Goal,
): GoalAcceptanceCertificateVerification {
  if (goal.status !== "achieved") {
    return failure("Only an achieved goal can be acceptance-certified.");
  }
  if (goal.acceptanceProtocolVersion !== 2) {
    return failure("Goal acceptance protocol mismatch; protocol v2 is required.");
  }

  const rawCertificate = goal.acceptanceCertificate;
  if (!rawCertificate || !isRecord(rawCertificate)) {
    return failure("Protocol v2 achieved goal requires a certificate.");
  }
  const certificate = cloneCanonical(
    rawCertificate,
    "acceptance certificate",
  ) as GoalAcceptanceCertificate;
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
  if (certificate.criteriaHash !== createGoalCriteriaHashInternal(goal)) {
    return failure("Certificate criteria hash mismatch.");
  }
  if (
    !isNonemptyString(certificate.acceptedAt) ||
    !isValidDate(certificate.acceptedAt)
  ) {
    return failure("Certificate accepted timestamp is malformed.");
  }

  const runVerification = verifyStringSet(
    certificate.runIds,
    "run id",
    1,
    "Certificate requires nonempty run identity.",
  );
  if (!runVerification.ok) return runVerification;

  const checkVerification = verifyCheckCoverage(goal, certificate.checkResults);
  if (!checkVerification.ok) return checkVerification;

  const evidenceVerification = verifyEvidence(certificate.evidence);
  if (!evidenceVerification.ok) return evidenceVerification;

  const semantic = getGoalChecks(goal).some(
    (check) => check.kind === "model_review",
  );
  const judgeVerification = verifyJudge(certificate.judge, semantic);
  if (!judgeVerification.ok) return judgeVerification;

  const referenceVerification = verifyEvidenceReferences(
    goal,
    certificate.checkResults,
    certificate.evidence,
    certificate.judge,
    certificate.runIds,
  );
  if (!referenceVerification.ok) return referenceVerification;

  return { ok: true };
}

function normalizeJudge(
  judge: CreateGoalAcceptanceCertificateInput["judge"],
  required: boolean,
): GoalAcceptanceCertificate["judge"] | undefined {
  if (!judge) {
    if (required) {
      throw new GoalAcceptanceCertificateInputError(
        "Semantic model_review certificates require judge metadata.",
      );
    }
    return undefined;
  }
  assertExactDataEnvelope(judge, "Certificate judge input", JUDGE_INPUT_KEYS);

  const normalized = {
    ...(judge.providerId !== undefined
      ? { providerId: requireNonemptyString(judge.providerId, "judge provider id") }
      : {}),
    model: requireNonemptyString(judge.model, "judge model"),
    promptVersion: requireNonemptyString(
      judge.promptVersion,
      "judge prompt version",
    ),
    evaluatedMessageIds: normalizeStringSet(
      judge.evaluatedMessageIds,
      "judge evaluated message id",
      required ? 1 : 0,
    ),
  };
  return cloneCanonical(normalized, "judge metadata") as typeof normalized;
}

function verifyCheckCoverage(
  goal: Goal,
  results: unknown,
): GoalAcceptanceCertificateVerification {
  if (!Array.isArray(results)) {
    return failure("Certificate check results are malformed.");
  }

  const expectedChecks = getGoalChecks(goal);
  const expectedById = new Map<string, AcceptanceCheck>();
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
      return failure(
        `Certificate check failure class is malformed for ${result.checkId}.`,
      );
    }
    const refsVerification = verifyStringSet(
      result.evidenceRefs,
      `check evidence ref for ${result.checkId}`,
    );
    if (!refsVerification.ok) return refsVerification;
  }

  const missing = [...expectedById.keys()].filter((checkId) => !seenIds.has(checkId));
  if (missing.length > 0) {
    return failure(
      `Certificate is missing check coverage: ${missing.sort(compareCodeUnits).join(", ")}.`,
    );
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

function verifyEvidenceReferences(
  goal: Pick<Goal, "successCriteria">,
  checkResults: GoalAcceptanceCheckResult[],
  evidence: GoalAcceptanceCertificate["evidence"],
  judge: GoalAcceptanceCertificate["judge"],
  runIds: string[],
): GoalAcceptanceCertificateVerification {
  const resolutionCounts = new Map<string, number>();
  for (const entry of evidence) {
    for (const ref of new Set([entry.ref, ...entry.provenanceRefs])) {
      resolutionCounts.set(ref, (resolutionCounts.get(ref) ?? 0) + 1);
    }
  }
  const judgeMessageIds = new Set(judge?.evaluatedMessageIds ?? []);
  const runEvidenceRefs = new Set(runIds.map((runId) => `run:${runId}`));

  const expectedById = new Map(
    getGoalChecks(goal).map((check) => [check.id, check]),
  );
  for (const result of checkResults) {
    const expected = expectedById.get(result.checkId);
    const declaredLogicalRefs = expected
      ? getDeclaredLogicalEvidenceRefs(expected)
      : new Set<string>();
    if (expected?.requiresEvidence && result.evidenceRefs.length === 0) {
      return failure(
        `Check ${result.checkId} requires evidence but has missing evidence refs.`,
      );
    }
    for (const ref of result.evidenceRefs) {
      let matches = resolutionCounts.get(ref) ?? 0;
      if (expected?.kind === "model_review" && judgeMessageIds.has(ref)) {
        matches += 1;
      }
      if (runEvidenceRefs.has(ref)) {
        matches += 1;
      }
      if (
        expected?.kind === "model_review" &&
        declaredLogicalRefs.has(ref)
      ) {
        matches += 1;
      }
      if (matches === 0) {
        return failure(
          `Check ${result.checkId} evidence ref ${ref} is not grounded and does not resolve to certificate evidence, declared review evidence, judge messages, or runs.`,
        );
      }
      if (matches > 1) {
        return failure(
          `Check ${result.checkId} evidence ref ${ref} is ambiguous across certificate evidence.`,
        );
      }
    }
  }
  return { ok: true };
}

function getDeclaredLogicalEvidenceRefs(check: AcceptanceCheck): Set<string> {
  const configured = check.params.evidenceRefs;
  if (!Array.isArray(configured)) return new Set();

  return new Set(
    configured
      .filter((ref): ref is string => typeof ref === "string")
      .map((ref) => redactAndBoundEvidenceRef(ref.trim()))
      .filter((ref) => ref.length > 0 && !ref.startsWith("artifact:")),
  );
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
  return verifyStringSet(
    judge.evaluatedMessageIds,
    "judge evaluated message id",
    required ? 1 : 0,
    "Semantic certificate requires nonempty judge evaluated message identity.",
  );
}

function verifyStringSet(
  value: unknown,
  label: string,
  minimum = 0,
  minimumReason = `Certificate requires a nonempty ${label} set.`,
): GoalAcceptanceCertificateVerification {
  if (!Array.isArray(value)) {
    return failure(`Certificate ${label} set is malformed.`);
  }
  if (value.length < minimum) {
    return failure(minimumReason);
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

function getGoalChecks(
  goal: Pick<Goal, "successCriteria">,
): AcceptanceCheck[] {
  const criteria = cloneCanonical(
    goal.successCriteria,
    "goal success criteria",
    true,
  ) as SuccessCriterion[];
  return criteria.flatMap((criterion) => criterion.acceptanceChecks);
}

function normalizeStringSet(
  value: readonly string[],
  label: string,
  minimum = 0,
): string[] {
  const cloned = cloneCanonical(value, `${label} set`) as unknown;
  if (!Array.isArray(cloned)) {
    throw new GoalAcceptanceCertificateInputError(`${label} set is malformed.`);
  }
  const result: string[] = [];
  for (const entry of cloned) {
    if (!isNonemptyString(entry)) {
      throw new GoalAcceptanceCertificateInputError(`${label} is malformed.`);
    }
    result.push(entry);
  }
  const unique = [...new Set(result)].sort(compareCodeUnits);
  if (unique.length < minimum) {
    throw new GoalAcceptanceCertificateInputError(
      `Certificate requires nonempty ${label} identity.`,
    );
  }
  return unique;
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
      throw new GoalAcceptanceCertificateInputError(
        `Conflicting ${label} entries share one stable identity.`,
      );
    }
    unique.set(key, entry);
  }
  return [...unique.values()];
}

function evidenceIdentity(entry: CertificateEvidence): string {
  return stableJson([entry.ref, entry.path ?? null]);
}

function compareStableDefinitions(left: unknown, right: unknown): number {
  const leftRecord = isRecord(left) ? left : {};
  const rightRecord = isRecord(right) ? right : {};
  return (
    compareCodeUnits(String(leftRecord.id ?? ""), String(rightRecord.id ?? "")) ||
    compareCodeUnits(stableJson(left), stableJson(right))
  );
}

function compareCheckResults(
  left: GoalAcceptanceCheckResult,
  right: GoalAcceptanceCheckResult,
): number {
  return (
    compareCodeUnits(left.checkId, right.checkId) ||
    compareCodeUnits(left.kind, right.kind) ||
    compareCodeUnits(stableJson(left), stableJson(right))
  );
}

function compareEvidence(left: CertificateEvidence, right: CertificateEvidence): number {
  return (
    compareCodeUnits(left.ref, right.ref) ||
    compareCodeUnits(left.path ?? "", right.path ?? "") ||
    compareCodeUnits(stableJson(left), stableJson(right))
  );
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableJson(value: unknown): string {
  const canonical = canonicalizeRoot(value, false);
  const serialized = JSON.stringify(canonical);
  if (Buffer.byteLength(serialized, "utf8") > MAX_CANONICAL_BYTES) {
    throw new GoalAcceptanceCertificateInputError(
      "Canonical byte bound exceeded.",
    );
  }
  return serialized;
}

function cloneCanonical(
  value: unknown,
  label: string,
  rejectSecretKeys = false,
): unknown {
  return protectCreation(`${label} is not plain bounded JSON.`, () => {
    const canonical = canonicalizeRoot(value, rejectSecretKeys);
    const serialized = JSON.stringify(canonical);
    if (Buffer.byteLength(serialized, "utf8") > MAX_CANONICAL_BYTES) {
      throw new GoalAcceptanceCertificateInputError(
        "Canonical byte bound exceeded.",
      );
    }
    return canonical;
  });
}

function canonicalizeRoot(value: unknown, rejectSecretKeys: boolean): unknown {
  return canonicalize(value, 0, {
    ancestors: new WeakSet<object>(),
    nodes: 0,
    rejectSecretKeys,
  });
}

function canonicalize(
  value: unknown,
  depth: number,
  state: CanonicalState,
): unknown {
  state.nodes += 1;
  if (state.nodes > MAX_CANONICAL_NODES) {
    throw new GoalAcceptanceCertificateInputError("Canonical node bound exceeded.");
  }
  if (depth > MAX_CANONICAL_DEPTH) {
    throw new GoalAcceptanceCertificateInputError("Canonical depth bound exceeded.");
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > MAX_CANONICAL_STRING_LENGTH) {
      throw new GoalAcceptanceCertificateInputError(
        "Canonical string bound exceeded.",
      );
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new GoalAcceptanceCertificateInputError(
        "Certificate hashing requires finite numbers.",
      );
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") {
    throw new GoalAcceptanceCertificateInputError(
      "Certificate hashing accepts only JSON scalars, arrays, and records.",
    );
  }
  if (isProxy(value)) {
    throw new GoalAcceptanceCertificateInputError(
      "Certificate hashing rejects proxy values.",
    );
  }
  if (state.ancestors.has(value)) {
    throw new GoalAcceptanceCertificateInputError(
      "Certificate hashing rejects circular values.",
    );
  }

  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) {
      throw new GoalAcceptanceCertificateInputError(
        "Certificate hashing requires plain JSON arrays.",
      );
    }
    return canonicalizeArray(value, depth, state);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new GoalAcceptanceCertificateInputError(
      "Certificate hashing requires plain JSON records.",
    );
  }
  return canonicalizeRecord(value, depth, state);
}

function canonicalizeArray(
  value: unknown[],
  depth: number,
  state: CanonicalState,
): unknown[] {
  if (value.length > MAX_CANONICAL_ARRAY_LENGTH) {
    throw new GoalAcceptanceCertificateInputError(
      "Canonical array bound exceeded.",
    );
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key === "symbol")) {
    throw new GoalAcceptanceCertificateInputError(
      "Certificate hashing rejects symbol array properties.",
    );
  }
  for (const key of keys as string[]) {
    if (key === "length") continue;
    if (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) {
      throw new GoalAcceptanceCertificateInputError(
        "Certificate hashing rejects custom array properties.",
      );
    }
  }

  state.ancestors.add(value);
  try {
    return Array.from({ length: value.length }, (_, index) => {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new GoalAcceptanceCertificateInputError(
          "Certificate hashing rejects sparse or accessor arrays.",
        );
      }
      return canonicalize(descriptor.value, depth + 1, state);
    });
  } finally {
    state.ancestors.delete(value);
  }
}

function canonicalizeRecord(
  value: object,
  depth: number,
  state: CanonicalState,
): Record<string, unknown> {
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.some((key) => typeof key === "symbol")) {
    throw new GoalAcceptanceCertificateInputError(
      "Certificate hashing rejects symbol record properties.",
    );
  }
  const keys = (ownKeys as string[]).sort(compareCodeUnits);
  const result: Record<string, unknown> = Object.create(null);

  state.ancestors.add(value);
  try {
    for (const key of keys) {
      if (key.length > MAX_CANONICAL_STRING_LENGTH) {
        throw new GoalAcceptanceCertificateInputError(
          "Canonical string bound exceeded for an object key.",
        );
      }
      if (state.rejectSecretKeys && isSecretParamKey(key)) {
        throw new GoalAcceptanceCertificateInputError(
          `Goal acceptance criteria params contain forbidden secret key "${key}".`,
        );
      }
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new GoalAcceptanceCertificateInputError(
          "Certificate hashing rejects accessor or non-enumerable record properties.",
        );
      }
      result[key] = canonicalize(descriptor.value, depth + 1, state);
    }
    return result;
  } finally {
    state.ancestors.delete(value);
  }
}

function isSecretParamKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (
    SECRET_PARAM_KEYS.has(normalized) ||
    SECRET_PARAM_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  ) {
    return true;
  }

  const words = key
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  const last = words.at(-1) ?? "";
  const lastPair = words.slice(-2).join("");
  return SECRET_PARAM_KEYS.has(last) ||
    SECRET_PARAM_SUFFIXES.some((suffix) => lastPair === suffix);
}

function assertExactDataEnvelope(
  value: unknown,
  label: string,
  allowedKeys: Set<string>,
): asserts value is Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    isProxy(value)
  ) {
    throw new GoalAcceptanceCertificateInputError(
      `${label} must be a plain non-proxy record.`,
    );
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new GoalAcceptanceCertificateInputError(
      `${label} must be a plain record.`,
    );
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key === "symbol")) {
    throw new GoalAcceptanceCertificateInputError(
      `${label} contains an undeclared symbol property.`,
    );
  }
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new GoalAcceptanceCertificateInputError(
        `${label} property "${key}" must be an enumerable data property.`,
      );
    }
    if (!allowedKeys.has(key)) {
      throw new GoalAcceptanceCertificateInputError(
        `${label} contains undeclared property "${key}".`,
      );
    }
  }
}

function protectCreation<T>(fallback: string, operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    throw toInputError(error, fallback);
  }
}

function toInputError(
  error: unknown,
  fallback: string,
): GoalAcceptanceCertificateInputError {
  return error instanceof GoalAcceptanceCertificateInputError
    ? error
    : new GoalAcceptanceCertificateInputError(fallback);
}

function requireNonemptyString(value: unknown, label: string): string {
  if (!isNonemptyString(value)) {
    throw new GoalAcceptanceCertificateInputError(`${label} is malformed.`);
  }
  if (value.length > MAX_CANONICAL_STRING_LENGTH) {
    throw new GoalAcceptanceCertificateInputError(
      `Canonical string bound exceeded for ${label}.`,
    );
  }
  return value;
}

function requireSafeNonnegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new GoalAcceptanceCertificateInputError(`${label} is malformed.`);
  }
  return value;
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
