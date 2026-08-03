import type {
  ChatCompletionResponse,
  ChatMessage,
} from "./openAiCompatibleClient";
import {
  ModelServiceNoticeError,
  throwForModelServiceNotice,
} from "../shared/modelServiceNotice";
import {
  buildOutputLimitContinuationPrompt,
  escalateOutputBudget,
  isRecoverableOutputLimit,
  OUTPUT_LIMIT_CONTINUATION_PREFIX_MAX_CHARS,
} from "./structuredOutputBudget";

/**
 * Structured model boundary protocol — the single recovery ladder every
 * structured model boundary runs through.
 *
 * Why this exists (2026-08-02 review): every model boundary used to grow its
 * own ad-hoc error handling, so each failure class (context integrity, JSON
 * slips, output truncation, fragment-masked syntax errors) was fixed at one
 * site and kept exploding at the next. LLM output over a wire is an
 * unreliable channel: strict prompt contracts are necessary but can never be
 * sufficient, because the model is stochastic. The boundary therefore needs
 * a protocol stack, and it needs to be ONE stack:
 *
 *   1. complete normally with the profile's output budget
 *   2. on a recoverable output-limit truncation (finishReason=length with
 *      partial content), continue exactly from the cut once with an
 *      escalated budget
 *   3. on a parse/contract failure, run one contract-feedback repair with
 *      the accurate (unmasked) error and the broken text echoed back
 *   4. otherwise fail closed with diagnostics plus a bounded raw excerpt
 *
 * At most 3 model completions per invocation. The ladder never changes the
 * contract itself — salvaged and repaired output must still pass the same
 * `parse` before it is accepted.
 */

export type StructuredBoundaryResponse = Pick<
  ChatCompletionResponse,
  "content" | "finishReason" | "modelServiceNotice" | "usage"
> & { reasoningContent?: string };

export type StructuredBoundaryContract<T> = {
  /** Boundary name for diagnostics, e.g. "plan-round:a1" or "plan-review". */
  name: string;
  /** System + user messages that define the contract for the model. */
  baseMessages: ChatMessage[];
  /**
   * Parse + validate raw response text into the contract shape. Must throw
   * on any violation; for plan boundaries this is parseUniquePlanRoundObject
   * composed with the round normalize (extraction + fragment-unmasking +
   * single-brace salvage included).
   */
  parse: (text: string) => T;
  /** Contract-feedback repair prompt shown after the echoed broken text. */
  buildRepairPrompt: (error: unknown) => string;
  /**
   * Build the terminal error when the ladder is exhausted. Receives the
   * last parse/contract error and the last response (for diagnostics and
   * raw-excerpt capture).
   */
  buildFailure: (
    error: unknown,
    response: StructuredBoundaryResponse,
  ) => Error;
  /** Message shown to the model when a response carries no text at all. */
  emptyContentError: string;
};

export type StructuredBoundaryResult<T> = {
  output: T;
  usage?: { inputTokens: number; outputTokens: number };
};

const MAX_BOUNDARY_COMPLETIONS = 3;
const REPAIR_ECHO_MAX_CHARS = 16_000;

export async function completeStructuredBoundary<T>(options: {
  complete: (request: {
    maxTokens: number;
    messages: ChatMessage[];
  }) => Promise<StructuredBoundaryResponse>;
  contract: StructuredBoundaryContract<T>;
  initialMaxTokens: number;
  signal?: AbortSignal;
}): Promise<StructuredBoundaryResult<T>> {
  const { contract } = options;
  let messages = contract.baseMessages;
  let maxTokens = options.initialMaxTokens;
  let outputLimitRecovered = false;
  let repairAttempted = false;
  let continuationPrefix = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let hasUsage = false;

  for (let attempt = 0; attempt < MAX_BOUNDARY_COMPLETIONS; attempt += 1) {
    const response = await options.complete({ maxTokens, messages });
    if (response.usage) {
      hasUsage = true;
      inputTokens += response.usage.inputTokens;
      outputTokens += response.usage.outputTokens;
    }
    if (
      !outputLimitRecovered &&
      isRecoverableOutputLimit(response.modelServiceNotice, response.content)
    ) {
      // Output-budget mismatch: the truncated prefix is valid partial JSON,
      // so resume at the cut with an escalated budget instead of dying.
      outputLimitRecovered = true;
      maxTokens = escalateOutputBudget(maxTokens);
      continuationPrefix = (response.content ?? "")
        .trim()
        .slice(0, OUTPUT_LIMIT_CONTINUATION_PREFIX_MAX_CHARS);
      messages = [
        ...contract.baseMessages,
        { role: "assistant" as const, content: continuationPrefix },
        {
          role: "user" as const,
          content: buildOutputLimitContinuationPrompt(),
        },
      ];
      continue;
    }
    throwForModelServiceNotice(response.modelServiceNotice);
    const text = continuationPrefix
      ? continuationPrefix + (response.content ?? "")
      : (response.content ?? "");
    try {
      if (!text.trim()) {
        throw new Error(contract.emptyContentError);
      }
      return {
        output: contract.parse(text),
        ...(hasUsage ? { usage: { inputTokens, outputTokens } } : {}),
      };
    } catch (error) {
      if (error instanceof ModelServiceNoticeError) {
        throw error;
      }
      if (repairAttempted) {
        throw contract.buildFailure(error, response);
      }
      repairAttempted = true;
      continuationPrefix = "";
      messages = [
        ...contract.baseMessages,
        ...(text.trim()
          ? [
              {
                role: "assistant" as const,
                content: text.trim().slice(0, REPAIR_ECHO_MAX_CHARS),
              },
            ]
          : []),
        { role: "user" as const, content: contract.buildRepairPrompt(error) },
      ];
    }
  }
  throw contract.buildFailure(
    new Error(`${contract.name} 结构化输出修复未完成。`),
    { content: "", finishReason: "unknown" },
  );
}
