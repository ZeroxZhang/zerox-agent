import { describe, expect, it } from "vitest";
import { buildPrimaryRunContext } from "../shared/agentWorkspace";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";
import { createChatAgentEvidenceRecorder } from "./chatAgentEvidence";

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
});
