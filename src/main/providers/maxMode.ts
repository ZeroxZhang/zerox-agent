// MaxMode / best-of-N (contracts v1.4 §10.2, Patch 13, P8).
//
// N parallel propose-only candidates (tool schema-only, NOT executed) → a judge
// model selects the winner. The parent AgentLoop executes the winner's tool calls
// exactly once through its normal authorization path. Only the winner enters the
// parent context; ensemble cost is tracked but does NOT count
// against the context token budget. Disabled by default (ZEROX_MAX_MODE).

import type { CompleteRequest, CompleteResponse, LLMProvider } from "./provider";
import type { ActorRuntime } from "../actors/actorRuntime";
import { readFeatureFlags } from "../../shared/featureFlags";
import {
  ModelServiceNoticeError,
  throwForModelServiceNotice,
} from "../../shared/modelServiceNotice";
import { throwIfResponseBodyLimitError } from "../fetchWithTimeout";

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
}

export interface MaxMode {
  runStep(input: CompleteRequest, opts: MaxModeRunStepOptions): Promise<MaxModeResult>;
}

export function createMaxMode(provider: LLMProvider): MaxMode {
  return {
    async runStep(input, opts): Promise<MaxModeResult> {
      const n = Math.max(1, opts.candidates);
      // 1. N parallel proposals. Provider calls only describe tool calls; the
      // parent AgentLoop remains the sole side-effect executor.
      const proposeReq: CompleteRequest = {
        ...input,
        toolChoice: input.toolChoice ?? "auto",
      };
      const candidateResults = await Promise.all(
        Array.from({ length: n }, async (): Promise<PromiseSettledResult<CompleteResponse>> => {
          try {
            return { status: "fulfilled", value: await provider.complete(proposeReq) };
          } catch (error) {
            // A response-budget violation is a security boundary, not a weak
            // candidate. Reject promptly even if a sibling proposal stalls.
            throwIfResponseBodyLimitError(error);
            return { status: "rejected", reason: error };
          }
        }),
      );
      const completedResponses = candidateResults
        .filter((r): r is PromiseFulfilledResult<CompleteResponse> => r.status === "fulfilled")
        .map((r) => r.value);
      const firstNotice = completedResponses.find(
        (candidate) => candidate.modelServiceNotice,
      )?.modelServiceNotice;
      const candidates = completedResponses.filter(
        (candidate) => !candidate.modelServiceNotice,
      );
      const ensembleInput = candidates.reduce((s, c) => s + (c.usage?.inputTokens ?? 0), 0);
      const ensembleOutput = candidates.reduce((s, c) => s + (c.usage?.outputTokens ?? 0), 0);

      if (candidates.length === 0) {
        throwForModelServiceNotice(firstNotice);
        throw new Error("MaxMode: all candidates failed");
      }

      // 2. Judge selects the winner (single candidate → trivially the winner).
      const winner = candidates.length === 1
        ? candidates[0]!
        : await judgeWinner(opts.judgeProvider ?? provider, opts.judgeModel, input, candidates, opts.signal);

      return {
        winner,
        candidatesTried: candidates.length,
        judgeModel: opts.judgeModel,
        ensembleTokens: { input: ensembleInput, output: ensembleOutput },
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
    throwForModelServiceNotice(res.modelServiceNotice);
    const match = (res.content ?? "").match(/(\d+)/);
    if (match) {
      const idx = parseInt(match[1]!, 10) - 1;
      if (idx >= 0 && idx < candidates.length) return candidates[idx]!;
    }
  } catch (error) {
    throwIfResponseBodyLimitError(error);
    if (error instanceof ModelServiceNoticeError) throw error;
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
  return readFeatureFlags(env).ZEROX_MAX_MODE === "on";
}
