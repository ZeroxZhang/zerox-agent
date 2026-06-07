export type DesktopRuntimeMode = "development" | "production";

export type DesktopRuntimeDataFile = {
  fileName: string;
  label: string;
  path: string;
};

export type DesktopRuntimeCommand = {
  command: string;
  label: string;
};

export type DesktopRuntimeInfo = {
  appPath: string;
  commands: DesktopRuntimeCommand[];
  configDir: string;
  dataFiles: DesktopRuntimeDataFile[];
  isPackaged: boolean;
  productName: string;
  rendererMode: DesktopRuntimeMode;
  userDataPath: string;
  version: string;
};

export function buildDesktopRuntimeInfo(options: {
  appPath: string;
  isPackaged: boolean;
  productName: string;
  rendererMode: DesktopRuntimeMode;
  userDataPath: string;
  version: string;
}): DesktopRuntimeInfo {
  const configDir = joinPath(options.userDataPath, "config");
  const files: Array<[string, string]> = [
    ["模型配置", "model-settings.json"],
    ["定时任务", "scheduled-tasks.json"],
    ["运行日志", "agent-runs.jsonl"],
    ["工具审计", "tool-audit.jsonl"],
    ["本地记忆", "memory-records.json"],
    ["会话记录", "chat-sessions.json"],
    ["验收结果", "agent-validation.json"],
  ];

  return {
    appPath: options.appPath,
    configDir,
    isPackaged: options.isPackaged,
    productName: options.productName,
    rendererMode: options.rendererMode,
    userDataPath: options.userDataPath,
    version: options.version,
    dataFiles: files.map(([label, fileName]) => ({
      fileName,
      label,
      path: joinPath(configDir, fileName),
    })),
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
  };
}

function joinPath(...parts: string[]): string {
  return parts
    .map((part, index) =>
      index === 0 ? part.replace(/\/+$/, "") : part.replace(/^\/+|\/+$/g, ""),
    )
    .filter(Boolean)
    .join("/");
}
