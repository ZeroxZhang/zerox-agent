// Checkpoint-writer orchestrator (contracts v1.4 §5.3).
//
// Coordinates the fork-agent checkpoint write: when compaction shouldCompact
// fires (or a milestone/replan event proactively refreshes), capture the parent
// CachePrefix, spawn the checkpoint-writer actor, await its outcome, and return
// it. On error/cancel the caller degrades to SummarizeCompaction (P2) — the
// orchestrator never blocks the main agent.

import { buildForkContext } from "./forkContext";
import { resolveCheckpointWriterFlag } from "./checkpointWriterOptions";
import { runCheckpointWriterActor } from "./checkpointWriterActor";
import { createActorRuntime, type ActorOutcome, type ActorRuntime, type ForkContext, type SpawnInput } from "./actorRuntime";
import type { CheckpointRepository, RunRepository, Storage } from "../../shared/storageContract";
import type { LLMProvider, NormalizedMessage, ToolDefinition } from "../providers/provider";
import type { Goal, ProgressLedgerEvent } from "../../shared/agentGoal";

export interface CheckpointWriterOrchestratorOptions {
  storage?: Storage;
  runRepository: RunRepository;
  checkpointRepository: CheckpointRepository;
  provider?: LLMProvider;
  resolveGoal?: (parentRunId: string) => { goal: Goal; ledgerEvents: ProgressLedgerEvent[] } | null;
  apiKey?: string;
  model?: string;
  actorRuntime?: ActorRuntime;
}

export interface MaybeWriteCheckpointInput {
  parentRunId: string;
  parentMessages: NormalizedMessage[];
  system?: string;
  tools?: ToolDefinition[];
  frozenAt?: number;
}

export interface CheckpointWriterOrchestrator {
  maybeWriteCheckpoint(input: MaybeWriteCheckpointInput): Promise<ActorOutcome | null>;
  runtime(): ActorRuntime;
}

export function createCheckpointWriterOrchestrator(
  options: CheckpointWriterOrchestratorOptions,
): CheckpointWriterOrchestrator {
  const runtime: ActorRuntime = options.actorRuntime ?? createActorRuntime({
    ...(options.storage ? { storage: options.storage } : {}),
    deps: {
      runActor: (input, forkContext, cancel) =>
        runCheckpointWriterActor(input, forkContext, cancel, {
          runRepository: options.runRepository,
          checkpointRepository: options.checkpointRepository,
          ...(options.provider ? { provider: options.provider } : {}),
          ...(options.resolveGoal ? { resolveGoal: options.resolveGoal } : {}),
          ...(options.apiKey ? { apiKey: options.apiKey } : {}),
          ...(options.model ? { model: options.model } : {}),
        }),
    },
  });

  return {
    runtime() { return runtime; },

    async maybeWriteCheckpoint(input): Promise<ActorOutcome | null> {
      const flag = resolveCheckpointWriterFlag();
      if (flag === "off") return null;
      // p2-transition: defer to P2's transition writer (the caller wires it);
      // the orchestrator only owns the p5-fork path.
      if (flag === "p2-transition") return null;

      const forkContext: ForkContext = buildForkContext({
        parentRunId: input.parentRunId,
        parentMessages: input.parentMessages,
        ...(input.system ? { system: input.system } : {}),
        ...(input.tools ? { tools: input.tools } : {}),
        ...(input.frozenAt !== undefined ? { frozenAt: input.frozenAt } : {}),
      });

      const spawnInput: SpawnInput = {
        contextMode: "full",
        lifecycle: "ephemeral",
        task: `Read trajectory for run ${input.parentRunId} and produce an 11-segment markdown checkpoint.`,
        parentRunId: input.parentRunId,
        forkContext,
      };

      const handle = runtime.spawn(spawnInput);
      return runtime.wait(handle.actorId);
    },
  };
}
