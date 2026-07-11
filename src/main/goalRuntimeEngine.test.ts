import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AcceptanceRepairDirective, Goal, Milestone } from "../shared/agentGoal";
import type { AgentRunRecord } from "../shared/agentRuns";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";
import type { AgentTaskContract } from "../shared/agentTaskContract";
import type { SkillRecord } from "../shared/skills";
import { getArtifactProvenancePath } from "../shared/agentArtifactProvenance";
import { buildPrimaryRunContext } from "../shared/agentWorkspace";
import type { AgentToolExecutor } from "./agentToolExecutor";
import { createAgentToolExecutor } from "./agentToolExecutor";
import { createAgentGoalAcceptance } from "./agentGoalAcceptance";
import { createDynamicToolRegistry } from "./dynamicToolRegistry";
import { createGoalRuntimeEngine } from "./goalRuntimeEngine";
import { createAgentGoalContext } from "./agentGoalContext";
import type { AgentLoopResult } from "./agentLoop";
import type { ChatMessage } from "./openAiCompatibleClient";
import { createScheduledTaskStore } from "./taskStore";
import { createToolAuditLog } from "./toolAuditLog";
import { createToolAuthorizationService } from "./toolAuthorizationService";
import { projectRunGraph } from "../shared/runGraph";

describe("goal runtime engine", () => {
  it("routes supported deterministic contracts through the native pipeline without a model loop", async () => {
    const runs: AgentRunRecord[] = [];
    const trajectoryEvents: AgentTrajectoryEvent[] = [];
    const executedTools: string[] = [];
    const authorizedTools: string[] = [];
    const goal = createGoal({ taskContract: chromeBookmarkTaskContract });
    const milestone = goal.milestones[0]!;
    const engine = createGoalRuntimeEngine({
      workspaceRoot: "/Users/demo/project",
      chatClient: {
        async complete() {
          throw new Error("deterministic pipeline should not call the model");
        },
      },
      getModelProfile: async () => {
        throw new Error("deterministic pipeline should not load a model profile");
      },
      toolExecutor: {
        async execute(request) {
          executedTools.push(request.toolName);
          return {
            ok: true,
            result: {
              artifactRef: "artifact:bookmark_list",
              artifactPath: "/Users/demo/Desktop/bookmark_list.md",
              provenanceRef: "provenance:bookmark_list",
              provenancePath: "/Users/demo/Desktop/bookmark_list.md.provenance.json",
              goalEvidenceRef: "artifact:goalEvidence",
              goalEvidencePath: "/Users/demo/Desktop/goalEvidence.md",
              goalEvidenceProvenanceRef: "provenance:goalEvidence",
              goalEvidenceProvenancePath:
                "/Users/demo/Desktop/goalEvidence.md.provenance.json",
              evidenceRefs: [
                "artifact:bookmark_list",
                "provenance:bookmark_list",
                "artifact:goalEvidence",
                "provenance:goalEvidence",
              ],
            },
          };
        },
        getRegistry() {
          return createDynamicToolRegistry();
        },
        hasTool() {
          return true;
        },
      },
      toolAuthorizationService: {
        async authorize(_taskId, request, options) {
          authorizedTools.push(request.toolName);
          expect(options?.runContext).toMatchObject({
            runId: "goal_run_1",
            goalId: "goal_1",
            milestoneId: "milestone_1",
          });
          return {
            ok: true,
            decision: {
              allowed: true,
              reason: "authorized deterministic tool",
            },
          };
        },
      },
      runStore: {
        async append(run) {
          runs.push(run);
          return run;
        },
      },
      trajectoryStore: {
        async append(_runId, event) {
          trajectoryEvents.push(event);
          return event;
        },
      },
      goalContext: createAgentGoalContext(),
      createId: () => "goal_run_1",
      now: () => "2026-06-13T10:00:00.000Z",
      runAgentLoop: async (): Promise<AgentLoopResult> => {
        throw new Error("deterministic pipeline should not enter runAgentLoop");
      },
    });

    const result = await engine.runMilestone(goal, milestone);

    expect(result).toMatchObject({
      runId: "goal_run_1",
      status: "succeeded",
      toolCallCount: 1,
    });
    expect(executedTools).toEqual(["chrome_bookmarks_read"]);
    expect(authorizedTools).toEqual(["chrome_bookmarks_read"]);
    expect(result.actionSignatures).toEqual([
      expect.stringMatching(/^chrome_bookmarks_read:/),
    ]);
    expect(runs[0]).toMatchObject({
      id: "goal_run_1",
      skillName: "deterministic-goal-pipeline",
      status: "succeeded",
      summary: expect.stringContaining("Deterministic Chrome bookmark"),
    });
    expect(trajectoryEvents.map((event) => event.type)).not.toContain(
      "model_request",
    );
    expect(trajectoryEvents).toContainEqual(
      expect.objectContaining({
        type: "run_context_created",
        payload: expect.objectContaining({
          runtimeContextSnapshot: expect.objectContaining({
            surface: "goal",
            model: expect.objectContaining({
              providerId: "native",
              modelId: "deterministic",
            }),
            permissions: expect.objectContaining({
              taskId: "goal:goal_1",
              approvalMode: "scheduled",
            }),
            trajectory: expect.objectContaining({
              runId: "goal_run_1",
            }),
          }),
          runtimeContextSnapshotSummary: expect.objectContaining({
            surface: "goal",
            permissionTaskId: "goal:goal_1",
          }),
          goalId: "goal_1",
          milestoneId: "milestone_1",
        }),
      }),
    );
    expect(trajectoryEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool_call",
          payload: expect.objectContaining({
            toolName: "chrome_bookmarks_read",
          }),
        }),
        expect.objectContaining({
          type: "tool_invocation",
          payload: expect.objectContaining({
            toolName: "chrome_bookmarks_read",
            invocationStatus: "completed",
          }),
        }),
        expect.objectContaining({
          type: "artifact_created",
          payload: expect.objectContaining({
            artifactRef: "artifact:bookmark_list",
            provenanceRef: "provenance:bookmark_list",
          }),
        }),
      ]),
    );
    expect(
      trajectoryEvents
        .filter((event) => event.type === "tool_invocation")
        .map((event) => event.payload.invocationStatus),
    ).toEqual(["proposed", "visible", "authorized", "running", "completed"]);
  });

  it("authorizes Chrome deterministic pipeline with the real goal policy and executes once", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "goal-chrome-authz-"));
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "goal-home-"));
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "goal-workspace-"));
    const outputRoot = path.join(workspaceRoot, "Desktop");
    const chromeUserDataDir = path.join(
      homeDir,
      "Library",
      "Application Support",
      "Google",
      "Chrome",
    );
    const bookmarksPath = path.join(chromeUserDataDir, "Default", "Bookmarks");
    const runs: AgentRunRecord[] = [];
    const trajectoryEvents: AgentTrajectoryEvent[] = [];

    try {
      await mkdir(path.dirname(bookmarksPath), { recursive: true });
      await writeFile(
        bookmarksPath,
        JSON.stringify({
          roots: {
            bookmark_bar: {
              type: "folder",
              name: "Bookmarks Bar",
              children: [
                {
                  type: "url",
                  name: "OpenAI",
                  url: "https://openai.com/",
                },
              ],
            },
          },
        }),
        "utf8",
      );
      const auditLog = createToolAuditLog({ configDir });
      const toolAuthorizationService = createToolAuthorizationService({
        taskStore: createScheduledTaskStore({ configDir }),
        auditLog,
        homeDir,
      });
      const toolExecutor = createAgentToolExecutor();
      const executedToolNames: string[] = [];
      const engine = createGoalRuntimeEngine({
        workspaceService: {
          async resolveRunContext() {
            return buildPrimaryRunContext({
              workspaceId: "workspace_1",
              workspaceRoot,
              locationEnv: { homeDir, platform: "darwin", workspaceRoot },
              sandbox: {
                mode: "workspace_write",
                network: "task_policy",
                shell: "approved_commands",
                allowWorkspaceEscape: false,
                extraReadRoots: [],
                extraWriteRoots: [outputRoot],
              },
            });
          },
        },
        chatClient: {
          async complete() {
            throw new Error("deterministic pipeline should not call the model");
          },
        },
        getModelProfile: async () => {
          throw new Error("deterministic pipeline should not load a model profile");
        },
        toolExecutor: {
          async execute(request, options) {
            executedToolNames.push(request.toolName);
            return toolExecutor.execute(request, options);
          },
          getRegistry() {
            return toolExecutor.getRegistry();
          },
          hasTool(toolName) {
            return toolExecutor.hasTool(toolName);
          },
        },
        toolAuthorizationService,
        runStore: {
          async append(run) {
            runs.push(run);
            return run;
          },
        },
        trajectoryStore: {
          async append(_runId, event) {
            trajectoryEvents.push(event);
            return event;
          },
        },
        goalContext: createAgentGoalContext(),
        createId: () => "goal_run_1",
        now: () => "2026-06-13T10:00:00.000Z",
      });

      const goal = createGoal({ taskContract: chromeBookmarkTaskContract });
      const result = await engine.runMilestone(goal, goal.milestones[0]!);

      expect(result.status).toBe("succeeded");
      expect(executedToolNames).toEqual(["chrome_bookmarks_read"]);
      await expect(auditLog.list()).resolves.toMatchObject([
        {
          taskId: "goal:goal_1",
          request: {
            toolName: "chrome_bookmarks_read",
            args: expect.objectContaining({
              chromeUserDataDir,
            }),
          },
          decision: {
            allowed: true,
            reason: expect.stringContaining("goal milestone"),
          },
        },
      ]);
      expect(trajectoryEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "artifact_created",
            payload: expect.objectContaining({
              artifactRef: "artifact:bookmark_list",
            }),
          }),
        ]),
      );
      expect(runs[0]?.skillName).toBe("deterministic-goal-pipeline");
    } finally {
      await rm(configDir, { recursive: true, force: true });
      await rm(homeDir, { recursive: true, force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("injects selected skill instructions and permissions into goal milestones", async () => {
    const runs: AgentRunRecord[] = [];
    const trajectoryEvents: AgentTrajectoryEvent[] = [];
    let capturedMessages: ChatMessage[] = [];
    let capturedRuntimeTask: unknown;
    const selectedSkill = createSkillRecord({
      name: "onepager",
      body: "Onepager 技能流程：必须先做内容架构分析。",
    });
    const goal = createGoal({ selectedSkill });
    const milestone = goal.milestones[0]!;
    const engine = createGoalRuntimeEngine({
      workspaceRoot: "/Users/demo/project",
      chatClient: {
        async complete() {
          throw new Error("runAgentLoop stub handles model execution");
        },
      },
      getModelProfile: async () => ({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        model: "agent-model",
        temperature: 0.2,
        maxTokens: 8192,
      }),
      toolExecutor: {
        async execute() {
          return { ok: true, result: {} };
        },
        getRegistry() {
          return createDynamicToolRegistry();
        },
        hasTool() {
          return true;
        },
      },
      runStore: {
        async append(run) {
          runs.push(run);
          return run;
        },
      },
      trajectoryStore: {
        async append(_runId, event) {
          trajectoryEvents.push(event);
          return event;
        },
      },
      goalContext: createAgentGoalContext(),
      createId: () => "goal_run_skill",
      now: () => "2026-06-13T10:00:00.000Z",
      runAgentLoop: async (messages, _profile, options): Promise<AgentLoopResult> => {
        capturedMessages = messages;
        capturedRuntimeTask = options.runtimeTask;
        return {
          status: "succeeded",
          summary: "skill report complete",
          turns: 1,
          messages,
          toolCallsExecuted: 0,
        };
      },
    });

    const result = await engine.runMilestone(goal, milestone);

    expect(result).toMatchObject({
      status: "succeeded",
      summary: "skill report complete",
    });
    const prompt = capturedMessages.map((message) => message.content).join("\n");
    expect(prompt).toContain("Selected skill execution contract");
    expect(prompt).toContain("Onepager 技能流程：必须先做内容架构分析。");
    expect(capturedRuntimeTask).toMatchObject({
      permissions: {
        files: {
          read: expect.arrayContaining([
            "/Users/demo/project",
            "/tmp/skills/onepager",
          ]),
        },
        tools: {
          allowedNames: expect.arrayContaining([
            "skill_load",
            "skill_resource_list",
          ]),
          allowedSkillNames: ["onepager"],
        },
      },
    });
    expect(runs[0]).toMatchObject({
      skillName: "goal-milestone",
      status: "succeeded",
    });
  });

  it("executes a typed JSON deterministic contract with real file tools and provenance", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "goal-json-authz-"));
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "goal-workspace-"));
    const inputPath = path.join(workspaceRoot, "input", "links.json");
    const outputPath = path.join(workspaceRoot, "reports", "local_fixture.md");
    const runs: AgentRunRecord[] = [];
    const trajectoryEvents: AgentTrajectoryEvent[] = [];

    try {
      await mkdir(path.dirname(inputPath), { recursive: true });
      await writeFile(
        inputPath,
        JSON.stringify({
          title: "Local fixture",
          links: ["https://example.com", "https://openai.com"],
        }),
        "utf8",
      );
      const auditLog = createToolAuditLog({ configDir });
      const toolAuthorizationService = createToolAuthorizationService({
        taskStore: createScheduledTaskStore({ configDir }),
        auditLog,
      });
      const toolExecutor = createAgentToolExecutor();
      const goal = createGoal({
        taskContract: createJsonMarkdownTaskContract(inputPath, outputPath),
      });
      const engine = createGoalRuntimeEngine({
        workspaceRoot,
        chatClient: {
          async complete() {
            throw new Error("deterministic pipeline should not call the model");
          },
        },
        getModelProfile: async () => {
          throw new Error("deterministic pipeline should not load a model profile");
        },
        toolExecutor,
        toolAuthorizationService,
        runStore: {
          async append(run) {
            runs.push(run);
            return run;
          },
        },
        trajectoryStore: {
          async append(_runId, event) {
            trajectoryEvents.push(event);
            return event;
          },
        },
        goalContext: createAgentGoalContext(),
        createId: () => "goal_run_json",
        now: () => "2026-06-13T10:00:00.000Z",
      });

      const result = await engine.runMilestone(goal, goal.milestones[0]!);

      expect(result.status).toBe("succeeded");
      await expect(readFile(outputPath, "utf8")).resolves.toContain(
        "https://openai.com",
      );
      await expect(
        readFile(getArtifactProvenancePath(outputPath), "utf8"),
      ).resolves.toContain('"artifactId": "local_fixture"');
      expect(trajectoryEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "artifact_created",
            payload: expect.objectContaining({
              artifactRef: "artifact:local_fixture",
              provenanceRef: "provenance:local_fixture",
            }),
          }),
        ]),
      );
      expect(runs[0]?.skillName).toBe("deterministic-goal-pipeline");
    } finally {
      await rm(configDir, { recursive: true, force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("falls back to the model loop for unsupported deterministic contracts", async () => {
    const loopInputs: string[] = [];
    const goal = createGoal({
      taskContract: unsupportedDeterministicContract,
    });
    const engine = createGoalRuntimeEngine({
      workspaceRoot: "/Users/example",
      chatClient: {
        async complete() {
          throw new Error("fake loop should be used");
        },
      },
      getModelProfile: async () => ({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        model: "agent-model",
        temperature: 0.2,
        maxTokens: 8192,
      }),
      toolExecutor: {
        async execute() {
          throw new Error("no tool expected");
        },
        getRegistry() {
          return createDynamicToolRegistry();
        },
        hasTool() {
          return true;
        },
      },
      runStore: {
        async append(run) {
          return run;
        },
      },
      trajectoryStore: {
        async append(_runId, event) {
          return event;
        },
      },
      goalContext: createAgentGoalContext(),
      createId: () => "goal_run_fallback",
      now: () => "2026-06-13T10:00:00.000Z",
      runAgentLoop: async (messages): Promise<AgentLoopResult> => {
        loopInputs.push(messages.at(-1)?.content ?? "");
        return {
          summary: "Existing Goal Mode handled unsupported contract.",
          status: "succeeded",
          turns: 1,
          messages,
          toolCallsExecuted: 0,
        };
      },
    });

    const result = await engine.runMilestone(goal, goal.milestones[0]!);

    expect(result.status).toBe("succeeded");
    expect(loopInputs).toHaveLength(1);
    expect(result.summary).toBe("Existing Goal Mode handled unsupported contract.");
  });

  it("falls back to the model loop for non-deterministic contracts", async () => {
    const loopInputs: string[] = [];
    const goal = createGoal({
      taskContract: nonDeterministicContract,
    });
    const engine = createGoalRuntimeEngine({
      workspaceRoot: "/Users/example",
      chatClient: {
        async complete() {
          throw new Error("fake loop should be used");
        },
      },
      getModelProfile: async () => ({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        model: "agent-model",
        temperature: 0.2,
        maxTokens: 8192,
      }),
      toolExecutor: {
        async execute() {
          throw new Error("no tool expected");
        },
        getRegistry() {
          return createDynamicToolRegistry();
        },
        hasTool() {
          return true;
        },
      },
      runStore: {
        async append(run) {
          return run;
        },
      },
      trajectoryStore: {
        async append(_runId, event) {
          return event;
        },
      },
      goalContext: createAgentGoalContext(),
      createId: () => "goal_run_nondeterministic",
      now: () => "2026-06-13T10:00:00.000Z",
      runAgentLoop: async (messages): Promise<AgentLoopResult> => {
        loopInputs.push(messages.at(-1)?.content ?? "");
        return {
          summary: "Existing Goal Mode handled non-deterministic contract.",
          status: "succeeded",
          turns: 1,
          messages,
          toolCallsExecuted: 0,
        };
      },
    });

    const result = await engine.runMilestone(goal, goal.milestones[0]!);

    expect(result.status).toBe("succeeded");
    expect(loopInputs).toHaveLength(1);
    expect(result.summary).toBe(
      "Existing Goal Mode handled non-deterministic contract.",
    );
  });

  it("awaits deterministic artifact trajectory writes before returning", async () => {
    const trajectoryEvents: AgentTrajectoryEvent[] = [];
    const delayedWrites: Array<Promise<void>> = [];
    const goal = createGoal({ taskContract: chromeBookmarkTaskContract });
    const engine = createGoalRuntimeEngine({
      workspaceRoot: "/Users/demo/project",
      chatClient: {
        async complete() {
          throw new Error("deterministic pipeline should not call the model");
        },
      },
      getModelProfile: async () => {
        throw new Error("deterministic pipeline should not load a model profile");
      },
      toolExecutor: {
        async execute() {
          return {
            ok: true,
            result: {
              artifactRef: "artifact:bookmark_list",
              artifactPath: "/Users/demo/Desktop/bookmark_list.md",
              provenanceRef: "provenance:bookmark_list",
              provenancePath: "/Users/demo/Desktop/bookmark_list.md.provenance.json",
              goalEvidenceRef: "artifact:goalEvidence",
              goalEvidencePath: "/Users/demo/Desktop/goalEvidence.md",
              goalEvidenceProvenanceRef: "provenance:goalEvidence",
              goalEvidenceProvenancePath:
                "/Users/demo/Desktop/goalEvidence.md.provenance.json",
            },
          };
        },
        getRegistry() {
          return createDynamicToolRegistry();
        },
        hasTool() {
          return true;
        },
      },
      runStore: {
        async append(run) {
          return run;
        },
      },
      trajectoryStore: {
        async append(_runId, event) {
          if (event.type === "artifact_created") {
            const write = new Promise<void>((resolve) => {
              setTimeout(() => {
                trajectoryEvents.push(event);
                resolve();
              }, 20);
            });
            delayedWrites.push(write);
            await write;
            return event;
          }
          trajectoryEvents.push(event);
          return event;
        },
      },
      goalContext: createAgentGoalContext(),
      createId: () => "goal_run_awaited",
      now: () => "2026-06-13T10:00:00.000Z",
    });

    await engine.runMilestone(goal, goal.milestones[0]!);

    expect(delayedWrites.length).toBeGreaterThan(0);
    expect(trajectoryEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "artifact_created",
          payload: expect.objectContaining({
            artifactRef: "artifact:bookmark_list",
          }),
        }),
      ]),
    );
  });

  it("runs a goal milestone through the agent loop and records the run", async () => {
    const runs: AgentRunRecord[] = [];
    const trajectoryEvents: AgentTrajectoryEvent[] = [];
    const loopInputs: Array<{
      messages: ChatMessage[];
      taskId: string | undefined;
      systemPrompt: string | undefined;
      maxTurns: number | undefined;
      pauseOnStrategyGuard: boolean | undefined;
      pauseOnTurnLimit: boolean | undefined;
    }> = [];
    const goal = createGoal();
    const milestone = goal.milestones[0]!;
    const goalContext = createAgentGoalContext();
    const engine = createGoalRuntimeEngine({
      workspaceRoot: "/Users/example",
      chatClient: {
        async complete() {
          throw new Error("fake loop should be used");
        },
      },
      getModelProfile: async () => ({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        model: "agent-model",
        temperature: 0.2,
        maxTokens: 8192,
      }),
      toolExecutor: {
        async execute() {
          return { ok: true, result: {} };
        },
        getRegistry() {
          return createDynamicToolRegistry();
        },
        hasTool() {
          return true;
        },
      },
      runStore: {
        async append(run) {
          runs.push(run);
          return run;
        },
      },
      trajectoryStore: {
        async append(_runId, event) {
          trajectoryEvents.push(event);
          return event;
        },
      },
      goalContext,
      createId: () => "goal_run_1",
      now: () => "2026-06-13T10:00:00.000Z",
      runAgentLoop: async (messages, _profile, options): Promise<AgentLoopResult> => {
        loopInputs.push({
          messages,
          taskId: options.taskId,
          systemPrompt: options.systemPrompt,
          maxTurns: options.maxTurns,
          pauseOnStrategyGuard: options.pauseOnStrategyGuard,
          pauseOnTurnLimit: options.pauseOnTurnLimit,
        });
        return {
          summary: "已完成 Serenity 投资方法论调研摘要。",
          status: "succeeded",
          turns: 2,
          messages,
          toolCallsExecuted: 3,
        };
      },
    });

    const result = await engine.runMilestone(goal, milestone);

    expect(result).toMatchObject({
      runId: "goal_run_1",
      toolCallCount: 3,
      status: "succeeded",
      summary: "已完成 Serenity 投资方法论调研摘要。",
    });
    expect(result.tokens).toBeGreaterThan(0);
    expect(loopInputs).toHaveLength(1);
    expect(loopInputs[0]?.taskId).toBe("goal:goal_1");
    expect(loopInputs[0]?.pauseOnStrategyGuard).toBe(true);
    expect(loopInputs[0]?.pauseOnTurnLimit).toBe(false);
    expect(loopInputs[0]?.maxTurns).toBeGreaterThan(8);
    expect(loopInputs[0]?.systemPrompt).toContain("长期目标执行");
    expect(loopInputs[0]?.systemPrompt).toContain("Model profile: default");
    expect(loopInputs[0]?.messages.at(-1)).toEqual({
      role: "user",
      content: expect.stringContaining("Milestone: 调研 Serenity 投资方法论"),
    });
    expect(loopInputs[0]?.messages.at(-1)?.content).toContain(
      "Workspace root: /Users/example",
    );
    expect(loopInputs[0]?.messages.at(-1)?.content).toContain(
      "所有 file_list/file_read/file_search/code_search/git_status/git_diff/test_run 调用都必须使用上述 workspace root",
    );
    expect(loopInputs[0]?.messages.at(-1)?.content).toContain(
      "只有这些工具无法完成时才申请 shell_exec",
    );
    expect(loopInputs[0]?.messages.some((message) =>
      message.content.includes("[Goal continuity checkpoint - never compact]")
    )).toBe(true);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: "goal_run_1",
      taskId: "goal:goal_1",
      taskName: "深度调研 Serenity",
      skillName: "goal-milestone",
      status: "succeeded",
      summary: "已完成 Serenity 投资方法论调研摘要。",
    });
    expect(result.transcriptMessages?.map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant",
    ]);
    expect(result.transcriptMessages?.at(-2)?.content).toContain(
      "Milestone: 调研 Serenity 投资方法论",
    );
    expect(result.transcriptMessages?.at(-1)?.content).toBe(
      "已完成 Serenity 投资方法论调研摘要。",
    );
    expect(runs[0]?.events.map((event) => event.message)).toContain(
      "Goal milestone agent loop completed.",
    );
    expect(trajectoryEvents).toContainEqual(
      expect.objectContaining({
        type: "run_context_created",
        payload: expect.objectContaining({
          runtimeContextSnapshot: expect.objectContaining({
            surface: "goal",
            model: expect.objectContaining({
              modelId: "agent-model",
            }),
            workspace: expect.objectContaining({
              workspaceRoot: "/Users/example",
            }),
            permissions: expect.objectContaining({
              taskId: "goal:goal_1",
              approvalMode: "scheduled",
            }),
          }),
          runtimeContextSnapshotSummary: expect.objectContaining({
            surface: "goal",
            workspaceRoot: "/Users/example",
          }),
        }),
      }),
    );
    expect(trajectoryEvents.map((event) => event.type)).toContain("final_summary");
    expect(trajectoryEvents.map((event) => event.type)).toContain("checkpoint_written");
  });

  it("rebuilds a milestone run from the prior real transcript", async () => {
    const goal = createGoal();
    const milestone = goal.milestones[0]!;
    let observedMessages: ChatMessage[] = [];
    const engine = createGoalRuntimeEngine({
      workspaceRoot: "/Users/demo/project",
      chatClient: { async complete() { throw new Error("unused"); } },
      getModelProfile: async () => ({
        baseUrl: "http://localhost",
        apiKey: "test",
        model: "test-model",
        temperature: 0,
        maxTokens: 4_000,
      }),
      toolExecutor: {
        async execute() { return { ok: true, result: {} }; },
        getRegistry() { return createDynamicToolRegistry(); },
        hasTool() { return true; },
      },
      runStore: { async append(run) { return run; } },
      trajectoryStore: { async append(_runId, event) { return event; } },
      goalContext: createAgentGoalContext(),
      runAgentLoop: async (messages) => {
        observedMessages = messages;
        return {
          summary: "continued",
          status: "succeeded",
          turns: 1,
          messages,
          toolCallsExecuted: 0,
        };
      },
    });
    const priorTranscript: ChatMessage[] = [
      { role: "assistant", content: "I will inspect package.json." },
      {
        role: "tool",
        tool_call_id: "call_read",
        content: JSON.stringify({ ok: true, result: { name: "zerox-agent" } }),
      },
    ];

    await engine.runMilestone(goal, milestone, {
      resumeMessages: priorTranscript,
    });

    expect(observedMessages).toEqual(
      expect.arrayContaining(priorTranscript),
    );
    expect(observedMessages.map((message) => message.content).join("\n"))
      .toContain("Resume directly from the latest real message/tool result");
  });

  it("suppresses final trajectory and run writes after cancellation", async () => {
    const controller = new AbortController();
    const trajectoryTypes: string[] = [];
    const runs: AgentRunRecord[] = [];
    const goal = createGoal();
    const engine = createGoalRuntimeEngine({
      workspaceRoot: "/Users/demo/project",
      chatClient: { async complete() { throw new Error("unused"); } },
      getModelProfile: async () => ({
        baseUrl: "http://localhost",
        apiKey: "test",
        model: "test-model",
        temperature: 0,
        maxTokens: 4_000,
      }),
      toolExecutor: {
        async execute() { return { ok: true, result: {} }; },
        getRegistry() { return createDynamicToolRegistry(); },
        hasTool() { return true; },
      },
      runStore: {
        async append(run) {
          runs.push(run);
          return run;
        },
      },
      trajectoryStore: {
        async append(_runId, event) {
          trajectoryTypes.push(event.type);
          return event;
        },
      },
      goalContext: createAgentGoalContext(),
      runAgentLoop: async (messages) => {
        controller.abort();
        return {
          summary: "canceled",
          status: "canceled",
          turns: 1,
          messages,
          toolCallsExecuted: 0,
        };
      },
    });

    const result = await engine.runMilestone(goal, goal.milestones[0]!, {
      signal: controller.signal,
    });

    expect(result.status).toBe("canceled");
    expect(runs).toEqual([]);
    expect(trajectoryTypes).not.toContain("final_summary");
    expect(trajectoryTypes).not.toContain("checkpoint_written");
  });

  it("passes run-scoped identity into chrome bookmark provenance and projects artifact events", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "goal-workspace-"));
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "goal-output-"));
    const bookmarksPath = path.join(workspaceRoot, "Chrome", "Default", "Bookmarks");
    const runs: AgentRunRecord[] = [];
    const trajectoryEvents: AgentTrajectoryEvent[] = [];
    const toolExecutor = createAgentToolExecutor();

    try {
      await mkdir(path.dirname(bookmarksPath), { recursive: true });
      await writeFile(
        bookmarksPath,
        JSON.stringify({
          roots: {
            bookmark_bar: {
              type: "folder",
              name: "Bookmarks Bar",
              children: [
                {
                  type: "url",
                  name: "OpenAI",
                  url: "https://openai.com/",
                },
              ],
            },
          },
        }),
        "utf8",
      );
      const criterion = {
        id: "criterion_bookmarks",
        description: "Bookmark artifacts exist with provenance.",
        acceptanceChecks: [
          {
            id: "check_bookmark_list",
            kind: "file_exists" as const,
            description: "bookmark_list.md exists with provenance.",
            params: {
              path: path.join(outputRoot, "bookmark_list.md"),
              artifactRef: "artifact:bookmark_list",
              requireProvenance: true,
            },
            requiresEvidence: true,
          },
          {
            id: "check_goal_evidence",
            kind: "file_exists" as const,
            description: "goalEvidence.md exists with provenance.",
            params: {
              path: path.join(outputRoot, "goalEvidence.md"),
              artifactRef: "artifact:goalEvidence",
              requireProvenance: true,
            },
            requiresEvidence: true,
          },
        ],
      };
      const goal = createGoal({
        description: `Read Chrome bookmarks and write artifacts to ${outputRoot}`,
        successCriteria: [criterion],
        milestoneSuccessCriteria: [criterion],
      });
      const milestone = goal.milestones[0]!;
      const engine = createGoalRuntimeEngine({
        workspaceRoot,
        chatClient: {
          async complete() {
            throw new Error("fake loop should be used");
          },
        },
        getModelProfile: async () => ({
          baseUrl: "https://api.example.com/v1",
          apiKey: "secret",
          model: "agent-model",
          temperature: 0.2,
          maxTokens: 8192,
        }),
        toolExecutor,
        runStore: {
          async append(run) {
            runs.push(run);
            return run;
          },
        },
        trajectoryStore: {
          async append(_runId, event) {
            trajectoryEvents.push(event);
            return event;
          },
        },
        goalContext: createAgentGoalContext(),
        createId: () => "goal_run_1",
        now: () => "2026-06-13T10:00:00.000Z",
        runAgentLoop: async (messages, _profile, options): Promise<AgentLoopResult> => {
          expect(options.runContext).toMatchObject({
            runId: "goal_run_1",
            goalId: "goal_1",
            milestoneId: "milestone_1",
          });
          const toolResult = await options.toolExecutor.execute(
            {
              toolName: "chrome_bookmarks_read",
              args: { bookmarksPath },
            },
            { runContext: options.runContext },
          );
          options.onToolResult?.("chrome_bookmarks_read", toolResult.ok, toolResult);
          return {
            summary: "已读取 Chrome 书签。",
            status: "succeeded",
            turns: 1,
            messages,
            toolCallsExecuted: 1,
          };
        },
      });

      const result = await engine.runMilestone(goal, milestone);

      expect(result.status).toBe("succeeded");
      const bookmarkManifest = JSON.parse(
        await readFile(
          path.join(outputRoot, "bookmark_list.md.provenance.json"),
          "utf8",
        ),
      );
      expect(bookmarkManifest).toMatchObject({
        runId: "goal_run_1",
        goalId: "goal_1",
        milestoneId: "milestone_1",
        artifactId: "bookmark_list",
        artifactRef: "artifact:bookmark_list",
      });

      const acceptance = createAgentGoalAcceptance();
      const acceptanceResult = await acceptance.evaluate(milestone, {
        runId: result.runId,
        goalId: goal.id,
        milestoneId: milestone.id,
        workspacePath: workspaceRoot,
        extraReadRoots: [outputRoot],
        extraWriteRoots: [outputRoot],
        toolExecutor,
        trajectoryStore: {
          async append(_runId, event) {
            trajectoryEvents.push(event);
            return event;
          },
        },
      });

      expect(acceptanceResult.accepted).toBe(true);
      expect(trajectoryEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "tool_result",
            payload: expect.objectContaining({
              toolName: "chrome_bookmarks_read",
              artifactRef: "artifact:bookmark_list",
              provenanceRef: "provenance:bookmark_list",
              evidenceRefs: expect.arrayContaining([
                "artifact:bookmark_list",
                "provenance:bookmark_list",
                "artifact:goalEvidence",
                "provenance:goalEvidence",
              ]),
            }),
          }),
          expect.objectContaining({
            type: "artifact_created",
            payload: expect.objectContaining({
              artifactId: "bookmark_list",
              artifactRef: "artifact:bookmark_list",
              provenanceRef: "provenance:bookmark_list",
            }),
          }),
          expect.objectContaining({
            type: "artifact_created",
            payload: expect.objectContaining({
              artifactId: "goalEvidence",
              artifactRef: "artifact:goalEvidence",
              provenanceRef: "provenance:goalEvidence",
            }),
          }),
        ]),
      );
      const graph = projectRunGraph({
        run: runs[0]!,
        trajectoryEvents,
        kernelEvents: [],
      });
      expect(graph.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ ref: "provenance:bookmark_list" }),
          expect.objectContaining({ ref: "provenance:goalEvidence" }),
        ]),
      );
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
      await rm(outputRoot, { recursive: true, force: true });
    }
  });

  it("records strategy guard events from the agent loop trajectory", async () => {
    const runs: AgentRunRecord[] = [];
    const trajectoryEvents: AgentTrajectoryEvent[] = [];
    const goal = createGoal();
    const engine = createGoalRuntimeEngine({
      workspaceRoot: "/Users/example",
      chatClient: {
        async complete() {
          throw new Error("fake loop should be used");
        },
      },
      getModelProfile: async () => ({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        model: "agent-model",
        temperature: 0.2,
        maxTokens: 8192,
      }),
      toolExecutor: {
        async execute() {
          return { ok: true, result: {} };
        },
        getRegistry() {
          return createDynamicToolRegistry();
        },
        hasTool() {
          return true;
        },
      },
      runStore: {
        async append(run) {
          runs.push(run);
          return run;
        },
      },
      trajectoryStore: {
        async append(_runId, event) {
          trajectoryEvents.push(event);
          return event;
        },
      },
      goalContext: createAgentGoalContext(),
      createId: () => "goal_run_1",
      now: () => "2026-06-13T10:00:00.000Z",
      runAgentLoop: async (messages, _profile, options): Promise<AgentLoopResult> => {
        options.onStrategyGuard?.({
          code: "FRAGMENTED_TOOL_CALLS",
          severity: "warn",
          message:
            "file_list has been called 4 times in one loop; switch to a batch or recursive strategy.",
          toolName: "file_list",
          count: 4,
        });
        return {
          summary: "已完成。",
          status: "succeeded",
          turns: 1,
          messages,
          toolCallsExecuted: 4,
        };
      },
    });

    await engine.runMilestone(goal, goal.milestones[0]!);

    expect(trajectoryEvents).toContainEqual(
      expect.objectContaining({
        type: "strategy_guard_triggered",
        payload: expect.objectContaining({
          code: "FRAGMENTED_TOOL_CALLS",
          toolName: "file_list",
          count: 4,
        }),
      }),
    );
    expect(runs[0]?.events.map((event) => event.message)).toContain(
      "Strategy guard triggered: FRAGMENTED_TOOL_CALLS",
    );
  });

  it("includes artifact evidence file contracts in milestone instructions", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "goal-workspace-"));
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "goal-output-"));

    try {
      const criterion = {
        id: "criterion_artifacts",
        description: "阶段成果必须落盘，供验收读取。",
        acceptanceChecks: [
          {
            id: "check_notes",
            kind: "model_review" as const,
            description: "评审确认研究笔记完整。",
            params: {
              condition: "研究笔记已经生成",
              evidenceRefs: ["artifact:research_notes", "artifact:report_outline"],
            },
            requiresEvidence: true,
          },
        ],
      };
      const goal = createGoal({
        description: `深度调研 Serenity，并把报告放在 ${outputRoot}`,
        milestoneSuccessCriteria: [criterion],
      });
      let milestoneInstruction = "";
      const engine = createGoalRuntimeEngine({
        workspaceRoot,
        chatClient: {
          async complete() {
            throw new Error("fake loop should be used");
          },
        },
        getModelProfile: async () => ({
          baseUrl: "https://api.example.com/v1",
          apiKey: "secret",
          model: "agent-model",
          temperature: 0.2,
          maxTokens: 8192,
        }),
        toolExecutor: {
          async execute() {
            return { ok: true, result: {} };
          },
          getRegistry() {
            return createDynamicToolRegistry();
          },
          hasTool() {
            return true;
          },
        },
        runStore: {
          async append(run) {
            return run;
          },
        },
        trajectoryStore: {
          async append(_runId, event) {
            return event;
          },
        },
        goalContext: createAgentGoalContext(),
        createId: () => "goal_run_1",
        now: () => "2026-06-13T10:00:00.000Z",
        runAgentLoop: async (messages): Promise<AgentLoopResult> => {
          milestoneInstruction = messages.at(-1)?.content ?? "";
          return {
            summary: "已写入 artifact 文件。",
            status: "succeeded",
            turns: 1,
            messages,
            toolCallsExecuted: 1,
          };
        },
      });

      await engine.runMilestone(goal, goal.milestones[0]!);

      expect(milestoneInstruction).toContain("Artifact evidence contract");
      expect(milestoneInstruction).toContain("artifact:research_notes");
      expect(milestoneInstruction).toContain(path.join(outputRoot, "research_notes.md"));
      expect(milestoneInstruction).toContain("artifact:report_outline");
      expect(milestoneInstruction).toContain(path.join(outputRoot, "report_outline.md"));
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
      await rm(outputRoot, { recursive: true, force: true });
    }
  });

  it("authorizes milestone tools with a goal-scoped policy instead of a scheduled task record", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "goal-authz-"));
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "goal-workspace-"));

    try {
      const auditLog = createToolAuditLog({
        configDir,
        createId: () => "audit_goal_1",
        now: () => new Date("2026-06-13T10:00:01.000Z"),
      });
      const toolAuthorizationService = createToolAuthorizationService({
        taskStore: createScheduledTaskStore({ configDir }),
        auditLog,
      });
      const registry = createDynamicToolRegistry();
      const executedArgs: Record<string, unknown>[] = [];
      const executionWorkspaceRoots: Array<string | undefined> = [];
      registry.register(
        {
          type: "function",
          function: {
            name: "web_search",
            description: "Search the web",
            parameters: {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"],
            },
          },
        },
        async (args, options) => {
          executedArgs.push(args);
          executionWorkspaceRoots.push(options?.runContext?.workspaceRoot);
          return {
            ok: true,
            result: { results: [{ title: "Serenity", url: "https://x.com" }] },
          };
        },
        "native:web",
      );
      const toolExecutor: AgentToolExecutor = {
        execute(request, options) {
          return registry.execute(request.toolName, request.args, options);
        },
        getRegistry() {
          return registry;
        },
        hasTool(toolName) {
          return registry.has(toolName);
        },
      };
      let completions = 0;
      const observedToolMessages: string[] = [];
      const goal = createGoal();
      const milestone = goal.milestones[0]!;
      const engine = createGoalRuntimeEngine({
        workspaceRoot,
        chatClient: {
          async complete(request) {
            completions += 1;
            if (completions === 1) {
              return {
                content: null,
                finishReason: "tool_calls",
                toolCalls: [
                  {
                    id: "tool_call_1",
                    type: "function",
                    function: {
                      name: "web_search",
                      arguments: JSON.stringify({ query: "白发魔女Serenity" }),
                    },
                  },
                ],
              };
            }

            const toolMessage = request.messages.find(
              (message) => message.role === "tool",
            );
            observedToolMessages.push(toolMessage?.content ?? "");
            return {
              content: "已根据搜索结果完成。",
              finishReason: "stop",
              toolCalls: [],
            };
          },
        },
        getModelProfile: async () => ({
          baseUrl: "https://api.example.com/v1",
          apiKey: "secret",
          model: "agent-model",
          temperature: 0.2,
          maxTokens: 8192,
        }),
        toolExecutor,
        toolAuthorizationService,
        runStore: {
          async append(run) {
            return run;
          },
        },
        trajectoryStore: {
          async append(_runId, event) {
            return event;
          },
        },
        goalContext: createAgentGoalContext(),
        createId: () => "goal_run_1",
        now: () => "2026-06-13T10:00:00.000Z",
        maxTurns: 3,
      });

      const result = await engine.runMilestone(goal, milestone);

      expect(result.status).toBe("succeeded");
      expect(executedArgs).toEqual([{ query: "白发魔女Serenity" }]);
      expect(executionWorkspaceRoots).toEqual([workspaceRoot]);
      expect(observedToolMessages[0]).toContain('"ok":true');
      await expect(auditLog.list()).resolves.toMatchObject([
        {
          taskId: "goal:goal_1",
          decision: {
            allowed: true,
            reason: expect.stringContaining("goal milestone"),
          },
        },
      ]);
    } finally {
      await rm(configDir, { recursive: true, force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("adds explicit goal output roots to the run context and runtime policy", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "goal-workspace-"));
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "goal-output-"));

    try {
      const outputPath = path.join(outputRoot, "serenity-raw-data.md");
      const criterion = {
        id: "criterion_output",
        description: "Report is written to the user-selected output directory.",
        acceptanceChecks: [
          {
            id: "check_output",
            kind: "file_exists" as const,
            description: "Report exists at the requested output path.",
            params: { path: outputPath },
            requiresEvidence: false,
          },
        ],
      };
      const goal = createGoal({
        description: `深度调研白发魔女 Serenity，并把报告放在 ${outputRoot}`,
        successCriteria: [criterion],
        milestoneSuccessCriteria: [criterion],
      });
      const observed: Array<{
        extraReadRoots: string[];
        extraWriteRoots: string[];
        policyReadRoots: string[];
        policyWriteRoots: string[];
        shellCommands: string[];
      }> = [];
      const engine = createGoalRuntimeEngine({
        workspaceRoot,
        chatClient: {
          async complete() {
            throw new Error("fake loop should be used");
          },
        },
        getModelProfile: async () => ({
          baseUrl: "https://api.example.com/v1",
          apiKey: "secret",
          model: "agent-model",
          temperature: 0.2,
          maxTokens: 8192,
        }),
        toolExecutor: {
          async execute() {
            return { ok: true, result: {} };
          },
          getRegistry() {
            return createDynamicToolRegistry();
          },
          hasTool() {
            return true;
          },
        },
        runStore: {
          async append(run) {
            return run;
          },
        },
        trajectoryStore: {
          async append(_runId, event) {
            return event;
          },
        },
        goalContext: createAgentGoalContext(),
        createId: () => "goal_run_1",
        now: () => "2026-06-13T10:00:00.000Z",
        runAgentLoop: async (messages, _profile, options): Promise<AgentLoopResult> => {
          observed.push({
            extraReadRoots: options.runContext?.sandbox.extraReadRoots ?? [],
            extraWriteRoots: options.runContext?.sandbox.extraWriteRoots ?? [],
            policyReadRoots: options.runtimeTask?.permissions.files.read ?? [],
            policyWriteRoots: options.runtimeTask?.permissions.files.write ?? [],
            shellCommands: options.runtimeTask?.permissions.shell.commands ?? [],
          });
          return {
            summary: "已写入用户指定目录。",
            status: "succeeded",
            turns: 1,
            messages,
            toolCallsExecuted: 1,
          };
        },
      });

      await engine.runMilestone(goal, goal.milestones[0]!);

      expect(observed).toEqual([
        {
          extraReadRoots: [outputRoot],
          extraWriteRoots: [outputRoot],
          policyReadRoots: [workspaceRoot, outputRoot],
          policyWriteRoots: [workspaceRoot, outputRoot],
          shellCommands: expect.arrayContaining([
            "npm test",
            "npm test -- *",
            "npm run harness:check",
            "npm run verify",
          ]),
        },
      ]);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
      await rm(outputRoot, { recursive: true, force: true });
    }
  });

  it("injects the exact repair directive and returns stable redacted model action signatures", async () => {
    const goal = createGoal();
    let instruction = "";
    const directive: AcceptanceRepairDirective = {
      action: "retry_alternate_strategy",
      summary: "Acceptance failed again for checks: check_report.",
      failedCheckIds: ["check_report"],
      fingerprint: "abcdef1234567890".padEnd(64, "0"),
      occurrence: 2,
      instructions: [
        'Resolve failed acceptance check "check_report" (assertion) and provide evidence for re-evaluation.',
        "Use a materially different strategy and materially different tool arguments; do not repeat the prior failed approach.",
      ],
    };
    const engine = createGoalRuntimeEngine({
      workspaceRoot: "/Users/example",
      chatClient: {
        async complete() {
          throw new Error("fake loop should be used");
        },
      },
      getModelProfile: async () => ({
        baseUrl: "https://api.example.com/v1",
        apiKey: "provider-secret",
        model: "agent-model",
        temperature: 0.2,
        maxTokens: 8192,
      }),
      toolExecutor: {
        async execute() {
          return { ok: true, result: {} };
        },
        getRegistry() {
          return createDynamicToolRegistry();
        },
        hasTool() {
          return true;
        },
      },
      runStore: {
        async append(run) {
          return run;
        },
      },
      trajectoryStore: {
        async append(_runId, event) {
          return event;
        },
      },
      goalContext: createAgentGoalContext(),
      createId: () => "goal_run_repair",
      now: () => "2026-06-13T10:00:00.000Z",
      runAgentLoop: async (messages, _profile, options): Promise<AgentLoopResult> => {
        instruction = messages.at(-1)?.content ?? "";
        options.onToolCall?.("web_fetch", {
          options: { z: 1, a: 2 },
          apiKey: "raw-secret-one",
        });
        options.onToolCall?.("web_fetch", {
          apiKey: "raw-secret-two",
          options: { a: 2, z: 1 },
        });
        options.onToolCall?.("file_write", {
          path: "report.md",
          content: "PRIVATE_FILE_CONTENT".repeat(2_000),
        });
        options.onToolCall?.("shell_exec", {
          command: "curl https://secret.invalid/run?api_key=query-secret -H 'Authorization: Bearer shell-secret'",
        });
        options.onToolCall?.("web_fetch", {
          url: "https://user:password@secret.invalid/report?access_token=url-secret",
          headers: { custom: "Bearer header-secret" },
        });
        return {
          summary: "Repair attempted.",
          status: "succeeded",
          turns: 1,
          messages,
          toolCallsExecuted: 2,
        };
      },
    });

    const result = await engine.runMilestone(goal, goal.milestones[0]!, {
      repairDirective: directive,
    });

    expect(instruction).toContain("BEGIN ACCEPTANCE REPAIR DIRECTIVE");
    expect(instruction).toContain("Failed check ids: check_report");
    expect(instruction).toContain("Occurrence: 2");
    expect(instruction).toContain("Fingerprint: abcdef123456");
    expect(instruction).toContain("materially different strategy");
    expect(instruction).toContain("do not repeat the prior failed approach");
    expect(result.actionSignatures).toHaveLength(4);
    expect(result.actionSignatures?.[0]).toContain("web_fetch:");
    expect(Buffer.byteLength(JSON.stringify(result.actionSignatures))).toBeLessThanOrEqual(8_192);
    expect(JSON.stringify(result.actionSignatures)).not.toMatch(
      /raw-secret|PRIVATE_FILE_CONTENT|curl https|secret\.invalid|query-secret|shell-secret|url-secret|header-secret/,
    );
  });
});

