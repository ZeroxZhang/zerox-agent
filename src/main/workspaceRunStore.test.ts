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

  it("pages workspace events from the JSONL source with opaque cut cursors", async () => {
    const store = createTestStore();
    await store.createRun({
      workspaceRunId: "workspace_run_page",
      sessionId: "session_1",
      requestId: "request_1",
    });
    for (const message of ["one", "two", "three"]) {
      await store.appendEvent("workspace_run_page", {
        type: "status",
        status: "running",
        message,
      });
    }

    const first = await store.getEventPage!("workspace_run_page", {
      limit: 2,
    });
    expect(first).toMatchObject({
      source: "workspace_run",
      sourceId: "workspace_run_page",
      status: "complete",
      records: [
        { seq: 1, message: "one" },
        { seq: 2, message: "two" },
      ],
    });
    expect(first.nextCursor).toBeTruthy();
    await expect(store.getEventPage!("workspace_run_page", {
      cursor: first.nextCursor,
      limit: 2,
    })).resolves.toMatchObject({
      status: "complete",
      records: [{ seq: 3, message: "three" }],
    });
  });

  it("rejects stale workspace cursors and propagates abort", async () => {
    const store = createTestStore();
    await store.createRun({
      workspaceRunId: "workspace_run_page",
      sessionId: "session_1",
      requestId: "request_1",
    });
    await store.appendEvent("workspace_run_page", {
      type: "status",
      status: "running",
      message: "one",
    });
    await store.appendEvent("workspace_run_page", {
      type: "status",
      status: "running",
      message: "two",
    });
    const first = await store.getEventPage!("workspace_run_page", {
      limit: 1,
    });
    await store.appendEvent("workspace_run_page", {
      type: "status",
      status: "running",
      message: "three",
    });
    await expect(store.getEventPage!("workspace_run_page", {
      cursor: first.nextCursor,
      limit: 1,
    })).resolves.toMatchObject({
      status: "incompatible",
      reasonCode: "source_cursor_mismatch",
      records: [],
    });

    const controller = new AbortController();
    controller.abort(new DOMException("canceled", "AbortError"));
    await expect(store.getEventPage!("workspace_run_page", {
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("reattaches an exact run envelope and rejects sanitized-id collisions", async () => {
    const store = createTestStore();
    const input = {
      workspaceRunId: "workspace_run_same",
      sessionId: "session:one",
      requestId: "request:one",
      workspaceId: "workspace:one",
      createdAt: "2026-06-21T00:00:00.000Z",
    };
    expect((await store.ensureRun(input)).disposition).toBe("created");
    expect((await store.ensureRun(input)).disposition).toBe("existing");
    await expect(store.ensureRun({
      ...input,
      sessionId: "session:other",
    })).rejects.toThrow(/envelope conflicts/);
  });

  it("settles event and nonterminal snapshot idempotently and rejects conflicts", async () => {
    const store = createTestStore();
    await store.ensureRun({
      workspaceRunId: "workspace_run_1",
      sessionId: "session_1",
      requestId: "request_1",
    });
    const input = {
      workspaceRunId: "workspace_run_1",
      event: {
        id: "chat-status:1",
        createdAt: "2026-06-21T00:00:10.000Z",
        type: "status" as const,
        status: "waiting_for_user" as const,
        message: "waiting",
        causalRef: {
          turnId: "turn:1",
          sourceSequence: 4,
        },
      },
      snapshotStatus: "waiting_for_user" as const,
    };
    const applied = await store.settleLifecycle(input);
    expect(applied).toMatchObject({
      disposition: "applied",
      run: { status: "waiting_for_user" },
      event: { id: "chat-status:1", seq: 1 },
    });
    expect((await store.settleLifecycle(input)).disposition).toBe("duplicate");
    await expect(store.settleLifecycle({
      ...input,
      event: { ...input.event, message: "conflicting" },
    })).rejects.toThrow(/event id conflict/);
    await expect(store.listEvents("workspace_run_1")).resolves.toHaveLength(1);
  });

  it("repairs a snapshot from an event-first crash witness on reload", async () => {
    const store = createTestStore();
    await store.createRun({
      workspaceRunId: "workspace_run_repair",
      sessionId: "session_1",
      requestId: "request_1",
    });
    await store.appendEvent("workspace_run_repair", {
      id: "status:paused",
      createdAt: "2026-06-21T00:00:10.000Z",
      type: "status",
      status: "paused",
      message: "paused",
    });
    const reloaded = createTestStore();
    await expect(reloaded.getRun("workspace_run_repair")).resolves.toMatchObject({
      status: "paused",
      updatedAt: "2026-06-21T00:00:10.000Z",
    });
  });

  it("repairs waiting approval and running from specialized lifecycle witnesses", async () => {
    const store = createTestStore();
    await store.createRun({
      workspaceRunId: "workspace_run_approval_repair",
      sessionId: "session_1",
      requestId: "request_1",
    });
    await store.appendEvent("workspace_run_approval_repair", {
      id: "invocation:waiting",
      createdAt: "2026-06-21T00:00:10.000Z",
      type: "tool_invocation",
      toolInvocationId: "invocation_1",
      toolCallId: "call_1",
      toolName: "shell_exec",
      invocationStatus: "waiting_approval",
      lifecycleStatus: "waiting_for_approval",
    });
    await expect(createTestStore().getRun("workspace_run_approval_repair"))
      .resolves.toMatchObject({ status: "waiting_for_approval" });

    await store.appendEvent("workspace_run_approval_repair", {
      id: "invocation:authorized",
      createdAt: "2026-06-21T00:00:11.000Z",
      type: "tool_invocation",
      toolInvocationId: "invocation_1",
      toolCallId: "call_1",
      toolName: "shell_exec",
      invocationStatus: "authorized",
      lifecycleStatus: "running",
    });
    await expect(createTestStore().getRun("workspace_run_approval_repair"))
      .resolves.toMatchObject({ status: "running" });
  });

  it("repairs a terminal crash witness before a competing finish settlement", async () => {
    const store = createTestStore();
    await store.createRun({
      workspaceRunId: "workspace_run_finish_first_repair",
      sessionId: "session_1",
      requestId: "request_1",
    });
    await store.appendEvent("workspace_run_finish_first_repair", {
      id: "status:succeeded-before-crash",
      createdAt: "2026-06-21T00:00:10.000Z",
      type: "status",
      status: "succeeded",
      lifecycleStatus: "succeeded",
      message: "durable success witness",
    });

    const reloaded = createTestStore();
    await expect(
      reloaded.finishRun("workspace_run_finish_first_repair", "failed"),
    ).rejects.toThrow(/cannot transition from succeeded to failed/);
    await expect(reloaded.getRun("workspace_run_finish_first_repair"))
      .resolves.toMatchObject({
        status: "succeeded",
        updatedAt: "2026-06-21T00:00:10.000Z",
      });
  });

  it("binds a lifecycle target to the stable event id", async () => {
    const store = createTestStore();
    await store.ensureRun({
      workspaceRunId: "workspace_run_target_conflict",
      sessionId: "session_1",
      requestId: "request_1",
    });
    const event = {
      id: "invocation:stable",
      createdAt: "2026-06-21T00:00:10.000Z",
      type: "tool_invocation" as const,
      toolInvocationId: "invocation_1",
      toolCallId: "call_1",
      toolName: "shell_exec",
      invocationStatus: "waiting_approval",
    };
    await store.settleLifecycle({
      workspaceRunId: "workspace_run_target_conflict",
      event,
      snapshotStatus: "waiting_for_approval",
    });
    await expect(store.settleLifecycle({
      workspaceRunId: "workspace_run_target_conflict",
      event,
      snapshotStatus: "running",
    })).rejects.toThrow(/event id conflict/);
  });

  it("never regresses or changes a terminal snapshot", async () => {
    const store = createTestStore();
    await store.ensureRun({
      workspaceRunId: "workspace_run_terminal",
      sessionId: "session_1",
      requestId: "request_1",
    });
    await store.settleLifecycle({
      workspaceRunId: "workspace_run_terminal",
      event: {
        id: "status:succeeded",
        createdAt: "2026-06-21T00:00:10.000Z",
        type: "status",
        status: "succeeded",
      },
      snapshotStatus: "succeeded",
    });
    await expect(store.settleLifecycle({
      workspaceRunId: "workspace_run_terminal",
      event: {
        id: "status:late-pause",
        createdAt: "2026-06-21T00:00:11.000Z",
        type: "status",
        status: "paused",
      },
      snapshotStatus: "paused",
    })).rejects.toThrow(/cannot transition/);
    await expect(store.finishRun("workspace_run_terminal", "failed"))
      .rejects.toThrow(/cannot transition/);
  });

  it("keeps an exact old lifecycle replay idempotent after a later terminal settlement", async () => {
    const store = createTestStore();
    await store.ensureRun({
      workspaceRunId: "workspace_run_terminal_replay",
      sessionId: "session_1",
      requestId: "request_1",
    });
    const running = {
      workspaceRunId: "workspace_run_terminal_replay",
      event: {
        id: "status:running",
        createdAt: "2026-06-21T00:00:05.000Z",
        type: "status" as const,
        status: "running" as const,
        message: "running",
      },
      snapshotStatus: "running" as const,
    };
    await store.settleLifecycle(running);
    await store.settleLifecycle({
      workspaceRunId: "workspace_run_terminal_replay",
      event: {
        id: "status:succeeded",
        createdAt: "2026-06-21T00:00:10.000Z",
        type: "status",
        status: "succeeded",
        message: "done",
      },
      snapshotStatus: "succeeded",
    });

    await expect(store.settleLifecycle(running)).resolves.toMatchObject({
      disposition: "duplicate",
      run: { status: "succeeded" },
    });
    await expect(store.listEvents("workspace_run_terminal_replay"))
      .resolves.toHaveLength(2);
    await expect(store.settleLifecycle({
      ...running,
      event: { ...running.event, message: "changed replay" },
    })).rejects.toThrow(/event id conflict/);
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
    await expect(store.getEventPage!("workspace_run_1")).resolves.toMatchObject({
      records: [event],
      status: "partial",
      reasonCode: "corrupt_record",
    });
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
