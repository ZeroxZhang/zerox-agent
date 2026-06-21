import type { AgentExecutionStatus, AgentFailureClass } from "./agentExecution";
import type { AgentRunRecord } from "./agentRuns";
import type { AgentTrajectoryEvent } from "./agentTrajectory";
import type { KernelEvent } from "./kernelContract";
import type { WorkspaceRunEvent } from "./workspaceRunLedger";

export type RunGraphNodeKind =
  | "goal"
  | "milestone"
  | "runtime_run"
  | "turn"
  | "model_request"
  | "tool_call"
  | "gate"
  | "acceptance_check"
  | "checkpoint"
  | "artifact"
  | "summary"
  | "actor" // P6 (Patch 21)
  | "workflow" // P6 (Patch 21)
  | "dream" // P7 (Patch 25)
  | "distill" // P7 (Patch 25)
  | "model_response" // P8 (Patch 11)
  | "ensemble"; // P8 (Patch 11)

export type RunGraphNodeStatus =
  | "planned"
  | "ready"
  | "running"
  | "waiting"
  | "blocked"
  | "succeeded"
  | "failed"
  | "paused"
  | "canceled"
  | "skipped";

export type RunGraphGateKind =
  | "permission"
  | "workspace_sandbox"
  | "goal_review"
  | "acceptance"
  | "strategy_guard"
  | "reconcile";

export type RunGraphNodeResult = {
  status: Extract<
    RunGraphNodeStatus,
    "succeeded" | "failed" | "paused" | "canceled" | "blocked"
  >;
  summary?: string;
  evidenceRefs: string[];
  artifactRefs?: string[];
  failureClass?: AgentFailureClass;
  retryable?: boolean;
  decidedBy?: "deterministic" | "model_judge" | "user" | "policy" | "runtime";
};

export type RunGraphNode = {
  id: string;
  kind: RunGraphNodeKind;
  status: RunGraphNodeStatus;
  title: string;
  sourceRefs: string[];
  result?: RunGraphNodeResult;
};

export type RunGraphEdgeRelation =
  | "contains"
  | "depends_on"
  | "produced"
  | "checked_by"
  | "blocked_by"
  | "spawned_by" // P6 (Patch 21): actor → parent actor / run
  | "candidate_of"; // P8 (Patch 11): ensemble candidate → winner

export type RunGraphEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  relation: RunGraphEdgeRelation;
};

export type RunGraphGate = {
  id: string;
  kind: RunGraphGateKind;
  status: Extract<RunGraphNodeStatus, "waiting" | "blocked" | "succeeded">;
  title: string;
  sourceRefs: string[];
};

export type RunGraphEvidence = {
  ref: string;
  source: "trajectory" | "kernel" | "run" | "workspace_run";
  eventType?: string;
};

export type RunGraphView = {
  graphId: string;
  runId: string;
  nodes: RunGraphNode[];
  edges: RunGraphEdge[];
  gates: RunGraphGate[];
  evidence: RunGraphEvidence[];
  totalUsage?: RunGraphTokenUsage; // P8 (Patch 11)
};

// P8 (Patch 11): token cost aggregation for runGraph.
export type RunGraphTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type ProjectRunGraphInput = {
  run: AgentRunRecord;
  trajectoryEvents?: AgentTrajectoryEvent[];
  kernelEvents?: KernelEvent[];
  workspaceRunEvents?: WorkspaceRunEvent[];
};

type MutableNode = RunGraphNode & { order: number };

