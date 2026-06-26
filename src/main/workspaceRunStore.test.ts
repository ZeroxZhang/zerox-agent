import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceRunStore } from "./workspaceRunStore";

describe("workspace run store", () => {
  let configDir: string;
  let idCounter = 0;
  let tick = 0;

  beforeEach(async () => {
    configDir = await mkdtemp(path.join(os.tmpdir(), "building-agent-workspace-runs-"));
    idCounter = 0;
    tick = 0;
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  it("creates workspace runs as append-only JSONL records", async () => {
    const store = createTestStore();

    const run = await store.createRun({
      workspaceRunId: "workspace_run_1",
      sessionId: "session_1",
      requestId: "request_1",
      workspaceId: "workspace_building_agent",
    });
    const finished = await store.finishRun(
      "workspace_run_1",
      "succeeded",
      "done",
    );

    expect(run).toMatchObject({
      workspaceRunId: "workspace_run_1",
      sessionId: "session_1",
      requestId: "request_1",
      workspaceId: "workspace_building_agent",
      status: "running",
      startedAt: "2026-06-21T00:00:01.000Z",
    });
    expect(finished).toMatchObject({
      workspaceRunId: "workspace_run_1",
      status: "succeeded",
      summary: "done",
      finishedAt: "2026-06-21T00:00:02.000Z",
    });

    const raw = await readFile(
      path.join(configDir, "workspace-runs", "runs.jsonl"),
      "utf8",
    );
    expect(raw.trim().split("\n").map((line) => JSON.parse(line))).toEqual([
      run,
      finished,
    ]);
  });

  it("assigns stable monotonic event sequence numbers across store reloads", async () => {
    const store = createTestStore();
    await store.createRun({
      workspaceRunId: "workspace_run_1",
      sessionId: "session_1",
      requestId: "request_1",
      workspaceId: "workspace_building_agent",
    });

    const first = await store.appendEvent("workspace_run_1", {
      type: "status",
      status: "running",
      message: "started",
    });
    const second = await store.appendEvent("workspace_run_1", {
      type: "tool_call",
      toolCallId: "tool_call_1",
      toolName: "shell",
    });
    const reloaded = createTestStore();
    const third = await reloaded.appendEvent("workspace_run_1", {
      type: "tool_result",
      toolCallId: "tool_call_1",
      toolName: "shell",
      ok: true,
      resultRef: "tool-result-refs/workspace_run_1_tool_call_1.json",
    });

    expect([first.seq, second.seq, third.seq]).toEqual([1, 2, 3]);
    await expect(reloaded.listEvents("workspace_run_1")).resolves.toEqual([
      first,
      second,
      third,
    ]);

    const raw = await readFile(
      path.join(configDir, "workspace-runs", "events", "workspace_run_1.jsonl"),
      "utf8",
    );
    expect(raw.trim().split("\n").map((line) => JSON.parse(line))).toEqual([
      first,
      second,
      third,
    ]);
  });

  it("projects chat trajectory events with tool result refs", async () => {
    const store = createTestStore();
    await store.createRun({
      workspaceRunId: "workspace_run_1",
      sessionId: "session_1",
      requestId: "request_1",
      workspaceId: "workspace_building_agent",
    });
    await store.createRun({
      workspaceRunId: "workspace_run_other_session",
      sessionId: "session_other",
      requestId: "request_2",
      workspaceId: "workspace_other",
    });

    const call = await store.appendEvent("workspace_run_1", {
      type: "tool_call",
      toolCallId: "tool_call_1",
      toolName: "shell",
      args: { cmd: "npm test" },
    });
    const result = await store.appendEvent("workspace_run_1", {
      type: "tool_result",
      toolCallId: "tool_call_1",
      toolName: "shell",
      ok: true,
      resultRef: "tool-result-refs/workspace_run_1_tool_call_1.json",
    });
    await store.appendEvent("workspace_run_other_session", {
      type: "tool_result",
      toolCallId: "tool_call_other",
      toolName: "shell",
      ok: true,
      resultRef: "tool-result-refs/other.json",
    });

    await expect(store.listChatTrajectory("session_1")).resolves.toEqual([
      expect.objectContaining({
        type: "tool_call",
        toolCallId: "tool_call_1",
        sourceEventId: call.id,
      }),
      expect.objectContaining({
        type: "tool_result",
        toolCallId: "tool_call_1",
        resultRef: "tool-result-refs/workspace_run_1_tool_call_1.json",
        sourceEventId: result.id,
      }),
    ]);
  });

  it("skips malformed JSONL lines while preserving workspace run trajectory records", async () => {
    const run = {
      workspaceRunId: "workspace_run_1",
      sessionId: "session_1",
      requestId: "request_1",
      workspaceId: "workspace_building_agent",
      status: "running",
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z",
      startedAt: "2026-06-21T00:00:00.000Z",
    };
    const event = {
      id: "event_1",
      workspaceRunId: "workspace_run_1",
      sessionId: "session_1",
      seq: 1,
      type: "tool_result",
      toolCallId: "tool_call_1",
      toolName: "shell",
      ok: true,
      resultRef: "tool-result-refs/workspace_run_1_tool_call_1.json",
      createdAt: "2026-06-21T00:00:01.000Z",
    };
    const root = path.join(configDir, "workspace-runs");
    const eventsDir = path.join(root, "events");
    await mkdir(eventsDir, { recursive: true });
    await writeFile(
      path.join(root, "runs.jsonl"),
      `${JSON.stringify(run)}\n{"workspaceRunId": "partial"\n`,
      "utf8",
    );
    await writeFile(
      path.join(eventsDir, "workspace_run_1.jsonl"),
      `{"id": "partial"\n${JSON.stringify(event)}\n`,
      "utf8",
    );

    const store = createTestStore();

    await expect(store.listChatTrajectory("session_1")).resolves.toEqual([
      expect.objectContaining({
        type: "tool_result",
        toolCallId: "tool_call_1",
        resultRef: "tool-result-refs/workspace_run_1_tool_call_1.json",
        sourceEventId: "event_1",
      }),
    ]);
    expect((await readdir(root)).some((file) => file.startsWith("runs.jsonl.corrupt-lines-"))).toBe(true);
    expect((await readdir(eventsDir)).some((file) => file.startsWith("workspace_run_1.jsonl.corrupt-lines-"))).toBe(true);
  });

  function createTestStore() {
    return createWorkspaceRunStore({
      configDir,
      createId: () => `generated_${++idCounter}`,
      now: () => {
        tick += 1;
        return new Date(`2026-06-21T00:00:${String(tick).padStart(2, "0")}.000Z`);
      },
    });
  }
});
