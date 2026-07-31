import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ResolvedModelBinding,
} from "../shared/modelSettings";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
} from "./openAiCompatibleClient";
import { createPlanArtifactWriter } from "./planArtifactWriter";
import { createPlanDebateOrchestrator } from "./planDebateOrchestrator";
import { createPlanStore } from "./planStore";
import type {
  BoundModelClient,
  ModelRouter,
} from "./providers/modelRouter";

describe("plan debate orchestrator", () => {
  let tempDir: string;
  let workspaceRoot: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "zerox-plan-debate-"));
    workspaceRoot = path.join(tempDir, "workspace");
    await mkdir(workspaceRoot, { recursive: true });
    await writeFile(
      path.join(workspaceRoot, "AGENTS.md"),
      "# Test workspace\n",
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("enforces A1 → B1 → A2 → B2 → C with isolated calls and one terminal projection", async () => {
    const calls: Array<{ profileId: string; request: ChatCompletionRequest }> =
      [];
    const router = createQueuedRouter(
      {
        profileA: [proposal("A1"), revisedProposal("A2")],
        profileB: [critique("B1"), critique("B2")],
        profileC: [artifact("C Final")],
      },
      calls,
    );
    let id = 0;
    const store = createPlanStore({
      configDir: path.join(tempDir, "config"),
      createId: () => `store_${++id}`,
    });
    const orchestrator = createPlanDebateOrchestrator({
      planStore: store,
      artifactWriter: createPlanArtifactWriter({
        now: () => "2026-07-30T08:00:00.000Z",
      }),
      modelRouter: router,
      createId: () => `runtime_${++id}`,
      now: () => "2026-07-30T08:00:00.000Z",
    });

    const plan = await orchestrator.createPlan({
      sessionId: "session-1",
      workspaceRoot,
      sourceMessage: "实现一个经过审查的本地功能。",
      mode: "debate",
      modelAssignments: {
        a: "profileA",
        b: "profileB",
        c: "profileC",
      },
    });

    expect(plan.status).toBe("awaiting_confirmation");
    expect(plan.actionGate).toBe("ready");
    expect(
      plan.rounds
        .filter((round) => round.status === "completed")
        .map((round) => round.kind),
    ).toEqual(["a1", "b1", "a2", "b2", "c"]);
    expect(plan.rounds.filter((round) => round.role === "a")).toHaveLength(2);
    expect(plan.rounds.filter((round) => round.role === "b")).toHaveLength(2);
    expect(new Set(plan.rounds.map((round) => round.runId)).size).toBe(5);
    expect(calls.map((call) => call.profileId)).toEqual([
      "profileA",
      "profileB",
      "profileA",
      "profileB",
      "profileC",
    ]);
    expect(
      calls.every((call) => call.request.messages.length === 2),
    ).toBe(true);
    const cInput = String(calls.at(-1)?.request.messages[1]?.content);
    expect(cInput).toContain('"a1"');
    expect(cInput).toContain('"b2"');
    expect(cInput).not.toContain("profileA");
    expect(cInput).not.toContain("runId");
    expect(plan.finalArtifact?.minorityOpinion).toEqual([
      "保留一次人工回滚演练。",
    ]);
    expect(plan.projection?.path).toBe(
      path.join(
        await realpath(workspaceRoot),
        ".zerox",
        "plans",
        `${plan.id}.md`,
      ),
    );
    const markdown = await readFile(plan.projection!.path, "utf8");
    expect(markdown).toContain("# C Final");
    expect(markdown).toContain("## 里程碑");
    expect(plan.finalArtifact?.markdown).toBe(markdown);
  });

  it("does not collect evidence through workspace symlinks that escape the root", async () => {
    const outsideReadme = path.join(tempDir, "outside-secret.md");
    await writeFile(outsideReadme, "OUTSIDE_SECRET_MUST_NOT_BE_READ\n");
    await symlink(outsideReadme, path.join(workspaceRoot, "README.md"));
    const router = createQueuedRouter(
      {
        profileDirect: [artifact("Symlink-safe plan")],
      },
      [],
    );
    const orchestrator = createPlanDebateOrchestrator({
      planStore: createPlanStore({
        configDir: path.join(tempDir, "config"),
      }),
      artifactWriter: createPlanArtifactWriter(),
      modelRouter: router,
    });

    const plan = await orchestrator.createPlan({
      sessionId: "session-symlink",
      workspaceRoot,
      sourceMessage: "生成只读计划。",
      mode: "direct",
      modelAssignments: { direct: "profileDirect" },
    });

    expect(plan.evidence.map((item) => item.title)).not.toContain("README.md");
    expect(JSON.stringify(plan.evidence)).not.toContain(
      "OUTSIDE_SECRET_MUST_NOT_BE_READ",
    );
  });

  it("snapshots the selected Skill as bounded read-only planning context", async () => {
    const calls: Array<{ profileId: string; request: ChatCompletionRequest }> =
      [];
    const router = createQueuedRouter(
      { profileDirect: [artifact("Skill-aware plan")] },
      calls,
    );
    const orchestrator = createPlanDebateOrchestrator({
      planStore: createPlanStore({
        configDir: path.join(tempDir, "config"),
      }),
      artifactWriter: createPlanArtifactWriter(),
      modelRouter: router,
    });

    const plan = await orchestrator.createPlan({
      sessionId: "session-selected-skill",
      workspaceRoot,
      sourceMessage: "使用指定 Skill 规划本地功能。",
      selectedSkill: {
        rootDir: path.join(tempDir, "skills", "dbs"),
        skillFile: path.join(tempDir, "skills", "dbs", "SKILL.md"),
        body: "DBS_SKILL_PLANNING_CONTEXT",
        manifest: {
          name: "dbs",
          displayName: "DBS",
          description: "Structured database workflow",
          version: "1.0.0",
          execution: { mode: "agent", entrypoint: null },
          inputs: [
            {
              name: "target",
              label: "Target",
              type: "string",
              required: true,
            },
          ],
          permissions: {
            files: { read: [], write: [] },
            shell: { commands: [] },
            web: { search: false, fetchDomains: [] },
            memory: { read: false, write: false },
          },
        },
      },
      mode: "direct",
      modelAssignments: { direct: "profileDirect" },
    });

    expect(plan.selectedSkill?.manifest.name).toBe("dbs");
    expect(plan.evidence).toContainEqual(
      expect.objectContaining({
        id: "evidence_selected_skill",
        kind: "skill",
      }),
    );
    expect(calls[0]?.request.messages[1]?.content).toContain(
      "DBS_SKILL_PLANNING_CONTEXT",
    );
  });

  it("pauses on a failed role and retries it with a replacement model while invalidating downstream output", async () => {
    const calls: Array<{ profileId: string; request: ChatCompletionRequest }> =
      [];
    const router = createQueuedRouter(
      {
        profileA: [proposal("A1"), revisedProposal("A2")],
        profileB: [new Error("B provider unavailable")],
        replacementB: [critique("B1 replacement"), critique("B2 replacement")],
        profileC: [artifact("Recovered Final")],
      },
      calls,
    );
    let id = 0;
    const store = createPlanStore({
      configDir: path.join(tempDir, "config"),
      createId: () => `event_${++id}`,
    });
    const orchestrator = createPlanDebateOrchestrator({
      planStore: store,
      artifactWriter: createPlanArtifactWriter(),
      modelRouter: router,
      createId: () => `id_${++id}`,
    });
    const paused = await orchestrator.createPlan({
      sessionId: "session-2",
      workspaceRoot,
      sourceMessage: "实现失败可恢复的计划。",
      mode: "debate",
      modelAssignments: {
        a: "profileA",
        b: "profileB",
        c: "profileC",
      },
    });
    expect(paused.status).toBe("paused");
    expect(
      paused.rounds.find((round) => round.kind === "b1"),
    ).toMatchObject({
      status: "failed",
      error: "B provider unavailable",
    });

    const result = await orchestrator.retryFailedRound(
      paused.id,
      "replacementB",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.status).toBe("awaiting_confirmation");
    expect(
      result.plan.rounds.find(
        (round) =>
          round.kind === "b1" &&
          round.status === "completed",
      )?.modelBinding.profileId,
    ).toBe("replacementB");
    expect(
      result.plan.rounds.some(
        (round) => round.kind === "b1" && round.status === "invalidated",
      ),
    ).toBe(true);
    expect(result.plan.requestedModelAssignments.b).toBe("replacementB");
    expect(result.plan.frozenModelAssignments.a?.profileId).toBe("profileA");
  });

  it("publishes an explicit output contract and accepts a common wrapped plan object", async () => {
    const calls: Array<{ profileId: string; request: ChatCompletionRequest }> =
      [];
    const router = createQueuedRouter(
      {
        profileDirect: [{ plan: artifact("Wrapped Final") }],
      },
      calls,
    );
    let id = 0;
    const orchestrator = createPlanDebateOrchestrator({
      planStore: createPlanStore({
        configDir: path.join(tempDir, "config"),
        createId: () => `event_${++id}`,
      }),
      artifactWriter: createPlanArtifactWriter(),
      modelRouter: router,
      createId: () => `id_${++id}`,
    });

    const plan = await orchestrator.createPlan({
      sessionId: "session-wrapped",
      workspaceRoot,
      sourceMessage: "生成一个结构化计划。",
      mode: "direct",
      modelAssignments: { direct: "profileDirect" },
    });

    expect(plan.status).toBe("awaiting_confirmation");
    expect(plan.finalArtifact?.title).toBe("Wrapped Final");
    const systemPrompt = calls[0]?.request.messages[0]?.content ?? "";
    expect(systemPrompt).toContain('"objective":"明确、可验证的目标"');
    expect(systemPrompt).toContain('"milestones"');
    expect(systemPrompt).toContain("不要把结果包装在");
  });

  it("regenerates an awaiting-input plan from user clarification without reusing prior rounds", async () => {
    const calls: Array<{ profileId: string; request: ChatCompletionRequest }> =
      [];
    const router = createQueuedRouter(
      {
        profileDirect: [
          {
            ...artifact("Needs Input"),
            unresolvedQuestions: ["DBS 的接口地址是什么？"],
            actionGate: "needs_input",
            gateReason: "需要用户补充 DBS 接口信息。",
          },
          artifact("Clarified Final"),
        ],
      },
      calls,
    );
    let id = 0;
    const store = createPlanStore({
      configDir: path.join(tempDir, "config"),
      createId: () => `event_${++id}`,
    });
    const orchestrator = createPlanDebateOrchestrator({
      planStore: store,
      artifactWriter: createPlanArtifactWriter(),
      modelRouter: router,
      createId: () => `id_${++id}`,
    });

    const awaitingInput = await orchestrator.createPlan({
      sessionId: "session-clarification",
      workspaceRoot,
      sourceMessage: "生成一个调用 DBS skill 的计划。",
      mode: "direct",
      modelAssignments: { direct: "profileDirect" },
    });

    expect(awaitingInput.status).toBe("awaiting_input");
    expect(
      await orchestrator.getInputRoutingPlan("session-clarification"),
    ).toMatchObject({ id: awaitingInput.id });

    const restartedStore = createPlanStore({
      configDir: path.join(tempDir, "config"),
      createId: () => `restart_event_${++id}`,
    });
    const restartedOrchestrator = createPlanDebateOrchestrator({
      planStore: restartedStore,
      artifactWriter: createPlanArtifactWriter(),
      modelRouter: router,
      createId: () => `restart_id_${++id}`,
    });
    expect(
      await restartedOrchestrator.getInputRoutingPlan(
        "session-clarification",
      ),
    ).toMatchObject({ id: awaitingInput.id });

    const result = await restartedOrchestrator.continueWithInput(
      awaitingInput.id,
      "DBS 就是当前技能列表里的 dbs skill，其他实现细节由你决定。",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.status).toBe("awaiting_confirmation");
    expect(result.plan.actionGate).toBe("ready");
    expect(result.plan.finalArtifact?.title).toBe("Clarified Final");
    expect(result.plan.sourceMessage).toContain("用户补充信息");
    expect(result.plan.sourceMessage).toContain("其他实现细节由你决定");
    expect(
      result.plan.rounds.filter((round) => round.status === "invalidated"),
    ).toHaveLength(1);
    expect(
      result.plan.rounds.filter((round) => round.status === "completed"),
    ).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.request.messages[0]?.content).toContain(
      "可以由执行 Agent 从工作区调查",
    );
    expect(calls[1]?.request.messages[1]?.content).toContain(
      "其他实现细节由你决定",
    );
  });

  it("keeps clarification history bounded without recursively embedding old prompts", async () => {
    const outputs = Array.from({ length: 15 }, (_, index) =>
      artifact(`Bounded revision ${index + 1}`),
    );
    const router = createQueuedRouter({ profileDirect: outputs }, []);
    const orchestrator = createPlanDebateOrchestrator({
      planStore: createPlanStore({
        configDir: path.join(tempDir, "config"),
      }),
      artifactWriter: createPlanArtifactWriter(),
      modelRouter: router,
    });
    let plan = await orchestrator.createPlan({
      sessionId: "session-bounded-clarifications",
      workspaceRoot,
      sourceMessage: "Keep this immutable base objective.",
      mode: "direct",
      modelAssignments: { direct: "profileDirect" },
    });

    for (let index = 1; index <= 14; index += 1) {
      const result = await orchestrator.continueWithInput(
        plan.id,
        `clarification-${String(index).padStart(2, "0")}`,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      plan = result.plan;
    }

    expect(plan.baseSourceMessage).toBe("Keep this immutable base objective.");
    expect(plan.clarifications).toHaveLength(12);
    expect(plan.clarifications?.[0]).toBe("clarification-03");
    expect(plan.sourceMessage).not.toContain("clarification-01");
    expect(plan.sourceMessage.match(/用户补充信息/g)).toHaveLength(1);
  });

  it("treats feedback on a ready plan as a new read-only revision", async () => {
    const calls: Array<{ profileId: string; request: ChatCompletionRequest }> =
      [];
    const router = createQueuedRouter(
      {
        profileDirect: [
          artifact("Ready v1"),
          artifact("Ready v2"),
        ],
      },
      calls,
    );
    let id = 0;
    const store = createPlanStore({
      configDir: path.join(tempDir, "config"),
      createId: () => `event_${++id}`,
    });
    const orchestrator = createPlanDebateOrchestrator({
      planStore: store,
      artifactWriter: createPlanArtifactWriter(),
      modelRouter: router,
      createId: () => `id_${++id}`,
    });

    const ready = await orchestrator.createPlan({
      sessionId: "session-ready-feedback",
      workspaceRoot,
      sourceMessage: "生成一个可确认计划。",
      mode: "direct",
      modelAssignments: { direct: "profileDirect" },
    });
    expect(ready.status).toBe("awaiting_confirmation");

    const result = await orchestrator.continueWithInput(
      ready.id,
      "把回滚演练加入验收标准，其他细节由你决定。",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.status).toBe("awaiting_confirmation");
    expect(result.plan.finalArtifact?.title).toBe("Ready v2");
    expect(result.plan.sourceMessage).toContain("把回滚演练加入验收标准");
    expect(
      result.plan.rounds.filter((round) => round.status === "invalidated"),
    ).toHaveLength(1);
    expect(
      result.plan.rounds.filter((round) => round.status === "completed"),
    ).toHaveLength(1);
    expect(result.plan.revision).toBeGreaterThan(ready.revision);
    expect(calls).toHaveLength(2);
  });

  it("does not accept a needs-input gate without an actual user question", async () => {
    const calls: Array<{ profileId: string; request: ChatCompletionRequest }> =
      [];
    const router = createQueuedRouter(
      {
        profileDirect: [
          {
            ...artifact("Phantom input gate"),
            unresolvedQuestions: [],
            actionGate: "needs_input",
            gateReason: "模板默认要求补充信息。",
          },
        ],
      },
      calls,
    );
    let id = 0;
    const orchestrator = createPlanDebateOrchestrator({
      planStore: createPlanStore({
        configDir: path.join(tempDir, "config"),
        createId: () => `event_${++id}`,
      }),
      artifactWriter: createPlanArtifactWriter(),
      modelRouter: router,
      createId: () => `id_${++id}`,
    });

    const plan = await orchestrator.createPlan({
      sessionId: "session-phantom-input",
      workspaceRoot,
      sourceMessage: "实现细节由执行 Agent 自主决定。",
      mode: "direct",
      modelAssignments: { direct: "profileDirect" },
    });

    expect(plan.status).toBe("awaiting_confirmation");
    expect(plan.actionGate).toBe("ready");
    expect(plan.finalArtifact).toMatchObject({
      actionGate: "ready",
      unresolvedQuestions: [],
      gateReason: "没有必须由用户立即回答的关键问题，计划可以进入确认。",
    });
  });

  it("fails closed when the terminal model omits the action gate", async () => {
    const withoutGate = artifact("Missing gate");
    delete withoutGate.actionGate;
    const router = createQueuedRouter(
      { profileDirect: [withoutGate] },
      [],
    );
    const orchestrator = createPlanDebateOrchestrator({
      planStore: createPlanStore({
        configDir: path.join(tempDir, "config"),
      }),
      artifactWriter: createPlanArtifactWriter(),
      modelRouter: router,
    });

    const plan = await orchestrator.createPlan({
      sessionId: "session-missing-gate",
      workspaceRoot,
      sourceMessage: "生成一个必须通过门禁校验的计划。",
      mode: "direct",
      modelAssignments: { direct: "profileDirect" },
    });

    expect(plan.status).toBe("paused");
    expect(plan.actionGate).toBe("blocked");
    expect(plan.finalArtifact).toBeUndefined();
  });

  it("persists cancellation as canceled and never leaves a running round", async () => {
    let completeStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      completeStarted = resolve;
    });
    const binding = bindingFor("profileDirect");
    const router: ModelRouter = {
      async resolve() {
        return {
          binding,
          client: {
            async complete(request) {
              const signal = request.signal;
              completeStarted();
              return new Promise<ChatCompletionResponse>((_resolve, reject) => {
                if (signal?.aborted) {
                  reject(signal.reason);
                  return;
                }
                signal?.addEventListener(
                  "abort",
                  () => reject(signal.reason),
                  { once: true },
                );
              });
            },
            async *streamComplete() {
              yield { type: "done" as const, finishReason: "stop" };
            },
          },
        };
      },
      async resolveFrozen() {
        return this.resolve();
      },
      invalidate() {},
    };
    let id = 0;
    const store = createPlanStore({
      configDir: path.join(tempDir, "config"),
      createId: () => `event_${++id}`,
    });
    const orchestrator = createPlanDebateOrchestrator({
      planStore: store,
      artifactWriter: createPlanArtifactWriter(),
      modelRouter: router,
      createId: () => `id_${++id}`,
    });
    const controller = new AbortController();

    const creating = orchestrator.createPlan({
      sessionId: "session-cancel",
      workspaceRoot,
      sourceMessage: "生成一个随后取消的计划。",
      mode: "direct",
      modelAssignments: { direct: "profileDirect" },
      signal: controller.signal,
    });
    await started;
    controller.abort(new DOMException("用户取消规划。", "AbortError"));

    await expect(creating).rejects.toMatchObject({ name: "AbortError" });
    const [canceled] = await store.listBySession("session-cancel");
    expect(canceled).toMatchObject({
      status: "canceled",
      actionGate: "blocked",
    });
    expect(canceled?.rounds.some((round) => round.status === "running")).toBe(
      false,
    );
    expect(canceled?.rounds).toEqual([
      expect.objectContaining({
        kind: "direct",
        status: "invalidated",
      }),
    ]);
    await expect(
      orchestrator.getInputRoutingPlan("session-cancel"),
    ).resolves.toMatchObject({
      id: canceled?.id,
      status: "canceled",
    });
    await expect(
      orchestrator.discard(canceled!.id, canceled!.revision),
    ).resolves.toMatchObject({
      ok: true,
      plan: { status: "discarded" },
    });
  });

  it("keeps cancellation authoritative when it arrives during projection", async () => {
    let projectionStarted!: () => void;
    let releaseProjection!: () => void;
    const started = new Promise<void>((resolve) => {
      projectionStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseProjection = resolve;
    });
    const baseWriter = createPlanArtifactWriter();
    const calls: Array<{ profileId: string; request: ChatCompletionRequest }> =
      [];
    const router = createQueuedRouter(
      { profileDirect: [artifact("Projection cancellation")] },
      calls,
    );
    let id = 0;
    const store = createPlanStore({
      configDir: path.join(tempDir, "config"),
      createId: () => `event_${++id}`,
    });
    const orchestrator = createPlanDebateOrchestrator({
      planStore: store,
      artifactWriter: {
        async write(plan, artifact) {
          projectionStarted();
          await release;
          return baseWriter.write(plan, artifact);
        },
        verify(plan) {
          return baseWriter.verify(plan);
        },
      },
      modelRouter: router,
      createId: () => `id_${++id}`,
    });
    const controller = new AbortController();

    const creating = orchestrator.createPlan({
      sessionId: "session-cancel-projection",
      workspaceRoot,
      sourceMessage: "生成计划，但在写投影时取消。",
      mode: "direct",
      modelAssignments: { direct: "profileDirect" },
      signal: controller.signal,
    });
    await started;
    controller.abort(new DOMException("用户取消规划。", "AbortError"));
    releaseProjection();

    await expect(creating).rejects.toMatchObject({ name: "AbortError" });
    const [canceled] = await store.listBySession(
      "session-cancel-projection",
    );
    expect(canceled).toMatchObject({
      status: "canceled",
      actionGate: "blocked",
    });
    expect(canceled?.finalArtifact).toBeUndefined();
    expect(canceled?.projection).toBeUndefined();
    expect(canceled?.rounds).toEqual([
      expect.objectContaining({
        kind: "direct",
        status: "completed",
      }),
    ]);
  });

  it("refuses to discard a plan after it has created an execution goal", async () => {
    const calls: Array<{ profileId: string; request: ChatCompletionRequest }> =
      [];
    const router = createQueuedRouter(
      { profileDirect: [artifact("Executed plan")] },
      calls,
    );
    let id = 0;
    const store = createPlanStore({
      configDir: path.join(tempDir, "config"),
      createId: () => `event_${++id}`,
    });
    const orchestrator = createPlanDebateOrchestrator({
      planStore: store,
      artifactWriter: createPlanArtifactWriter(),
      modelRouter: router,
      createId: () => `id_${++id}`,
    });
    const ready = await orchestrator.createPlan({
      sessionId: "session-executed-plan",
      workspaceRoot,
      sourceMessage: "生成一个即将执行的计划。",
      mode: "direct",
      modelAssignments: { direct: "profileDirect" },
    });
    const executed = await store.save(
      {
        ...ready,
        status: "failed",
        actionGate: "blocked",
        executionGoalId: "goal_from_plan",
        executionRunId: "run_from_plan",
      },
      ready.revision,
      "test_execution_failed",
    );

    await expect(
      orchestrator.discard(executed.id, executed.revision),
    ).resolves.toMatchObject({
      ok: false,
      message: "计划已经进入执行，不能丢弃。",
      plan: {
        executionGoalId: "goal_from_plan",
        executionRunId: "run_from_plan",
      },
    });
  });

  it("repairs one non-JSON response inside the same isolated round", async () => {
    const calls: Array<{ profileId: string; request: ChatCompletionRequest }> =
      [];
    const router = createQueuedRouter(
      {
        profileDirect: [
          "我会先解释计划思路，然后再整理结构。",
          artifact("Repaired Final"),
        ],
      },
      calls,
    );
    let id = 0;
    const orchestrator = createPlanDebateOrchestrator({
      planStore: createPlanStore({
        configDir: path.join(tempDir, "config"),
        createId: () => `event_${++id}`,
      }),
      artifactWriter: createPlanArtifactWriter(),
      modelRouter: router,
      createId: () => `id_${++id}`,
    });

    const plan = await orchestrator.createPlan({
      sessionId: "session-repair",
      workspaceRoot,
      sourceMessage: "生成一个结构化计划。",
      mode: "direct",
      modelAssignments: { direct: "profileDirect" },
    });

    expect(plan.status).toBe("awaiting_confirmation");
    expect(plan.finalArtifact?.title).toBe("Repaired Final");
    expect(calls).toHaveLength(2);
    expect(calls[1]?.request.messages).toHaveLength(4);
    expect(calls[1]?.request.messages[2]).toMatchObject({
      role: "assistant",
      content: "我会先解释计划思路，然后再整理结构。",
    });
    expect(calls[1]?.request.messages[3]?.content).toContain(
      "同一轮的格式修复，不是新的方案发言",
    );
    expect(calls[1]?.request.thinking).toEqual({ type: "disabled" });
    expect(plan.rounds.filter((round) => round.status === "completed")).toHaveLength(1);
  });

  it("repairs malformed C inside the same run without replaying A1 through B2", async () => {
    const calls: Array<{ profileId: string; request: ChatCompletionRequest }> =
      [];
    const router = createQueuedRouter(
      {
        profileA: [proposal("A1"), revisedProposal("A2")],
        profileB: [critique("B1"), critique("B2")],
        profileC: ["C returned prose only", artifact("Repaired C")],
      },
      calls,
    );
    const orchestrator = createPlanDebateOrchestrator({
      planStore: createPlanStore({
        configDir: path.join(tempDir, "config"),
      }),
      artifactWriter: createPlanArtifactWriter(),
      modelRouter: router,
    });

    const plan = await orchestrator.createPlan({
      sessionId: "session-c-repair",
      workspaceRoot,
      sourceMessage: "Generate a debated plan with recoverable synthesis.",
      mode: "debate",
      modelAssignments: {
        a: "profileA",
        b: "profileB",
        c: "profileC",
      },
    });

    expect(plan.status).toBe("awaiting_confirmation");
    expect(calls.map((call) => call.profileId)).toEqual([
      "profileA",
      "profileB",
      "profileA",
      "profileB",
      "profileC",
      "profileC",
    ]);
    expect(
      plan.rounds
        .filter((round) => round.status === "completed")
        .map((round) => round.kind),
    ).toEqual(["a1", "b1", "a2", "b2", "c"]);
    expect(new Set(plan.rounds.map((round) => round.runId)).size).toBe(5);
    expect(plan.rounds.filter((round) => round.kind === "c")).toHaveLength(1);
  });

  it("repairs a parseable but incomplete artifact instead of making it confirmable", async () => {
    const calls: Array<{ profileId: string; request: ChatCompletionRequest }> =
      [];
    const router = createQueuedRouter(
      {
        profileDirect: [
          { objective: "Incomplete", milestones: [null] },
          artifact("Strictly repaired"),
        ],
      },
      calls,
    );
    const orchestrator = createPlanDebateOrchestrator({
      planStore: createPlanStore({
        configDir: path.join(tempDir, "config"),
      }),
      artifactWriter: createPlanArtifactWriter(),
      modelRouter: router,
    });

    const plan = await orchestrator.createPlan({
      sessionId: "session-incomplete-artifact",
      workspaceRoot,
      sourceMessage: "Generate a complete plan.",
      mode: "direct",
      modelAssignments: { direct: "profileDirect" },
    });

    expect(calls).toHaveLength(2);
    expect(plan.status).toBe("awaiting_confirmation");
    expect(plan.finalArtifact?.title).toBe("Strictly repaired");
    expect(plan.finalArtifact?.milestones[0]?.acceptanceCriteria).toEqual([
      "测试通过",
    ]);
  });

  it("selects the only round-valid JSON object after unrelated metadata", async () => {
    const calls: Array<{ profileId: string; request: ChatCompletionRequest }> =
      [];
    const content = [
      JSON.stringify({ note: "unrelated metadata" }),
      JSON.stringify(artifact("Valid after metadata")),
    ].join("\n");
    const router = createQueuedRouter({ profileDirect: [content] }, calls);
    const orchestrator = createPlanDebateOrchestrator({
      planStore: createPlanStore({
        configDir: path.join(tempDir, "config"),
      }),
      artifactWriter: createPlanArtifactWriter(),
      modelRouter: router,
    });

    const plan = await orchestrator.createPlan({
      sessionId: "session-json-metadata",
      workspaceRoot,
      sourceMessage: "Generate one valid plan.",
      mode: "direct",
      modelAssignments: { direct: "profileDirect" },
    });

    expect(calls).toHaveLength(1);
    expect(plan.status).toBe("awaiting_confirmation");
    expect(plan.finalArtifact?.title).toBe("Valid after metadata");
  });

  it("extracts a valid object after prose with unrelated braces", async () => {
    const calls: Array<{ profileId: string; request: ChatCompletionRequest }> =
      [];
    const finalArtifact = artifact("Balanced JSON Final");
    const router = createQueuedRouter(
      {
        profileDirect: [
          `格式示例 {not-json}，以下才是终版：\n${JSON.stringify(finalArtifact)}\n完成。`,
        ],
      },
      calls,
    );
    let id = 0;
    const orchestrator = createPlanDebateOrchestrator({
      planStore: createPlanStore({
        configDir: path.join(tempDir, "config"),
        createId: () => `event_${++id}`,
      }),
      artifactWriter: createPlanArtifactWriter(),
      modelRouter: router,
      createId: () => `id_${++id}`,
    });

    const plan = await orchestrator.createPlan({
      sessionId: "session-balanced-json",
      workspaceRoot,
      sourceMessage: "生成一个结构化计划。",
      mode: "direct",
      modelAssignments: { direct: "profileDirect" },
    });

    expect(plan.status).toBe("awaiting_confirmation");
    expect(plan.finalArtifact?.title).toBe("Balanced JSON Final");
    expect(calls).toHaveLength(1);
  });

  it("fails closed after one repair with safe response diagnostics", async () => {
    const calls: Array<{ profileId: string; request: ChatCompletionRequest }> =
      [];
    const router = createQueuedRouter(
      {
        profileDirect: ["first invalid response", "second invalid response"],
      },
      calls,
    );
    let id = 0;
    const orchestrator = createPlanDebateOrchestrator({
      planStore: createPlanStore({
        configDir: path.join(tempDir, "config"),
        createId: () => `event_${++id}`,
      }),
      artifactWriter: createPlanArtifactWriter(),
      modelRouter: router,
      createId: () => `id_${++id}`,
    });

    const plan = await orchestrator.createPlan({
      sessionId: "session-fail-closed",
      workspaceRoot,
      sourceMessage: "生成一个结构化计划。",
      mode: "direct",
      modelAssignments: { direct: "profileDirect" },
    });

    expect(plan.status).toBe("paused");
    expect(calls).toHaveLength(2);
    const error = plan.rounds.find((round) => round.status === "failed")?.error ?? "";
    expect(error).toContain("连续两次未返回可用 JSON 对象");
    expect(error).toContain("finishReason=stop");
    expect(error).toContain("contentLength=23");
    expect(error).toMatch(/contentSha256=[a-f0-9]{16}/);
    expect(error).not.toContain("second invalid response");
  });

  it("reports an output-limit notice without retrying JSON repair or persisting reasoning", async () => {
    let calls = 0;
    const binding = bindingFor("profileDirect");
    const client: BoundModelClient["client"] = {
      async complete() {
        calls += 1;
        return {
          content: null,
          reasoningContent: "private reasoning must not be persisted",
          toolCalls: [],
          finishReason: "length",
          usage: { inputTokens: 120, outputTokens: 4096 },
          modelServiceNotice: {
            kind: "output_limit",
            provider: "test-provider",
            model: "test-model",
            rawReason: "length",
            message: "模型输出达到限制。",
          },
        };
      },
      async *streamComplete() {
        yield { type: "done" as const, finishReason: "length" };
      },
    };
    const router: ModelRouter = {
      async resolve() {
        return { binding, client };
      },
      async resolveFrozen() {
        return { binding, client };
      },
      invalidate() {},
    };
    const orchestrator = createPlanDebateOrchestrator({
      planStore: createPlanStore({
        configDir: path.join(tempDir, "config"),
      }),
      artifactWriter: createPlanArtifactWriter(),
      modelRouter: router,
    });

    const plan = await orchestrator.createPlan({
      sessionId: "session-reasoning-only",
      workspaceRoot,
      sourceMessage: "生成一个结构化计划。",
      mode: "direct",
      modelAssignments: { direct: "profileDirect" },
    });

    expect(calls).toBe(1);
    expect(plan.status).toBe("paused");
    const error =
      plan.rounds.find((round) => round.status === "failed")?.error ?? "";
    expect(error).toContain("模型输出达到限制");
    expect(JSON.stringify(plan)).not.toContain(
      "private reasoning must not be persisted",
    );
  });
});

