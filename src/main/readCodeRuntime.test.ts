import { describe, expect, it } from "vitest";
import {
  runReadCodeProgram,
  type ReadCodeProgram,
} from "./readCodeRuntime";

describe("read Code Mode Worker runtime", () => {
  it("executes a dependency DAG with bounded concurrency and stable outputs", async () => {
    let active = 0;
    let highWater = 0;
    const started: string[] = [];
    const program: ReadCodeProgram = {
      steps: [
        {
          id: "list",
          tool: "file_list",
          args: { path: "/workspace" },
        },
        {
          id: "read_a",
          tool: "file_read",
          args: { path: "/workspace/a.ts" },
          dependsOn: ["list"],
        },
        {
          id: "read_b",
          tool: "file_read",
          args: { path: "/workspace/b.ts" },
          dependsOn: ["list"],
        },
      ],
      output: ["read_b", "read_a"],
    };

    const result = await runReadCodeProgram(program, {
      limits: { maxConcurrency: 2 },
      async invoke(toolName, args) {
        started.push(`${toolName}:${String(args.path)}`);
        active += 1;
        highWater = Math.max(highWater, active);
        await delay(toolName === "file_list" ? 2 : 10);
        active -= 1;
        return {
          ok: true,
          result: { path: args.path },
        };
      },
    });

    expect(started[0]).toBe("file_list:/workspace");
    expect(new Set(started.slice(1))).toEqual(
      new Set([
        "file_read:/workspace/a.ts",
        "file_read:/workspace/b.ts",
      ]),
    );
    expect(highWater).toBe(2);
    expect(result).toEqual({
      outputs: [
        {
          id: "read_b",
          tool: "file_read",
          result: {
            ok: true,
            result: { path: "/workspace/b.ts" },
          },
        },
        {
          id: "read_a",
          tool: "file_read",
          result: {
            ok: true,
            result: { path: "/workspace/a.ts" },
          },
        },
      ],
      stepsExecuted: 3,
    });
  });

  it.each(["file_write", "shell_exec", "read_code", "custom_mcp"])(
    "rejects non-read-only tool %s before invoking it",
    async (tool) => {
      let invoked = false;
      await expect(
        runReadCodeProgram({
          steps: [{ id: "unsafe", tool, args: {} }],
        }, {
          async invoke() {
            invoked = true;
            return { ok: true, result: {} };
          },
        }),
      ).rejects.toThrow(/not read-only allowlisted/i);
      expect(invoked).toBe(false);
    },
  );

  it("rejects duplicate ids, unknown dependencies, and dependency cycles", async () => {
    const invoke = async () => ({ ok: true as const, result: {} });
    await expect(
      runReadCodeProgram({
        steps: [
          { id: "same", tool: "file_list", args: {} },
          { id: "same", tool: "file_list", args: {} },
        ],
      }, { invoke }),
    ).rejects.toThrow(/duplicate step id/i);
    await expect(
      runReadCodeProgram({
        steps: [
          {
            id: "one",
            tool: "file_list",
            args: {},
            dependsOn: ["missing"],
          },
        ],
      }, { invoke }),
    ).rejects.toThrow(/unknown dependency/i);
    await expect(
      runReadCodeProgram({
        steps: [
          {
            id: "one",
            tool: "file_list",
            args: {},
            dependsOn: ["two"],
          },
          {
            id: "two",
            tool: "file_list",
            args: {},
            dependsOn: ["one"],
          },
        ],
      }, { invoke }),
    ).rejects.toThrow(/dependency cycle/i);
  });

  it("enforces declared call and aggregate output limits", async () => {
    await expect(
      runReadCodeProgram({
        steps: [
          { id: "one", tool: "file_list", args: {} },
          { id: "two", tool: "file_list", args: {} },
        ],
      }, {
        limits: { maxCalls: 1 },
        async invoke() {
          return { ok: true, result: {} };
        },
      }),
    ).rejects.toThrow(/exceeded 1 declared steps/i);
    await expect(
      runReadCodeProgram({
        steps: [
          {
            id: "large_input",
            tool: "file_read",
            args: { path: "x".repeat(500) },
          },
        ],
      }, {
        limits: { maxProgramBytes: 120 },
        async invoke() {
          return { ok: true, result: {} };
        },
      }),
    ).rejects.toThrow(/program exceeded 120 bytes/i);
    await expect(
      runReadCodeProgram({
        steps: [{ id: "large", tool: "file_read", args: {} }],
      }, {
        limits: {
          maxSubcallBytes: 10_000,
          maxOutputBytes: 80,
        },
        async invoke() {
          return {
            ok: true,
            result: { content: "x".repeat(500) },
          };
        },
      }),
    ).rejects.toThrow(/output exceeded 80 bytes/i);
  });

  it("aborts and drains active subcalls before returning", async () => {
    const controller = new AbortController();
    const started: string[] = [];
    const settled: string[] = [];
    const execution = runReadCodeProgram({
      steps: [0, 1, 2].map((index) => ({
        id: `read_${index}`,
        tool: "file_read",
        args: { path: `/workspace/${index}.ts` },
      })),
    }, {
      signal: controller.signal,
      limits: { maxConcurrency: 2 },
      async invoke(_toolName, args, signal) {
        const path = String(args.path);
        started.push(path);
        await waitForAbort(signal);
        await delay(5);
        settled.push(path);
        throw signal.reason;
      },
    });

    await waitFor(() => started.length === 2);
    controller.abort(new Error("user canceled"));
    await expect(execution).rejects.toThrow("user canceled");
    expect(started).toHaveLength(2);
    expect(settled).toEqual(started);
  });

  it("times out, aborts subcalls, and waits for their settlement", async () => {
    let started = false;
    let settled = false;
    const execution = runReadCodeProgram({
      steps: [{ id: "slow", tool: "file_read", args: {} }],
    }, {
      limits: { timeoutMs: 100 },
      async invoke(_toolName, _args, signal) {
        started = true;
        await waitForAbort(signal);
        await delay(5);
        settled = true;
        throw signal.reason;
      },
    });

    await waitFor(() => started);
    await expect(execution).rejects.toThrow(/timed out after 100ms/i);
    expect(settled).toBe(true);
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("waitFor timed out");
    await delay(1);
  }
}

async function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}