function createGoal(overrides: {
  description?: string;
  successCriteria?: Goal["successCriteria"];
  milestoneSuccessCriteria?: Milestone["successCriteria"];
  taskContract?: Goal["taskContract"];
  selectedSkill?: Goal["selectedSkill"];
} = {}): Goal {
  const milestone: Milestone = {
    id: "milestone_1",
    description: "调研 Serenity 投资方法论",
    dependsOn: [],
    successCriteria: overrides.milestoneSuccessCriteria ?? [],
    state: "ready",
    runIds: [],
    attempts: 0,
  };

  return {
    id: "goal_1",
    chatSessionId: "chat_1",
    description: overrides.description ?? "深度调研 Serenity",
    successCriteria: overrides.successCriteria ?? [],
    milestones: [milestone],
    status: "executing",
    budget: {
      maxIterations: 8,
      maxToolCalls: 64,
      maxWallClockMs: 45 * 60 * 1000,
      maxReplans: 3,
    },
    budgetUsage: {
      iterations: 0,
      toolCalls: 0,
      wallClockMs: 0,
      tokens: 0,
      replans: 0,
    },
    reviewPolicy: "review_each_milestone",
    planVersion: 1,
    ...(overrides.taskContract ? { taskContract: overrides.taskContract } : {}),
    ...(overrides.selectedSkill ? { selectedSkill: overrides.selectedSkill } : {}),
    createdAt: "2026-06-13T10:00:00.000Z",
    updatedAt: "2026-06-13T10:00:00.000Z",
  };
}

