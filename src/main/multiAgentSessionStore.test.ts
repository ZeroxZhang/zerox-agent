import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMultiAgentSessionStore } from "./multiAgentSessionStore";

describe("multi agent session store", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(path.join(os.tmpdir(), "zerox-sessions-"));
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  it("creates and persists a multi-agent session", async () => {
    const store = createMultiAgentSessionStore({
      configDir,
      createId: () => "session_1",
      now: () => new Date("2026-06-08T00:00:00.000Z"),
    });

    const session = await store.create({
      title: "Research plan",
      workspaceId: "workspace_1",
      rootRunId: "run_root",
    });

    expect(session).toEqual({
      id: "session_1",
      title: "Research plan",
      rootRunId: "run_root",
      status: "running",
      workspaceId: "workspace_1",
      createdAt: "2026-06-08T00:00:00.000Z",
      updatedAt: "2026-06-08T00:00:00.000Z",
      childRunIds: [],
      roles: {},
    });
    await expect(store.get("session_1")).resolves.toEqual(session);
    const raw = await readFile(
      path.join(configDir, "multi-agent-sessions.json"),
      "utf8",
    );
    expect(JSON.parse(raw)).toMatchObject({
      schemaVersion: 1,
      sessions: [session],
    });
  });

  it("appends child runs in order and stores roles", async () => {
    let tick = 0;
    const store = createMultiAgentSessionStore({
      configDir,
      createId: () => "session_1",
      now: () =>
        new Date(
          [
            "2026-06-08T00:00:00.000Z",
            "2026-06-08T00:01:00.000Z",
            "2026-06-08T00:02:00.000Z",
          ][tick++]!,
        ),
    });
    await store.create({
      title: "Research plan",
      workspaceId: "workspace_1",
    });

    await expect(
      store.appendChildRun("session_1", "run_planner", "planner"),
    ).resolves.toMatchObject({
      childRunIds: ["run_planner"],
      roles: { run_planner: "planner" },
      updatedAt: "2026-06-08T00:01:00.000Z",
    });
    await expect(
      store.appendChildRun("session_1", "run_executor", "executor"),
    ).resolves.toMatchObject({
      childRunIds: ["run_planner", "run_executor"],
      roles: {
        run_planner: "planner",
        run_executor: "executor",
      },
      updatedAt: "2026-06-08T00:02:00.000Z",
    });
  });

  it("updates status and returns null for missing sessions", async () => {
    const store = createMultiAgentSessionStore({
      configDir,
      createId: () => "session_1",
      now: () => new Date("2026-06-08T00:00:00.000Z"),
    });
    await store.create({
      title: "Research plan",
      workspaceId: "workspace_1",
    });

    await expect(store.setStatus("session_1", "paused")).resolves.toMatchObject({
      status: "paused",
    });
    await expect(
      store.appendChildRun("missing", "run_executor", "executor"),
    ).resolves.toBeNull();
    await expect(store.setStatus("missing", "failed")).resolves.toBeNull();
    await expect(store.get("missing")).resolves.toBeNull();
  });
});
