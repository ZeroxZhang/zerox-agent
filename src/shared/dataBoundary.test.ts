import { describe, expect, it } from "vitest";
import { buildAgentDataBoundary } from "./dataBoundary";

describe("agent data boundary", () => {
  it("labels Electron as the formal local data mode", () => {
    expect(buildAgentDataBoundary("desktop")).toEqual({
      mode: "desktop",
      title: "正式本地数据模式",
      message:
        "当前窗口连接的是 Electron 桌面端，任务、运行、会话和记忆都会写入本机用户数据目录。",
      storageLabel: "Electron userData/config",
      cleanupLabel: "桌面端不会注入演示数据",
      canClearDemoData: false,
    });
  });

  it("labels browser preview as demo data mode and allows preview cleanup", () => {
    expect(buildAgentDataBoundary("preview")).toEqual({
      mode: "preview",
      title: "浏览器演示数据模式",
      message:
        "当前窗口没有连接桌面端 IPC，只展示前端演示数据；这里的任务、运行和记忆不会写入正式本地数据。",
      storageLabel: "浏览器 localStorage / 静态演示数据",
      cleanupLabel: "清理预览验收数据",
      canClearDemoData: true,
    });
  });
});