export function projectRunGraph(input: ProjectRunGraphInput): RunGraphView {
  const nodes = new Map<string, MutableNode>();
  const edges = new Map<string, RunGraphEdge>();
  const gates = new Map<string, RunGraphGate>();
  const evidence = new Map<string, RunGraphEvidence>();
  const runNodeId = `run:${input.run.id}`;
  const acceptedTrajectoryRunIds = buildAcceptedTrajectoryRunIds(input.run);

  addNode(nodes, {
    id: runNodeId,
    kind: "runtime_run",
    status: toGraphStatus(input.run.status),
    title: input.run.taskName,
    sourceRefs: [`run:${input.run.id}`],
    result: isTerminalStatus(input.run.status)
      ? {
          status: toTerminalResultStatus(input.run.status),
          summary: input.run.summary,
          evidenceRefs: [`run:${input.run.id}`],
          ...(input.run.failureClass
            ? { failureClass: input.run.failureClass }
            : {}),
          decidedBy: "runtime",
        }
      : undefined,
    order: 0,
  });
  evidence.set(`run:${input.run.id}`, {
    ref: `run:${input.run.id}`,
    source: "run",
  });

  const orderedKernelEvents = [...(input.kernelEvents ?? [])]
    .filter((event) => event.runId === input.run.id)
    .sort(compareKernelEvents);
  for (const [index, event] of orderedKernelEvents.entries()) {
    const ref = `kernel:${event.runId}:${event.type}:${event.createdAt}:${index}`;
    evidence.set(ref, { ref, source: "kernel", eventType: event.type });
    if (event.type === "turn_start") {
      const turnNodeId = `turn:${event.turn}`;
      addNode(nodes, {
        id: turnNodeId,
        kind: "turn",
        status: "running",
        title: `Turn ${event.turn}/${event.maxTurns}`,
        sourceRefs: [ref],
        order: kernelOrder(event),
      });
      addEdge(edges, runNodeId, turnNodeId, "contains");
    }
    if (event.type === "run_end") {
      const runNode = nodes.get(runNodeId);
      if (runNode) {
        runNode.status = toGraphStatus(event.status);
        runNode.result = {
          status: toTerminalResultStatus(event.status),
          summary: event.reason,
          evidenceRefs: [...new Set([...(runNode.result?.evidenceRefs ?? []), ref])],
          decidedBy: "runtime",
        };
        runNode.sourceRefs = [...new Set([...runNode.sourceRefs, ref])];
      }
    }
  }

  let lastToolNodeId: string | null = null;
  const openToolNodeIdsByName = new Map<string, string[]>();
  const totalUsage: RunGraphTokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const orderedWorkspaceRunEvents = [...(input.workspaceRunEvents ?? [])]
    .sort(compareWorkspaceRunEvents);
  for (const event of orderedWorkspaceRunEvents) {
    const ref = `workspace-run:${event.id}`;
    evidence.set(ref, {
      ref,
      source: "workspace_run",
      eventType: event.type,
    });

    if (event.type === "tool_call") {
      const nodeId = `tool:${event.toolCallId}`;
      addNode(nodes, {
        id: nodeId,
        kind: "tool_call",
        status: "running",
        title: event.toolName,
        sourceRefs: [ref],
        order: workspaceRunOrder(event),
      });
      addEdge(edges, runNodeId, nodeId, "contains");
      recordOpenToolCall(openToolNodeIdsByName, event.toolName, nodeId);
      lastToolNodeId = nodeId;
    }

    if (event.type === "tool_result") {
      const nodeId = `tool:${event.toolCallId}`;
      const ok = event.ok === true;
      const node = nodes.get(nodeId);
      if (node) {
        node.status = ok ? "succeeded" : "failed";
        node.result = {
          status: ok ? "succeeded" : "failed",
          evidenceRefs: [ref],
          decidedBy: "runtime",
        };
        node.sourceRefs = [...new Set([...node.sourceRefs, ref])];
      }
      closeOpenToolCall(openToolNodeIdsByName, event.toolName ?? null, nodeId);
      lastToolNodeId = nodeId;
    }
  }
  const orderedTrajectoryEvents = [...(input.trajectoryEvents ?? [])]
    .filter((event) => acceptedTrajectoryRunIds.has(event.runId))
    .sort(compareTrajectoryEvents);
  for (const event of orderedTrajectoryEvents) {
    const ref = `trajectory:${event.id}`;
    evidence.set(ref, {
      ref,
      source: "trajectory",
      eventType: event.type,
    });

    if (event.type === "goal_planned") {
      const goalId = readString(event.payload.goalId) ?? event.id;
      const nodeId = `goal:${goalId}`;
      addNode(nodes, {
        id: nodeId,
        kind: "goal",
        status: "planned",
        title: readString(event.payload.description) ?? `Goal ${goalId}`,
        sourceRefs: [ref],
        order: trajectoryOrder(event),
      });
      addEdge(edges, runNodeId, nodeId, "contains");
    }

    if (event.type === "milestone_started") {
      const milestoneId = readString(event.payload.milestoneId) ?? event.id;
      const goalId = readString(event.payload.goalId);
      const nodeId = `milestone:${milestoneId}`;
      addNode(nodes, {
        id: nodeId,
        kind: "milestone",
        status: "running",
        title:
          readString(event.payload.description) ??
          readString(event.payload.title) ??
          `Milestone ${milestoneId}`,
        sourceRefs: [ref],
        order: trajectoryOrder(event),
      });
      if (goalId) {
        const goalNodeId = `goal:${goalId}`;
        if (!nodes.has(goalNodeId)) {
          addNode(nodes, {
            id: goalNodeId,
            kind: "goal",
            status: "planned",
            title: `Goal ${goalId}`,
            sourceRefs: [ref],
            order: trajectoryOrder(event) - 1,
          });
          addEdge(edges, runNodeId, goalNodeId, "contains");
        }
        addEdge(edges, goalNodeId, nodeId, "contains");
      } else {
        addEdge(edges, runNodeId, nodeId, "contains");
      }
    }

    if (event.type === "model_request") {
      const turn = readNumber(event.payload.turn) ?? event.sequence;
      const nodeId = `model_request:${turn}`;
      addNode(nodes, {
        id: nodeId,
        kind: "model_request",
        status: "running",
        title: `Model request ${turn}`,
        sourceRefs: [ref],
        order: trajectoryOrder(event),
      });
      addEdge(edges, runNodeId, nodeId, "contains");
    }

    if (event.type === "tool_call") {
      const toolName = readString(event.payload.toolName) ?? "tool_call";
      const toolCallId = readString(event.payload.toolCallId) ?? event.id;
      const nodeId = `tool:${toolCallId}`;
      addNode(nodes, {
        id: nodeId,
        kind: "tool_call",
        status: "running",
        title: toolName,
        sourceRefs: [ref],
        order: trajectoryOrder(event),
      });
      addEdge(edges, runNodeId, nodeId, "contains");
      recordOpenToolCall(openToolNodeIdsByName, toolName, nodeId);
      lastToolNodeId = nodeId;
    }

    if (event.type === "tool_result") {
      const toolName = readString(event.payload.toolName);
      const explicitToolCallId = readString(event.payload.toolCallId);
      const nodeId: string =
        explicitToolCallId !== null
          ? `tool:${explicitToolCallId}`
          : findOpenToolCall(openToolNodeIdsByName, toolName) ??
            lastToolNodeId ??
            `tool:${event.id}`;
      const ok = event.payload.ok === true;
      const node = nodes.get(nodeId);
      if (node) {
        const failureSummary = readString(event.payload.error);
        node.status = ok ? "succeeded" : "failed";
        node.result = {
          status: ok ? "succeeded" : "failed",
          evidenceRefs: [ref],
          decidedBy: "runtime",
          ...(ok || !failureSummary ? {} : { summary: failureSummary }),
        };
        node.sourceRefs = [...new Set([...node.sourceRefs, ref])];
      }
      closeOpenToolCall(openToolNodeIdsByName, toolName, nodeId);
      lastToolNodeId = nodeId;
    }

    if (event.type === "checkpoint_written") {
      const checkpointId = readString(event.payload.checkpointId) ?? event.id;
      const nodeId = `checkpoint:${checkpointId}`;
      addNode(nodes, {
        id: nodeId,
        kind: "checkpoint",
        status: "succeeded",
        title: checkpointId,
        sourceRefs: [ref],
        result: {
          status: "succeeded",
          evidenceRefs: [ref],
          decidedBy: "runtime",
        },
        order: trajectoryOrder(event),
      });
      addEdge(edges, runNodeId, nodeId, "contains");
      if (lastToolNodeId) {
        addEdge(edges, lastToolNodeId, nodeId, "produced");
      }
    }

    if (event.type === "artifact_created") {
      const artifactRef = readString(event.payload.artifactRef);
      const artifactId = readString(event.payload.artifactId) ?? artifactRef ?? event.id;
      const provenanceRef = readString(event.payload.provenanceRef);
      const artifactRefIsConsistent = artifactRef === `artifact:${artifactId}`;
      const provenanceIsConsistent = isConsistentArtifactProvenanceEvent(
        event.payload,
        artifactId,
        artifactRef,
        provenanceRef,
      );
      const nodeId = artifactRefIsConsistent ? artifactRef : `artifact:${artifactId}`;
      const evidenceRefs = provenanceIsConsistent ? [ref, provenanceRef] : [ref];
      if (provenanceIsConsistent) {
        evidence.set(provenanceRef, {
          ref: provenanceRef,
          source: "trajectory",
          eventType: event.type,
        });
      }
      addNode(nodes, {
        id: nodeId,
        kind: "artifact",
        status: "succeeded",
        title: artifactId,
        sourceRefs: [ref],
        result: {
          status: "succeeded",
          evidenceRefs,
          ...(artifactRefIsConsistent ? { artifactRefs: [artifactRef] } : {}),
          decidedBy: "runtime",
        },
        order: trajectoryOrder(event),
      });
      addEdge(edges, runNodeId, nodeId, "contains");
      if (lastToolNodeId) {
        addEdge(edges, lastToolNodeId, nodeId, "produced");
      }
    }

    if (event.type === "goal_review_requested") {
      const goalId = readString(event.payload.goalId) ?? event.runId;
      const milestoneId = readString(event.payload.milestoneId) ?? "goal";
      const gateId = `gate:goal_review:${goalId}:${milestoneId}`;
      addGate(gates, nodes, {
        id: gateId,
        kind: "goal_review",
        status: "waiting",
        title: "Goal review requested",
        sourceRefs: [ref],
      }, trajectoryOrder(event));
      addEdge(edges, runNodeId, gateId, "blocked_by");
    }

    if (event.type === "acceptance_checked") {
      const checkId =
        readString(event.payload.checkId) ??
        readString(event.payload.milestoneId) ??
        event.id;
      const accepted = event.payload.accepted === true;
      const gateId = `gate:acceptance:${checkId}`;
      addGate(gates, nodes, {
        id: gateId,
        kind: "acceptance",
        status: accepted ? "succeeded" : "blocked",
        title: accepted ? "Acceptance check passed" : "Acceptance check failed",
        sourceRefs: [ref],
      }, trajectoryOrder(event));
      if (!accepted) {
        addEdge(edges, runNodeId, gateId, "blocked_by");
      }
    }

    if (event.type === "workspace_escape_denied") {
      const toolName = readString(event.payload.toolName) ?? "tool";
      const gateId = `gate:workspace_sandbox:${event.id}`;
      addGate(gates, nodes, {
        id: gateId,
        kind: "workspace_sandbox",
        status: "blocked",
        title: `Workspace sandbox denied ${toolName}`,
        sourceRefs: [ref],
      }, trajectoryOrder(event));
      addEdge(edges, runNodeId, gateId, "blocked_by");
    }

    if (event.type === "final_summary") {
      const nodeId = `summary:${event.id}`;
      const summary = readString(event.payload.summary);
      addNode(nodes, {
        id: nodeId,
        kind: "summary",
        status: event.payload.status === "failed" ? "failed" : "succeeded",
        title: "Final summary",
        sourceRefs: [ref],
        result: {
          status: event.payload.status === "failed" ? "failed" : "succeeded",
          evidenceRefs: [ref],
          decidedBy: "runtime",
          ...(summary ? { summary } : {}),
        },
        order: trajectoryOrder(event),
      });
      addEdge(edges, runNodeId, nodeId, "contains");
    }

    // P6 (Patch 21): actor + workflow node projection (pure additive — does not
    // touch the existing 11 node-producing branches above).
    if (event.type === "actor_spawned") {
      const actorId = readString(event.payload.actorId);
      if (actorId) {
        const nodeId = `actor:${actorId}`;
        const task = readString(event.payload.task);
        addNode(nodes, {
          id: nodeId,
          kind: "actor",
          status: "running",
          title: task ? `Actor: ${task.slice(0, 60)}` : "Actor",
          sourceRefs: [ref],
          order: trajectoryOrder(event),
        });
        addEdge(edges, runNodeId, nodeId, "spawned_by");
      }
    }
    if (event.type === "actor_done") {
      const actorId = readString(event.payload.actorId);
      if (actorId) {
        const nodeId = `actor:${actorId}`;
        const existing = nodes.get(nodeId);
        if (existing) {
          const status = readString(event.payload.status);
          const summary = readString(event.payload.summary);
          nodes.set(nodeId, {
            ...existing,
            status: status === "done" ? "succeeded" : status === "error" ? "failed" : "canceled",
            result: { status: status === "done" ? "succeeded" : status === "error" ? "failed" : "canceled", ...(summary ? { summary } : {}), evidenceRefs: [ref] },
          });
        }
      }
    }
    if (event.type === "workflow_started") {
      const wfId = readString(event.payload.name);
      if (wfId) {
        const nodeId = `workflow:${event.id}`;
        addNode(nodes, {
          id: nodeId,
          kind: "workflow",
          status: "running",
          title: `Workflow: ${wfId}`,
          sourceRefs: [ref],
          order: trajectoryOrder(event),
        });
        addEdge(edges, runNodeId, nodeId, "contains");
      }
    }
    if (event.type === "workflow_completed") {
      const status = readString(event.payload.status);
      const nodeId = `workflow:${event.id}`;
      const existing = nodes.get(nodeId);
      if (existing) {
        nodes.set(nodeId, {
          ...existing,
          status: status === "done" ? "succeeded" : "failed",
          result: { status: status === "done" ? "succeeded" : "failed", evidenceRefs: [ref] },
        });
      }
    }

    // P7 (Patch 25): dream + distill node projection (pure additive).
    if (event.type === "dream_started") {
      const nodeId = `dream:${event.id}`;
      addNode(nodes, {
        id: nodeId, kind: "dream", status: "running",
        title: "Dream (history distillation)", sourceRefs: [ref], order: trajectoryOrder(event),
      });
      addEdge(edges, runNodeId, nodeId, "spawned_by");
    }
    if (event.type === "dream_completed") {
      const nodeId = `dream:${event.id}`;
      const existing = nodes.get(nodeId);
      if (existing) {
        nodes.set(nodeId, { ...existing, status: "succeeded", result: { status: "succeeded", evidenceRefs: [ref] } });
      }
    }
    if (event.type === "distill_started") {
      const nodeId = `distill:${event.id}`;
      addNode(nodes, {
        id: nodeId, kind: "distill", status: "running",
        title: "Distill (workflow → skill)", sourceRefs: [ref], order: trajectoryOrder(event),
      });
      addEdge(edges, runNodeId, nodeId, "spawned_by");
    }
    if (event.type === "distill_completed") {
      const nodeId = `distill:${event.id}`;
      const existing = nodes.get(nodeId);
      if (existing) {
        nodes.set(nodeId, { ...existing, status: "succeeded", result: { status: "succeeded", evidenceRefs: [ref] } });
      }
    }

    // P8 (Patch 11): model_response node + cost aggregation (pure additive).
    if (event.type === "model_response") {
      const nodeId = `model_response:${event.id}`;
      const usage = event.payload.usage as { inputTokens?: number; outputTokens?: number } | undefined;
      const cacheRead = readNumber(event.payload.cacheReadTokens);
      const cacheWrite = readNumber(event.payload.cacheWriteTokens);
      addNode(nodes, {
        id: nodeId,
        kind: "model_response",
        status: "succeeded",
        title: "Model response",
        sourceRefs: [ref],
        result: {
          status: "succeeded",
          evidenceRefs: [ref],
          decidedBy: "runtime",
          ...(usage ? { tokens: usage } : {}),
          ...(cacheRead !== null ? { cacheReadTokens: cacheRead } : {}),
          ...(cacheWrite !== null ? { cacheWriteTokens: cacheWrite } : {}),
        },
        order: trajectoryOrder(event),
      });
      addEdge(edges, runNodeId, nodeId, "produced");
      if (usage) {
        totalUsage.inputTokens += usage.inputTokens ?? 0;
        totalUsage.outputTokens += usage.outputTokens ?? 0;
      }
      totalUsage.cacheReadTokens += cacheRead ?? 0;
      totalUsage.cacheWriteTokens += cacheWrite ?? 0;
    }
  }

  return {
    graphId: `graph:${input.run.id}`,
    runId: input.run.id,
    nodes: [...nodes.values()]
      .sort((left, right) => left.order - right.order)
      .map(({ order: _order, ...node }) => node),
    edges: [...edges.values()],
    gates: [...gates.values()],
    evidence: [...evidence.values()],
    totalUsage,
  };
}

