// MaxMode / best-of-N (contracts v1.4 §10.2, Patch 13, P8).
//
// N parallel propose-only candidates (tool schema-only, NOT executed) → a judge
// model selects the winner → the winner's tool calls are replayed via a P6
// ephemeral state actor (contract §10.2 + Patch 13 `executedViaActor`). Only the
// winner enters the parent context; ensemble cost is tracked but does NOT count
// against the context token budget. Disabled by default (ZEROX_MAX_MODE).

import type {
  CompleteRequest,
  CompleteResponse,
  LLMProvider,
  ToolCall,
} from "./provider";
import type { ActorRuntime, ActorOutcome, SpawnInput } from "../actors/actorRuntime";

export interface MaxModeRunStepOptions {
  candidates: number;
  judgeModel: string;
  judgeProvider?: LLMProvider;
  actorRuntime?: ActorRuntime; // for winner replay
  parentRunId?: string;
  signal?: AbortSignal;
}

export interface MaxModeResult {
  winner: CompleteResponse;
  candidatesTried: number;
  judgeModel: string;
  ensembleTokens: { input: number; output: number };
  executedViaActor?: string; // actorId if winner had tool calls replayed via actor
}

export interface MaxMode {
  runStep(input: CompleteRequest, opts: MaxModeRunStepOptions): Promise<MaxModeResult>;
}

export function createMaxMode(provider: LLMProvider): MaxMode {
  return {
    async runStep(input, opts): Promise<MaxModeResult> {
      const n = Math.max(1, opts.candidates);
      // 1. N parallel propose-only candidates (toolChoice: none → schema-only, no exec).
      const proposeReq: CompleteRequest = { ...input, toolChoice: "none" };
      const candidateResults = await Promise.allSettled(
        Array.from({ length: n }, () => provider.complete(proposeReq)),
      );
      const candidates = candidateResults
        .filter((r): r is PromiseFulfilledResult<CompleteResponse> => r.status === "fulfilled")
        .map((r) => r.value);
      const ensembleInput = candidates.reduce((s, c) => s + (c.usage?.inputTokens ?? 0), 0);
      const ensembleOutput = candidates.reduce((s, c) => s + (c.usage?.outputTokens ?? 0), 0);

      if (candidates.length === 0) {
        throw new Error("MaxMode: all candidates failed");
      }

      // 2. Judge selects the winner (single candidate → trivially the winner).
      const winner = candidates.length === 1
        ? candidates[0]!
        : await judgeWinner(opts.judgeProvider ?? provider, opts.judgeModel, input, candidates, opts.signal);

      // 3. If the winner has tool calls, replay them via a P6 ephemeral state actor
      //    (contract §10.2 + Patch 13). The actor executes the side effects; only the
      //    winner's message enters the parent context (handled by the caller).
      let executedViaActor: string | undefined;
      if (winner.toolCalls && winner.toolCalls.length > 0 && opts.actorRuntime && opts.parentRunId) {
        const replayInput: SpawnInput = {
          contextMode: "state",
          lifecycle: "ephemeral",
          toolWhitelist: "inherit",
          task: `Replay max-mode winner tool calls: ${winner.toolCalls.map((tc: ToolCall) => tc.function.name).join(", ")}`,
          parentRunId: opts.parentRunId,
        };
        const handle = opts.actorRuntime.spawn(replayInput);
        const outcome: ActorOutcome = await opts.actorRuntime.wait(handle.actorId);
        if (outcome.status === "done") executedViaActor = handle.actorId;
      }

      return {
        winner,
        candidatesTried: candidates.length,
        judgeModel: opts.judgeModel,
        ensembleTokens: { input: ensembleInput, output: ensembleOutput },
        ...(executedViaActor ? { executedViaActor } : {}),
      };
    },
  };
}

async function judgeWinner(
  judgeProvider: LLMProvider,
  judgeModel: string,
  original: CompleteRequest,
  candidates: CompleteResponse[],
  signal?: AbortSignal,
): Promise<CompleteResponse> {
  // Ask the judge to pick the best candidate by index. Fall back to the first
  // candidate on any judge failure (never block the parent loop).
  try {
    const numbered = candidates.map((c, i) => `Candidate ${i + 1}: ${c.content ?? "(tool calls only)"}`).join("\n\n");
    const req: CompleteRequest = {
      model: judgeModel,
      apiKey: original.apiKey,
      temperature: 0,
      maxTokens: 16,
      messages: [
        { role: "system", content: "Pick the best candidate by replying with only its number." },
        { role: "user", content: [{ type: "text", text: `Original task: ${summarizeTask(original)}\n\n${numbered}\n\nReply with the single best candidate number (1-${candidates.length}).` }] },
      ],
      ...(signal ? { signal } : {}),
    };
    const res = await judgeProvider.complete(req);
    const match = (res.content ?? "").match(/(\d+)/);
    if (match) {
      const idx = parseInt(match[1]!, 10) - 1;
      if (idx >= 0 && idx < candidates.length) return candidates[idx]!;
    }
  } catch {
    // judge failed — fall through to heuristic
  }
  // Heuristic: prefer the candidate with tool calls, else the longest text.
  const withTools = candidates.find((c) => c.toolCalls && c.toolCalls.length > 0);
  if (withTools) return withTools;
  return [...candidates].sort((a, b) => (b.content ?? "").length - (a.content ?? "").length)[0]!;
}

function summarizeTask(req: CompleteRequest): string {
  const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
  if (!lastUser || lastUser.role !== "user") return "(task)";
  return lastUser.content.map((c) => (c.type === "text" ? c.text : "")).join(" ").slice(0, 500);
}

export function isMaxModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.ZEROX_MAX_MODE ?? "").toLowerCase();
  return raw === "1" || raw === "true" || raw === "on";
}
