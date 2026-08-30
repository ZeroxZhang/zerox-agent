import type {
  ToolApprovalDecisionPayload,
  ToolApprovalRequestPayload,
} from "../shared/toolApproval";

export type ToolApprovalProjectionState = {
  pending: ToolApprovalRequestPayload[];
  revisionById: Record<string, number>;
  terminalRevisionById: Record<string, number>;
};

export type ToolApprovalProjectionEvent =
  | { type: "request"; request: ToolApprovalRequestPayload }
  | { type: "decision"; decision: ToolApprovalDecisionPayload }
  | { type: "snapshot"; requests: ToolApprovalRequestPayload[] };

export function createToolApprovalProjectionState(): ToolApprovalProjectionState {
  return {
    pending: [],
    revisionById: {},
    terminalRevisionById: {},
  };
}

export function applyToolApprovalProjectionEvent(
  state: ToolApprovalProjectionState,
  event: ToolApprovalProjectionEvent,
): ToolApprovalProjectionState {
  if (event.type === "snapshot") {
    return event.requests.reduce(
      (current, request) => applyToolApprovalProjectionEvent(current, {
        type: "request",
        request,
      }),
      state,
    );
  }
  if (event.type === "decision") {
    const revision = normalizeRevision(event.decision.revision, 2);
    const previousTerminal = state.terminalRevisionById[event.decision.id] ?? 0;
    if (revision < previousTerminal) return state;
    return {
      ...state,
      pending: state.pending.filter((request) => request.id !== event.decision.id),
      revisionById: {
        ...state.revisionById,
        [event.decision.id]: Math.max(
          revision,
          state.revisionById[event.decision.id] ?? 0,
        ),
      },
      terminalRevisionById: {
        ...state.terminalRevisionById,
        [event.decision.id]: revision,
      },
    };
  }

  const request = structuredClone(event.request);
  const revision = normalizeRevision(request.revision, 1);
  if ((state.terminalRevisionById[request.id] ?? 0) >= revision) return state;
  if ((state.revisionById[request.id] ?? 0) > revision) return state;
  const existingIndex = state.pending.findIndex((candidate) => candidate.id === request.id);
  return {
    ...state,
    pending: existingIndex === -1
      ? [...state.pending, request]
      : state.pending.map((candidate, index) =>
          index === existingIndex ? request : candidate,
        ),
    revisionById: {
      ...state.revisionById,
      [request.id]: revision,
    },
  };
}

function normalizeRevision(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}
