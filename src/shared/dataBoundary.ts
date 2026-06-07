export type AgentDataMode = "desktop" | "preview";

export type AgentDataBoundary = {
  mode: AgentDataMode;
  title: string;
  message: string;
  storageLabel: string;
  cleanupLabel: string;
  canClearDemoData: boolean;
};

export function buildAgentDataBoundary(mode: AgentDataMode): AgentDataBoundary {
  if (mode === "desktop") {
    return {
      mode,
      title: "正式本地数据模式",
      message:
        "当前窗口连接的是 Electron 桌面端，任务、运行、会话和记忆都会写入本机用户数据目录。",
      storageLabel: "Electron userData/config",
      cleanupLabel: "桌面端不会注入演示数据",
      canClearDemoData: false,
    };
  }

  return {
    mode,
    title: "浏览器演示数据模式",
    message:
      "当前窗口没有连接桌面端 IPC，只展示前端演示数据；这里的任务、运行和记忆不会写入正式本地数据。",
    storageLabel: "浏览器 localStorage / 静态演示数据",
    cleanupLabel: "清理预览验收数据",
    canClearDemoData: true,
  };
}
