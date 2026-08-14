export const CONTEXT_SURFACE_VERSION = 1 as const;

export type ContextSurfaceToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type ContextSurfaceMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ContextSurfaceToolCall[];
  tool_call_id?: string;
  name?: string;
  images?: Array<{
    mediaType: string;
    data: string;
  }>;
};

export type ContextSurfaceSourceEvent = {
  kind: "source";
  id: string;
  sequence: number;
  message: ContextSurfaceMessage;
  estimatedTokens: number;
  afterNodeId?: string | null;
  createdAt: string;
};

export type ContextSurfaceReplacementReason =
  | "summarize"
  | "rebuild"
  | "summarize-degraded"
  | "message-integrity"
  | "tool-batch-trim";

export type ContextSurfaceReplacementNode = {
  id: string;
  message: ContextSurfaceMessage;
  estimatedTokens: number;
};

export type ContextSurfaceReplacementEvent = {
  kind: "replace";
  id: string;
  sequence: number;
  reason: ContextSurfaceReplacementReason;
  strategy?: "summarize" | "rebuild" | "summarize-degraded";
  shadowedNodeIds: string[];
  sourceNodeIds: string[];
  replacementNodes: ContextSurfaceReplacementNode[];
  checkpointRef?: string;
  createdAt: string;
};

export type ContextSurfaceEvent =
  | ContextSurfaceSourceEvent
  | ContextSurfaceReplacementEvent;

export type ContextSurfaceState = {
  version: typeof CONTEXT_SURFACE_VERSION;
  runId: string;
  nextSequence: number;
  events: ContextSurfaceEvent[];
};