function createQueuedRouter(
  outputs: Record<string, Array<Record<string, unknown> | string | Error>>,
  calls: Array<{ profileId: string; request: ChatCompletionRequest }>,
): ModelRouter {
  const clients = new Map<string, BoundModelClient>();
  const resolve = async (profileId?: string | null) => {
    const selected = profileId ?? "profileA";
    const cached = clients.get(selected);
    if (cached) return cached;
    const binding = bindingFor(selected);
    const client: BoundModelClient["client"] = {
      async complete(request): Promise<ChatCompletionResponse> {
        calls.push({ profileId: selected, request });
        const value = outputs[selected]?.shift();
        if (value instanceof Error) throw value;
        if (!value) throw new Error(`No queued output for ${selected}.`);
        return {
          content: typeof value === "string" ? value : JSON.stringify(value),
          toolCalls: [],
          finishReason: "stop",
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      },
      async *streamComplete() {
        yield { type: "done" as const, finishReason: "stop" };
      },
    };
    const bound = { binding, client };
    clients.set(selected, bound);
    return bound;
  };
  return {
    resolve,
    resolveFrozen(binding) {
      return resolve(binding.profileId);
    },
    invalidate() {},
  };
}

function bindingFor(profileId: string): ResolvedModelBinding {
  return {
    profileId,
    connectionId: `connection-${profileId}`,
    providerKind: "openai",
    modelId: `model-${profileId}`,
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
  };
}

function proposal(title: string): Record<string, unknown> {
  return {
    title,
    summary: `${title} summary`,
    objective: "完成本地实现",
    scope: { in: ["代码"], out: ["外部发布"] },
    assumptions: [],
    milestones: [
      {
        id: "m1",
        title: "实现",
        description: "实现功能",
        acceptanceCriteria: ["测试通过"],
        dependencies: [],
      },
    ],
    dependencies: [],
    risks: [],
    acceptanceCriteria: ["测试通过"],
  };
}

function revisedProposal(title: string): Record<string, unknown> {
  return {
    ...proposal(title),
    decisions: [
      {
        issueId: "issue-1",
        decision: "accepted",
        reason: "补充测试",
        changedSections: ["milestones"],
      },
    ],
  };
}

function critique(summary: string): Record<string, unknown> {
  return {
    summary,
    issues: [
      {
        id: "issue-1",
        target: "milestones",
        severity: "medium",
        claim: "测试不足",
        evidenceOrCounterexample: "缺少失败恢复测试",
        requestedChange: "补充恢复测试",
        status: "resolved",
      },
    ],
    minorityOpinion: ["保留人工复核"],
    unresolvedRisks: [],
  };
}

function artifact(title: string): Record<string, unknown> {
  return {
    ...proposal(title),
    claimLedger: [
      {
        id: "claim-1",
        claim: "实现可由测试验证",
        evidenceRefs: ["evidence_file"],
        counterexamples: [],
        conditions: ["测试通过"],
        confidence: 0.9,
        status: "verified",
      },
    ],
    unresolvedQuestions: [],
    minorityOpinion: ["保留一次人工回滚演练。"],
    actionGate: "ready",
    gateReason: "计划结构完整且没有未缓解的严重风险。",
  };
}
