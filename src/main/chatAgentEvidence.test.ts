import { describe, expect, it } from "vitest";
import { buildPrimaryRunContext } from "../shared/agentWorkspace";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";
import { createChatAgentEvidenceRecorder } from "./chatAgentEvidence";
import { createAgentTrajectoryStore } from "./agentTrajectoryStore";
import { createInMemoryStorage } from "./storage/storageDb";

describe("chat agent evidence recorder", () => {
  it("can attach run context and redaction overrides to snapshot evidence", async () => {
    const events: AgentTrajectoryEvent[] = [];
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: "/repo",
      runId: "run_1",
      sessionId: "session_1",
    });
    const recorder = createChatAgentEvidenceRecorder({
      trajectoryStore: {
        async append(_runId, event) {
          events.push(event);
          return event;
        },
        async list() {
          return events;
        },
        async appendIfAbsent(_runId, _publicationKey, event) {
          const existing = events.find(
            (candidate) => candidate.id === event.id,
          );
          if (existing) return { appended: false, event: existing };
          events.push(event);
          return { appended: true, event };
        },
        async flushShadowWrites() {
          return;
        },
      },
      runId: "run_1",
      runContext,
      createId: () => `event_${events.length + 1}`,
      now: () => new Date("2026-06-28T14:00:00.000Z"),
    });

    const stored = await recorder.append(
      "run_context_created",
      {
        runtimeContextSnapshotSummary: {
          snapshotId: "runtime_snapshot_1",
        },
      },
      {
        containsApiKey: false,
        containsFileContent: false,
        containsUserText: false,
      },
    );
    await recorder.drain();

    expect(events).toEqual([
      expect.objectContaining({
        type: "run_context_created",
        runContext,
        redaction: {
          containsApiKey: false,
          containsFileContent: false,
          containsUserText: false,
        },
      }),
    ]);
    expect(stored?.id).toBe(events[0]?.id);
  });

  it("redacts credentials at the durable evidence boundary", async () => {
    const events: AgentTrajectoryEvent[] = [];
    const recorder = createChatAgentEvidenceRecorder({
      trajectoryStore: {
        async append(_runId, event) {
          events.push(event);
          return event;
        },
        async list() {
          return events;
        },
        async appendIfAbsent(_runId, _publicationKey, event) {
          events.push(event);
          return { appended: true, event };
        },
        async flushShadowWrites() {},
      },
      runId: "run_secret_safe",
      createId: () => `event_${events.length + 1}`,
      now: () => new Date("2026-08-24T00:00:00.000Z"),
    });

    await recorder.append("tool_result", {
      error: "Authorization: Bearer evidence-bearer-canary",
      args: { apiKey: "evidence-key-canary" },
    });
    await recorder.drain();

    const serialized = JSON.stringify(events);
    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toMatch(/evidence-bearer-canary|evidence-key-canary/);
  });

  it("continues after the highest durable sequence when resuming an evidence run", async () => {
    const events: AgentTrajectoryEvent[] = [
      {
        id: "event_existing",
        runId: "run_resumed",
        type: "model_response",
        sequence: 7,
        payload: {},
        redaction: {
          containsApiKey: false,
          containsFileContent: false,
          containsUserText: true,
        },
        createdAt: "2026-08-24T00:00:00.000Z",
      },
    ];
    const recorder = createChatAgentEvidenceRecorder({
      trajectoryStore: {
        async append(_runId, event) {
          events.push(event);
          return event;
        },
        async list() {
          return events;
        },
        async appendIfAbsent(_runId, _publicationKey, event) {
          events.push(event);
          return { appended: true, event };
        },
        async flushShadowWrites() {},
      },
      runId: "run_resumed",
      createId: () => `event_${events.length + 1}`,
      now: () => new Date("2026-08-24T00:00:01.000Z"),
    });

    const [first, second] = await Promise.all([
      recorder.append("model_request", {}),
      recorder.append("model_response", {}),
    ]);
    await recorder.drain();

    expect([first?.sequence, second?.sequence]).toEqual([8, 9]);
    expect(events.map((event) => event.sequence)).toEqual([7, 8, 9]);
  });

  it("allocates one sequence authority across concurrent recorders", async () => {
    const storage = await createInMemoryStorage();
    const trajectoryStore = createAgentTrajectoryStore({
      configDir: "/unused",
      backend: "sqlite",
      storage,
    });
    const first = createChatAgentEvidenceRecorder({
      trajectoryStore,
      runId: "run_shared_continuation",
      createId: () => "event_first",
    });
    const second = createChatAgentEvidenceRecorder({
      trajectoryStore,
      runId: "run_shared_continuation",
      createId: () => "event_second",
    });

    const stored = await Promise.all([
      first.append("model_request", { owner: "first" }),
      second.append("model_response", { owner: "second" }),
    ]);

    expect(stored.map((event) => event?.sequence).sort()).toEqual([1, 2]);
    expect((await trajectoryStore.list("run_shared_continuation"))
      .map((event) => event.sequence)).toEqual([1, 2]);
    storage.close();
  });
});