function createSkillRecord(
  partial: Partial<SkillRecord> & Pick<SkillRecord["manifest"], "name"> & { body?: string },
): SkillRecord {
  const name = partial.name;
  return {
    rootDir: `/tmp/skills/${name}`,
    skillFile: `/tmp/skills/${name}/SKILL.md`,
    body: partial.body ?? "Skill body",
    manifest: {
      name,
      displayName: partial.manifest?.displayName ?? name,
      description: partial.manifest?.description ?? `${name} description`,
      version: partial.manifest?.version ?? "0.1.0",
      execution: partial.manifest?.execution ?? {
        mode: "agent",
        entrypoint: null,
      },
      inputs: partial.manifest?.inputs ?? [],
      permissions: partial.manifest?.permissions ?? {
        files: { read: [], write: [] },
        shell: { commands: [] },
        web: { search: false, fetchDomains: [] },
        memory: { read: false, write: false },
      },
      ...(partial.manifest?.planning ? { planning: partial.manifest.planning } : {}),
      ...(partial.manifest?.tools ? { tools: partial.manifest.tools } : {}),
      ...(partial.manifest?.mcpServers ? { mcpServers: partial.manifest.mcpServers } : {}),
      ...(partial.manifest?.dependencies ? { dependencies: partial.manifest.dependencies } : {}),
    },
  };
}

