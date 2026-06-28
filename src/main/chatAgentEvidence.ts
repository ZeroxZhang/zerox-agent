import { randomUUID } from "node:crypto";
import type { AgentTrajectoryStore } from "./agentTrajectoryStore";
import type {
  AgentTrajectoryEvent,
  AgentTrajectoryEventType,
} from "../shared/agentTrajectory";
import type { AgentRunContext } from "../shared/agentWorkspace";

export type ChatAgentEvidenceRecorder = {
  runId: string;
  append(
    type: AgentTrajectoryEventType,
    payload: Record<string, unknown>,
    redaction?: AgentTrajectoryEvent["redaction"],
  ): Promise<void>;
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

  return {
    runId,
    async append(type, payload, redaction) {
      if (!options.trajectoryStore) {
        return;
      }

      sequence += 1;
      await options.trajectoryStore.append(runId, {
        id: createId(),
        runId,
        type,
        sequence,
        ...(options.runContext ? { runContext: options.runContext } : {}),
        payload,
        redaction:
          redaction ??
          {
            containsApiKey: false,
            containsFileContent: type === "tool_result",
            containsUserText:
              type === "model_request" || type === "model_response",
          },
        createdAt: now().toISOString(),
      });
    },
  };
}
