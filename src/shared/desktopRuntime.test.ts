import { describe, expect, it } from "vitest";
import { buildDesktopRuntimeInfo } from "./desktopRuntime";

describe("desktop runtime info", () => {
  it("builds user-facing runtime and local data paths", () => {
    const info = buildDesktopRuntimeInfo({
      appPath: "/Applications/Zerox Agent.app",
      isPackaged: true,
      productName: "Zerox Agent",
      rendererMode: "production",
      userDataPath: "/Users/demo/Library/Application Support/Zerox Agent",
      version: "1.0.0",
    });

    expect(info).toEqual({
      appPath: "/Applications/Zerox Agent.app",
      configDir: "/Users/demo/Library/Application Support/Zerox Agent/config",
      isPackaged: true,
      productName: "Zerox Agent",
      rendererMode: "production",
      userDataPath: "/Users/demo/Library/Application Support/Zerox Agent",
      version: "1.0.0",
      dataFiles: [
        {
          fileName: "model-settings.json",
          label: "模型配置",
          path: "/Users/demo/Library/Application Support/Zerox Agent/config/model-settings.json",
        },
        {
          fileName: "scheduled-tasks.json",
          label: "定时任务",
          path: "/Users/demo/Library/Application Support/Zerox Agent/config/scheduled-tasks.json",
        },
        {
          fileName: "agent-runs.jsonl",
          label: "运行日志",
          path: "/Users/demo/Library/Application Support/Zerox Agent/config/agent-runs.jsonl",
        },
        {
          fileName: "tool-audit.jsonl",
          label: "工具审计",
          path: "/Users/demo/Library/Application Support/Zerox Agent/config/tool-audit.jsonl",
        },
        {
          fileName: "memory-records.json",
          label: "本地记忆",
          path: "/Users/demo/Library/Application Support/Zerox Agent/config/memory-records.json",
        },
        {
          fileName: "chat-sessions.json",
          label: "会话记录",
          path: "/Users/demo/Library/Application Support/Zerox Agent/config/chat-sessions.json",
        },
        {
          fileName: "agent-validation.json",
          label: "验收结果",
          path: "/Users/demo/Library/Application Support/Zerox Agent/config/agent-validation.json",
        },
      ],
      commands: [
        {
          command: "npm run doctor",
          label: "使用前检查",
        },
        {
          command: "npm run start:prod",
          label: "构建并启动",
        },
        {
          command: "npm run dev",
          label: "开发模式",
        },
      ],
    });
  });
});
