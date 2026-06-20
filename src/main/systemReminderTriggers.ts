import type { SystemReminderTrigger, SystemReminderContext } from "../shared/systemReminder";

/**
 * Injects when context usage exceeds 70% of the token budget.
 * Nudges the model to compress its approach and avoid re-reading.
 */
export const contextPressureTrigger: SystemReminderTrigger = {
  type: "context_pressure",
  shouldFire(ctx: SystemReminderContext): boolean {
    if (ctx.tokenBudget <= 0) return false;
    return ctx.estimatedTokens / ctx.tokenBudget > 0.7;
  },
  build(_ctx: SystemReminderContext): string {
    return [
      "<system-reminder>",
      "上下文使用已超过 70%。请精简后续工具调用，优先复用已有结果；",
      "不要重复读取已获取过的文件内容。如果当前步骤已完成，给出阶段性结论。",
      "</system-reminder>",
    ].join("\n");
  },
};

/**
 * Injects when the model calls the same tool with the same args 3+ consecutive times.
 * Forces the model to change approach rather than looping.
 */
export const loopDetectionTrigger: SystemReminderTrigger = {
  type: "loop_detection",
  shouldFire(ctx: SystemReminderContext): boolean {
    const count = ctx.loopCount ?? 0;
    return count >= 3;
  },
  build(ctx: SystemReminderContext): string {
    const sig = ctx.loopSignature ?? "unknown";
    const count = ctx.loopCount ?? 3;
    return [
      "<system-reminder>",
      `检测到重复工具调用模式（${sig}），已连续执行 ${count} 次。`,
      "请立即停止当前循环，换一个不同的方法或工具继续；",
      "如果所有路径都已尝试，请基于已有结果给出当前发现和下一步建议。",
      "</system-reminder>",
    ].join("\n");
  },
};

/**
 * Injects when the model's structured output fails JSON Schema validation 2+ times.
 * Reminds the model to check required fields and valid JSON syntax.
 */
export const structuredOutputRetryTrigger: SystemReminderTrigger = {
  type: "structured_output_retry",
  shouldFire(ctx: SystemReminderContext): boolean {
    return (ctx.structuredOutputAttempts ?? 0) >= 2;
  },
  build(ctx: SystemReminderContext): string {
    const attempts = ctx.structuredOutputAttempts ?? 2;
    return [
      "<system-reminder>",
      `连续 ${attempts} 次输出未通过 JSON Schema 校验。`,
      "请仔细阅读 Schema 中的 required 字段，确认所有必填项都已包含；",
      "确保输出的 JSON 语法正确（引号闭合、无尾随逗号），然后重试。",
      "</system-reminder>",
    ].join("\n");
  },
};

/**
 * Injects when transitioning from planning mode to execution mode.
 * Unlocks the model from over-planning and pushes it to act.
 */
export const modeTransitionTrigger: SystemReminderTrigger = {
  type: "mode_transition",
  shouldFire(ctx: SystemReminderContext): boolean {
    // Fire once when entering execution mode (fired by caller at mode switch boundary)
    return ctx.mode === "execution";
  },
  build(_ctx: SystemReminderContext): string {
    return [
      "<system-reminder>",
      "已进入执行模式。不要再做规划——直接执行计划的下一步，调用工具获取实际结果。",
      "</system-reminder>",
    ].join("\n");
  },
};

/**
 * Injects when the model's previous output was truncated mid-response.
 * Asks the model to continue from the truncation point.
 */
export const outputContinuationTrigger: SystemReminderTrigger = {
  type: "output_continuation",
  shouldFire(ctx: SystemReminderContext): boolean {
    return ctx.outputTruncated === true;
  },
  build(_ctx: SystemReminderContext): string {
    return [
      "<system-reminder>",
      "上一轮输出被截断。请从截断处继续，不要重复已输出的内容。",
      "</system-reminder>",
    ].join("\n");
  },
};

/**
 * Injects when the model is about to stop but there are still incomplete tasks.
 * Prevents premature termination.
 */
export const taskGateTrigger: SystemReminderTrigger = {
  type: "task_gate",
  shouldFire(ctx: SystemReminderContext): boolean {
    const tasks = ctx.incompleteTasks ?? [];
    return tasks.some((t) => t.status !== "completed" && t.status !== "canceled");
  },
  build(ctx: SystemReminderContext): string {
    const tasks = (ctx.incompleteTasks ?? []).filter(
      (t) => t.status !== "completed" && t.status !== "canceled",
    );
    const taskList = tasks
      .map((t) => `  - ${t.summary || t.id}（${t.status}）`)
      .join("\n");
    return [
      "<system-reminder>",
      "以下任务尚未完成：",
      taskList,
      "请在结束前完成这些任务，或明确说明放弃原因。不要无声跳过。",
      "</system-reminder>",
    ].join("\n");
  },
};

/** All built-in triggers in a convenient array. */
export const builtInTriggers: SystemReminderTrigger[] = [
  contextPressureTrigger,
  loopDetectionTrigger,
  structuredOutputRetryTrigger,
  modeTransitionTrigger,
  outputContinuationTrigger,
  taskGateTrigger,
];
