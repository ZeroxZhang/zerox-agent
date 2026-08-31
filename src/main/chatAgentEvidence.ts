import { randomUUID } from "node:crypto";
import type { AgentTrajectoryStore } from "./agentTrajectoryStore";
import type {
  AgentTrajectoryEvent,
  AgentTrajectoryEventType,
} from "../shared/agentTrajectory";
import type { AgentRunContext } from "../shared/agentWorkspace";
import { redactCredentials } from "../shared/credentialRedaction";
import { highestAgentTrajectorySequence } from "./agentTrajectorySequence";

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
  let fallbackSequence = 0;
  let fallbackSequenceInitialized = false;
  let mutationQueue: Promise<void> = Promise.resolve();

  return {
    runId,
    async append(type, payload, redaction) {
      if (!options.trajectoryStore) {
        return null;
      }

      const result = mutationQueue.then(async () => {
        const event: AgentTrajectoryEvent = {
          id: createId(),
          runId,
          type,
          // The store replaces this placeholder while holding the per-run
          // mutation authority. Recorder-local counters cannot coordinate
          // separate continuations that share one evidence run.
          sequence: 0,
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
        if (options.trajectoryStore!.appendNext) {
          return options.trajectoryStore!.appendNext(runId, event);
        }
        // Narrow compatibility path for injected legacy stores. Production
        // stores expose appendNext and allocate under durable store authority.
        if (!fallbackSequenceInitialized) {
          fallbackSequence = highestAgentTrajectorySequence(
            await options.trajectoryStore!.list(runId),
          );
          fallbackSequenceInitialized = true;
        }
        fallbackSequence += 1;
        return options.trajectoryStore!.append(runId, {
          ...event,
          sequence: fallbackSequence,
        });
      });
      mutationQueue = result.then(() => undefined, () => undefined);
      return result;
    },
    async drain() {
      await mutationQueue;
    },
  };
}
