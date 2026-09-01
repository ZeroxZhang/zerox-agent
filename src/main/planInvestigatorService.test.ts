import { describe, expect, it, vi } from "vitest";
import type { AgentToolExecutor } from "./agentToolExecutor";
import type { DynamicToolRegistry } from "./dynamicToolRegistry";
import type { BoundModelClient } from "./providers/modelRouter";
import type { ToolAuthorizationService } from "./toolAuthorizationService";
import {
  createPlanInvestigatorService,
  PlanInvestigationError,
} from "./planInvestigatorService";
import { createPlanTaskProfile } from "./plannerKernel";

describe("plan investigator service", () => {
  it("runs an isolated read-only plan loop and persists model-visible evidence refs", async () => {
    let observedSystemPrompt = "";
    let observedRunMode = "";
    let observedSandboxMode = "";
    let observedContextWindow: number | undefined;
    let observedContextWindowSource: unknown;
    const registry = {
      getVisibleDefinitions(filter: { runMode?: string }) {
        observedRunMode = filter.runMode ?? "";
        return [
          {
            type: "function" as const,
            function: {
              name: "file_read",
              description: "Read file",
              parameters: {
                type: "object",
                properties: { path: { type: "string" } },
                required: ["path"],
              },
            },
          },
        ];
      },
    } as unknown as DynamicToolRegistry;
    const executor: AgentToolExecutor = {
      getRegistry: () => registry,
      hasTool: (name) => name === "file_read",
      async execute() {
        return {
          ok: true,
          result: {
            path: "/workspace/README.md",
            content: "# Workspace",
          },
        };
      },
    };
    const runLoop = vi.fn(
      async (
        _messages: Parameters<
          NonNullable<
            Parameters<typeof createPlanInvestigatorService>[0]["runLoop"]
          >
        >[0],
        _profile: Parameters<
          NonNullable<
            Parameters<typeof createPlanInvestigatorService>[0]["runLoop"]
          >
        >[1],
        options: Parameters<
          NonNullable<
            Parameters<typeof createPlanInvestigatorService>[0]["runLoop"]
          >
        >[2],
      ) => {
        observedSystemPrompt = options.systemPrompt ?? "";
        observedSandboxMode = options.runContext?.sandbox.mode ?? "";
        observedContextWindow = _profile.contextWindow;
        observedContextWindowSource = _profile.contextWindowSource;
        const event = { toolCallId: "call-1", runId: options.runId };
        options.onToolCall?.(
          "file_read",
          { path: "README.md" },
          event,
        );
        const result = await options.toolExecutor.execute(
          { toolName: "file_read", args: { path: "README.md" } },
          { runContext: options.runContext },
        );
        options.onToolResult?.("file_read", result.ok, result, event);
        const evidenceRef =
          result.ok && typeof result.result.planningEvidenceRef === "string"
            ? result.result.planningEvidenceRef
            : "";
        return {
          summary: JSON.stringify({
            objective: "理解工作区",
            deliverables: ["调查摘要"],
            inScope: ["README"],
            outOfScope: ["修改文件"],
            constraints: ["只读"],
            assumptions: [],
            unresolvedQuestions: ["文稿保存目录和命名规则是什么？"],
            targetRefs: ["README.md"],
            evidenceRefs: ["evidence_user_request", evidenceRef],
            skillCandidates: [],
          }),
          status: "succeeded" as const,
          turns: 2,
          messages: [],
          toolCallsExecuted: 1,
          tokensConsumed: 50,
        };
      },
    );
    const service = createPlanInvestigatorService({
      toolExecutor: executor,
      toolAuthorizationService: {} as ToolAuthorizationService,
      discoverSkills: async () => ({ skills: [], errors: [] }),
      runLoop,
      createId: (() => {
        let id = 0;
        return () => `id-${++id}`;
      })(),
      now: () => "2026-07-31T00:00:00.000Z",
    });

    const result = await service.investigate({
      planId: "plan-1",
      sessionId: "session-1",
      workspaceRoot: "/workspace",
      sourceMessage: "分析 README",
      autonomyMode: "auto",
      profile: createPlanTaskProfile("分析 README"),
      baseEvidence: [
        {
          id: "evidence_user_request",
          kind: "user",
          title: "用户需求",
          summary: "分析 README",
        },
      ],
      model: model(),
    });

    expect(observedRunMode).toBe("plan");
    expect(observedSandboxMode).toBe("read_only");
    expect(observedContextWindow).toBe(128_000);
    expect(observedContextWindowSource).toEqual({
      kind: "public_catalog",
      label: "Zerox 公开模型目录",
      checkedAt: "2026-08-16T00:00:00.000Z",
    });
    expect(observedSystemPrompt).toContain("planningEvidenceRef");
    expect(observedSystemPrompt).toContain("本次 Goal 已开启自动模式");
    expect(
      result.evidence.some((item) =>
        item.id.startsWith("evidence_tool_"),
      ),
    ).toBe(true);
    expect(result.brief.evidenceRefs).toEqual(
      expect.arrayContaining([
        "evidence_user_request",
        expect.stringMatching(/^evidence_tool_/),
      ]),
    );
    expect(result.brief.unresolvedQuestions).toEqual([]);
    expect(result.brief.assumptions).toEqual([
      expect.stringContaining("自动模式决策"),
    ]);
    expect(result.stage).toMatchObject({
      kind: "investigation",
      status: "completed",
    });
  });

  it("projects initial evidence into the discovered model budget before the first request", async () => {
    let prompt: Record<string, unknown> | undefined;
    const registry = {
      getVisibleDefinitions() {
        return [];
      },
    } as unknown as DynamicToolRegistry;
    const service = createPlanInvestigatorService({
      toolExecutor: {
        getRegistry: () => registry,
        hasTool: () => false,
        async execute() {
          throw new Error("no tools expected");
        },
      },
      toolAuthorizationService: {} as ToolAuthorizationService,
      discoverSkills: async () => ({ skills: [], errors: [] }),
      runLoop: async (messages) => {
        prompt = JSON.parse(messages[0]!.content) as Record<string, unknown>;
        return {
          summary: JSON.stringify({
            objective: "在预算内调查",
            deliverables: ["规划摘要"],
            inScope: ["工作区"],
            outOfScope: ["写操作"],
            constraints: ["只读"],
            assumptions: [],
            unresolvedQuestions: [],
            targetRefs: ["README.md"],
            evidenceRefs: ["evidence_user_request"],
            skillCandidates: [],
          }),
          status: "succeeded",
          turns: 1,
          messages: [],
          toolCallsExecuted: 0,
          tokensConsumed: 20,
        };
      },
      now: () => "2026-08-16T00:00:00.000Z",
    });
    const boundedModel = model();
    boundedModel.binding.contextWindow = 12_000;

    await service.investigate({
      planId: "plan-bounded-prompt",
      sessionId: "session-bounded-prompt",
      workspaceRoot: "/workspace",
      sourceMessage: "保留这条完整用户目标",
      profile: createPlanTaskProfile("保留这条完整用户目标"),
      baseEvidence: [
        {
          id: "evidence_user_request",
          kind: "user",
          title: "用户需求",
          summary: "u".repeat(40_000),
        },
        ...Array.from({ length: 24 }, (_, index) => ({
          id: `evidence_large_${index}`,
          kind: "workspace" as const,
          title: `大型证据 ${index}`,
          summary: "x".repeat(12_000),
        })),
      ],
      model: boundedModel,
    });

    expect(prompt?.sourceMessage).toBe("保留这条完整用户目标");
    expect(
      (prompt?.baseEvidence as Array<{ id: string }>).map((item) => item.id),
    ).toContain("evidence_user_request");
    expect(
      (
        prompt?.baseEvidence as Array<{ id: string; summary: string }>
      ).find((item) => item.id === "evidence_user_request")?.summary.length,
    ).toBeLessThanOrEqual(512);
    expect(
      (
        prompt?.investigationPolicy as {
          omittedEvidenceCount: number;
        }
      ).omittedEvidenceCount,
    ).toBeGreaterThan(0);
    expect(JSON.stringify(prompt).length).toBeLessThan(30_000);
  });

  it("escalates evidence-poor investigation with distinct recoverable runs and redacts secrets", async () => {
    const registry = {
      getVisibleDefinitions(filter: { allowedNames?: string[] }) {
        return (filter.allowedNames ?? []).map((name) => ({
          type: "function" as const,
          function: {
            name,
            description: name,
            parameters: { type: "object", properties: {} },
          },
        }));
      },
    } as unknown as DynamicToolRegistry;
    const executor: AgentToolExecutor = {
      getRegistry: () => registry,
      hasTool: () => true,
      async execute() {
        return {
          ok: true,
          result: {
            path: "/workspace/.env",
            content: 'OPENAI_API_KEY="sk-super-secret-value"',
            password: "do-not-persist",
          },
        };
      },
    };
    const stageUpdates: Array<{
      runId: string;
      status: string;
      depth?: string;
    }> = [];
    let attempt = 0;
    const runLoop = vi.fn(
      async (
        _messages: Parameters<
          NonNullable<
            Parameters<typeof createPlanInvestigatorService>[0]["runLoop"]
          >
        >[0],
        _profile: Parameters<
          NonNullable<
            Parameters<typeof createPlanInvestigatorService>[0]["runLoop"]
          >
        >[1],
        options: Parameters<
          NonNullable<
            Parameters<typeof createPlanInvestigatorService>[0]["runLoop"]
          >
        >[2],
      ) => {
        attempt += 1;
        let evidenceRefs = ["evidence_user_request"];
        if (attempt === 2) {
          const event = { toolCallId: "call-secret", runId: options.runId };
          options.onToolCall?.(
            "file_read",
            { path: "/workspace/.env" },
            event,
          );
          const result = await options.toolExecutor.execute(
            {
              toolName: "file_read",
              args: { path: "/workspace/.env" },
            },
            { runContext: options.runContext },
          );
          options.onToolResult?.("file_read", result.ok, result, event);
          evidenceRefs = [
            ...evidenceRefs,
            String(result.ok ? result.result.planningEvidenceRef : ""),
          ];
        }
        return {
          summary: JSON.stringify({
            objective: "检查配置文档",
            deliverables: ["调查摘要"],
            inScope: ["工作区"],
            outOfScope: ["修改"],
            constraints: ["只读"],
            assumptions: [],
            unresolvedQuestions: [],
            targetRefs: [".env"],
            evidenceRefs,
            skillCandidates: [],
          }),
          status: "succeeded" as const,
          turns: 1,
          messages: [],
          toolCallsExecuted: attempt === 2 ? 1 : 0,
          tokensConsumed: 20,
        };
      },
    );
    const service = createPlanInvestigatorService({
      toolExecutor: executor,
      toolAuthorizationService: {} as ToolAuthorizationService,
      discoverSkills: async () => ({ skills: [], errors: [] }),
      runLoop,
      createId: (() => {
        let id = 0;
        return () => `escalation-${++id}`;
      })(),
      now: () => "2026-07-31T00:00:00.000Z",
    });

    const result = await service.investigate({
      planId: "plan-escalation",
      sessionId: "session-escalation",
      workspaceRoot: "/workspace",
      sourceMessage: "解释这份配置文档",
      profile: createPlanTaskProfile("解释这份配置文档"),
      baseEvidence: [
        {
          id: "evidence_user_request",
          kind: "user",
          title: "用户需求",
          summary: "解释这份配置文档",
        },
      ],
      model: model(),
      async onStageUpdate(stage) {
        stageUpdates.push({
          runId: stage.runId,
          status: stage.status,
          depth: stage.investigationDepth,
        });
      },
    });

    expect(runLoop).toHaveBeenCalledTimes(2);
    expect(result.depth).toBe("standard");
    expect(result.stages).toHaveLength(2);
    expect(new Set(result.stages.map((stage) => stage.runId)).size).toBe(2);
    expect(stageUpdates.map((stage) => stage.status)).toEqual([
      "running",
      "completed",
      "running",
      "completed",
    ]);
    const secretEvidence = result.evidence.find(
      (item) => item.sourceRef === "/workspace/.env",
    );
    expect(secretEvidence?.summary).toContain(
      "SENSITIVE FILE CONTENT OMITTED",
    );
    expect(secretEvidence?.summary).not.toContain("super-secret");
    expect(secretEvidence?.summary).not.toContain("do-not-persist");
    expect(secretEvidence?.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fails closed and records a recoverable stage when PlanningBrief is malformed", async () => {
    const registry = {
      getVisibleDefinitions() {
        return [];
      },
    } as unknown as DynamicToolRegistry;
    const executor: AgentToolExecutor = {
      getRegistry: () => registry,
      hasTool: () => false,
      async execute() {
        throw new Error("no tools expected");
      },
    };
    const stageStatuses: string[] = [];
    const service = createPlanInvestigatorService({
      toolExecutor: executor,
      toolAuthorizationService: {} as ToolAuthorizationService,
      discoverSkills: async () => ({ skills: [], errors: [] }),
      runLoop: async () => ({
        summary: JSON.stringify({
          objective: "缺少必需数组的非法调查结果",
        }),
        status: "succeeded",
        turns: 1,
        messages: [],
        toolCallsExecuted: 0,
        tokensConsumed: 10,
      }),
      createId: (() => {
        let id = 0;
        return () => `malformed-${++id}`;
      })(),
      now: () => "2026-07-31T00:00:00.000Z",
    });

    const investigation = service.investigate({
      planId: "plan-malformed",
      sessionId: "session-malformed",
      workspaceRoot: "/workspace",
      sourceMessage: "分析工作区",
      profile: createPlanTaskProfile("分析工作区"),
      baseEvidence: [
        {
          id: "evidence_user_request",
          kind: "user",
          title: "用户需求",
          summary: "分析工作区",
        },
      ],
      model: model(),
      async onStageUpdate(stage) {
        stageStatuses.push(stage.status);
      },
    });

    await expect(investigation).rejects.toBeInstanceOf(
      PlanInvestigationError,
    );
    expect(stageStatuses).toEqual(["running", "failed"]);
  });

  it("losslessly canonicalizes a scalar Skill evidence ref without re-sampling the model", async () => {
    const registry = {
      getVisibleDefinitions() {
        return [];
      },
    } as unknown as DynamicToolRegistry;
    let repairCalls = 0;
    const scalarModel = model();
    scalarModel.client = {
      async complete() {
        repairCalls += 1;
        throw new Error("canonicalization should not call the model");
      },
      async *streamComplete() {
        yield { type: "done" as const, finishReason: "stop" };
      },
    };
    const service = createPlanInvestigatorService({
      toolExecutor: {
        getRegistry: () => registry,
        hasTool: () => false,
        async execute() {
          throw new Error("no tools expected");
        },
      },
      toolAuthorizationService: {} as ToolAuthorizationService,
      discoverSkills: async () => ({ skills: [], errors: [] }),
      runLoop: async () => ({
        summary: JSON.stringify({
          objective: "理解工作区",
          deliverables: ["调查摘要"],
          inScope: ["README"],
          outOfScope: ["修改文件"],
          constraints: ["只读"],
          assumptions: [],
          unresolvedQuestions: [],
          targetRefs: ["README.md"],
          evidenceRefs: ["evidence_user_request"],
          skillCandidates: [
            {
              name: "not-installed",
              reason: "候选项",
              evidenceRefs: "evidence_user_request",
            },
          ],
        }),
        status: "succeeded",
        turns: 1,
        messages: [],
        toolCallsExecuted: 0,
        tokensConsumed: 10,
      }),
    });

    const result = await service.investigate({
      planId: "plan-scalar-canonicalization",
      sessionId: "session-scalar-canonicalization",
      workspaceRoot: "/workspace",
      sourceMessage: "分析工作区",
      profile: createPlanTaskProfile("分析工作区"),
      baseEvidence: [
        {
          id: "evidence_user_request",
          kind: "user",
          title: "用户需求",
          summary: "分析工作区",
        },
      ],
      model: scalarModel,
    });

    expect(result.stage.status).toBe("completed");
    expect(result.stage.revisionAttempted).toBeUndefined();
    expect(result.brief.skillCandidates).toEqual([]);
    expect(repairCalls).toBe(0);
  });

  it("repairs malformed structured output with a bounded model retry", async () => {
    const registry = {
      getVisibleDefinitions() {
        return [];
      },
    } as unknown as DynamicToolRegistry;
    const executor: AgentToolExecutor = {
      getRegistry: () => registry,
      hasTool: () => false,
      async execute() {
        throw new Error("no tools expected");
      },
    };
    const validBrief = JSON.stringify({
      objective: "理解工作区",
      deliverables: ["调查摘要"],
      inScope: ["README"],
      outOfScope: ["修改文件"],
      constraints: ["只读"],
      assumptions: [],
      unresolvedQuestions: [],
      targetRefs: ["README.md"],
      evidenceRefs: ["evidence_user_request"],
      skillCandidates: [],
    });
    // Missing closing braces and an unescaped quote — the exact failure
    // class observed in production ("Expected ',' or '}' after property
    // value in JSON").
    const brokenSummary = `{"objective": "理解工作区", "deliverables": ["调查摘要"], "inScope": ["README"], "outOfScope": ["修改文件"], "constraints": ["只读"], "assumptions": [], "unresolvedQuestions": [], "targetRefs": ["README.md"], "evidenceRefs": ["evidence_user_request"], "skillCandidates": []`;
    const repairRequests: Array<{ messages: unknown }> = [];
    const repairModel = model();
    repairModel.client = {
      async complete(request) {
        repairRequests.push(request);
        return {
          content: validBrief,
          toolCalls: [],
          finishReason: "stop",
        };
      },
      async *streamComplete() {
        yield { type: "done" as const, finishReason: "stop" };
      },
    };
    const stageStatuses: string[] = [];
    const service = createPlanInvestigatorService({
      toolExecutor: executor,
      toolAuthorizationService: {} as ToolAuthorizationService,
      discoverSkills: async () => ({ skills: [], errors: [] }),
      runLoop: async () => ({
        summary: brokenSummary,
        status: "succeeded",
        turns: 1,
        messages: [],
        toolCallsExecuted: 0,
        tokensConsumed: 10,
      }),
      createId: (() => {
        let id = 0;
        return () => `repair-${++id}`;
      })(),
      now: () => "2026-07-31T00:00:00.000Z",
    });

    const result = await service.investigate({
      planId: "plan-repair",
      sessionId: "session-repair",
      workspaceRoot: "/workspace",
      sourceMessage: "分析工作区",
      profile: createPlanTaskProfile("分析工作区"),
      baseEvidence: [
        {
          id: "evidence_user_request",
          kind: "user",
          title: "用户需求",
          summary: "分析工作区",
        },
      ],
      model: repairModel,
      async onStageUpdate(stage) {
        stageStatuses.push(stage.status);
      },
    });

    expect(result.brief.objective).toBe("理解工作区");
    expect(stageStatuses).toEqual(["running", "completed"]);
    expect(repairRequests).toHaveLength(1);
    // Repair completions regenerate the whole brief, so they run with an
    // escalated output budget (4096 profile → 16384) to avoid truncating
    // the repair the same way the original was truncated.
    expect(repairRequests[0]).toMatchObject({ maxTokens: 16384 });
    const repairMessages = repairRequests[0]?.messages as Array<{
      role: string;
      content: string;
    }>;
    expect(repairMessages[2]).toMatchObject({
      role: "assistant",
      content: brokenSummary,
    });
    expect(repairMessages[3]?.content).toContain(
      "PlanningBrief 结构化合同校验",
    );
    expect(result.stage.revisionAttempted).toBe(true);
  });

  it("still fails closed when structured-output repairs are exhausted", async () => {
    const secret = "sk-proj-sixth-round-investigator-secret-123456";
    const registry = {
      getVisibleDefinitions() {
        return [];
      },
    } as unknown as DynamicToolRegistry;
    const executor: AgentToolExecutor = {
      getRegistry: () => registry,
      hasTool: () => false,
      async execute() {
        throw new Error("no tools expected");
      },
    };
    let repairAttempts = 0;
    const repairModel = model();
    repairModel.client = {
      async complete() {
        repairAttempts += 1;
        return {
          content: `still not json at all api_key=${secret}`,
          toolCalls: [],
          finishReason: "stop",
          usage: { inputTokens: 7, outputTokens: 3 },
        };
      },
      async *streamComplete() {
        yield { type: "done" as const, finishReason: "stop" };
      },
    };
    const stageStatuses: string[] = [];
    let failedExcerpt = "";
    let failedRepairAttempted = false;
    const service = createPlanInvestigatorService({
      toolExecutor: executor,
      toolAuthorizationService: {} as ToolAuthorizationService,
      discoverSkills: async () => ({ skills: [], errors: [] }),
      runLoop: async () => ({
        summary: "{broken json",
        status: "succeeded",
        turns: 1,
        messages: [],
        toolCallsExecuted: 0,
        tokensConsumed: 10,
      }),
      createId: (() => {
        let id = 0;
        return () => `exhaust-${++id}`;
      })(),
      now: () => "2026-07-31T00:00:00.000Z",
    });

    const investigation = service.investigate({
      planId: "plan-repair-exhausted",
      sessionId: "session-repair-exhausted",
      workspaceRoot: "/workspace",
      sourceMessage: "分析工作区",
      profile: createPlanTaskProfile("分析工作区"),
      baseEvidence: [
        {
          id: "evidence_user_request",
          kind: "user",
          title: "用户需求",
          summary: "分析工作区",
        },
      ],
      model: repairModel,
      async onStageUpdate(stage) {
        stageStatuses.push(stage.status);
        if (stage.status === "failed") {
          failedExcerpt = stage.failureExcerpt ?? "";
          failedRepairAttempted = stage.revisionAttempted === true;
        }
      },
    });

    await expect(investigation).rejects.toBeInstanceOf(
      PlanInvestigationError,
    );
    expect(repairAttempts).toBe(1);
    expect(stageStatuses).toEqual(["running", "failed"]);
    expect(failedExcerpt).toContain("still not json at all");
    expect(failedExcerpt).toContain("[redacted]");
    expect(failedExcerpt).not.toContain(secret);
    expect(failedRepairAttempted).toBe(true);
    const failure = (await investigation.catch((error) => error)) as
      | PlanInvestigationError
      | undefined;
    expect(failure).toBeInstanceOf(PlanInvestigationError);
    expect(failure?.message).not.toContain(secret);
    expect(failure?.stages.at(-1)?.usage).toMatchObject({
      inputTokens: 7,
      outputTokens: 13,
      estimated: true,
    });
  });

  it("surfaces the provider notice instead of an internal continuation reason", async () => {
    const providerMessage = "模型服务商正在限流，请稍后由你手动重试。";
    const stageErrors: string[] = [];
    const registry = {
      getVisibleDefinitions() {
        return [];
      },
    } as unknown as DynamicToolRegistry;
    const service = createPlanInvestigatorService({
      toolExecutor: {
        getRegistry: () => registry,
        hasTool: () => false,
        async execute() {
          throw new Error("no tools expected");
        },
      },
      toolAuthorizationService: {} as ToolAuthorizationService,
      discoverSkills: async () => ({ skills: [], errors: [] }),
      runLoop: async () => ({
        summary: "internal continuation detail",
        status: "paused",
        turns: 1,
        messages: [],
        toolCallsExecuted: 0,
        continuation: {
          reason: "provider_rate_limit",
          maxTurns: 4,
          toolCallsExecuted: 0,
        },
        modelServiceNotice: {
          kind: "rate_limit",
          provider: "deepseek",
          model: "deepseek-v4-flash",
          statusCode: 429,
          message: providerMessage,
        },
      }),
      now: () => "2026-07-31T00:00:00.000Z",
    });

    const investigation = service.investigate({
      planId: "plan-provider-limit",
      sessionId: "session-provider-limit",
      workspaceRoot: "/workspace",
      sourceMessage: "分析工作区",
      profile: createPlanTaskProfile("分析工作区"),
      baseEvidence: [
        {
          id: "evidence_user_request",
          kind: "user",
          title: "用户需求",
          summary: "分析工作区",
        },
      ],
      model: model(),
      async onStageUpdate(stage) {
        if (stage.error) stageErrors.push(stage.error);
      },
    });

    await expect(investigation).rejects.toMatchObject({
      message: providerMessage,
    });
    expect(stageErrors).toEqual([providerMessage]);
  });
});

function model(): BoundModelClient {
  return {
    binding: {
      profileId: "planner",
      connectionId: "connection",
      providerKind: "openai",
      modelId: "planner-model",
      contextWindow: 128_000,
      contextWindowSource: {
        kind: "public_catalog",
        label: "Zerox 公开模型目录",
        checkedAt: "2026-08-16T00:00:00.000Z",
      },
      revision: 1,
      connectionRevision: 1,
      profileRevision: 1,
      capabilities: {
        tools: true,
        vision: false,
        pdf: false,
        streaming: true,
        parallelToolCalls: true,
      },
      generation: {
        temperature: 0.2,
        maxTokens: 4096,
        thinkingEnabled: false,
        thinkingBudgetTokens: 1024,
      },
    },
    client: {
      async complete() {
        throw new Error("runLoop stub should own model calls");
      },
      async *streamComplete() {
        yield { type: "done" as const, finishReason: "stop" };
      },
    },
  };
}
