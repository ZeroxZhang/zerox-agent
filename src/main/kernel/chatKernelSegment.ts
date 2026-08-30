import type { RuntimeKernelResult } from "./runtimeKernel";
import type {
  ProductionKernelDriver,
  ProductionKernelExecutionContext,
  ProductionKernelReporter,
  ProductionKernelSegment,
} from "./productionKernelDriver";

export type ChatKernelStreamTerminal = {
  type: "completed" | "failed" | "canceled";
  finalMessageId?: string;
};

export type ChatKernelSettlement<TResult> = ProductionKernelSegment & {
  result: TResult;
  persistence:
    | {
        requiredStatePersisted: true;
        assistantMessageId?: string;
        continuationPersisted?: true;
        /** Paused only because legacy business settlement cannot be proven. */
        reconciliationRequired?: true;
        terminalActivityPersisted?: true;
        /** Valid only when absence was established before any owning fact existed. */
        noDomainStateCreated?: true;
        settlementRecoveryRequired?: never;
        settlementFailureCode?: never;
      }
    | {
        /** At least one owning domain may exist, but the required receipts did not all commit. */
        requiredStatePersisted: false;
        settlementRecoveryRequired: true;
        settlementFailureCode: string;
        noDomainStateCreated?: never;
        terminalActivityPersisted?: never;
        assistantMessageId?: never;
        continuationPersisted?: never;
        reconciliationRequired?: never;
      };
  streamTerminals: readonly [ChatKernelStreamTerminal];
};

export type ChatKernelSegmentInput<TResult> = {
  driver: ProductionKernelDriver;
  runId: string;
  signal?: AbortSignal;
  execute(
    reporter: ProductionKernelReporter,
    context: ProductionKernelExecutionContext,
  ): Promise<ChatKernelSettlement<TResult>>;
  settleAborted(
    status: "paused" | "canceled",
    context: ProductionKernelExecutionContext,
  ): Promise<ChatKernelSettlement<TResult>>;
  settleFailed(
    error: unknown,
    context: ProductionKernelExecutionContext,
  ): Promise<ChatKernelSettlement<TResult>>;
};

export async function runChatKernelSegment<TResult>(
  input: ChatKernelSegmentInput<TResult>,
): Promise<{
  kernel: RuntimeKernelResult;
  settlement: ChatKernelSettlement<TResult>;
}> {
  const outcome = await input.driver.run({
    runId: input.runId,
    mode: "chat",
    failureDisposition: "return_settlement",
    ...(input.signal ? { signal: input.signal } : {}),
    async execute(reporter, context) {
      return validateChatKernelSettlement(
        await input.execute(reporter, context),
      );
    },
    async settleAborted(status, context) {
      return validateChatKernelSettlement(
        await input.settleAborted(status, context),
      );
    },
    async settleFailed(error, context) {
      return validateChatKernelSettlement(
        await input.settleFailed(error, context),
      );
    },
  });

  return {
    kernel: outcome.kernel,
    settlement: outcome.segment,
  };
}

export function validateChatKernelSettlement<TResult>(
  settlement: ChatKernelSettlement<TResult>,
): ChatKernelSettlement<TResult> {
  if (settlement.streamTerminals.length !== 1) {
    throw new Error(
      `Chat Kernel settlement requires exactly one stream terminal, received ${settlement.streamTerminals.length}.`,
    );
  }

  const terminal = settlement.streamTerminals[0];
  const expectedTerminal = expectedStreamTerminal(settlement.status);
  if (terminal.type !== expectedTerminal) {
    throw new Error(
      `Chat Kernel ${settlement.status} settlement requires ${expectedTerminal} stream terminal, received ${terminal.type}.`,
    );
  }

  const assistantMessageId =
    settlement.persistence.assistantMessageId?.trim();
  const finalMessageId = terminal.finalMessageId?.trim();
  if (assistantMessageId && finalMessageId !== assistantMessageId) {
    throw new Error(
      "Chat Kernel assistant persistence and stream final message IDs must match.",
    );
  }
  if (!assistantMessageId && finalMessageId) {
    throw new Error(
      "Chat Kernel stream final message ID requires a persisted assistant message.",
    );
  }

  if (
    settlement.persistence.requiredStatePersisted === false
    && (
      settlement.persistence.settlementRecoveryRequired !== true
      || !settlement.persistence.settlementFailureCode.trim()
      || (settlement.status !== "failed" && settlement.status !== "canceled")
    )
  ) {
    throw new Error(
      "Incomplete Chat Kernel persistence requires a typed failed or canceled recovery settlement.",
    );
  }
  if (
    settlement.status === "paused" &&
    settlement.persistence.requiredStatePersisted === true &&
    settlement.persistence.continuationPersisted !== true &&
    settlement.persistence.reconciliationRequired !== true
  ) {
    throw new Error(
      "Paused Chat Kernel settlement requires durable continuation or explicit reconciliation state.",
    );
  }
  if (
    settlement.persistence.requiredStatePersisted === true &&
    settlement.persistence.continuationPersisted === true
    && settlement.persistence.reconciliationRequired === true
  ) {
    throw new Error(
      "Chat Kernel settlement cannot claim both continuation and reconciliation-only state.",
    );
  }
  if (
    settlement.persistence.requiredStatePersisted === true &&
    (settlement.status === "failed" ||
      settlement.status === "canceled") &&
    settlement.persistence.terminalActivityPersisted !== true &&
    settlement.persistence.noDomainStateCreated !== true
  ) {
    throw new Error(
      `${settlement.status} Chat Kernel settlement requires durable terminal activity.`,
    );
  }
  if (
    settlement.persistence.requiredStatePersisted === true &&
    settlement.status === "succeeded" &&
    !assistantMessageId &&
    settlement.persistence.terminalActivityPersisted !== true &&
    settlement.persistence.noDomainStateCreated !== true
  ) {
    throw new Error(
      "succeeded Chat Kernel settlement requires a persisted assistant message or terminal activity.",
    );
  }

  return Object.freeze(settlement);
}

function expectedStreamTerminal(
  status: ProductionKernelSegment["status"],
): ChatKernelStreamTerminal["type"] {
  if (status === "failed") return "failed";
  if (status === "canceled") return "canceled";
  return "completed";
}
