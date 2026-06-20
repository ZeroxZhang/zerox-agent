/**
 * Builds the memory system usage instructions embedded in the system prompt.
 * Teaches the model when and how to use `memory_search`, `conversation_search`,
 * and the MEMORY.md file system.
 *
 * Token budget: <500 tokens.
 */
export function buildMemoryInstructions(): string {
  return [
    "记忆系统使用说明：",
    "",
    "【何时主动检索记忆】",
    "- 任务开始时：用 memory_search 检索与当前任务相关的核心记忆（kind: \"core\"）和程序性记忆（kind: \"procedural\"），了解类似任务的历史执行经验。",
    "- 用户提到之前讨论过的话题时：用 conversation_search 查找原始对话，获取准确上下文而非凭印象回答。",
    "- 遇到不确定的工具用法或工作流程时：检索 procedural 记忆确认正确做法。",
    "",
    "【memory_search 使用规范】",
    "- 每次调用 memory_search 会返回裁剪后的摘要，不是完整记忆内容。重要细节需进一步用完整 ID 查阅。",
    "- 每轮对话最多调用 memory_search 和 conversation_search 合计 3 次，避免把记忆检索当成循环动作反复执行。",
    "- 优先使用精准关键词而非长句查询；用 kind 参数缩小检索范围（core/procedural/semantic/episodic）。",
    "- 检索到相关记忆后，必须将记忆内容与当前任务上下文结合判断，不要盲信记忆中的过时信息。",
    "",
    "【MEMORY.md 文件规范】",
    "- MEMORY.md 是本项目的持久化记忆文件，位于工作区根目录。你可以用 file_read 直接阅读它。",
    "- 当 memory_search 返回摘要不够详细时，直接用 file_read 读取 MEMORY.md 的对应段获取完整上下文。",
    "- 发现值得长期保留的知识、用户偏好或重要决策时，可通过记忆写入工具更新 MEMORY.md（需确认权限）。",
    "",
    "【程序性记忆】",
    "- 程序性记忆（kind: \"procedural\"）记录了已审核验证的工具使用流程和工作模式。任务相关时优先参考。",
    "- 如果当前任务成功完成，系统会自动将本次执行经验提炼为程序性记忆，供后续任务参考。",
    "",
    "【反模式 — 不要这样做】",
    "- 不要在每轮都调用 memory_search 作为例行公事；只在任务开始时或遇到不确定情况时按需检索。",
    "- 不要用 memory_search 替代 file_read 去读取已知路径的文件。",
    "- 不要在同一轮中重复检索相同 query（结果已缓存，重复无益）。",
    "- 检索结果不相关时，接受「无结果」并继续，不要不断变换关键词重试。",
  ].join("\n");
}
