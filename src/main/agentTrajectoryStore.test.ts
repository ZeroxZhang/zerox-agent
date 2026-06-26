import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentTrajectoryStore } from "./agentTrajectoryStore";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";

describe("agent trajectory store", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(path.join(os.tmpdir(), "building-agent-trajectory-"));
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  it("appends trajectory events as one JSONL file per run", async () => {
    const store = createAgentTrajectoryStore({ configDir });
    const first = createEvent("state_transition", "event_1");
    const second = createEvent("tool_call", "event_2");

    await expect(store.append("run_1", first)).resolves.toEqual(first);
    await expect(store.append("run_1", second)).resolves.toEqual(second);

    await expect(store.list("run_1")).resolves.toEqual([first, second]);
    const raw = await readFile(
      path.join(configDir, "agent-trajectories", "run_1.jsonl"),
      "utf8",
    );
    expect(raw.trim().split("\n").map((line) => JSON.parse(line))).toEqual([
      first,
      second,
    ]);
  });

  it("keeps trajectories isolated by run id", async () => {
    const store = createAgentTrajectoryStore({ configDir });
    const runOne = createEvent("model_request", "event_run_1");
    const runTwo = createEvent("model_response", "event_run_2");

    await store.append("run_1", runOne);
    await store.append("run_2", runTwo);

    await expect(store.list("run_1")).resolves.toEqual([runOne]);
    await expect(store.list("run_2")).resolves.toEqual([runTwo]);
  });

  it("returns an empty list when a trajectory file is missing", async () => {
    const store = createAgentTrajectoryStore({ configDir });

    await expect(store.list("missing_run")).resolves.toEqual([]);
  });

  it("skips malformed JSONL lines while preserving valid trajectory events", async () => {
    const first = createEvent("model_request", "event_1");
    const second = createEvent("model_response", "event_2");
    const dir = path.join(configDir, "agent-trajectories");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "run_1.jsonl"),
      `${JSON.stringify(first)}\n{"id": "partial"\n${JSON.stringify(second)}\n`,
      "utf8",
    );

    const store = createAgentTrajectoryStore({ configDir });

    await expect(store.list("run_1")).resolves.toEqual([first, second]);
    const files = await readdir(dir);
    expect(files.some((file) => file.startsWith("run_1.jsonl.corrupt-lines-"))).toBe(true);
  });
});

function createEvent(
  type: AgentTrajectoryEvent["type"],
  id: string,
): AgentTrajectoryEvent {
  return {
    id,
    runId: "run_1",
    type,
    sequence: Number(id.replace(/\D/g, "")),
    payload: { label: type },
    redaction: {
      containsApiKey: false,
      containsFileContent: false,
      containsUserText: true,
    },
    createdAt: "2026-06-07T00:00:00.000Z",
  };
}
