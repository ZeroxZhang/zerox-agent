import type {
  AgentExecutionArtifact,
  AgentExecutionStatus,
  AgentFailureClass,
} from "./agentExecution";
import type { AgentRunContext } from "./agentWorkspace";
import type { ModelServiceNotice } from "./modelServiceNotice";
import {
  SecretSafeFailureError,
  type SecretSafeFailureCode,
} from "./secretSafeFailure";
import { redactCredentials } from "./credentialRedaction";

export type AgentRunStatus = AgentExecutionStatus;

export type AgentPhase = "planning" | "executing" | "reflecting" | "done";

export type AgentRunEvent = {
  level: "info" | "warn" | "error";
  message: string;
  phase?: AgentPhase;
  data?: Record<string, unknown>;
  createdAt: string;
};

/**
 * Publishes an AgentRun observation without allowing observer failures to alter
 * the owning run lifecycle. Observers are projections, never participants in
 * admission, execution, persistence, or settlement.
 */
export function publishAgentRunObserverEvent(
  onEvent: ((event: AgentRunEvent) => void) | undefined,
  event: AgentRunEvent,
): AgentRunEvent {
  try {
    const observed = onEvent?.(event) as unknown;
    if (
      observed &&
      typeof observed === "object" &&
      "then" in observed &&
      typeof observed.then === "function"
    ) {
      void Promise.resolve(observed).catch(() => undefined);
    }
  } catch {
    // AgentRun observers are deliberately best-effort projections.
  }
  return event;
}

export type ExecutionPlan = {
  steps: ExecutionStep[];
  estimatedTurns: number;
  reasoning: string;
};

export type ExecutionStep = {
  description: string;
  expectedTool?: string;
  expectedOutcome: string;
  status: "pending" | "in_progress" | "completed" | "failed";
};

export type AgentRunRecord = {
  id: string;
  taskId: string;
  taskName: string;
  skillName: string;
  status: AgentRunStatus;
  runContext?: AgentRunContext;
  summary: string;
  events: AgentRunEvent[];
  checkpointId?: string;
  checkpointPath?: string;
  artifacts?: AgentExecutionArtifact[];
  childRunIds?: string[];
  modelServiceNotice?: ModelServiceNotice;
  /** Absent on legacy rows; interpreted as revision 1. */
  executionRevision?: number;
  failureClass?: AgentFailureClass;
  failureCode?: SecretSafeFailureCode;
  failureMessage?: string;
  startedAt: string;
  finishedAt: string;
};

/**
 * AgentRun records cross both public and durable boundaries. Keep their
 * authority identifiers stable while projecting every descriptive field
 * through the shared credential sanitizer.
 */
export function projectSecretSafeAgentRun(
  run: AgentRunRecord,
): AgentRunRecord {
  const projected = redactCredentials(run) as AgentRunRecord;
  return {
    ...projected,
    id: run.id,
    taskId: run.taskId,
  };
}

export type AgentRunAdmissionCandidate = Readonly<{
  runId: string;
  taskId: string;
  sessionId?: string;
  /** Absent only for legacy callers; interpreted as revision 1. */
  executionRevision?: number;
  /** Required for resumed owners so admission is bound before execution. */
  executionEnvelope?: AgentRunExecutionEnvelope;
}>;

export type AgentRunAdmissionLease = Readonly<{
  runId: string;
  taskId: string;
  /** Absent only on legacy admission leases; interpreted as revision 1. */
  executionRevision?: number;
  /** Must exactly echo a candidate execution envelope when one is present. */
  executionEnvelope?: AgentRunExecutionEnvelope;
  settle(status: AgentRunStatus, expectedExecutionRevision?: number): Promise<void>;
}>;

export type AgentRunAdmissionGate = (
  candidate: AgentRunAdmissionCandidate,
) => Promise<AgentRunAdmissionLease | void>;

export class AgentRunPostCommitSettlementError extends SecretSafeFailureError {
  constructor(cause?: unknown) {
    super("AGENT_RUN_EXECUTION_FAILED", cause);
    this.name = "AgentRunPostCommitSettlementError";
  }
}

export class AgentRunRevisionConflictError extends SecretSafeFailureError {
  constructor(cause?: unknown) {
    super("AGENT_RUN_EXECUTION_FAILED", cause);
    this.name = "AgentRunRevisionConflictError";
  }
}

/**
 * Commits the owning AgentRun before its causal admission can become terminal.
 * Callers may perform best-effort projections only after this boundary.
 */
export async function commitAdmittedAgentRun(input: Readonly<{
  run: AgentRunRecord;
  admissionLease?: AgentRunAdmissionLease;
  appendRun: (run: AgentRunRecord) => Promise<unknown>;
  onRunPersisted?: (run: AgentRunRecord) => void;
}>): Promise<void> {
  const safeRun = projectSecretSafeAgentRun(input.run);
  await input.appendRun(safeRun);
  input.onRunPersisted?.(safeRun);
  try {
    await input.admissionLease?.settle(
      safeRun.status,
      resolveAgentRunExecutionRevision(safeRun),
    );
  } catch (error) {
    throw new AgentRunPostCommitSettlementError(error);
  }
}

