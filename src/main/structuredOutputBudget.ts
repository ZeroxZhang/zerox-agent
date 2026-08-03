import type { ModelServiceNotice } from "../shared/modelServiceNotice";

/**
 * Output-budget recovery for structured planning completions.
 *
 * Root cause (observed 2026-08-01, plan "规划模型未完成本轮"): planner
 * profiles ship with maxTokens = 8192, but a complex v2 PlanArtifact JSON
 * routinely exceeds that (the final plan markdown renderings of the same
 * content are 22-31 KB; Chinese text is roughly one token per character).
 * Every structured boundary treated `finishReason=length` as fatal, so a
 * budget mismatch killed the whole plan even though the model had produced
 * most of a valid artifact. This module is the shared protocol adapter for
 * the budget dimension: truncated-but-present content is recoverable by
 * (a) asking the model to continue exactly from the cut point and
 * (b) escalating the output budget for the retry, both strictly bounded so
 * a persistently over-budget round still fails closed.
 */

/** Hard ceiling for escalated output budgets (provider-independent). */
export const MAX_ESCALATED_OUTPUT_TOKENS = 32_768;

/** Minimum budget used when escalating, even if 2x the profile is smaller. */
export const MIN_ESCALATED_OUTPUT_TOKENS = 16_384;

/**
 * Cap for the truncated prefix echoed back for continuation. Large enough
 * to cover a full 8192-token truncation (Chinese ≈ 1 token/char) while
 * keeping the continuation request's input bounded.
 */
export const OUTPUT_LIMIT_CONTINUATION_PREFIX_MAX_CHARS = 64_000;

export function escalateOutputBudget(currentMaxTokens: number): number {
  const base =
    Number.isFinite(currentMaxTokens) && currentMaxTokens > 0
      ? currentMaxTokens
      : 8192;
  return Math.min(
    Math.max(base * 2, MIN_ESCALATED_OUTPUT_TOKENS),
    MAX_ESCALATED_OUTPUT_TOKENS,
  );
}

/**
 * An output-limit notice is recoverable only when the provider returned
 * partial content to continue from. An empty truncated response carries no
 * usable prefix and fails through the normal notice path.
 */
export function isRecoverableOutputLimit(
  notice: ModelServiceNotice | undefined,
  content: string | null | undefined,
): boolean {
  return notice?.kind === "output_limit" && Boolean(content?.trim());
}

/**
 * User message appended after the truncated assistant prefix: resume exactly
 * at the cut, stay compact so the remainder fits the escalated budget.
 */
export function buildOutputLimitContinuationPrompt(): string {
  return [
    "你的上一条响应因达到输出长度限制而被截断，JSON 不完整。",
    "请紧接着上一条响应的截断处继续输出剩余 JSON：不要重复已输出的任何字符，不要重新开始，不要输出解释或 Markdown 代码围栏。",
    "为在输出预算内完成：使用紧凑 JSON（不缩进、无多余空白），精简长文本字段（概述/描述类各不超过 200 字），不要复述证据原文，用引用 ID 表示。",
  ].join("\n");
}
