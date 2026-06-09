import { randomUUID } from "node:crypto";
import type { AgentTrajectoryStore } from "./agentTrajectoryStore";
import type { MultiAgentSessionStore } from "./multiAgentSessionStore";
import type {
  AgentRole,
  AgentRunContext,
  MultiAgentSession,
} from "../shared/agentWorkspace";
import { buildChildRunContext } from "../shared/agentWorkspace";
import {
  createAgentHandoffContract,
  createHandoffReviewDecision,
  type AgentChildHandoffOutput,
  type AgentHandoffContract,
  type AgentHandoffContractInput,
  type AgentHandoffReviewDecision,
} from "../shared/agentHandoff";

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
  handoff?: AgentHandoffContract;
};

export type MultiAgentCoordinator = {
  createSession(input: CreateMultiAgentSessionInput): Promise<MultiAgentSession>;
  buildChildContext(
    parent: AgentRunContext,
    input: BuildChildContextInput,
  ): AgentRunContext;
  createHandoffContract(
    parent: AgentRunContext,
    input: Omit<AgentHandoffContractInput, "handoffId"> & {
      handoffId?: string;
    },
  ): AgentHandoffContract;
  recordChildRun(input: RecordChildRunInput): Promise<MultiAgentSession>;
  recordChildOutput(input: {
    parentRunId: string;
    output: AgentChildHandoffOutput;
  }): Promise<void>;
  recordHandoffReview(
    input: Omit<AgentHandoffReviewDecision, "createdAt"> & {
      createdAt?: string;
    },
  ): Promise<AgentHandoffReviewDecision>;
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

    createHandoffContract(parent, input) {
      return createAgentHandoffContract(parent, {
        ...input,
        handoffId: input.handoffId ?? `handoff_${createId()}`,
      });
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

      if (input.handoff) {
        await appendParentTrajectory(input.parentRunId, "child_handoff_created", {
          handoff: input.handoff,
        }, input.runContext);
      }

      await appendParentTrajectory(input.parentRunId, "child_run_scheduled", {
        sessionId: input.sessionId,
        parentRunId: input.parentRunId,
        childRunId: input.childRunId,
        agentRole: input.agentRole,
        ...(input.handoff ? { handoffId: input.handoff.handoffId } : {}),
      }, input.runContext);

      return session;
    },

    async recordChildOutput(input) {
      await appendParentTrajectory(input.parentRunId, "child_handoff_completed", {
        output: input.output,
      });
    },

    async recordHandoffReview(input) {
      const decision = createHandoffReviewDecision({
        ...input,
        createdAt: input.createdAt ?? now().toISOString(),
      });

      await appendParentTrajectory(input.parentRunId, "child_handoff_reviewed", {
        decision,
      });

      return decision;
    },
  };

  async function appendParentTrajectory(
    runId: string,
    type:
      | "child_run_scheduled"
      | "child_handoff_created"
      | "child_handoff_completed"
      | "child_handoff_reviewed",
    payload: Record<string, unknown>,
    runContext?: AgentRunContext,
  ) {
    await options.trajectoryStore?.append(runId, {
      id: createId(),
      runId,
      type,
      sequence: 1,
      ...(runContext ? { runContext } : {}),
      payload,
      redaction: {
        containsApiKey: false,
        containsFileContent: false,
        containsUserText: false,
      },
      createdAt: now().toISOString(),
    });
  }
}
