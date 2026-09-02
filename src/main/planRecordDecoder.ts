import type { PlanRecord } from "../shared/planMode";
import { sanitizePlanRecordDiagnostics } from "../shared/planDiagnostics";
import { validateOutputSchema } from "./actors/actorOutputSchema";

type Schema = Record<string, unknown>;

const stringSchema = { type: "string" };
const numberSchema = { type: "number" };
const booleanSchema = { type: "boolean" };
const objectSchema = { type: "object" };
const stringArraySchema = arrayOf(stringSchema);

function arrayOf(items: Schema): Schema {
  return { type: "array", items };
}

function objectOf(
  properties: Record<string, Schema>,
  required: string[] = [],
): Schema {
  return {
    type: "object",
    ...(required.length ? { required } : {}),
    properties,
  };
}

function enumOf(values: readonly unknown[]): Schema {
  return { enum: [...values] };
}

const usageSchema = objectOf({
  inputTokens: numberSchema,
  outputTokens: numberSchema,
  estimated: booleanSchema,
});

const modelBindingSchema = objectOf({
  profileId: stringSchema,
  connectionId: stringSchema,
  providerKind: stringSchema,
  modelId: stringSchema,
  contextWindow: numberSchema,
  contextWindowSource: objectOf({
    kind: enumOf(["public_catalog", "provider_metadata"]),
    label: stringSchema,
    checkedAt: stringSchema,
  }, ["kind", "label"]),
  revision: numberSchema,
  connectionRevision: numberSchema,
  profileRevision: numberSchema,
  baseUrl: stringSchema,
  capabilities: objectOf({
    tools: booleanSchema,
    vision: booleanSchema,
    pdf: booleanSchema,
    streaming: booleanSchema,
    parallelToolCalls: booleanSchema,
  }),
  generation: objectOf({
    temperature: numberSchema,
    maxTokens: numberSchema,
    thinkingEnabled: booleanSchema,
    thinkingBudgetTokens: numberSchema,
  }),
});

const acceptanceCheckSchema = objectOf({
  id: stringSchema,
  kind: stringSchema,
  description: stringSchema,
  requiresEvidence: booleanSchema,
});

const goalIssueSchema = objectOf({
  id: stringSchema,
  severity: stringSchema,
  description: stringSchema,
  evidenceRefs: stringArraySchema,
});

const milestoneSchema = objectOf({
  id: stringSchema,
  title: stringSchema,
  description: stringSchema,
  acceptanceCriteria: stringArraySchema,
  dependencies: stringArraySchema,
  targetRefs: stringArraySchema,
  evidenceRefs: stringArraySchema,
  actions: stringArraySchema,
  toolNames: stringArraySchema,
  acceptanceChecks: arrayOf(acceptanceCheckSchema),
});

const riskSchema = objectOf({
  id: stringSchema,
  severity: stringSchema,
  description: stringSchema,
  mitigation: stringSchema,
  status: stringSchema,
});

const proposalSchema = objectOf({
  title: stringSchema,
  summary: stringSchema,
  objective: stringSchema,
  scope: objectOf({ in: stringArraySchema, out: stringArraySchema }),
  assumptions: stringArraySchema,
  milestones: arrayOf(milestoneSchema),
  dependencies: stringArraySchema,
  risks: arrayOf(riskSchema),
  acceptanceCriteria: stringArraySchema,
  acceptanceChecks: arrayOf(acceptanceCheckSchema),
  goalContractIssues: arrayOf(goalIssueSchema),
  claimLedger: arrayOf(objectOf({
    id: stringSchema,
    claim: stringSchema,
    evidenceRefs: stringArraySchema,
    counterexamples: stringArraySchema,
    conditions: stringArraySchema,
    confidence: numberSchema,
    status: stringSchema,
  }, ["evidenceRefs", "counterexamples", "conditions"])),
  unresolvedQuestions: stringArraySchema,
  minorityOpinion: stringArraySchema,
  actionGate: stringSchema,
  gateReason: stringSchema,
  markdown: stringSchema,
  issues: arrayOf(objectOf({
    id: stringSchema,
    target: stringSchema,
    severity: stringSchema,
    claim: stringSchema,
    evidenceOrCounterexample: stringSchema,
    requestedChange: stringSchema,
    status: stringSchema,
  })),
  unresolvedRisks: arrayOf(riskSchema),
  decisions: arrayOf(objectOf({
    issueId: stringSchema,
    decision: stringSchema,
    reason: stringSchema,
    changedSections: stringArraySchema,
  }, ["changedSections"])),
});

