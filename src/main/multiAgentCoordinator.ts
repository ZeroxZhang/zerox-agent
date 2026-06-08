import { randomUUID } from "node:crypto";
import type { AgentTrajectoryStore } from "./agentTrajectoryStore";
import type { MultiAgentSessionStore } from "./multiAgentSessionStore";
import type {
  AgentRole,
  AgentRunContext,
  MultiAgentSession,
} from "../shared/agentWorkspace";
import { buildChildRunContext } from "../shared/agentWorkspace";

export type CreateMultiAgentSessionInput = {
  title: string;
  workspaceId: string;
  rootRunId?: string;
};

export type BuildChildContextInput = {
  parentRunId: string;
  agentRole: Exclude<AgentRole, "primary">;
};

export type RecordChildRunInput = {
  sessionId: string;
  parentRunId: string;
  childRunId: string;
  agentRole: AgentRole;
  runContext: AgentRunContext;
};

export type MultiAgentCoordinator = {
  createSession(input: CreateMultiAgentSessionInput): Promise<MultiAgentSession>;
  buildChildContext(
    parent: AgentRunContext,
    input: BuildChildContextInput,
  ): AgentRunContext;
  recordChildRun(input: RecordChildRunInput): Promise<MultiAgentSession>;
};

export function createMultiAgentCoordinator(options: {
  sessionStore: MultiAgentSessionStore;
  trajectoryStore?: AgentTrajectoryStore;
  createId?: () => string;
  now?: () => Date;
}): MultiAgentCoordinator {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());

  return {
    createSession(input) {
      return options.sessionStore.create(input);
    },

    buildChildContext(parent, input) {
      if (parent.depth >= 3) {
        throw new Error("Multi-agent child run depth cannot exceed 3.");
      }

      return buildChildRunContext(parent, input);
    },

    async recordChildRun(input) {
      const session = await options.sessionStore.appendChildRun(
        input.sessionId,
        input.childRunId,
        input.agentRole,
      );
      if (!session) {
        throw new Error(`Multi-agent session "${input.sessionId}" was not found.`);
      }

      await options.trajectoryStore?.append(input.parentRunId, {
        id: createId(),
        runId: input.parentRunId,
        type: "child_run_scheduled",
        sequence: 1,
        runContext: input.runContext,
        payload: {
          sessionId: input.sessionId,
          parentRunId: input.parentRunId,
          childRunId: input.childRunId,
          agentRole: input.agentRole,
        },
        redaction: {
          containsApiKey: false,
          containsFileContent: false,
          containsUserText: false,
        },
        createdAt: now().toISOString(),
      });

      return session;
    },
  };
}
