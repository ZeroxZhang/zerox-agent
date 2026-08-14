import { isDeepStrictEqual } from "node:util";
import {
  CONTEXT_SURFACE_VERSION,
  type ContextSurfaceEvent,
  type ContextSurfaceMessage,
  type ContextSurfaceReplacementEvent,
  type ContextSurfaceReplacementReason,
  type ContextSurfaceSourceEvent,
  type ContextSurfaceState,
} from "../shared/contextSurface";
import type { ChatMessage } from "./openAiCompatibleClient";

type ProjectedNode = {
  id: string;
  message: ChatMessage;
  estimatedTokens: number;
  sourceNodeIds: string[];
};

type ContextSurfaceProjection = {
  nodes: ProjectedNode[];
  estimatedTokens: number;
  sourceCount: number;
  replacementCount: number;
};

export type ContextSurfaceReplay = {
  messages: ChatMessage[];
  visibleNodeIds: string[];
  sourceNodeIds: string[];
  estimatedTokens: number;
  sourceCount: number;
  replacementCount: number;
};

export type ContextSurface = {
  append(message: ChatMessage): ContextSurfaceSourceEvent;
  insert(index: number, message: ChatMessage): ContextSurfaceSourceEvent;
  replace(
    messages: ChatMessage[],
    input: {
      reason: ContextSurfaceReplacementReason;
      strategy?: "summarize" | "rebuild" | "summarize-degraded";
      checkpointRef?: string;
    },
  ): ContextSurfaceReplacementEvent;
  messages(): ChatMessage[];
  visibleNodeIds(): string[];
  estimatedTokens(): number;
  snapshot(): ContextSurfaceState;
  stats(): {
    sourceCount: number;
    replacementCount: number;
    visibleMessageCount: number;
    estimatedTokens: number;
  };
};

export function createContextSurface(options: {
  runId: string;
  initialMessages?: ChatMessage[];
  state?: ContextSurfaceState;
  expectedMessages?: ChatMessage[];
  estimateMessageTokens: (message: ChatMessage) => number;
  now?: () => string;
}): ContextSurface {
  const runId = requireNonEmpty(options.runId, "Context surface runId");
  const now = options.now ?? (() => new Date().toISOString());
  let state: ContextSurfaceState = options.state
    ? cloneState(options.state)
    : {
        version: CONTEXT_SURFACE_VERSION,
        runId,
        nextSequence: 1,
        events: [],
      };
  if (state.runId !== runId) {
    throw new Error(
      `Context surface runId mismatch: expected ${runId}, received ${state.runId}.`,
    );
  }

  let projection = projectContextSurface(state);
  if (options.state) {
    if (
      options.expectedMessages &&
      !isDeepStrictEqual(
        projection.nodes.map((node) => node.message),
        options.expectedMessages,
      )
    ) {
      throw new Error(
        "Context surface checkpoint parity failed: projected messages differ from the compatibility checkpoint.",
      );
    }
  } else {
    for (const message of options.initialMessages ?? []) {
      appendSource(message);
    }
  }

  function appendSource(
    message: ChatMessage,
    afterNodeId?: string | null,
  ): ContextSurfaceSourceEvent {
    const sequence = state.nextSequence;
    const event: ContextSurfaceSourceEvent = {
      kind: "source",
      id: buildNodeId(runId, "source", sequence),
      sequence,
      message: cloneMessage(message),
      estimatedTokens: normalizeTokenEstimate(
        options.estimateMessageTokens(message),
      ),
      ...(afterNodeId !== undefined ? { afterNodeId } : {}),
      createdAt: now(),
    };
    state.events.push(event);
    state.nextSequence += 1;
    const node: ProjectedNode = {
      id: event.id,
      message: cloneMessage(event.message as ChatMessage),
      estimatedTokens: event.estimatedTokens,
      sourceNodeIds: [event.id],
    };
    if (event.afterNodeId === null) {
      projection.nodes.splice(0, 0, node);
    } else if (event.afterNodeId !== undefined) {
      const anchorIndex = projection.nodes.findIndex(
        (candidate) => candidate.id === event.afterNodeId,
      );
      if (anchorIndex < 0) {
        throw new Error(
          `Context surface source insertion references stale node ${event.afterNodeId}.`,
        );
      }
      projection.nodes.splice(anchorIndex + 1, 0, node);
    } else {
      projection.nodes.push(node);
    }
    projection.estimatedTokens += event.estimatedTokens;
    projection.sourceCount += 1;
    return cloneEvent(event) as ContextSurfaceSourceEvent;
  }

  return {
    append(message) {
      return appendSource(message);
    },

    insert(index, message) {
      if (!Number.isInteger(index) || index < 0 || index > projection.nodes.length) {
        throw new Error(`Context surface insertion index is out of range: ${index}.`);
      }
      if (index === projection.nodes.length) {
        return appendSource(message);
      }
      const afterNodeId = index === 0 ? null : projection.nodes[index - 1]!.id;
      return appendSource(message, afterNodeId);
    },

    replace(messages, input) {
      assertCompleteToolPairs(messages);
      const sequence = state.nextSequence;
      const shadowedNodeIds = projection.nodes.map((node) => node.id);
      const sourceNodeIds = unique(
        projection.nodes.flatMap((node) => node.sourceNodeIds),
      );
      const event: ContextSurfaceReplacementEvent = {
        kind: "replace",
        id: buildNodeId(runId, "replace", sequence),
        sequence,
        reason: input.reason,
        ...(input.strategy ? { strategy: input.strategy } : {}),
        shadowedNodeIds,
        sourceNodeIds,
        replacementNodes: messages.map((message, index) => ({
          id: buildNodeId(runId, "replacement", sequence, index + 1),
          message: cloneMessage(message),
          estimatedTokens: normalizeTokenEstimate(
            options.estimateMessageTokens(message),
          ),
        })),
        ...(input.checkpointRef
          ? { checkpointRef: input.checkpointRef }
          : {}),
        createdAt: now(),
      };
      state.events.push(event);
      state.nextSequence += 1;
      projection.nodes = event.replacementNodes.map((node) => ({
        id: node.id,
        message: cloneMessage(node.message as ChatMessage),
        estimatedTokens: node.estimatedTokens,
        sourceNodeIds: [...event.sourceNodeIds],
      }));
      projection.estimatedTokens = event.replacementNodes.reduce(
        (total, node) => total + node.estimatedTokens,
        0,
      );
      projection.replacementCount += 1;
      return cloneEvent(event) as ContextSurfaceReplacementEvent;
    },

    messages() {
      return projection.nodes.map((node) => cloneMessage(node.message));
    },

    visibleNodeIds() {
      return projection.nodes.map((node) => node.id);
    },

    estimatedTokens() {
      return projection.estimatedTokens;
    },

    snapshot() {
      return cloneState(state);
    },

    stats() {
      return {
        sourceCount: projection.sourceCount,
        replacementCount: projection.replacementCount,
        visibleMessageCount: projection.nodes.length,
        estimatedTokens: projection.estimatedTokens,
      };
    },
  };
}

