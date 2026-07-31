import { describe, expect, it } from "vitest";
import {
  createSkillExecutionService,
  resolveSkillInput,
} from "./skillExecutionService";
import type { SkillRecord } from "../shared/skills";
import { buildPrimaryRunContext } from "../shared/agentWorkspace";

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
      executionPolicy: { checkpointEveryTurns: 4 },
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
      executionPolicy: { checkpointEveryTurns: 4 },
    });
    expect(result.snapshot.stageRecords.map((record) => record.stage)).toEqual([
      "resolving_skill",
      "loading_resources",
      "auditing_requirements",
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

  it("resolves required missing skill inputs deterministically", () => {
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: "/workspace/project",
    });

    expect(
      resolveSkillInput({
        skill: createSkillRecord([
          {
            name: "targetDir",
            label: "Target directory",
            type: "path",
            required: true,
          },
          {
            name: "format",
            label: "Format",
            type: "choice",
            required: true,
            choices: ["markdown", "html"],
          },
        ]),
        values: {},
        runContext,
      }),
    ).toEqual({
      status: "missing",
      values: {},
      missingFields: ["targetDir", "format"],
      invalidFields: [],
    });
  });

  it("rejects invalid number, boolean, choice, and outside-workspace path inputs", () => {
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: "/workspace/project",
    });

    expect(
      resolveSkillInput({
        skill: createSkillRecord([
          {
            name: "targetDir",
            label: "Target directory",
            type: "path",
            required: true,
          },
          {
            name: "limit",
            label: "Limit",
            type: "number",
            required: true,
          },
          {
            name: "includeResearch",
            label: "Include research",
            type: "boolean",
            required: true,
          },
          {
            name: "format",
            label: "Format",
            type: "choice",
            required: true,
            choices: ["markdown", "html"],
          },
        ]),
        values: {
          targetDir: "/etc",
          limit: "10",
          includeResearch: "false",
          format: "pdf",
        },
        runContext,
      }),
    ).toEqual({
      status: "invalid",
      values: {},
      missingFields: [],
      invalidFields: ["targetDir", "limit", "includeResearch", "format"],
    });
  });

  it("accepts boolean false, valid choices, defaults, and workspace-local paths", () => {
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: "/workspace/project",
    });

    expect(
      resolveSkillInput({
        skill: createSkillRecord([
          {
            name: "targetDir",
            label: "Target directory",
            type: "path",
            required: true,
          },
          {
            name: "includeResearch",
            label: "Include research",
            type: "boolean",
            required: true,
          },
          {
            name: "format",
            label: "Format",
            type: "choice",
            required: true,
            choices: ["markdown", "html"],
          },
          {
            name: "limit",
            label: "Limit",
            type: "number",
            required: false,
            defaultValue: 5,
          },
        ]),
        values: {
          targetDir: "docs",
          includeResearch: false,
          format: "markdown",
        },
        runContext,
      }),
    ).toEqual({
      status: "complete",
      values: {
        targetDir: "/workspace/project/docs",
        includeResearch: false,
        format: "markdown",
        limit: 5,
      },
      missingFields: [],
      invalidFields: [],
    });
  });

  it("canonicalizes workspace-relative path inputs before resolving values", () => {
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: "/workspace/project",
    });

    expect(
      resolveSkillInput({
        skill: createSkillRecord([
          {
            name: "targetDir",
            label: "Target directory",
            type: "path",
            required: true,
          },
        ]),
        values: {
          targetDir: "docs",
        },
        runContext,
      }),
    ).toEqual({
      status: "complete",
      values: {
        targetDir: "/workspace/project/docs",
      },
      missingFields: [],
      invalidFields: [],
    });
  });
});

function createSkillRecord(
  inputs: SkillRecord["manifest"]["inputs"] = [],
): SkillRecord {
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
      inputs,
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