function addNode(nodes: Map<string, MutableNode>, node: MutableNode) {
  const existing = nodes.get(node.id);
  if (!existing) {
    nodes.set(node.id, node);
    return;
  }

  existing.sourceRefs = [...new Set([...existing.sourceRefs, ...node.sourceRefs])];
  existing.order = Math.min(existing.order, node.order);
}

function addEdge(
  edges: Map<string, RunGraphEdge>,
  fromNodeId: string,
  toNodeId: string,
  relation: RunGraphEdgeRelation,
) {
  const id = `edge:${fromNodeId}:${relation}:${toNodeId}`;
  edges.set(id, { id, fromNodeId, toNodeId, relation });
}

function addGate(
  gates: Map<string, RunGraphGate>,
  nodes: Map<string, MutableNode>,
  gate: RunGraphGate,
  order: number,
) {
  const existing = gates.get(gate.id);
  if (!existing) {
    gates.set(gate.id, gate);
  } else {
    existing.sourceRefs = [...new Set([...existing.sourceRefs, ...gate.sourceRefs])];
    existing.status = gate.status;
    existing.title = gate.title;
  }

  addNode(nodes, {
    id: gate.id,
    kind: "gate",
    status: gate.status,
    title: gate.title,
    sourceRefs: gate.sourceRefs,
    order,
  });
  const node = nodes.get(gate.id);
  if (node) {
    node.status = gate.status;
    node.title = gate.title;
    node.sourceRefs = [...new Set([...node.sourceRefs, ...gate.sourceRefs])];
  }
}