export function replayContextSurface(
  state: ContextSurfaceState,
): ContextSurfaceReplay {
  const projection = projectContextSurface(state);
  return {
    messages: projection.nodes.map((node) => cloneMessage(node.message)),
    visibleNodeIds: projection.nodes.map((node) => node.id),
    sourceNodeIds: unique(
      projection.nodes.flatMap((node) => node.sourceNodeIds),
    ),
    estimatedTokens: projection.estimatedTokens,
    sourceCount: projection.sourceCount,
    replacementCount: projection.replacementCount,
  };
}

function projectContextSurface(
  state: ContextSurfaceState,
): ContextSurfaceProjection {
  if (state.version !== CONTEXT_SURFACE_VERSION) {
    throw new Error(
      `Unsupported context surface version: ${String(state.version)}.`,
    );
  }
  requireNonEmpty(state.runId, "Context surface runId");
  if (!Array.isArray(state.events)) {
    throw new Error("Context surface events must be an array.");
  }

  let nodes: ProjectedNode[] = [];
  let sourceCount = 0;
  let replacementCount = 0;
  const eventIds = new Set<string>();
  const nodeIds = new Set<string>();

  for (const [index, rawEvent] of state.events.entries()) {
    const expectedSequence = index + 1;
    if (rawEvent.sequence !== expectedSequence) {
      throw new Error(
        `Context surface sequence mismatch at event ${index}: expected ${expectedSequence}, received ${rawEvent.sequence}.`,
      );
    }
    requireUniqueId(rawEvent.id, eventIds, "event");

    if (rawEvent.kind === "source") {
      assertMessage(rawEvent.message);
      requireTokenEstimate(rawEvent.estimatedTokens);
      requireUniqueId(rawEvent.id, nodeIds, "node");
      const node: ProjectedNode = {
        id: rawEvent.id,
        message: cloneMessage(rawEvent.message as ChatMessage),
        estimatedTokens: rawEvent.estimatedTokens,
        sourceNodeIds: [rawEvent.id],
      };
      if (rawEvent.afterNodeId === null) {
        nodes.splice(0, 0, node);
      } else if (rawEvent.afterNodeId !== undefined) {
        const anchorIndex = nodes.findIndex(
          (candidate) => candidate.id === rawEvent.afterNodeId,
        );
        if (anchorIndex < 0) {
          throw new Error(
            `Context surface source insertion references stale node ${rawEvent.afterNodeId}.`,
          );
        }
        nodes.splice(anchorIndex + 1, 0, node);
      } else {
        nodes.push(node);
      }
      sourceCount += 1;
      continue;
    }

    if (rawEvent.kind !== "replace") {
      throw new Error("Context surface event kind is invalid.");
    }
    const visibleNodeIds = nodes.map((node) => node.id);
    if (!isDeepStrictEqual(rawEvent.shadowedNodeIds, visibleNodeIds)) {
      throw new Error(
        "Context surface replacement shadow set does not match the complete visible surface.",
      );
    }
    const expectedLineage = unique(
      nodes.flatMap((node) => node.sourceNodeIds),
    );
    if (!isDeepStrictEqual(rawEvent.sourceNodeIds, expectedLineage)) {
      throw new Error(
        "Context surface replacement lineage does not match its shadowed sources.",
      );
    }
    if (!Array.isArray(rawEvent.replacementNodes)) {
      throw new Error("Context surface replacement nodes must be an array.");
    }
    const replacementMessages = rawEvent.replacementNodes.map((node) => {
      requireUniqueId(node.id, nodeIds, "node");
      assertMessage(node.message);
      requireTokenEstimate(node.estimatedTokens);
      return cloneMessage(node.message as ChatMessage);
    });
    assertCompleteToolPairs(replacementMessages);
    nodes = rawEvent.replacementNodes.map((node) => ({
      id: node.id,
      message: cloneMessage(node.message as ChatMessage),
      estimatedTokens: node.estimatedTokens,
      sourceNodeIds: [...rawEvent.sourceNodeIds],
    }));
    replacementCount += 1;
  }

  if (state.nextSequence !== state.events.length + 1) {
    throw new Error(
      `Context surface next sequence mismatch: expected ${state.events.length + 1}, received ${state.nextSequence}.`,
    );
  }

  return {
    nodes,
    estimatedTokens: nodes.reduce(
      (total, node) => total + node.estimatedTokens,
      0,
    ),
    sourceCount,
    replacementCount,
  };
}

