import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { redactCredentials } from "../shared/credentialRedaction";
import { redactConversationDisclosurePaths } from "../shared/conversationDisclosure";
import type {
  ConversationDisclosureItem,
  ConversationDisclosureLifecycle,
  ConversationDisclosureRequiredness,
  ConversationDisclosureSnapshot,
  ConversationSourceCut,
} from "../shared/conversationDisclosure";

export const CONVERSATION_SHADOW_PARITY_SCHEMA_VERSION = 3 as const;

export type ConversationShadowDifferenceReason =
  | "legacy_tail"
  | "ephemeral_kernel"
  | "unsupported_presenter"
  | "optional_unknown"
  | "owner_not_linked";

export type ConversationShadowExpectation = {
  id: string;
  requiredness: ConversationDisclosureRequiredness;
  lifecycle: ConversationDisclosureLifecycle;
  canonicalBodyDigest: string;
};

export type ConversationShadowOptionalDifference = {
  id: string;
  reasonCode: ConversationShadowDifferenceReason;
  sourceCutWitness: string;
};

export type ConversationShadowScopeAudit = {
  scopeKey: string;
  sourceCutDigest: string;
  expectedCount: number;
  actualCount: number;
  missingRequiredFacts: number;
  requirednessMismatches: number;
  requirednessMismatchIds: string[];
  lifecycleMismatches: number;
  bodyMismatches: number;
  sourceCutMismatches: number;
  duplicateStableIdConflicts: number;
  sensitiveLeaks: number;
  optionalDifferences: ConversationShadowOptionalDifference[];
};

export type ConversationShadowParityArtifact = {
  schemaVersion: 3;
  kind: "conversation-disclosure-shadow-parity";
  programId: string;
  featureId: string;
  generatedAt: string;
  sourceDigest: string;
  fixtureDigest: string;
  integrationProof: {
    kind: "production-container-vitest";
    status: "passed";
    command: string;
    testFile: string;
    testFileSha256: string;
  };
  scopes: ConversationShadowScopeAudit[];
  totals: {
    missingRequiredFacts: number;
    requirednessMismatches: number;
    lifecycleMismatches: number;
    bodyMismatches: number;
    sourceCutMismatches: number;
    duplicateStableIdConflicts: number;
    sensitiveLeaks: number;
    optionalDifferences: number;
  };
  accepted: boolean;
  digest: string;
};

export function auditConversationDisclosureShadow(input: {
  snapshot: ConversationDisclosureSnapshot;
  expected: readonly ConversationShadowExpectation[];
  expectedSourceCuts?: readonly ConversationSourceCut[];
  expectedSourceCutDigest?: string;
  optionalReasons?: Readonly<Record<string, ConversationShadowDifferenceReason>>;
}): ConversationShadowScopeAudit {
  if (
    !input.expectedSourceCuts
    && !/^sha256:[0-9a-f]{64}$/.test(input.expectedSourceCutDigest ?? "")
  ) {
    throw new Error("shadow parity requires exact source-cut evidence");
  }
  const actualById = new Map<string, ConversationDisclosureItem>();
  let duplicateStableIdConflicts = 0;
  for (const item of input.snapshot.items) {
    const existing = actualById.get(item.id);
    if (existing && !isDeepStrictEqual(existing, item)) {
      duplicateStableIdConflicts += 1;
    } else if (!existing) {
      actualById.set(item.id, item);
    }
  }
  let missingRequiredFacts = 0;
  let requirednessMismatches = 0;
  const requirednessMismatchIds: string[] = [];
  let lifecycleMismatches = 0;
  let bodyMismatches = 0;
  const optionalDifferences: ConversationShadowOptionalDifference[] = [];
  const expectedIds = new Set(input.expected.map((entry) => entry.id));
  const sourceCutWitness = hashCanonical(input.snapshot.sourceCuts);
  for (const expected of input.expected) {
    const actual = actualById.get(expected.id);
    if (!actual) {
      if (expected.requiredness === "required") {
        missingRequiredFacts += 1;
      } else {
        optionalDifferences.push({
          id: expected.id,
          reasonCode: input.optionalReasons?.[expected.id] ?? "owner_not_linked",
          sourceCutWitness,
        });
      }
      continue;
    }
    if (
      sourceCutForItem(input.snapshot.sourceCuts, actual)?.requiredness
        !== expected.requiredness
    ) {
      requirednessMismatches += 1;
      requirednessMismatchIds.push(expected.id);
    }
    const lifecycleMismatch = actual.lifecycle !== expected.lifecycle;
    if (lifecycleMismatch) lifecycleMismatches += 1;
    if (
      !lifecycleMismatch
      && hashCanonical(actual) !== expected.canonicalBodyDigest
    ) {
      if (expected.requiredness === "required") {
        bodyMismatches += 1;
      } else {
        optionalDifferences.push({
          id: expected.id,
          reasonCode: input.optionalReasons?.[expected.id]
            ?? "unsupported_presenter",
          sourceCutWitness,
        });
      }
    }
  }
  for (const item of input.snapshot.items) {
    if (expectedIds.has(item.id)) continue;
    if (
      sourceCutForItem(input.snapshot.sourceCuts, item)?.requiredness
        === "required"
    ) {
      requirednessMismatches += 1;
      requirednessMismatchIds.push(item.id);
      continue;
    }
    optionalDifferences.push({
      id: item.id,
      reasonCode: input.optionalReasons?.[item.id] ?? (
        item.primarySource.kind === "kernel"
          ? "ephemeral_kernel"
          : item.primarySource.kind === "unknown"
            ? "optional_unknown"
            : "owner_not_linked"
      ),
      sourceCutWitness,
    });
  }
  const sensitiveLeaks = countSensitiveLeaks({
    snapshot: input.snapshot,
    expectedSourceCuts: input.expectedSourceCuts ?? [],
  });
  const sourceCutsMatch = input.expectedSourceCuts
    ? isDeepStrictEqual(
        normalizeCuts(input.snapshot.sourceCuts),
        normalizeCuts(input.expectedSourceCuts),
      )
    : sourceCutWitness === input.expectedSourceCutDigest;
  const sourceCutMismatches = sourceCutsMatch ? 0 : 1;
  return {
    scopeKey: input.snapshot.scope.key,
    sourceCutDigest: sourceCutWitness,
    expectedCount: input.expected.length,
    actualCount: input.snapshot.items.length,
    missingRequiredFacts,
    requirednessMismatches,
    requirednessMismatchIds: requirednessMismatchIds.sort(),
    lifecycleMismatches,
    bodyMismatches,
    sourceCutMismatches,
    duplicateStableIdConflicts,
    sensitiveLeaks,
    optionalDifferences: optionalDifferences
      .sort((left, right) => compareCanonicalStrings(left.id, right.id)),
  };
}

