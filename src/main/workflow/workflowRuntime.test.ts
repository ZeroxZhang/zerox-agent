import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWorkflowActorHostHook,
  createWorkflowRuntime,
  type WorkflowHostHooks,
  type WorkflowRuntime,
} from "./workflowRuntime";
import { createWorkflowToolHandler } from "./workflowTool";
import { createActorRuntime } from "../actors/actorRuntime";

afterEach(() => {
  vi.useRealTimers();
});

describe("WorkflowRuntime quiescence", () => {
  it("does not return a deadline result before the workflow settles", async () => {
    vi.useFakeTimers();
    const runtime = createWorkflowRuntime(emptyHooks());
    let release!: () => void;
    runtime.register("slow", async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return "late result";
    });
    let settled = false;
    const outcome = runtime
      .run("slow", null, { runId: "run_deadline", deadlineMs: 10 })
      .then((result) => {
        settled = true;
        return result;
      });

    await vi.advanceTimersByTimeAsync(20);
    expect(settled).toBe(false);

    release();
    await expect(outcome).resolves.toMatchObject({
      status: "deadline_exceeded",
    });
  });

  it("does not return parent cancellation before the workflow settles", async () => {
    const runtime = createWorkflowRuntime(emptyHooks());
    const parent = new AbortController();
    let release!: () => void;
    runtime.register("slow", async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return "late result";
    });
    let settled = false;
    const outcome = runtime
      .run("slow", null, {
        runId: "run_cancel",
        signal: parent.signal,
      })
      .then((result) => {
        settled = true;
        return result;
      });

    parent.abort(new Error("parent stopped"));
    await Promise.resolve();
    expect(settled).toBe(false);

    release();
    await expect(outcome).resolves.toMatchObject({ status: "canceled" });
  });

  it("drains host operations started without awaiting them", async () => {
    let releaseFetch!: () => void;
    let fetchSettled = false;
    const runtime = createWorkflowRuntime({
      ...emptyHooks(),
      async webfetch() {
        await new Promise<void>((resolve) => {
          releaseFetch = resolve;
        });
        fetchSettled = true;
        return "done";
      },
    });
    runtime.register("background-host-call", async (_args, sandbox) => {
      void sandbox.webfetch("https://example.com");
      return "workflow returned";
    });
    let settled = false;
    const outcome = runtime
      .run("background-host-call", null, { runId: "run_host" })
      .then((result) => {
        settled = true;
        return result;
      });

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(settled).toBe(false);
    expect(fetchSettled).toBe(false);

    releaseFetch();
    await expect(outcome).resolves.toMatchObject({
      status: "done",
      value: "workflow returned",
    });
    expect(fetchSettled).toBe(true);
  });

  it("drains unawaited parallel work before returning", async () => {
    let releaseParallel!: () => void;
    let parallelSettled = false;
    const runtime = createWorkflowRuntime(emptyHooks());
    runtime.register("background-parallel", async (_args, sandbox) => {
      void sandbox.parallel([
        async () => {
          await new Promise<void>((resolve) => {
            releaseParallel = resolve;
          });
          parallelSettled = true;
          return "done";
        },
      ]);
      return "workflow returned";
    });
    let settled = false;
    const outcome = runtime
      .run("background-parallel", null, { runId: "run_parallel" })
      .then((result) => {
        settled = true;
        return result;
      });

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(settled).toBe(false);
    expect(parallelSettled).toBe(false);

    releaseParallel();
    await expect(outcome).resolves.toMatchObject({
      status: "done",
      value: "workflow returned",
    });
    expect(parallelSettled).toBe(true);
  });

  it("rejects delayed host admission after normal completion", async () => {
    vi.useFakeTimers();
    let webfetchCalls = 0;
    let delayedError = "";
    const runtime = createWorkflowRuntime({
      ...emptyHooks(),
      async webfetch() {
        webfetchCalls += 1;
        return "unexpected";
      },
    });
    runtime.register("late-host-call", async (_args, sandbox) => {
      setTimeout(() => {
        try {
          void sandbox.webfetch("https://example.com/late");
        } catch (error) {
          delayedError = String(error);
        }
      }, 20);
      return "done";
    });

    await expect(
      runtime.run("late-host-call", null, { runId: "run_late" }),
    ).resolves.toMatchObject({ status: "done" });
    await vi.advanceTimersByTimeAsync(20);

    expect(webfetchCalls).toBe(0);
    expect(delayedError).toContain("admission is closed");
  });

  it("cancels and drains a spawned actor before returning deadline", async () => {
    vi.useFakeTimers();
    let actorSawAbort = false;
    let actorCleanupFinished = false;
    const actorRuntime = createActorRuntime({
      deps: {
        runActor: async (_input, _context, signal) =>
          new Promise((resolve) => {
            signal.addEventListener(
              "abort",
              () => {
                actorSawAbort = true;
                setTimeout(() => {
                  actorCleanupFinished = true;
                  resolve({
                    status: "done",
                    summary: "released after cleanup",
                    filesTouched: [],
                  });
                }, 20);
              },
              { once: true },
            );
          }),
      },
    });
    const runtime = createWorkflowRuntime({
      ...emptyHooks(),
      spawnActor: createWorkflowActorHostHook(actorRuntime),
    });
    runtime.register("actor", async (_args, sandbox) =>
      sandbox.agent({
        contextMode: "state",
        lifecycle: "ephemeral",
        task: "slow actor",
      }),
    );
    let settled = false;
    const outcome = runtime
      .run("actor", null, { runId: "run_actor", deadlineMs: 10 })
      .then((result) => {
        settled = true;
        return result;
      });

    await vi.advanceTimersByTimeAsync(10);
    expect(actorSawAbort).toBe(true);
    expect(actorCleanupFinished).toBe(false);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(20);
    await expect(outcome).resolves.toMatchObject({
      status: "deadline_exceeded",
    });
    expect(actorCleanupFinished).toBe(true);
  });

  it("propagates deadline to web hooks and closes later host admission", async () => {
    vi.useFakeTimers();
    let webfetchSawAbort = false;
    let webfetchCleanupFinished = false;
    let websearchCalls = 0;
    const runtime = createWorkflowRuntime({
      ...emptyHooks(),
      async webfetch(_url, options) {
        return new Promise((resolve) => {
          options.signal.addEventListener(
            "abort",
            () => {
              webfetchSawAbort = true;
              setTimeout(() => {
                webfetchCleanupFinished = true;
                resolve("released");
              }, 20);
            },
            { once: true },
          );
        });
      },
      async websearch() {
        websearchCalls += 1;
        return [];
      },
    });
    runtime.register("web", async (_args, sandbox) => {
      try {
        await sandbox.webfetch("https://example.com");
      } catch {
        // A workflow may recover locally, but canceled admission stays closed.
      }
      try {
        await sandbox.websearch("must not start");
      } catch {
        return "canceled";
      }
      return "unexpected";
    });
    let settled = false;
    const outcome = runtime
      .run("web", null, { runId: "run_web", deadlineMs: 10 })
      .then((result) => {
        settled = true;
        return result;
      });

    await vi.advanceTimersByTimeAsync(10);
    expect(webfetchSawAbort).toBe(true);
    expect(webfetchCleanupFinished).toBe(false);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(20);
    await expect(outcome).resolves.toMatchObject({
      status: "deadline_exceeded",
    });
    expect(webfetchCleanupFinished).toBe(true);
    expect(websearchCalls).toBe(0);
  });
});

describe("workflow tool cancellation", () => {
  it("forwards the active tool signal to the workflow runtime", async () => {
    const controller = new AbortController();
    let observedSignal: AbortSignal | undefined;
    const runtime: WorkflowRuntime = {
      register() {},
      list() {
        return ["fixture"];
      },
      has() {
        return true;
      },
      async run(_name, _args, options) {
        observedSignal = options.signal;
        return {
          status: "canceled",
          phases: [],
          actorSpawns: [],
        };
      },
    };
    const handler = createWorkflowToolHandler({ workflowRuntime: runtime });

    await handler(
      { op: "run", name: "fixture", runId: "run_tool" },
      { signal: controller.signal },
    );

    expect(observedSignal).toBe(controller.signal);
  });
});

function emptyHooks(): WorkflowHostHooks {
  return {
    async spawnActor() {
      return { status: "done", summary: "", filesTouched: [] };
    },
    async webfetch() {
      return "";
    },
    async websearch() {
      return [];
    },
  };
}
