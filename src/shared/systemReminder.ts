/** Conditions that can trigger a system-reminder injection. */
export type SystemReminderTriggerType =
  | "context_pressure"       // context usage > 70%
  | "loop_detection"         // repeated tool calls with same args
  | "structured_output_retry" // JSON schema parse failure
  | "mode_transition"        // switching from planning to execution
  | "output_continuation"    // output was truncated
  | "task_gate";             // non-terminal tasks remaining before stop

/** Runtime context passed to trigger evaluators. */
export type SystemReminderContext = {
  /** Estimated token count of the current message list. */
  estimatedTokens: number;
  /** Token budget (maxTokens * 0.7 typically). */
  tokenBudget: number;
  /** Stable hash of the most recent repeated tool+args. */
  loopSignature?: string | null;
  /** Consecutive count of the same tool+args. */
  loopCount?: number;
  /** How many times structured output has failed in this turn. */
  structuredOutputAttempts?: number;
  /** Current execution mode. */
  mode?: "planning" | "execution";
  /** Whether the last output was truncated. */
  outputTruncated?: boolean;
  /** Incomplete tasks that still need work. */
  incompleteTasks?: Array<{ id: string; status: string; summary: string }>;
};

/** A single system-reminder trigger: evaluates context and builds reminder text. */
export type SystemReminderTrigger = {
  type: SystemReminderTriggerType;
  /** Returns true if this reminder should fire. */
  shouldFire(ctx: SystemReminderContext): boolean;
  /** Builds the reminder text to inject into the next user message. */
  build(ctx: SystemReminderContext): string;
};

/** Registry of all system-reminder triggers. */
export type SystemReminderRegistry = {
  /** Evaluate all enabled triggers against the context and return reminder texts. */
  evaluate(ctx: SystemReminderContext): string[];
  /** Enable a trigger type. */
  enable(type: SystemReminderTriggerType): void;
  /** Disable a trigger type. */
  disable(type: SystemReminderTriggerType): void;
  /** Check if a trigger type is enabled. */
  isEnabled(type: SystemReminderTriggerType): boolean;
  /** Register a custom trigger (enabled by default). */
  register(trigger: SystemReminderTrigger): void;
  /** Remove a previously registered trigger. */
  remove(type: SystemReminderTriggerType): void;
};