function toGraphStatus(status: AgentExecutionStatus): RunGraphNodeStatus {
  if (status === "queued") return "planned";
  if (status === "waiting_for_approval") return "waiting";
  return status;
}

function toTerminalResultStatus(
  status: Extract<AgentExecutionStatus, "succeeded" | "failed" | "paused" | "canceled">,
): RunGraphNodeResult["status"] {
  return status;
}

function isTerminalStatus(
  status: AgentExecutionStatus,
): status is Extract<AgentExecutionStatus, "succeeded" | "failed" | "paused" | "canceled"> {
  return (
    status === "succeeded" ||
    status === "failed" ||
    status === "paused" ||
    status === "canceled"
  );
}

function compareTrajectoryEvents(
  left: AgentTrajectoryEvent,
  right: AgentTrajectoryEvent,
) {
  return left.sequence - right.sequence || left.createdAt.localeCompare(right.createdAt);
}

function compareKernelEvents(left: KernelEvent, right: KernelEvent) {
  return left.createdAt.localeCompare(right.createdAt) || left.type.localeCompare(right.type);
}

function compareWorkspaceRunEvents(
  left: WorkspaceRunEvent,
  right: WorkspaceRunEvent,
) {
  return (
    left.createdAt.localeCompare(right.createdAt) ||
    left.workspaceRunId.localeCompare(right.workspaceRunId) ||
    left.seq - right.seq ||
    left.id.localeCompare(right.id)
  );
}

