import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentValidationStore } from "./agentValidationStore";
import type { AgentBootstrapValidationSnapshot } from "../shared/agentBootstrap";

describe("agent validation store", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(path.join(os.tmpdir(), "agent-validation-"));
  });

  afterEach(() => {
    configDir = "";
  });

  it("starts empty when no validation snapshot exists", async () => {
    const store = createAgentValidationStore({ configDir });

    await expect(store.load()).resolves.toBeNull();
  });

  it("persists and reloads the latest validation snapshot", async () => {
    const store = createAgentValidationStore({ configDir });
    const snapshot = createSnapshot();

    await store.save(snapshot);

    await expect(store.load()).resolves.toEqual(snapshot);
    const raw = await readFile(path.join(configDir, "agent-validation.json"), {
      encoding: "utf8",
    });
    expect(JSON.parse(raw)).toEqual({
      schemaVersion: 1,
      latest: snapshot,
    });
  });
});

function createSnapshot(): AgentBootstrapValidationSnapshot {
  return {
    validatedAt: "2026-06-06T08:00:00.000Z",
    report: {
      ready: true,
      model: { ready: true, message: "模型配置已就绪。" },
      skill: { ready: true, message: "内置文件整理技能已就绪。" },
      task: {
        ready: true,
        created: false,
        task: null,
        message: "默认文件整理任务已存在。",
      },
      connection: {
        ready: true,
        checked: true,
        latencyMs: 42,
        message: "模型连接测试成功。",
      },
      run: {
        ready: true,
        ran: true,
        run: null,
        message: "默认文件整理任务已验收运行。",
      },
    },
  };
}