const goalContractRefSchema = objectOf({
  id: stringSchema,
  revision: numberSchema,
  sha256: stringSchema,
});

const goalPlanRefSchema = objectOf({
  planId: stringSchema,
  planRevision: numberSchema,
  goalPlanVersion: numberSchema,
  mode: stringSchema,
  purpose: stringSchema,
  goalContractRef: goalContractRefSchema,
}, ["goalContractRef"]);

const goalContractSnapshotSchema = objectOf({
  schemaVersion: numberSchema,
  id: stringSchema,
  revision: numberSchema,
  source: objectOf({
    kind: stringSchema,
    ref: stringSchema,
    summary: stringSchema,
  }),
  objective: stringSchema,
  deliverables: stringArraySchema,
  scope: objectOf(
    { in: stringArraySchema, out: stringArraySchema },
    ["in", "out"],
  ),
  assumptions: stringArraySchema,
  constraints: arrayOf(objectOf({
    id: stringSchema,
    dimension: stringSchema,
    strength: stringSchema,
    description: stringSchema,
  })),
  successCriteria: arrayOf(objectOf({
    id: stringSchema,
    description: stringSchema,
  })),
  stopPolicy: objectSchema,
  riskPolicy: objectSchema,
  createdAt: stringSchema,
}, [
  "source",
  "deliverables",
  "scope",
  "assumptions",
  "constraints",
  "successCriteria",
  "stopPolicy",
  "riskPolicy",
]);

const selectedSkillSchema = objectOf({
  rootDir: stringSchema,
  skillFile: stringSchema,
  rootIdentity: objectOf({ dev: stringSchema, ino: stringSchema }, ["dev", "ino"]),
  skillFileIdentity: objectOf({ dev: stringSchema, ino: stringSchema }, ["dev", "ino"]),
  body: stringSchema,
  manifest: objectOf({
    name: stringSchema,
    displayName: stringSchema,
    description: stringSchema,
    version: stringSchema,
    execution: objectOf({
      mode: enumOf(["agent", "script"]),
      entrypoint: {},
      maxTurns: numberSchema,
    }, ["mode", "entrypoint"]),
    inputs: arrayOf(objectOf({
      name: stringSchema,
      label: stringSchema,
      type: enumOf(["string", "path", "number", "boolean", "choice"]),
      required: booleanSchema,
      description: stringSchema,
      defaultValue: {},
      choices: stringArraySchema,
    }, ["name", "label", "type", "required"])),
    permissions: objectOf({
      files: objectOf(
        { read: stringArraySchema, write: stringArraySchema },
        ["read", "write"],
      ),
      shell: objectOf({ commands: stringArraySchema }, ["commands"]),
      web: objectOf(
        { search: booleanSchema, fetchDomains: stringArraySchema },
        ["search", "fetchDomains"],
      ),
      memory: objectOf(
        { read: booleanSchema, write: booleanSchema },
        ["read", "write"],
      ),
    }, ["files", "shell", "web", "memory"]),
    planning: objectOf({
      required: booleanSchema,
      maxSteps: numberSchema,
    }, ["required"]),
    tools: arrayOf(objectOf({
      name: stringSchema,
      description: stringSchema,
      parameters: objectSchema,
      entrypoint: stringSchema,
    }, ["name", "description", "parameters", "entrypoint"])),
    mcpServers: arrayOf(objectOf({
      name: stringSchema,
      transport: enumOf(["stdio", "http", "sse"]),
      command: stringSchema,
      readRoots: stringArraySchema,
      network: booleanSchema,
    }, ["name", "transport"])),
    dependencies: stringArraySchema,
  }, [
    "name",
    "displayName",
    "description",
    "version",
    "execution",
    "inputs",
    "permissions",
  ]),
}, ["rootDir", "skillFile", "body", "manifest"]);

