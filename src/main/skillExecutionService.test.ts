import { describe, expect, it } from "vitest";
import { createSkillExecutionService } from "./skillExecutionService";
import type { SkillRecord } from "../shared/skills";

describe("SkillExecutionService", () => {
  it("creates replayable skill execution snapshots with session, request, provenance, and terminal stage records", async () => {
    const snapshots: unknown[] = [];
    const service = createSkillExecutionService({
      createId: () => "exec_1",
      now: createSteppedClock("2026-06-21T00:00:00.000Z"),
      onSnapshot(snapshot) {
        snapshots.push(snapshot);
      },
    });

    const result = await service.execute({
      skill: createSkillRecord(),
      taskId: "chat_session_1_request_1",
      sessionId: "session_1",
      requestId: "request_1",
      workspaceId: "workspace_1",
      budgets: { maxTurns: 4, maxToolCalls: 8 },
      runAgentSkill: async () => ({
        ok: true,
        result: { summary: "skill completed" },
      }),
    });

    expect(result.ok).toBe(true);
    expect(result.snapshot).toMatchObject({
      executionId: "skill_exec_exec_1",
      taskId: "chat_session_1_request_1",
      sessionId: "session_1",
      requestId: "request_1",
      workspaceId: "workspace_1",
      selectedSkillName: "agent-reach",
      stage: "succeeded",
      terminal: true,
      skill: {
        name: "agent-reach",
        displayName: "Agent Reach",
        skillFile: "/skills/agent-reach/SKILL.md",
        rootDir: "/skills/agent-reach",
      },
      budgets: { maxTurns: 4, maxToolCalls: 8 },
    });
    expect(result.snapshot.stageRecords.map((record) => record.stage)).toEqual([
      "resolving_skill",
      "loading_resources",
      "configuring",
      "planning",
      "executing",
      "validating",
      "finalizing",
      "succeeded",
    ]);
    expect(snapshots.at(-1)).toMatchObject({
      stage: "succeeded",
      terminal: true,
    });
  });
});

function createSkillRecord(): SkillRecord {
  return {
    rootDir: "/skills/agent-reach",
    skillFile: "/skills/agent-reach/SKILL.md",
    body: "Use the browser reference.",
    manifest: {
      name: "agent-reach",
      displayName: "Agent Reach",
      description: "Give agents browser reach.",
      version: "1.0.0",
      execution: { mode: "agent", entrypoint: null, maxTurns: 4 },
      inputs: [],
      permissions: {
        files: { read: [], write: [] },
        web: { search: false, fetchDomains: [] },
        shell: { commands: [] },
        memory: { read: false, write: false },
      },
      tools: [],
      mcpServers: [],
    },
  };
}

function createSteppedClock(start: string): () => Date {
  let offset = 0;
  const startMs = new Date(start).getTime();
  return () => {
    const value = new Date(startMs + offset * 1000);
    offset += 1;
    return value;
  };
}
