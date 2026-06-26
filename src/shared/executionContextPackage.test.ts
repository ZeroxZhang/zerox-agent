import { describe, expect, it } from "vitest";
import {
  createExecutionContextPackage,
  summarizeExecutionContextPackage,
} from "./executionContextPackage";
import { buildPrimaryRunContext } from "./agentWorkspace";

describe("execution context package", () => {
  it("captures one durable contract across runtime surfaces", () => {
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: "/repo",
    });

    const pkg = createExecutionContextPackage({
      packageId: "ecp_1",
      runId: "run_1",
      surface: "chat",
      runContext,
      skill: {
        name: "onepager",
        displayName: "Onepager",
        rootDir: "/skills/onepager",
        manifestHash: "sha256:skill",
        resources: [
          {
            kind: "skill",
            path: "/skills/onepager/SKILL.md",
            sha256: "sha256:skill-md",
          },
        ],
      },
      tools: {
        visible: [
          {
            name: "skill_load",
            source: "built-in",
            riskLevel: "low",
            available: true,
          },
        ],
      },
      permissions: {
        interactive: true,
        failClosedOnAsk: false,
        policyLabel: "chat workspace contract",
      },
      memory: {
        scopes: [
          { kind: "session", id: "session_1" },
          { kind: "workspace", id: "workspace_1" },
          { kind: "skill", id: "onepager" },
        ],
        recallBudgetTokens: 1800,
        rawHistoryEnabled: true,
      },
      checkpoint: {
        strategy: "boundary",
        preserveToolPairs: true,
        protectSkillLoads: true,
      },
      trajectory: {
        runId: "run_1",
        workspaceRunId: "workspace_run_1",
        sessionId: "session_1",
        requestId: "request_1",
      },
      createdAt: "2026-06-25T00:00:00.000Z",
    });

    expect(pkg).toMatchObject({
      version: 1,
      surface: "chat",
      workspace: {
        workspaceId: "workspace_1",
        workspaceRoot: "/repo",
        sandboxMode: "workspace_write",
      },
      skill: {
        name: "onepager",
        manifestHash: "sha256:skill",
      },
      permissions: {
        interactive: true,
        failClosedOnAsk: false,
      },
      memory: {
        rawHistoryEnabled: true,
      },
      checkpoint: {
        strategy: "boundary",
        preserveToolPairs: true,
      },
    });
    expect(summarizeExecutionContextPackage(pkg)).toEqual({
      packageId: "ecp_1",
      runId: "run_1",
      surface: "chat",
      workspaceId: "workspace_1",
      skillName: "onepager",
      visibleToolCount: 1,
      memoryScopes: ["session:session_1", "workspace:workspace_1", "skill:onepager"],
      checkpointStrategy: "boundary",
    });
  });
});
