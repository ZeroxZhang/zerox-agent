import { randomUUID } from "node:crypto";
import type { AgentTrajectoryStore } from "./agentTrajectoryStore";
import type { AgentTrajectoryEventType } from "../shared/agentTrajectory";

export type ChatAgentEvidenceRecorder = {
  runId: string;
  append(
    type: AgentTrajectoryEventType,
    payload: Record<string, unknown>,
  ): Promise<void>;
};

export function createChatAgentEvidenceRecorder(options: {
  trajectoryStore?: AgentTrajectoryStore;
  runId?: string;
  createId?: () => string;
  now?: () => Date;
}): ChatAgentEvidenceRecorder {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const runId = options.runId ?? createId();
  let sequence = 0;

  return {
    runId,
    async append(type, payload) {
      if (!options.trajectoryStore) {
        return;
      }

      sequence += 1;
      await options.trajectoryStore.append(runId, {
        id: createId(),
        runId,
        type,
        sequence,
        payload,
        redaction: {
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
