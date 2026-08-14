import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { afterAll, describe, expect, it } from "vitest";
import type {
  ChatMessageRecord,
  ChatSessionRecord,
} from "../shared/chat";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";
import {
  createContextSurface,
  replayContextSurface,
} from "./contextSurface";
import { runReadCodeProgram } from "./readCodeRuntime";
import { createInMemoryStorage, createTempFileStorage } from "./storage/storageDb";
import { createChatSessionEventRepository } from "./storage/repositories/chatSessionEventRepository";
import { createRunRepository } from "./storage/repositories/runRepository";
import { scheduleToolBatch } from "./toolBatchScheduler";

const CONTEXT_EVENT_COUNT = 25_000;
const CHAT_MESSAGE_COUNT = 10_000;
const TRAJECTORY_EVENT_COUNT = 25_000;
const BATCH_ITEM_COUNT = 5_000;
const BATCH_PARALLELISM = 32;
const WORKER_STEP_COUNT = 128;
const WORKER_PARALLELISM = 16;
const metrics: Array<{ scenario: string; elapsedMs: number }> = [];

describe.skipIf(process.env.ZEROX_RUNTIME_STRESS !== "1")(
  "runtime stress gate",
  () => {
    afterAll(() => {
      process.stdout.write(
        `[runtime-stress] ${JSON.stringify(metrics)}\n`,
      );
    });

    it("replays a 25k-event context surface without token rescans", () => {
      const startedAt = performance.now();
      let estimatorCalls = 0;
      let expectedTokens = 0;
      const surface = createContextSurface({
        runId: "stress_context",
        estimateMessageTokens(message) {
          estimatorCalls += 1;
          return message.content.length;
        },
        now: fixedNow,
      });

      for (let index = 0; index < CONTEXT_EVENT_COUNT; index += 1) {
        const content = `context-message-${index}`;
        expectedTokens += content.length;
        surface.append({ role: "user", content });
      }

      for (let index = 0; index < 10_000; index += 1) {
        expect(surface.estimatedTokens()).toBe(expectedTokens);
        expect(surface.stats().sourceCount).toBe(CONTEXT_EVENT_COUNT);
      }
      expect(estimatorCalls).toBe(CONTEXT_EVENT_COUNT);

      const replayed = replayContextSurface(surface.snapshot());
      expect(replayed.sourceCount).toBe(CONTEXT_EVENT_COUNT);
      expect(replayed.messages).toHaveLength(CONTEXT_EVENT_COUNT);
      expect(replayed.messages[0]?.content).toBe("context-message-0");
      expect(replayed.messages.at(-1)?.content).toBe(
        `context-message-${CONTEXT_EVENT_COUNT - 1}`,
      );
      expect(replayed.estimatedTokens).toBe(expectedTokens);
      recordMetric("context-25k", startedAt, 30_000);
    }, 60_000);

    it("keeps a 10k-message Chat projection bounded and searchable", async () => {
      const startedAt = performance.now();
      const storage = await createInMemoryStorage();
      try {
        const repository = createChatSessionEventRepository(storage);
        let metadata: Omit<ChatSessionRecord, "messages"> = {
          id: "stress_chat",
          title: "Stress Chat",
          summary: "",
          createdAt: timestamp(0),
          updatedAt: timestamp(0),
        };
        repository.importSnapshots([
          {
            eventId: "stress_chat_import",
            session: { ...metadata, messages: [] },
          },
        ]);

        for (let index = 1; index <= CHAT_MESSAGE_COUNT; index += 1) {
          const content = index === CHAT_MESSAGE_COUNT
            ? `stress needle ${index}`
            : `history message ${index} ${"x".repeat(128)}`;
          const message: ChatMessageRecord = {
            id: `stress_message_${index}`,
            role: index % 2 === 0 ? "assistant" : "user",
            content,
            createdAt: timestamp(index),
          };
          metadata = {
            ...metadata,
            summary: content,
            updatedAt: message.createdAt,
          };
          repository.commit({
            eventId: `stress_chat_event_${index}`,
            sessionId: metadata.id,
            type: "message_appended",
            eventPayload: {
              messageId: message.id,
              role: message.role,
            },
            createdAt: message.createdAt,
            session: metadata,
            message,
          });
        }

        const projection = repository.getProjection(metadata.id);
        expect(projection).toMatchObject({
          watermark: CHAT_MESSAGE_COUNT + 1,
          messageCount: CHAT_MESSAGE_COUNT,
          lastAssistantMessageAt: timestamp(CHAT_MESSAGE_COUNT),
        });
        const projectionRow = storage.db
          .prepare(
            `SELECT length(payload) AS bytes, message_count
               FROM chat_session_projections
              WHERE session_id = ?`,
          )
          .get<{ bytes: number; message_count: number }>(metadata.id)!;
        expect(projectionRow.message_count).toBe(CHAT_MESSAGE_COUNT);
        expect(projectionRow.bytes).toBeLessThan(2_000);

        const session = repository.getSession(metadata.id);
        expect(session?.messages).toHaveLength(CHAT_MESSAGE_COUNT);
        expect(session?.messages[0]?.id).toBe("stress_message_1");
        expect(session?.messages.at(-1)?.id).toBe(
          `stress_message_${CHAT_MESSAGE_COUNT}`,
        );
        expect(
          repository.searchMessages({
            query: `needle ${CHAT_MESSAGE_COUNT}`,
            sessionId: metadata.id,
            limit: 5,
          }),
        ).toEqual([
          expect.objectContaining({
            messageId: `stress_message_${CHAT_MESSAGE_COUNT}`,
          }),
        ]);
        const events = repository.listEvents(metadata.id);
        expect(events).toHaveLength(CHAT_MESSAGE_COUNT + 1);
        expect(events.at(-1)?.sequence).toBe(CHAT_MESSAGE_COUNT + 1);
      } finally {
        storage.close();
      }
      recordMetric("chat-10k", startedAt, 30_000);
    }, 60_000);

    it("preserves SQLite trajectory tail reads at 25k events", async () => {
      const startedAt = performance.now();
      const directory = await mkdtemp(
        path.join(os.tmpdir(), "zerox-runtime-stress-"),
      );
      const storage = await createTempFileStorage(directory);
      try {
        const repository = createRunRepository(storage);
        for (let sequence = 1; sequence <= TRAJECTORY_EVENT_COUNT; sequence += 1) {
          const event: AgentTrajectoryEvent = {
            id: `stress_event_${sequence}`,
            runId: "stress_run",
            type: sequence % 2 === 0 ? "tool_call" : "tool_result",
            sequence,
            payload: {
              sequence,
              content: "x".repeat(128),
            },
            redaction: {
              containsApiKey: false,
              containsFileContent: false,
              containsUserText: false,
            },
            createdAt: timestamp(sequence),
          };
          repository.appendTrajectory(event.runId, event);
        }

        const count = storage.db
          .prepare(
            "SELECT COUNT(*) AS count FROM trajectory_events WHERE run_id = ?",
          )
          .get<{ count: number }>("stress_run")!.count;
        expect(count).toBe(TRAJECTORY_EVENT_COUNT);
        const tail = repository.getTrajectory("stress_run", {
          fromSeq: TRAJECTORY_EVENT_COUNT - 9,
        });
        expect(tail.map((event) => event.sequence)).toEqual(
          Array.from(
            { length: 10 },
            (_, index) => TRAJECTORY_EVENT_COUNT - 9 + index,
          ),
        );
      } finally {
        storage.close();
        await rm(directory, { recursive: true, force: true });
      }
      recordMetric("trajectory-25k", startedAt, 30_000);
    }, 60_000);

    it("bounds and order-commits a 5k parallel tool batch", async () => {
      const startedAt = performance.now();
      let active = 0;
      let highWater = 0;
      let firstWaveStarted = 0;
      let releaseFirstWave!: () => void;
      const firstWave = new Promise<void>((resolve) => {
        releaseFirstWave = resolve;
      });
      const commits: number[] = [];

      const results = await scheduleToolBatch(
        Array.from({ length: BATCH_ITEM_COUNT }, (_, index) => ({
          value: index,
          mode: "parallel" as const,
        })),
        {
          maxParallel: BATCH_PARALLELISM,
          async execute(index) {
            active += 1;
            highWater = Math.max(highWater, active);
            if (index < BATCH_PARALLELISM) {
              firstWaveStarted += 1;
              if (firstWaveStarted === BATCH_PARALLELISM) {
                releaseFirstWave();
              }
              await firstWave;
            } else {
              await Promise.resolve();
            }
            active -= 1;
            return index;
          },
          commit(result, index) {
            expect(result.status).toBe("fulfilled");
            commits.push(index);
          },
        },
      );

      expect(highWater).toBe(BATCH_PARALLELISM);
      expect(active).toBe(0);
      expect(results).toHaveLength(BATCH_ITEM_COUNT);
      expect(
        results.every(
          (result, index) =>
            result.status === "fulfilled" && result.value === index,
        ),
      ).toBe(true);
      expect(commits).toEqual(
        Array.from({ length: BATCH_ITEM_COUNT }, (_, index) => index),
      );
      recordMetric("parallel-5k", startedAt, 10_000);
    }, 30_000);

    it("cancels a 5k batch after 32 admissions and drains them", async () => {
      const startedAt = performance.now();
      const controller = new AbortController();
      const started: number[] = [];
      const settled: number[] = [];
      const reason = new Error("stress cancellation");

      const scheduled = scheduleToolBatch(
        Array.from({ length: BATCH_ITEM_COUNT }, (_, index) => ({
          value: index,
          mode: "parallel" as const,
        })),
        {
          maxParallel: BATCH_PARALLELISM,
          signal: controller.signal,
          async execute(index) {
            started.push(index);
            await waitForAbort(controller.signal);
            await delay(2);
            settled.push(index);
            throw controller.signal.reason;
          },
        },
      );

      await waitFor(() => started.length === BATCH_PARALLELISM);
      controller.abort(reason);
      const results = await scheduled;

      expect(started).toEqual(
        Array.from({ length: BATCH_PARALLELISM }, (_, index) => index),
      );
      expect(settled).toEqual(started);
      expect(
        results.slice(0, BATCH_PARALLELISM).every(
          (result) => result.status === "rejected",
        ),
      ).toBe(true);
      expect(
        results.slice(BATCH_PARALLELISM).every(
          (result) =>
            result.status === "skipped" && result.reason === "canceled",
        ),
      ).toBe(true);
      recordMetric("cancel-5k", startedAt, 10_000);
    }, 30_000);

    it("drains a saturated Worker timeout and recovers on the next run", async () => {
      const startedAt = performance.now();
      let active = 0;
      let highWater = 0;
      let started = 0;
      let settled = 0;

      await expect(
        runReadCodeProgram({
          steps: Array.from(
            { length: WORKER_STEP_COUNT },
            (_, index) => ({
              id: `slow_${index}`,
              tool: "file_read",
              args: { path: `/workspace/slow-${index}.ts` },
            }),
          ),
        }, {
          limits: {
            maxCalls: WORKER_STEP_COUNT,
            maxConcurrency: WORKER_PARALLELISM,
            timeoutMs: 200,
          },
          async invoke(_toolName, _args, signal) {
            active += 1;
            started += 1;
            highWater = Math.max(highWater, active);
            await waitForAbort(signal);
            await delay(5);
            active -= 1;
            settled += 1;
            throw signal.reason;
          },
        }),
      ).rejects.toThrow(/timed out after 200ms/i);

      expect(started).toBe(WORKER_PARALLELISM);
      expect(highWater).toBe(WORKER_PARALLELISM);
      expect(settled).toBe(started);
      expect(active).toBe(0);

      const recovered = await runReadCodeProgram({
        steps: Array.from({ length: 64 }, (_, index) => ({
          id: `healthy_${index}`,
          tool: "file_read",
          args: { path: `/workspace/healthy-${index}.ts` },
        })),
      }, {
        limits: {
          maxCalls: 64,
          maxConcurrency: WORKER_PARALLELISM,
          timeoutMs: 5_000,
        },
        async invoke(_toolName, args) {
          await Promise.resolve();
          return {
            ok: true,
            result: { path: args.path },
          };
        },
      });
      expect(recovered.stepsExecuted).toBe(64);
      expect(recovered.outputs).toHaveLength(64);
      recordMetric("worker-timeout-recovery", startedAt, 10_000);
    }, 30_000);
  },
);

function recordMetric(
  scenario: string,
  startedAt: number,
  budgetMs: number,
): void {
  const elapsedMs = Math.round(performance.now() - startedAt);
  metrics.push({ scenario, elapsedMs });
  expect(elapsedMs, `${scenario} exceeded ${budgetMs}ms`).toBeLessThan(
    budgetMs,
  );
}

function fixedNow(): string {
  return "2026-08-14T00:00:00.000Z";
}

function timestamp(offset: number): string {
  return new Date(
    Date.parse("2026-08-14T00:00:00.000Z") + offset * 1_000,
  ).toISOString();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for stress condition.");
    }
    await delay(1);
  }
}

async function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}
