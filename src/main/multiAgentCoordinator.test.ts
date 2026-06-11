import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentWorkspaceStore } from "./agentWorkspaceStore";
import { createMultiAgentCoordinator } from "./multiAgentCoordinator";
import { createMultiAgentSessionStore } from "./multiAgentSessionStore";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";
import {
  buildChildRunContext,
  buildPrimaryRunContext,
} from "../shared/agentWorkspace";

describe("multi agent coordinator", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(path.join(os.tmpdir(), "zerox-coordinator-"));
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  it("creates a session for a workspace", async () => {
    const coordinator = createCoordinator();

    await expect(
      coordinator.createSession({
        title: "Plan a migration",
        workspaceId: "workspace_1",
        rootRunId: "run_root",
      }),
    ).resolves.toMatchObject({
      id: "session_1",
      title: "Plan a migration",
      workspaceId: "workspace_1",
      rootRunId: "run_root",
      status: "running",
    });
  });

  it("builds child contexts from parent context and enforces max depth", async () => {
    const coordinator = createCoordinator();
    const parent = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: "/tmp/workspace",
      sessionId: "session_1",
    });

    expect(
      coordinator.buildChildContext(parent, {
        parentRunId: "run_root",
        agentRole: "executor",
      }),
    ).toEqual(
      buildChildRunContext(parent, {
        parentRunId: "run_root",
        agentRole: "executor",
      }),
    );

    const tooDeep = {
      ...parent,
      depth: 3,
    };
    expect(() =>
      coordinator.buildChildContext(tooDeep, {
        parentRunId: "run_3",
        agentRole: "critic",
      }),
    ).toThrow("Multi-agent child run depth cannot exceed 3.");
  });

  it("records child runs and appends lineage trajectory", async () => {
    const trajectoryEvents: AgentTrajectoryEvent[] = [];
    const coordinator = createCoordinator(trajectoryEvents);
    await coordinator.createSession({
      title: "Plan a migration",
      workspaceId: "workspace_1",
      rootRunId: "run_root",
    });

    const session = await coordinator.recordChildRun({
      sessionId: "session_1",
      parentRunId: "run_root",
      childRunId: "run_child",
      agentRole: "planner",
      runContext: buildPrimaryRunContext({
        workspaceId: "workspace_1",
        workspaceRoot: "/tmp/workspace",
        sessionId: "session_1",
      }),
    });

    expect(session).toMatchObject({
      childRunIds: ["run_child"],
      roles: { run_child: "planner" },
    });
    expect(trajectoryEvents).toEqual([
      expect.objectContaining({
        runId: "run_root",
        type: "child_run_scheduled",
        payload: {
          sessionId: "session_1",
          parentRunId: "run_root",
          childRunId: "run_child",
          agentRole: "planner",
        },
      }),
    ]);
  });

  it("records a bounded handoff, child output, and review gate decision", async () => {
    const trajectoryEvents: AgentTrajectoryEvent[] = [];
    const coordinator = createCoordinator(trajectoryEvents);
    const parentContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: "/tmp/workspace",
      sessionId: "session_1",
    });
    await coordinator.createSession({
      title: "Research a topic",
      workspaceId: "workspace_1",
      rootRunId: "run_parent",
    });

    const handoff = coordinator.createHandoffContract(parentContext, {
      parentRunId: "run_parent",
      childRole: "researcher",
      objective: "Collect citation-backed source notes.",
      allowedTools: ["web_fetch_document", "citation_record"],
      budget: { toolCallBudget: 4 },
      expectedArtifacts: ["tool_result"],
      reviewGate: {
        required: true,
        reviewerRole: "primary",
        checklist: ["Every sourced fact has a citation."],
      },
    });

    await coordinator.recordChildRun({
      sessionId: "session_1",
      parentRunId: "run_parent",
      childRunId: "run_child",
      agentRole: "researcher",
      runContext: parentContext,
      handoff,
    });
    await coordinator.recordChildOutput({
      parentRunId: "run_parent",
      output: {
        handoffId: handoff.handoffId,
        childRunId: "run_child",
        status: "succeeded",
        summary: "Collected citation-backed source notes.",
        artifacts: [
          {
            id: "artifact_sources",
            kind: "tool_result",
            label: "sources.json",
            createdAt: "2026-06-08T00:00:00.000Z",
          },
        ],
        trajectoryEventIds: ["event_child_tool"],
        openQuestions: [],
        recommendedNextAction: "accept",
      },
    });
    await coordinator.recordHandoffReview({
      handoffId: handoff.handoffId,
      parentRunId: "run_parent",
      childRunId: "run_child",
      decision: "accepted",
      reviewerRole: "primary",
      notes: "Sources are complete.",
    });

    expect(trajectoryEvents.map((event) => event.type)).toEqual([
      "child_handoff_created",
      "child_run_scheduled",
      "child_handoff_completed",
      "child_handoff_reviewed",
    ]);
    expect(trajectoryEvents[0]).toMatchObject({
      payload: {
        handoff: {
          childRole: "researcher",
          objective: "Collect citation-backed source notes.",
          reviewGate: { required: true },
        },
      },
    });
    expect(trajectoryEvents[3]).toMatchObject({
      payload: {
        decision: {
          decision: "accepted",
          childRunId: "run_child",
        },
      },
    });
  });

  function createCoordinator(trajectoryEvents: AgentTrajectoryEvent[] = []) {
    const sessionStore = createMultiAgentSessionStore({
      configDir,
      createId: () => "session_1",
      now: () => new Date("2026-06-08T00:00:00.000Z"),
    });
    createAgentWorkspaceStore({ configDir });

    return createMultiAgentCoordinator({
      sessionStore,
      trajectoryStore: {
        async append(_runId, event) {
          trajectoryEvents.push(structuredClone(event));
          return event;
        },
        async list() {
          return trajectoryEvents;
        },
      },
      createId: () => "event_1",
      now: () => new Date("2026-06-08T00:00:00.000Z"),
    });
  }
});