const planRecordSchema = objectOf({
  schemaVersion: numberSchema,
  id: stringSchema,
  sessionId: stringSchema,
  workspaceId: stringSchema,
  workspaceRoot: stringSchema,
  sourceMessage: stringSchema,
  baseSourceMessage: stringSchema,
  clarifications: stringArraySchema,
  requestedSkillName: {},
  selectedSkill: selectedSkillSchema,
  mode: enumOf(["direct", "debate"]),
  autonomyMode: enumOf(["standard", "auto"]),
  status: enumOf([
    "drafting", "paused", "awaiting_input", "awaiting_confirmation",
    "confirmed_pending_execution", "executing", "steps_completed",
    "completed", "superseded", "discarded", "canceled", "failed",
  ]),
  actionGate: enumOf(["ready", "needs_input", "blocked"]),
  revision: numberSchema,
  taskProfile: objectOf({
    domain: stringSchema,
    mode: stringSchema,
    risk: stringSchema,
    expectedScale: stringSchema,
    needsConfirmation: booleanSchema,
    targetRefs: arrayOf(objectOf({
      rawText: stringSchema,
      canonical: stringSchema,
      kind: stringSchema,
      exists: booleanSchema,
      confidence: numberSchema,
      alternatives: stringArraySchema,
    }, ["alternatives"])),
    ambiguity: arrayOf(objectOf({
      field: stringSchema,
      reason: stringSchema,
      options: stringArraySchema,
    }, ["options"])),
    investigationDepth: stringSchema,
  }, ["targetRefs", "ambiguity"]),
  planningBrief: objectOf({
    objective: stringSchema,
    deliverables: stringArraySchema,
    inScope: stringArraySchema,
    outOfScope: stringArraySchema,
    constraints: stringArraySchema,
    assumptions: stringArraySchema,
    unresolvedQuestions: stringArraySchema,
    targetRefs: stringArraySchema,
    evidenceRefs: stringArraySchema,
    skillCandidates: arrayOf(objectOf({
      name: stringSchema,
      reason: stringSchema,
      evidenceRefs: stringArraySchema,
    }, ["evidenceRefs"])),
    recommendedSkillName: stringSchema,
    recommendedSkillReason: stringSchema,
    recommendedSkillInputValues: objectSchema,
    recommendedSkillInputEvidenceRefs: objectSchema,
  }, [
    "deliverables",
    "inScope",
    "outOfScope",
    "constraints",
    "assumptions",
    "unresolvedQuestions",
    "targetRefs",
    "evidenceRefs",
    "skillCandidates",
  ]),
  planningStages: arrayOf(objectOf({
    id: stringSchema,
    kind: enumOf([
      "triage", "investigation", "skill_route", "contract", "generation",
      "review", "quality",
    ]),
    runId: stringSchema,
    status: enumOf(["pending", "running", "completed", "failed", "invalidated"]),
    investigationDepth: enumOf(["quick", "standard", "deep"]),
    modelBinding: modelBindingSchema,
    evidenceRefs: stringArraySchema,
    reviewApproved: booleanSchema,
    reviewIssues: arrayOf(objectOf({
      code: stringSchema,
      severity: stringSchema,
      message: stringSchema,
      repairable: booleanSchema,
      repairInstruction: stringSchema,
    })),
    revisionAttempted: booleanSchema,
    gateRepairAttempted: booleanSchema,
    startedAt: stringSchema,
    completedAt: stringSchema,
    latencyMs: numberSchema,
    usage: usageSchema,
    error: stringSchema,
    failureExcerpt: stringSchema,
  })),
  skillDecision: objectOf({
    source: enumOf(["explicit", "automatic", "none"]),
    selectedSkillName: stringSchema,
    reason: stringSchema,
    evidenceRefs: stringArraySchema,
    alternatives: arrayOf(objectOf({
      name: stringSchema,
      reason: stringSchema,
      evidenceRefs: stringArraySchema,
    }, ["evidenceRefs"])),
    snapshotSha256: stringSchema,
    inputValues: objectSchema,
    inputEvidenceRefs: objectSchema,
    missingInputFields: stringArraySchema,
    invalidInputFields: stringArraySchema,
    permissions: objectOf({
      fileRead: stringArraySchema,
      fileWrite: stringArraySchema,
      shellCommands: stringArraySchema,
      webSearch: booleanSchema,
      webFetchDomains: stringArraySchema,
      memoryRead: booleanSchema,
      memoryWrite: booleanSchema,
    }, ["fileRead", "fileWrite", "shellCommands", "webFetchDomains"]),
  }, [
    "evidenceRefs",
    "alternatives",
    "inputValues",
    "inputEvidenceRefs",
    "missingInputFields",
    "invalidInputFields",
  ]),
  selectedSkillInputValues: objectSchema,
  qualityReport: objectOf({
    status: stringSchema,
    blockingIssues: arrayOf(objectOf({
      code: stringSchema,
      severity: stringSchema,
      message: stringSchema,
    })),
    warnings: arrayOf(objectOf({
      code: stringSchema,
      severity: stringSchema,
      message: stringSchema,
    })),
    evidenceCoverage: objectOf({
      referenced: numberSchema,
      total: numberSchema,
      missingRefs: stringArraySchema,
    }),
    acceptanceCoverage: objectOf({
      deterministicChecks: numberSchema,
      modelReviewChecks: numberSchema,
      totalChecks: numberSchema,
      milestonesCovered: numberSchema,
      milestonesTotal: numberSchema,
    }),
    generatedAt: stringSchema,
  }),
  taskContract: objectOf({
    objective: stringSchema,
    audience: stringSchema,
    deliverables: stringArraySchema,
    inScope: stringArraySchema,
    outOfScope: stringArraySchema,
    constraints: stringArraySchema,
    successCriteria: stringArraySchema,
    assumptions: stringArraySchema,
    targetRefs: stringArraySchema,
    evidenceRefs: stringArraySchema,
  }),
  purpose: stringSchema,
  goalContractSnapshot: goalContractSnapshotSchema,
  goalContractRef: goalContractRefSchema,
  goalId: stringSchema,
  parentPlanRef: goalPlanRefSchema,
  goalPlanVersion: numberSchema,
  trigger: objectOf({
    kind: stringSchema,
    summary: stringSchema,
    evidenceRefs: stringArraySchema,
    at: stringSchema,
  }, ["evidenceRefs"]),
  criterionBindings: arrayOf(objectOf({
    criterionId: stringSchema,
    milestoneIds: stringArraySchema,
    checkIds: stringArraySchema,
  }, ["milestoneIds", "checkIds"])),
  goalContractIssues: arrayOf(goalIssueSchema),
  supersededByPlanId: stringSchema,
  supersededAt: stringSchema,
  evidence: arrayOf(objectOf({
    id: stringSchema,
    kind: stringSchema,
    title: stringSchema,
    summary: stringSchema,
    sourceRef: stringSchema,
    sha256: stringSchema,
    sourceHashes: arrayOf(objectOf({
      sourceRef: stringSchema,
      sha256: stringSchema,
    })),
  })),
  requestedModelAssignments: objectOf({
    direct: stringSchema,
    a: stringSchema,
    b: stringSchema,
    c: stringSchema,
  }),
  frozenModelAssignments: objectOf({
    direct: modelBindingSchema,
    a: modelBindingSchema,
    b: modelBindingSchema,
    c: modelBindingSchema,
  }),
  rounds: arrayOf(objectOf({
    id: stringSchema,
    kind: enumOf(["direct", "a1", "b1", "a2", "b2", "c"]),
    role: enumOf(["direct", "a", "b", "c"]),
    ordinal: numberSchema,
    runId: stringSchema,
    modelBinding: modelBindingSchema,
    status: enumOf(["pending", "running", "completed", "failed", "invalidated"]),
    publicInputRefs: stringArraySchema,
    output: proposalSchema,
    error: stringSchema,
    failureExcerpt: stringSchema,
    startedAt: stringSchema,
    completedAt: stringSchema,
    latencyMs: numberSchema,
    usage: usageSchema,
  })),
  finalArtifact: proposalSchema,
  projection: objectOf({
    path: stringSchema,
    sha256: stringSchema,
    writtenAt: stringSchema,
  }),
  projectionIntent: objectOf({
    kind: enumOf(["artifact", "tombstone"]),
    renderVersion: enumOf([1]),
    expectedSha256: {},
    nextPath: stringSchema,
    nextSha256: stringSchema,
    body: stringSchema,
    targetStatus: enumOf([
      "drafting", "paused", "awaiting_input", "awaiting_confirmation",
      "confirmed_pending_execution", "executing", "steps_completed",
      "completed", "superseded", "discarded", "canceled", "failed",
    ]),
    targetActionGate: enumOf(["ready", "needs_input", "blocked"]),
    preparedAt: stringSchema,
  }, [
    "kind", "renderVersion", "expectedSha256", "nextPath", "nextSha256",
    "body", "targetStatus", "targetActionGate", "preparedAt",
  ]),
  executionGoalId: stringSchema,
  executionRunId: stringSchema,
  confirmedRevision: numberSchema,
  confirmedAt: stringSchema,
  createdAt: stringSchema,
  updatedAt: stringSchema,
}, [
  "id",
  "sessionId",
  "sourceMessage",
  "mode",
  "status",
  "actionGate",
  "revision",
  "taskContract",
  "evidence",
  "requestedModelAssignments",
  "frozenModelAssignments",
  "rounds",
  "createdAt",
  "updatedAt",
]);

