import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentTrajectoryStore } from "./agentTrajectoryStore";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";
import { createInMemoryStorage } from "./storage/storageDb";

describe("agent trajectory store", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(path.join(os.tmpdir(), "building-agent-trajectory-"));
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  it("appends trajectory events as one JSONL file per run", async () => {
    const store = createAgentTrajectoryStore({ configDir });
    const first = createEvent("state_transition", "event_1");
    const second = createEvent("tool_call", "event_2");

    await expect(store.append("run_1", first)).resolves.toEqual(first);
    await expect(store.append("run_1", second)).resolves.toEqual(second);

    await expect(store.list("run_1")).resolves.toEqual([first, second]);
    const raw = await readFile(
      path.join(configDir, "agent-trajectories", "run_1.jsonl"),
      "utf8",
    );
    expect(raw.trim().split("\n").map((line) => JSON.parse(line))).toEqual([
      first,
      second,
    ]);
  });

  it("keeps trajectories isolated by run id", async () => {
    const store = createAgentTrajectoryStore({ configDir });
    const runOne = createEvent("model_request", "event_run_1");
    const runTwo = createEvent("model_response", "event_run_2");

    await store.append("run_1", runOne);
    await store.append("run_2", runTwo);

    await expect(store.list("run_1")).resolves.toEqual([runOne]);
    await expect(store.list("run_2")).resolves.toEqual([runTwo]);
  });

  it("does not append when the supplied signal is already aborted", async () => {
    const store = createAgentTrajectoryStore({ configDir });
    const controller = new AbortController();
    controller.abort(new DOMException("Run canceled.", "AbortError"));

    await expect(
      store.append("run_1", createEvent("goal_judged", "event_1"), {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(store.list("run_1")).resolves.toEqual([]);
  });

  it("returns an empty list when a trajectory file is missing", async () => {
    const store = createAgentTrajectoryStore({ configDir });

    await expect(store.list("missing_run")).resolves.toEqual([]);
  });

  it.each(["json", "sqlite"] as const)(
    "atomically appends a %s publication event once across store instances",
    async (backend) => {
      const storage = backend === "sqlite"
        ? await createInMemoryStorage()
        : undefined;
      const firstStore = createAgentTrajectoryStore({
        configDir,
        backend,
        storage,
      });
      const secondStore = createAgentTrajectoryStore({
        configDir,
        backend,
        storage,
      });
      const event = createEvent(
        "acceptance_manual_completion_recorded",
        "event_recorded",
      );

      const results = await Promise.all([
        firstStore.appendIfAbsent(
          "run_1",
          "manual:recorded:a",
          event,
        ),
        secondStore.appendIfAbsent(
          "run_1",
          "manual:recorded:a",
          { ...event, id: "event_competing" },
        ),
      ]);

      expect(results.map((result) => result.appended).sort()).toEqual([
        false,
        true,
      ]);
      await expect(firstStore.list("run_1")).resolves.toEqual([
        expect.objectContaining({
          type: "acceptance_manual_completion_recorded",
          payload: expect.objectContaining({
            publicationKey: "manual:recorded:a",
          }),
        }),
      ]);
      storage?.close();
    },
  );

  it.each(["json", "sqlite"] as const)(
    "allocates monotonic %s publication sequences independently of caller input",
    async (backend) => {
      const storage = backend === "sqlite"
        ? await createInMemoryStorage()
        : undefined;
      const store = createAgentTrajectoryStore({
        configDir,
        backend,
        storage,
      });
      await store.append("run_1", {
        ...createEvent("tool_call", "event_7"),
        sequence: 7,
      });

      const first = await store.appendIfAbsent(
        "run_1",
        "publication:a",
        { ...createEvent("goal_judged", "event_1"), sequence: 1 },
      );
      const secondStore = createAgentTrajectoryStore({
        configDir,
        backend,
        storage,
      });
      const second = await secondStore.appendIfAbsent(
        "run_1",
        "publication:b",
        { ...createEvent("goal_stopped", "event_1"), sequence: 1 },
      );

      expect(first).toMatchObject({
        appended: true,
        event: { sequence: 8 },
      });
      expect(second).toMatchObject({
        appended: true,
        event: { sequence: 9 },
      });
      await expect(store.list("run_1")).resolves.toEqual([
        expect.objectContaining({ sequence: 7 }),
        expect.objectContaining({ sequence: 8 }),
        expect.objectContaining({ sequence: 9 }),
      ]);
      storage?.close();
    },
  );

  it("keeps dual-write publication sequences identical", async () => {
    const storage = await createInMemoryStorage();
    const store = createAgentTrajectoryStore({
      configDir,
      backend: "dual",
      storage,
    });
    await store.append("run_1", createEvent("tool_call", "event_1"));
    await store.appendIfAbsent(
      "run_1",
      "publication:a",
      { ...createEvent("goal_judged", "event_9"), sequence: 99 },
    );
    await store.flushShadowWrites();

    const jsonStore = createAgentTrajectoryStore({
      configDir,
      backend: "json",
    });
    const [sqliteEvents, jsonEvents] = await Promise.all([
      store.list("run_1"),
      jsonStore.list("run_1"),
    ]);
    expect(jsonEvents).toEqual(sqliteEvents);
    storage.close();
  });

  it("finishes a committed dual-write JSON shadow after caller cancellation", async () => {
    const storage = await createInMemoryStorage();
    const store = createAgentTrajectoryStore({
      configDir,
      backend: "dual",
      storage,
    });
    const controller = new AbortController();
    const event = createEvent("tool_call", "event_1");

    const append = store.append("run_1", event, {
      signal: controller.signal,
    });
    controller.abort(new DOMException("Run canceled.", "AbortError"));

    await expect(append).resolves.toEqual(event);
    const jsonStore = createAgentTrajectoryStore({
      configDir,
      backend: "json",
    });
    await expect(jsonStore.list("run_1")).resolves.toEqual(
      await store.list("run_1"),
    );
    storage.close();
  });

  it("reports a dual shadow failure and repairs it on an idempotent retry", async () => {
    const storage = await createInMemoryStorage();
    const store = createAgentTrajectoryStore({
      configDir,
      backend: "dual",
      storage,
    });
    const event = createEvent("tool_call", "event_1");
    const trajectoriesDir = path.join(configDir, "agent-trajectories");
    await writeFile(trajectoriesDir, "blocks directory creation", "utf8");

    await expect(store.append("run_1", event)).rejects.toMatchObject({
      code: "ENOTDIR",
    });
    await expect(store.list("run_1")).resolves.toEqual([event]);

    await rm(trajectoriesDir, { force: true });
    await expect(store.append("run_1", event)).resolves.toEqual(event);

    const jsonStore = createAgentTrajectoryStore({
      configDir,
      backend: "json",
    });
    await expect(jsonStore.list("run_1")).resolves.toEqual([event]);
    storage.close();
  });

  it("repairs a missing dual-write JSON publication on idempotent retry", async () => {
    const storage = await createInMemoryStorage();
    const store = createAgentTrajectoryStore({
      configDir,
      backend: "dual",
      storage,
    });
    const event = { ...createEvent("goal_judged", "event_9"), sequence: 99 };
    await store.appendIfAbsent("run_1", "publication:a", event);
    await store.flushShadowWrites();
    await rm(
      path.join(configDir, "agent-trajectories", "run_1.jsonl"),
      { force: true },
    );

    await expect(
      store.appendIfAbsent("run_1", "publication:a", event),
    ).resolves.toMatchObject({ appended: false, event: { sequence: 1 } });
    await store.flushShadowWrites();

    const jsonStore = createAgentTrajectoryStore({
      configDir,
      backend: "json",
    });
    await expect(jsonStore.list("run_1")).resolves.toEqual(
      await store.list("run_1"),
    );
    storage.close();
  });

  it("does not confuse a SQLite sequence collision with an existing publication", async () => {
    const storage = await createInMemoryStorage();
    const store = createAgentTrajectoryStore({
      configDir,
      backend: "sqlite",
      storage,
    });
    const existing = createEvent("goal_judged", "event_1");
    const publication = {
      ...createEvent("goal_stopped", "event_competing"),
      sequence: existing.sequence,
    };
    await store.append("run_1", existing);

    await expect(
      store.appendIfAbsent(
        "run_1",
        "goal_stopped:run_1:1",
        publication,
      ),
    ).resolves.toMatchObject({ appended: true });
    await expect(store.list("run_1")).resolves.toHaveLength(2);
    storage.close();
  });

  it("skips malformed JSONL lines while preserving valid trajectory events", async () => {
    const first = createEvent("model_request", "event_1");
    const second = createEvent("model_response", "event_2");
    const dir = path.join(configDir, "agent-trajectories");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "run_1.jsonl"),
      `${JSON.stringify(first)}\n{"id": "partial"\n${JSON.stringify(second)}\n`,
      "utf8",
    );

    const store = createAgentTrajectoryStore({ configDir });

    await expect(store.list("run_1")).resolves.toEqual([first, second]);
    const files = await readdir(dir);
    expect(files.some((file) => file.startsWith("run_1.jsonl.corrupt-lines-"))).toBe(true);
  });
});

function createEvent(
  type: AgentTrajectoryEvent["type"],
  id: string,
): AgentTrajectoryEvent {
  return {
    id,
    runId: "run_1",
    type,
    sequence: Number(id.replace(/\D/g, "")),
    payload: { label: type },
    redaction: {
      containsApiKey: false,
      containsFileContent: false,
      containsUserText: true,
    },
    createdAt: "2026-06-07T00:00:00.000Z",
  };
}
