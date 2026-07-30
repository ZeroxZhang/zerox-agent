import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPrimaryRunContext } from "../shared/agentWorkspace";
import { createAgentToolExecutor } from "./agentToolExecutor";
import { createDynamicToolRegistry } from "./dynamicToolRegistry";
import {
  authorizePlanModeTool,
  filterPlanModeToolDefinitions,
} from "./planModePolicy";
import { createScheduledTaskStore } from "./taskStore";
import { createToolAuditLog } from "./toolAuditLog";
import { createToolAuthorizationService } from "./toolAuthorizationService";

describe("Plan Mode immutable permission gate", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "zerox-plan-policy-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("filters write, shell, actor, workflow, memory-write, and unknown tools from visibility", () => {
    const definitions = [
      "file_read",
      "file_write",
      "shell_exec",
      "actor",
      "workflow",
      "memory_write",
      "unknown_dynamic_tool",
    ].map((name) => ({
      type: "function" as const,
      function: {
        name,
        description: name,
        parameters: { type: "object", properties: {}, required: [] },
      },
    }));
    expect(
      filterPlanModeToolDefinitions(definitions).map(
        (definition) => definition.function.name,
      ),
    ).toEqual(["file_read"]);

    const registry = createDynamicToolRegistry();
    for (const definition of definitions) {
      registry.register(
        definition,
        async () => ({ ok: true, result: {} }),
        "test",
      );
    }
    expect(
      registry
        .getVisibleDefinitions({
          allowedSources: ["test"],
          runMode: "plan",
        })
        .map((definition) => definition.function.name),
    ).toEqual(["file_read"]);
  });

  it("denies disallowed tools again inside AgentToolExecutor before execution", async () => {
    const executor = createAgentToolExecutor();
    const runContext = {
      ...buildPrimaryRunContext({
        workspaceId: "workspace",
        workspaceRoot: tempDir,
      }),
      runMode: "plan" as const,
    };
    await expect(
      executor.execute(
        { toolName: "shell_exec", args: { command: "touch forbidden" } },
        { runContext },
      ),
    ).resolves.toMatchObject({
      ok: false,
      errorDetails: {
        code: "plan_mode_tool_denied",
        toolName: "shell_exec",
      },
    });
    expect(
      authorizePlanModeTool({
        toolName: "unknown_dynamic_tool",
        args: {},
      }),
    ).toMatchObject({ allowed: false });
  });

  it("denies and audits the same request in ToolAuthorizationService even when task policy allows it", async () => {
    const taskStore = createScheduledTaskStore({
      configDir: tempDir,
      createId: () => "task-plan",
    });
    const auditLog = createToolAuditLog({
      configDir: tempDir,
      createId: () => "audit-plan",
    });
    const service = createToolAuthorizationService({ taskStore, auditLog });
    await taskStore.create({
      name: "Plan policy test",
      skillName: "local-file-organizer",
      enabled: true,
      schedule: { kind: "manual" },
      input: {},
      permissions: {
        files: { read: [tempDir], write: [tempDir] },
        web: { search: false, fetchDomains: [] },
        shell: { commands: [] },
        memory: { read: true, write: true },
      },
    });
    const runContext = {
      ...buildPrimaryRunContext({
        workspaceId: "workspace",
        workspaceRoot: tempDir,
      }),
      runMode: "plan" as const,
    };

    const result = await service.authorize(
      "task-plan",
      { toolName: "file_write", args: { path: "forbidden.md" } },
      { runContext },
    );

    expect(result).toMatchObject({
      ok: true,
      decision: {
        allowed: false,
        reason: expect.stringContaining("Plan Mode"),
      },
    });
    await expect(auditLog.list()).resolves.toEqual([
      expect.objectContaining({
        request: expect.objectContaining({ toolName: "file_write" }),
        decision: expect.objectContaining({ allowed: false }),
      }),
    ]);
  });
});