const chromeBookmarkTaskContract: AgentTaskContract = {
  schemaVersion: 1,
  id: "task_contract_chrome_bookmarks_demo",
  taskKind: "local_data_to_artifact",
  mode: "deterministic",
  source: { type: "chrome_bookmarks" },
  transform: { type: "grouped_markdown" },
  deliverable: {
    artifactId: "bookmark_list",
    artifactRef: "artifact:bookmark_list",
    mediaType: "text/markdown",
    destination: { kind: "desktop", filename: "bookmark_list.md" },
  },
  capabilities: [
    { id: "chrome_bookmarks_read", toolName: "chrome_bookmarks_read" },
  ],
  acceptance: {
    evidenceRefs: ["artifact:bookmark_list", "artifact:goalEvidence"],
    provenanceRequired: true,
  },
  createdFrom: {
    description:
      "Get my Chrome bookmarks, group them, and write a Markdown file to Desktop.",
  },
};

function createJsonMarkdownTaskContract(
  inputPath: string,
  outputPath: string,
): AgentTaskContract {
  return {
    schemaVersion: 1,
    id: "task_contract_json_fixture_demo",
    taskKind: "local_data_to_artifact",
    mode: "deterministic",
    source: {
      type: "json_file",
      path: inputPath,
    },
    transform: { type: "json_markdown" },
    deliverable: {
      artifactId: "local_fixture",
      artifactRef: "artifact:local_fixture",
      mediaType: "text/markdown",
      destination: { kind: "path", path: outputPath },
    },
    capabilities: [
      { id: "file_read", toolName: "file_read" },
      { id: "file_write", toolName: "file_write" },
    ],
    acceptance: {
      evidenceRefs: ["artifact:local_fixture"],
      provenanceRequired: true,
    },
    createdFrom: {
      description:
        "Transform the local JSON fixture into Markdown and write it to Desktop.",
    },
  };
}

