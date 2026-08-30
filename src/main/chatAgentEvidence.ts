import { randomUUID } from "node:crypto";
import type { AgentTrajectoryStore } from "./agentTrajectoryStore";
import type {
  AgentTrajectoryEvent,
  AgentTrajectoryEventType,
} from "../shared/agentTrajectory";
import type { AgentRunContext } from "../shared/agentWorkspace";
import { redactCredentials } from "../shared/credentialRedaction";

export type ChatAgentEvidenceRecorder = {
  runId: string;
  append(
    type: AgentTrajectoryEventType,
    payload: Record<string, unknown>,
    redaction?: AgentTrajectoryEvent["redaction"],
  ): Promise<AgentTrajectoryEvent | null>;
  drain(): Promise<void>;
};

export function createChatAgentEvidenceRecorder(options: {
  trajectoryStore?: AgentTrajectoryStore;
  runId?: string;
  runContext?: AgentRunContext;
  createId?: () => string;
  now?: () => Date;
}): ChatAgentEvidenceRecorder {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const runId = options.runId ?? createId();
  let sequence = 0;
  let mutationQueue: Promise<void> = Promise.resolve();

  return {
    runId,
    async append(type, payload, redaction) {
      if (!options.trajectoryStore) {
        return null;
      }

      sequence += 1;
      const event: AgentTrajectoryEvent = {
        id: createId(),
        runId,
        type,
        sequence,
        ...(options.runContext ? { runContext: options.runContext } : {}),
        payload: redactCredentials(payload) as Record<string, unknown>,
        redaction:
          redaction ??
          {
            containsApiKey: false,
            containsFileContent: type === "tool_result",
            containsUserText:
              type === "model_request" || type === "model_response",
          },
        createdAt: now().toISOString(),
      };
      const result = mutationQueue.then(() =>
        options.trajectoryStore!.append(runId, event),
      );
      mutationQueue = result.then(() => undefined, () => undefined);
      return result;
    },
    async drain() {
      await mutationQueue;
    },
  };
}