function assertCompleteToolPairs(messages: readonly ChatMessage[]): void {
  let open = new Set<string>();
  for (const [index, message] of messages.entries()) {
    if (message.role === "tool") {
      const toolCallId = message.tool_call_id ?? "";
      if (!open.delete(toolCallId)) {
        throw new Error(
          `Context surface replacement contains an orphan tool result at index ${index}.`,
        );
      }
      continue;
    }
    if (open.size > 0) {
      throw new Error(
        `Context surface replacement splits a completed tool-call/result batch before index ${index}.`,
      );
    }
    if (message.role === "assistant" && message.tool_calls?.length) {
      open = new Set(message.tool_calls.map((call) => call.id));
    }
  }
  if (open.size > 0) {
    throw new Error(
      `Context surface replacement has unanswered tool calls: ${[...open].join(", ")}.`,
    );
  }
}

function assertMessage(message: ContextSurfaceMessage): void {
  if (
    !message ||
    !["system", "user", "assistant", "tool"].includes(message.role) ||
    typeof message.content !== "string"
  ) {
    throw new Error("Context surface message is invalid.");
  }
}

function cloneState(state: ContextSurfaceState): ContextSurfaceState {
  return {
    version: state.version,
    runId: state.runId,
    nextSequence: state.nextSequence,
    events: state.events.map(cloneEvent),
  };
}

function cloneEvent(event: ContextSurfaceEvent): ContextSurfaceEvent {
  if (event.kind === "source") {
    return {
      ...event,
      message: cloneMessage(event.message as ChatMessage),
    };
  }
  return {
    ...event,
    shadowedNodeIds: [...event.shadowedNodeIds],
    sourceNodeIds: [...event.sourceNodeIds],
    replacementNodes: event.replacementNodes.map((node) => ({
      ...node,
      message: cloneMessage(node.message as ChatMessage),
    })),
  };
}

function cloneMessage(message: ChatMessage): ChatMessage {
  return {
    role: message.role,
    content: message.content,
    ...(message.tool_calls
      ? {
          tool_calls: message.tool_calls.map((call) => ({
            ...call,
            function: { ...call.function },
          })),
        }
      : {}),
    ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
    ...(message.name ? { name: message.name } : {}),
    ...(message.images
      ? { images: message.images.map((image) => ({ ...image })) }
      : {}),
  };
}

function normalizeTokenEstimate(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Context surface token estimate is invalid: ${value}.`);
  }
  return Math.floor(value);
}

function requireTokenEstimate(value: number): void {
  normalizeTokenEstimate(value);
}

function requireNonEmpty(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must not be empty.`);
  }
  return value;
}

function requireUniqueId(
  value: string,
  ids: Set<string>,
  label: string,
): void {
  requireNonEmpty(value, `Context surface ${label} id`);
  if (ids.has(value)) {
    throw new Error(`Duplicate context surface ${label} id: ${value}.`);
  }
  ids.add(value);
}

function buildNodeId(
  runId: string,
  kind: "source" | "replace" | "replacement",
  sequence: number,
  ordinal?: number,
): string {
  const safeRunId =
    runId.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") ||
    "run";
  return [
    "surface",
    safeRunId,
    kind,
    sequence,
    ...(ordinal === undefined ? [] : [ordinal]),
  ].join(":");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