const unsupportedDeterministicContract = {
  schemaVersion: 1,
  id: "task_contract_unsupported_demo",
  taskKind: "local_data_to_artifact",
  mode: "deterministic",
  source: { type: "sqlite_database", path: "/Users/demo/db.sqlite" },
  transform: { type: "table_markdown" },
  deliverable: {
    artifactId: "database_report",
    artifactRef: "artifact:database_report",
    mediaType: "text/markdown",
    destination: { kind: "desktop", filename: "database_report.md" },
  },
  capabilities: [{ id: "sqlite_read", toolName: "sqlite_read" }],
  acceptance: {
    evidenceRefs: ["artifact:database_report"],
    provenanceRequired: true,
  },
  createdFrom: { description: "Unsupported deterministic database report." },
} as unknown as AgentTaskContract;

const nonDeterministicContract = {
  schemaVersion: 1,
  id: "task_contract_research_demo",
  taskKind: "local_data_to_artifact",
  mode: "agentic",
  source: { type: "web_research" },
  transform: { type: "synthesis_markdown" },
  deliverable: {
    artifactId: "research_report",
    artifactRef: "artifact:research_report",
    mediaType: "text/markdown",
    destination: { kind: "desktop", filename: "research_report.md" },
  },
  capabilities: [{ id: "web_search", toolName: "web_search" }],
  acceptance: {
    evidenceRefs: ["artifact:research_report"],
    provenanceRequired: false,
  },
  createdFrom: { description: "Agentic research report." },
} as unknown as AgentTaskContract;