export function createConversationShadowBodyDigest(value: unknown): string {
  return hashCanonical(value);
}

export function buildConversationShadowParityArtifact(input: {
  programId: string;
  featureId: string;
  generatedAt: string;
  sourceDigest: string;
  fixtureDigest: string;
  integrationProof: ConversationShadowParityArtifact["integrationProof"];
  scopes: readonly ConversationShadowScopeAudit[];
}): ConversationShadowParityArtifact {
  const scopes = structuredClone([...input.scopes])
    .sort((left, right) =>
      compareCanonicalStrings(left.scopeKey, right.scopeKey));
  const totals = scopes.reduce(
    (sum, scope) => ({
      missingRequiredFacts:
        sum.missingRequiredFacts + scope.missingRequiredFacts,
      requirednessMismatches:
        sum.requirednessMismatches + scope.requirednessMismatches,
      lifecycleMismatches:
        sum.lifecycleMismatches + scope.lifecycleMismatches,
      bodyMismatches: sum.bodyMismatches + scope.bodyMismatches,
      sourceCutMismatches:
        sum.sourceCutMismatches + scope.sourceCutMismatches,
      duplicateStableIdConflicts:
        sum.duplicateStableIdConflicts + scope.duplicateStableIdConflicts,
      sensitiveLeaks: sum.sensitiveLeaks + scope.sensitiveLeaks,
      optionalDifferences:
        sum.optionalDifferences + scope.optionalDifferences.length,
    }),
    {
      missingRequiredFacts: 0,
      requirednessMismatches: 0,
      lifecycleMismatches: 0,
      bodyMismatches: 0,
      sourceCutMismatches: 0,
      duplicateStableIdConflicts: 0,
      sensitiveLeaks: 0,
      optionalDifferences: 0,
    },
  );
  const withoutDigest = {
    schemaVersion: CONVERSATION_SHADOW_PARITY_SCHEMA_VERSION,
    kind: "conversation-disclosure-shadow-parity" as const,
    programId: input.programId,
    featureId: input.featureId,
    generatedAt: input.generatedAt,
    sourceDigest: input.sourceDigest,
    fixtureDigest: input.fixtureDigest,
    integrationProof: structuredClone(input.integrationProof),
    scopes,
    totals,
    accepted: totals.missingRequiredFacts === 0
      && totals.requirednessMismatches === 0
      && totals.lifecycleMismatches === 0
      && totals.bodyMismatches === 0
      && totals.sourceCutMismatches === 0
      && totals.duplicateStableIdConflicts === 0
      && totals.sensitiveLeaks === 0,
  };
  return { ...withoutDigest, digest: hashCanonical(withoutDigest) };
}

