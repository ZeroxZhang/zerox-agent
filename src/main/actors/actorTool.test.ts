import { describe, expect, it } from "vitest";
import { createDynamicToolRegistry } from "../dynamicToolRegistry";
import { registerActorTool, ACTOR_TOOL_NAME } from "./actorTool";
import { registerWorkflowTool, WORKFLOW_TOOL_NAME } from "../workflow/workflowTool";
import { createActorRuntime } from "./actorRuntime";
import { createWorkflowRuntime } from "../workflow/workflowRuntime";
import { registerDeepResearchWorkflow } from "../workflow/deepResearchWorkflow";

describe("actor tool registration + execution (P6 activation)", () => {
  it("registers the actor tool and runs spawn+wait via op:run", async () => {
    const registry = createDynamicToolRegistry();
    const runtime = createActorRuntime({
      deps: { runActor: async (input) => ({ status: "done", summary: `did: ${input.task}`, filesTouched: [] }) },
    });
    registerActorTool(registry, { actorRuntime: runtime });
    expect(registry.has(ACTOR_TOOL_NAME)).toBe(true);
    const def = registry.getDefinitions().find((d) => d.function.name === ACTOR_TOOL_NAME);
    expect(def).toBeTruthy();

    const res = await registry.execute(ACTOR_TOOL_NAME, { op: "run", task: "research the spec", contextMode: "state" });
    expect(res.ok).toBe(true);
    expect((res as { result: { summary: string } }).result.summary).toContain("did: research the spec");
  });

  it("op:spawn returns an actorId without waiting", async () => {
    const registry = createDynamicToolRegistry();
    const runtime = createActorRuntime({ deps: { runActor: async () => ({ status: "done", summary: "ok", filesTouched: [] }) } });
    registerActorTool(registry, { actorRuntime: runtime });
    const res = await registry.execute(ACTOR_TOOL_NAME, { op: "spawn", task: "bg work", background: true });
    expect(res.ok).toBe(true);
    expect((res as { result: { actorId: string } }).result.actorId).toBeTruthy();
  });

  it("rejects unknown op", async () => {
    const registry = createDynamicToolRegistry();
    registerActorTool(registry, { actorRuntime: createActorRuntime({ deps: { runActor: async () => ({ status: "done", summary: "", filesTouched: [] }) } }) });
    const res = await registry.execute(ACTOR_TOOL_NAME, { op: "frobnicate" });
    expect(res.ok).toBe(false);
  });
});

describe("workflow tool registration + execution (P6 activation)", () => {
  it("registers the workflow tool; op:list returns registered workflows incl deep-research", async () => {
    const registry = createDynamicToolRegistry();
    const wf = createWorkflowRuntime({ async spawnActor() { return { status: "done", summary: "", filesTouched: [] }; }, async webfetch() { return ""; }, async websearch() { return []; } });
    registerDeepResearchWorkflow(wf.register.bind(wf));
    registerWorkflowTool(registry, { workflowRuntime: wf });
    expect(registry.has(WORKFLOW_TOOL_NAME)).toBe(true);
    const res = await registry.execute(WORKFLOW_TOOL_NAME, { op: "list" });
    expect(res.ok).toBe(true);
    expect((res as { result: { workflows: string[] } }).result.workflows).toContain("deep-research");
  });
});