export type AgentRunExecutionAdmittedHandler = (
  candidate: AgentRunAdmissionCandidate,
) => void | Promise<void>;

export function assertAgentRunAdmissionLease(
  candidate: AgentRunAdmissionCandidate,
  lease: AgentRunAdmissionLease | void,
): AgentRunAdmissionLease | undefined {
  if (!lease) return undefined;
  if (lease.runId !== candidate.runId || lease.taskId !== candidate.taskId) {
    throw new AgentRunRevisionConflictError();
  }
  if (
    resolveAgentRunExecutionRevision(lease)
    !== resolveAgentRunExecutionRevision(candidate)
  ) {
    throw new AgentRunRevisionConflictError();
  }
  if (
    candidate.executionEnvelope === undefined
      ? lease.executionEnvelope !== undefined
      : lease.executionEnvelope === undefined
        || !areAgentRunExecutionEnvelopesEqual(
          candidate.executionEnvelope,
          lease.executionEnvelope,
        )
  ) {
    throw new AgentRunRevisionConflictError();
  }
  return lease;
}

export function requireAgentRunAdmissionLease(
  candidate: AgentRunAdmissionCandidate,
  lease: AgentRunAdmissionLease | void,
): AgentRunAdmissionLease {
  const admitted = assertAgentRunAdmissionLease(candidate, lease);
  if (!admitted) {
    throw new AgentRunRevisionConflictError();
  }
  return admitted;
}

export function resolveAgentRunExecutionRevision(
  value: { executionRevision?: number },
): number {
  if (value.executionRevision === undefined) return 1;
  return Number.isSafeInteger(value.executionRevision)
    && value.executionRevision > 0
    ? value.executionRevision
    : Number.NaN;
}

export type AgentRunRevisionWriteDisposition =
  | "insert"
  | "duplicate"
  | "replace"
  | "conflict";

export type AgentRunExecutionEnvelope = Readonly<Pick<
  AgentRunRecord,
  "id" | "taskId" | "taskName" | "skillName" | "runContext" | "startedAt"
>>;

export function projectAgentRunExecutionEnvelope(
  run: AgentRunRecord,
): AgentRunExecutionEnvelope {
  return {
    id: run.id,
    taskId: run.taskId,
    taskName: run.taskName,
    skillName: run.skillName,
    ...(run.runContext === undefined ? {} : { runContext: run.runContext }),
    startedAt: run.startedAt,
  };
}

export function areAgentRunExecutionEnvelopesEqual(
  left: AgentRunExecutionEnvelope,
  right: AgentRunExecutionEnvelope,
): boolean {
  return JSON.stringify(toCanonicalJsonValue(left))
    === JSON.stringify(toCanonicalJsonValue(right));
}

function toCanonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(toCanonicalJsonValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, toCanonicalJsonValue(item)]),
    );
  }
  return value;
}

export function classifyAgentRunRevisionWrite(
  current: AgentRunRecord | null,
  candidate: AgentRunRecord,
  isExactDuplicate: (left: AgentRunRecord, right: AgentRunRecord) => boolean,
  isExecutionEnvelopeEqual: (
    left: AgentRunExecutionEnvelope,
    right: AgentRunExecutionEnvelope,
  ) => boolean,
): AgentRunRevisionWriteDisposition {
  const candidateRevision = resolveAgentRunExecutionRevision(candidate);
  if (!Number.isSafeInteger(candidateRevision) || candidateRevision < 1) {
    return "conflict";
  }
  if (!current) {
    return candidateRevision === 1 ? "insert" : "conflict";
  }
  const currentRevision = resolveAgentRunExecutionRevision(current);
  if (!Number.isSafeInteger(currentRevision) || currentRevision < 1) {
    return "conflict";
  }
  if (candidateRevision === currentRevision) {
    return isExactDuplicate(current, candidate) ? "duplicate" : "conflict";
  }
  const candidateIsTerminal =
    candidate.status === "succeeded"
    || candidate.status === "paused"
    || candidate.status === "failed"
    || candidate.status === "canceled";
  return current.status === "paused"
    && candidateRevision === currentRevision + 1
    && candidateIsTerminal
    && isExecutionEnvelopeEqual(
      projectAgentRunExecutionEnvelope(current),
      projectAgentRunExecutionEnvelope(candidate),
    )
    ? "replace"
    : "conflict";
}

export type RunScheduledTaskResult =
  | {
      ok: true;
      run: AgentRunRecord;
    }
  | {
      ok: false;
      message: string;
    };

export type CancelScheduledTaskRunResult =
  | {
      ok: true;
      message: string;
    }
  | {
      ok: false;
      message: string;
    };

export type PauseAgentRunResult = CancelScheduledTaskRunResult;

export type OpenAgentRunSessionResult =
  | {
      ok: true;
      sessionId: string;
    }
  | {
      ok: false;
      message: string;
    };