export class InvalidPersistedPlanRecordError extends Error {
  constructor(path: string) {
    super(`持久化计划记录结构非法：${path}`);
    this.name = "InvalidPersistedPlanRecordError";
  }
}

export function decodePersistedPlanRecord(value: unknown): PlanRecord {
  const error = validateOutputSchema(value, planRecordSchema);
  if (error) throw new InvalidPersistedPlanRecordError(error);
  const record = value as Record<string, unknown>;
  assertNullableString(record.requestedSkillName, "$.requestedSkillName");
  assertStringArrayRecord(
    (record.planningBrief as Record<string, unknown> | undefined)
      ?.recommendedSkillInputEvidenceRefs,
    "$.planningBrief.recommendedSkillInputEvidenceRefs",
  );
  assertSkillInputValueRecord(
    (record.planningBrief as Record<string, unknown> | undefined)
      ?.recommendedSkillInputValues,
    "$.planningBrief.recommendedSkillInputValues",
  );
  assertSkillInputValueRecord(
    (record.skillDecision as Record<string, unknown> | undefined)?.inputValues,
    "$.skillDecision.inputValues",
  );
  assertSkillInputValueRecord(
    record.selectedSkillInputValues,
    "$.selectedSkillInputValues",
  );
  assertStringArrayRecord(
    (record.skillDecision as Record<string, unknown> | undefined)
      ?.inputEvidenceRefs,
    "$.skillDecision.inputEvidenceRefs",
  );
  assertSelectedSkillServers(record.selectedSkill);
  assertSelectedSkillScalars(record.selectedSkill);
  return sanitizePlanRecordDiagnostics(value as PlanRecord);
}

