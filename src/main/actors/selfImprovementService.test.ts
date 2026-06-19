import { describe, expect, it, afterEach } from "vitest";
import { createInMemoryStorage } from "../storage/storageDb";
import { createRunRepository, createTrajectoryRepository } from "../storage/repositories/runRepository";
import { createMemoryRepository } from "../storage/repositories/memoryRepository";
import { createSessionRepository } from "../storage/repositories/sessionRepository";
import { createWorkflowRuntime } from "../workflow/workflowRuntime";
import { createSelfImprovementService, resolveSelfImprovementMode } from "./selfImprovementService";
import { rm, mkdirSync } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

describe("selfImprovementService", () => {
  afterEach(() => { delete process.env.ZEROX_SELF_IMPROVEMENT; });

  it("defaults to off (opt-in)", () => {
    expect(resolveSelfImprovementMode({})).toBe("off");
    expect(resolveSelfImprovementMode({ ZEROX_SELF_IMPROVEMENT: "on" })).toBe("on");
  });

  it("start() is a no-op when mode is off", () => {
    const svc = makeService();
    svc.start();
    expect(svc.isRunning()).toBe(false);
  });

  it("runNow() runs a dream+distill cycle and returns a report", async () => {
    const svc = makeService();
    const report = await svc.runNow();
    expect(report).toHaveProperty("dream");
    expect(report).toHaveProperty("distill");
    expect(report).toHaveProperty("at");
  });

  it("start() arms the timer when mode is on", () => {
    process.env.ZEROX_SELF_IMPROVEMENT = "on";
    const svc = makeService();
    svc.start();
    expect(svc.isRunning()).toBe(true);
    svc.stop();
    expect(svc.isRunning()).toBe(false);
  });
});

function makeService() {
  const storage = createInMemoryStorageSync();
  return createSelfImprovementService({
    storage,
    memoryRepository: createMemoryRepository(storage),
    runRepository: createRunRepository(storage),
    trajectoryRepository: createTrajectoryRepository(storage),
    sessionRepository: createSessionRepository(storage),
    workflowRuntime: createWorkflowRuntime({ async spawnActor() { return { status: "done", summary: "", filesTouched: [] }; }, async webfetch() { return ""; }, async websearch() { return []; } }),
    skillsDir: join(tmpdir(), `zerox-si-${randomUUID()}`),
    intervalMs: 1000,
  });
}

// Synchronous in-memory storage wrapper for the test (migrate is sync at construction).
import { createStorageImpl } from "../storage/storageDb";
function createInMemoryStorageSync() {
  const s = createStorageImpl({ dbPath: ":memory:" });
  // migrations run eagerly at construction
  return s;
}