export function validateConversationShadowParityArtifact(
  artifact: ConversationShadowParityArtifact,
): string[] {
  const errors: string[] = [];
  const { digest, ...withoutDigest } = artifact;
  if (artifact.schemaVersion !== CONVERSATION_SHADOW_PARITY_SCHEMA_VERSION
    || artifact.kind !== "conversation-disclosure-shadow-parity"
    || !artifact.programId
    || !artifact.featureId
    || !Number.isFinite(Date.parse(artifact.generatedAt))
    || !/^sha256:[0-9a-f]{64}$/.test(artifact.sourceDigest)
    || !/^sha256:[0-9a-f]{64}$/.test(artifact.fixtureDigest)
    || artifact.integrationProof?.kind !== "production-container-vitest"
    || artifact.integrationProof.status !== "passed"
    || !artifact.integrationProof.command
    || !artifact.integrationProof.testFile
    || !/^sha256:[0-9a-f]{64}$/.test(
      artifact.integrationProof.testFileSha256,
    )) {
    errors.push("shadow parity identity is invalid");
  }
  if (digest !== hashCanonical(withoutDigest)) {
    errors.push("shadow parity digest is stale");
  }
  const recomputed = buildConversationShadowParityArtifact({
    programId: artifact.programId,
    featureId: artifact.featureId,
    generatedAt: artifact.generatedAt,
    sourceDigest: artifact.sourceDigest,
    fixtureDigest: artifact.fixtureDigest,
    integrationProof: artifact.integrationProof,
    scopes: artifact.scopes,
  });
  if (!isDeepStrictEqual(recomputed.totals, artifact.totals)
    || recomputed.accepted !== artifact.accepted) {
    errors.push("shadow parity totals are stale");
  }
  if (
    artifact.accepted
    && (
      artifact.totals.missingRequiredFacts !== 0
      || artifact.totals.requirednessMismatches !== 0
      || artifact.totals.lifecycleMismatches !== 0
      || artifact.totals.bodyMismatches !== 0
      || artifact.totals.sourceCutMismatches !== 0
      || artifact.totals.duplicateStableIdConflicts !== 0
      || artifact.totals.sensitiveLeaks !== 0
    )
  ) {
    errors.push("shadow parity cannot accept a required or safety mismatch");
  }
  return errors;
}

function normalizeCuts(cuts: readonly ConversationSourceCut[]) {
  return [...cuts].sort((left, right) =>
    compareCanonicalStrings(cutKey(left), cutKey(right)));
}

function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function cutKey(cut: ConversationSourceCut): string {
  return `${cut.source}:${cut.originalKind ?? ""}:${cut.sourceIdentity ?? ""}`;
}

function sourceCutForItem(
  cuts: readonly ConversationSourceCut[],
  item: ConversationDisclosureItem,
): ConversationSourceCut | undefined {
  return cuts.find((cut) =>
    cut.source === item.primarySource.kind
    && cut.sourceIdentity === `record:${item.primarySource.ref}`
    && (
      item.primarySource.kind !== "unknown"
      || cut.originalKind === item.primarySource.originalKind
    ));
}

function countSensitiveLeaks(value: unknown): number {
  let leaks = 0;
  const visit = (current: unknown, key = "") => {
    if (forbiddenKey(key)) {
      leaks += 1;
      return;
    }
    if (typeof current === "string") {
      if (!isDeepStrictEqual(redactCredentials(current), current)) leaks += 1;
      if (
        !isDeepStrictEqual(
          redactConversationDisclosurePaths(current),
          current,
        )
      ) {
        leaks += 1;
      }
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((entry) => visit(entry));
      return;
    }
    if (!current || typeof current !== "object") return;
    for (const [entryKey, entryValue] of Object.entries(
      current as Record<string, unknown>,
    )) {
      visit(entryValue, entryKey);
    }
  };
  visit(value);
  return leaks;
}

function forbiddenKey(key: string): boolean {
  return [
    "args",
    "content",
    "fileContent",
    "rawReasoning",
    "resultRef",
    "path",
    "filePath",
    "cwd",
    "workingDirectory",
    "rootPath",
    "workspaceRoot",
    "grant",
    "permissionGrant",
  ].includes(key);
}

function hashCanonical(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(canonicalJson(value))
    .digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(",")}}`;
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  throw new Error(`unsupported shadow parity value: ${typeof value}`);
}