function assertNullableString(value: unknown, path: string): void {
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw new InvalidPersistedPlanRecordError(path);
  }
}

function assertStringArrayRecord(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidPersistedPlanRecordError(path);
  }
  for (const refs of Object.values(value)) {
    if (!Array.isArray(refs) || !refs.every((ref) => typeof ref === "string")) {
      throw new InvalidPersistedPlanRecordError(path);
    }
  }
}

function assertSkillInputValueRecord(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidPersistedPlanRecordError(path);
  }
  for (const [key, input] of Object.entries(value)) {
    if (
      !key
      || (typeof input !== "string"
        && typeof input !== "number"
        && typeof input !== "boolean")
      || (typeof input === "number" && !Number.isFinite(input))
    ) {
      throw new InvalidPersistedPlanRecordError(path);
    }
  }
}

function assertSelectedSkillServers(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const manifest = (value as Record<string, unknown>).manifest;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return;
  }
  const servers = (manifest as Record<string, unknown>).mcpServers;
  if (servers === undefined) return;
  for (const server of servers as Array<Record<string, unknown>>) {
    const valid = server.transport === "stdio"
      || server.transport === "http"
      || server.transport === "sse";
    if (!valid) {
      throw new InvalidPersistedPlanRecordError(
        "$.selectedSkill.manifest.mcpServers",
      );
    }
  }
}

function assertSelectedSkillScalars(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const manifest = (value as Record<string, unknown>).manifest;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return;
  }
  const manifestRecord = manifest as Record<string, unknown>;
  const execution = manifestRecord.execution as Record<string, unknown>;
  assertNullableString(
    execution.entrypoint,
    "$.selectedSkill.manifest.execution.entrypoint",
  );
  if (
    execution.maxTurns !== undefined
    && (!Number.isInteger(execution.maxTurns) || Number(execution.maxTurns) <= 0)
  ) {
    throw new InvalidPersistedPlanRecordError(
      "$.selectedSkill.manifest.execution.maxTurns",
    );
  }
  const planning = manifestRecord.planning as Record<string, unknown> | undefined;
  if (
    planning?.maxSteps !== undefined
    && (!Number.isInteger(planning.maxSteps) || Number(planning.maxSteps) <= 0)
  ) {
    throw new InvalidPersistedPlanRecordError(
      "$.selectedSkill.manifest.planning.maxSteps",
    );
  }
  const inputs = manifestRecord.inputs as Array<Record<string, unknown>>;
  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index];
    if (input.defaultValue === undefined) continue;
    const expectedType = input.type === "number"
      ? "number"
      : input.type === "boolean"
        ? "boolean"
        : "string";
    if (typeof input.defaultValue !== expectedType) {
      throw new InvalidPersistedPlanRecordError(
        `$.selectedSkill.manifest.inputs[${index}].defaultValue`,
      );
    }
  }
}
