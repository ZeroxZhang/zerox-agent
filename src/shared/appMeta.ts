export type AppMeta = {
  productName: string;
  tagline: string;
  modules: string[];
};

export function getAppMeta(): AppMeta {
  return {
    productName: "Zerox Agent",
    tagline: "从留白开始行动的本地桌面智能体。",
    modules: ["会话", "运行", "任务", "设置"],
  };
}