function trajectoryOrder(event: AgentTrajectoryEvent): number {
  return event.sequence * 100;
}

function workspaceRunOrder(event: WorkspaceRunEvent): number {
  return event.seq * 100;
}

function kernelOrder(event: KernelEvent): number {
  if (event.type === "turn_start") {
    return event.turn * 100 - 50;
  }
  return Number.MAX_SAFE_INTEGER;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isConsistentArtifactProvenanceEvent(
  payload: Record<string, unknown>,
  artifactId: string,
  artifactRef: string | null,
  provenanceRef: string | null,
): provenanceRef is string {
  if (artifactRef !== `artifact:${artifactId}`) {
    return false;
  }
  if (provenanceRef !== `provenance:${artifactId}`) {
    return false;
  }
  const artifactPath = readString(payload.artifactPath);
  const provenancePath = readString(payload.provenancePath);
  if (artifactPath && provenancePath && provenancePath !== `${artifactPath}.provenance.json`) {
    return false;
  }
  return true;
}

function buildAcceptedTrajectoryRunIds(run: AgentRunRecord): Set<string> {
  const ids = new Set<string>([run.id, run.taskId]);
  if (run.taskId.startsWith("goal:")) {
    ids.add(run.taskId.slice("goal:".length));
  }
  return ids;
}

function recordOpenToolCall(
  openToolNodeIdsByName: Map<string, string[]>,
  toolName: string,
  nodeId: string,
) {
  const existing = openToolNodeIdsByName.get(toolName) ?? [];
  openToolNodeIdsByName.set(toolName, [...existing, nodeId]);
}

function findOpenToolCall(
  openToolNodeIdsByName: Map<string, string[]>,
  toolName: string | null,
): string | null {
  if (!toolName) {
    return null;
  }

  return openToolNodeIdsByName.get(toolName)?.at(-1) ?? null;
}

function closeOpenToolCall(
  openToolNodeIdsByName: Map<string, string[]>,
  toolName: string | null,
  nodeId: string,
) {
  if (!toolName) {
    return;
  }

  const existing = openToolNodeIdsByName.get(toolName) ?? [];
  openToolNodeIdsByName.set(
    toolName,
    existing.filter((candidate) => candidate !== nodeId),
  );
}
