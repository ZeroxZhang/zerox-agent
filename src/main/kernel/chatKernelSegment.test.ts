import { describe, expect, it } from "vitest";
import { KernelEventBus } from "./eventBus";
import { createProductionKernelDriver } from "./productionKernelDriver";
import {
  runChatKernelSegment,
  validateChatKernelSettlement,
  type ChatKernelSettlement,
} from "./chatKernelSegment";

describe("Chat Kernel segment adapter", () => {
  it("persists the assistant and emits completed before run_end", async () => {
    const bus = new KernelEventBus();
    const lifecycle: string[] = [];
    bus.subscribe((event) => {
      if (event.type === "run_end") lifecycle.push("run_end");
    });

    const result = await runChatKernelSegment({
      driver: createProductionKernelDriver({ bus, now: fixedNow }),
      runId: "chat_success",
      async execute(_reporter, context) {
        expect(context).toEqual({
          runId: "chat_success",
          mode: "chat",
          turn: 1,
        });
        lifecycle.push("assistant_persisted");
        lifecycle.push("stream_completed");
        return assistantSettlement("succeeded", "message_2", {
          ok: true,
          reply: "done",
        });
      },
      settleAborted: unreachable,
      settleFailed: unreachable,
    });

    expect(result.settlement.result).toEqual({
      ok: true,
      reply: "done",
    });
    expect(Object.isFrozen(result.settlement)).toBe(true);
    expect(lifecycle).toEqual([
      "assistant_persisted",
      "stream_completed",
      "run_end",
    ]);
  });

  it("requires continuation persistence before a paused run_end", async () => {
    const bus = new KernelEventBus();
    const lifecycle: string[] = [];
    bus.subscribe((event) => {
      if (event.type === "run_end") lifecycle.push("run_end");
    });

    const result = await runChatKernelSegment({
      driver: createProductionKernelDriver({ bus, now: fixedNow }),
      runId: "chat_paused",
      async execute() {
        lifecycle.push("continuation_persisted");
        lifecycle.push("assistant_persisted");
        lifecycle.push("stream_completed");
        return {
          ...assistantSettlement("paused", "message_pause", {
            ok: true,
            state: "paused",
          }),
          persistence: {
            requiredStatePersisted: true,
            continuationPersisted: true,
            assistantMessageId: "message_pause",
          },
        };
      },
      settleAborted: unreachable,
      settleFailed: unreachable,
    });

    expect(result.kernel.status).toBe("paused");
    expect(lifecycle.at(-1)).toBe("run_end");
  });

  it("accepts an explicit reconciliation-only pause without claiming continuation", () => {
    expect(validateChatKernelSettlement({
      ...assistantSettlement("paused", "message_legacy", {}),
      persistence: {
        requiredStatePersisted: true,
        assistantMessageId: "message_legacy",
        reconciliationRequired: true,
      },
    })).toMatchObject({
      status: "paused",
      persistence: {
        reconciliationRequired: true,
      },
    });
  });

  it("returns the durable safe settlement without rethrowing the original error", async () => {
    const bus = new KernelEventBus();
    const lifecycle: string[] = [];
    const error = new Error("model failed");
    bus.subscribe((event) => {
      if (event.type === "run_end") lifecycle.push("run_end");
    });

    await expect(
      runChatKernelSegment({
        driver: createProductionKernelDriver({ bus, now: fixedNow }),
        runId: "chat_failed",
        async execute() {
          throw error;
        },
        settleAborted: unreachable,
        async settleFailed(observedError, context) {
          expect(observedError).toBe(error);
          expect(context.mode).toBe("chat");
          lifecycle.push("failed_activity_persisted");
          lifecycle.push("stream_failed");
          return terminalActivitySettlement("failed", {
            ok: false,
            message: "model failed",
          });
        },
      }),
    ).resolves.toMatchObject({
      kernel: { status: "failed", reason: "settled_failure" },
      settlement: { status: "failed", result: { ok: false } },
    });

    expect(lifecycle).toEqual([
      "failed_activity_persisted",
      "stream_failed",
      "run_end",
    ]);
    expect(bus.history().at(-1)).toMatchObject({
      type: "run_end",
      status: "failed",
      reason: "settled_failure",
    });
    expect(JSON.stringify(bus.history())).not.toContain(error.message);
  });

  it("settles a pre-canceled turn before run_end without executing", async () => {
    const bus = new KernelEventBus();
    const controller = new AbortController();
    controller.abort(new Error("user canceled"));
    const lifecycle: string[] = [];
    let executed = false;
    bus.subscribe((event) => {
      if (event.type === "run_end") lifecycle.push("run_end");
    });

    const result = await runChatKernelSegment({
      driver: createProductionKernelDriver({ bus, now: fixedNow }),
      runId: "chat_pre_canceled",
      signal: controller.signal,
      async execute() {
        executed = true;
        return assistantSettlement("succeeded", "unreachable", {
          ok: true,
        });
      },
      async settleAborted(status, context) {
        expect(status).toBe("canceled");
        expect(context).toEqual({
          runId: "chat_pre_canceled",
          mode: "chat",
          turn: 0,
        });
        lifecycle.push("canceled_activity_persisted");
        lifecycle.push("stream_canceled");
        return terminalActivitySettlement("canceled", {
          ok: false,
          code: "CANCELED",
        });
      },
      settleFailed: unreachable,
    });

    expect(executed).toBe(false);
    expect(result.kernel.status).toBe("canceled");
    expect(lifecycle).toEqual([
      "canceled_activity_persisted",
      "stream_canceled",
      "run_end",
    ]);
  });

  it.each([
    {
      name: "mismatched stream terminal",
      settlement: {
        ...terminalActivitySettlement("failed", {}),
        streamTerminals: [{ type: "completed" }],
      },
      error: /requires failed stream terminal/i,
    },
    {
      name: "mismatched assistant id",
      settlement: {
        ...assistantSettlement("succeeded", "message_1", {}),
        streamTerminals: [
          { type: "completed", finalMessageId: "message_2" },
        ],
      },
      error: /message IDs must match/i,
    },
    {
      name: "paused without continuation",
      settlement: {
        ...assistantSettlement("paused", "message_1", {}),
        persistence: {
          requiredStatePersisted: true,
          assistantMessageId: "message_1",
        },
      },
      error: /requires durable continuation/i,
    },
    {
      name: "paused with contradictory continuation and reconciliation",
      settlement: {
        ...assistantSettlement("paused", "message_1", {}),
        persistence: {
          requiredStatePersisted: true,
          assistantMessageId: "message_1",
          continuationPersisted: true,
          reconciliationRequired: true,
        },
      },
      error: /cannot claim both continuation and reconciliation/i,
    },
    {
      name: "canceled without durable activity",
      settlement: {
        status: "canceled",
        summary: "canceled",
        result: {},
        persistence: { requiredStatePersisted: true },
        streamTerminals: [{ type: "canceled" }],
      },
      error: /requires durable terminal activity/i,
    },
    {
      name: "multiple stream terminals",
      settlement: {
        ...terminalActivitySettlement("failed", {}),
        streamTerminals: [
          { type: "failed" },
          { type: "failed" },
        ],
      },
      error: /exactly one stream terminal/i,
    },
    {
      name: "incomplete persistence without a failure code",
      settlement: {
        status: "failed",
        summary: "failed",
        result: {},
        persistence: {
          requiredStatePersisted: false,
          settlementRecoveryRequired: true,
          settlementFailureCode: "",
        },
        streamTerminals: [{ type: "failed" }],
      },
      error: /typed failed or canceled recovery settlement/i,
    },
    {
      name: "successful result with incomplete persistence",
      settlement: {
        status: "succeeded",
        summary: "succeeded",
        result: {},
        persistence: {
          requiredStatePersisted: false,
          settlementRecoveryRequired: true,
          settlementFailureCode: "CROSS_DOMAIN_SETTLEMENT_FAILED",
        },
        streamTerminals: [{ type: "completed" }],
      },
      error: /typed failed or canceled recovery settlement/i,
    },
  ])("rejects $name", ({ settlement, error }) => {
    expect(() =>
      validateChatKernelSettlement(
        settlement as ChatKernelSettlement<unknown>,
      ),
    ).toThrow(error);
  });

  it("accepts an honest recovery-required failed settlement without claiming absence", () => {
    expect(validateChatKernelSettlement({
      status: "failed",
      summary: "recovery required",
      result: {},
      persistence: {
        requiredStatePersisted: false,
        settlementRecoveryRequired: true,
        settlementFailureCode: "SETTLEMENT_COMPENSATION_INCOMPLETE",
      },
      streamTerminals: [{ type: "failed" }],
    })).toMatchObject({
      persistence: {
        requiredStatePersisted: false,
        settlementRecoveryRequired: true,
      },
    });
  });
});

function assistantSettlement<TResult>(
  status: "succeeded" | "paused",
  assistantMessageId: string,
  result: TResult,
): ChatKernelSettlement<TResult> {
  return {
    status,
    summary: `${status} Chat turn`,
    result,
    persistence: {
      requiredStatePersisted: true,
      assistantMessageId,
      ...(status === "paused"
        ? { continuationPersisted: true as const }
        : {}),
    },
    streamTerminals: [
      {
        type: "completed",
        finalMessageId: assistantMessageId,
      },
    ],
  };
}

function terminalActivitySettlement<TResult>(
  status: "failed" | "canceled",
  result: TResult,
): ChatKernelSettlement<TResult> {
  return {
    status,
    summary: `${status} Chat turn`,
    result,
    persistence: {
      requiredStatePersisted: true,
      terminalActivityPersisted: true,
    },
    streamTerminals: [{ type: status }],
  };
}

async function unreachable(): Promise<never> {
  throw new Error("unreachable settlement");
}

function fixedNow(): string {
  return "2026-08-14T12:00:00.000Z";
}
