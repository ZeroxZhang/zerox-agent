import { describe, expect, it } from "vitest";
import {
  clearPreviewValidationSnapshot,
  loadPreviewValidationSnapshot,
  savePreviewValidationSnapshot,
} from "./agentValidationPreviewStore";
import type { AgentBootstrapValidationSnapshot } from "../shared/agentBootstrap";

describe("agent validation preview store", () => {
  it("saves and loads validation snapshots from browser storage", () => {
    const storage = createMemoryStorage();
    const snapshot = createSnapshot();

    savePreviewValidationSnapshot(storage, snapshot);

    expect(loadPreviewValidationSnapshot(storage)).toEqual(snapshot);
  });

  it("returns null for missing or invalid preview snapshots", () => {
    const storage = createMemoryStorage();

    expect(loadPreviewValidationSnapshot(storage)).toBeNull();
    storage.setItem("building-agent.validation-preview", "{bad json");
    expect(loadPreviewValidationSnapshot(storage)).toBeNull();
  });

  it("clears validation snapshots from browser storage", () => {
    const storage = createMemoryStorage();
    const snapshot = createSnapshot();

    savePreviewValidationSnapshot(storage, snapshot);
    clearPreviewValidationSnapshot(storage);

    expect(loadPreviewValidationSnapshot(storage)).toBeNull();
  });
});

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

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
        latencyMs: 0,
        message: "浏览器预览：模型连接测试通过。",
      },
      run: {
        ready: true,
        ran: true,
        run: null,
        message: "浏览器预览：默认任务已验收运行。",
      },
    },
  };
}
