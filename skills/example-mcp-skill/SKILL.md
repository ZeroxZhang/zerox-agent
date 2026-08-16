---
name: example-mcp-skill
displayName: MCP 示例技能
description: 演示如何使用 MCP 服务器和自定义工具扩展智能体能力。
version: 0.1.0
execution:
  mode: agent
  maxTurns: 48
inputs:
  - name: query
    label: 查询内容
    type: string
    required: true
permissions:
  files:
    read: []
    write: []
  shell:
    commands: []
  web:
    search: false
    fetchDomains: []
  memory:
    read: true
    write: true
planning:
  required: false
  maxSteps: 4

# MCP 服务器配置
# 取消注释并修改为你的 MCP 服务器路径以启用
# mcpServers:
#   - name: filesystem
#     transport: stdio
#     command: npx
#     args: ["-y", "@anthropic/mcp-server-filesystem", "/path/to/allowed/dir"]
#     readRoots: ["/path/to/allowed/dir"]
#     network: false
#   - name: web-search
#     transport: stdio
#     command: npx
#     args: ["-y", "@anthropic/mcp-server-brave-search"]
#     network: true
#     env:
#       BRAVE_API_KEY: "your-api-key"
#   - name: remote-search
#     transport: http
#     url: https://mcp.example.com/rpc
#     headers:
#       authorization: "Bearer configured-token"

# 自定义工具定义
# 取消注释以启用
# tools:
#   - name: count_files
#     description: 统计指定目录下特定类型的文件数量
#     entrypoint: ./tools/count-files.js
#     parameters:
#       type: object
#       properties:
#         directory:
#           type: string
#           description: 目标目录路径
#         extension:
#           type: string
#           description: 文件扩展名过滤，如 ".md" 或 ".pdf"
#       required: [directory]

# 技能依赖
# dependencies:
#   - local-file-organizer
---

# MCP 示例技能

这是一个演示技能，展示了 Building Agent 的扩展能力：

## MCP 服务器集成

在 `mcpServers` 配置项中定义 MCP 服务器并不会自动授予信任。应用只会连接同时满足
`ZEROX_ENABLE_SKILL_MCP=1` 且精确列入
`ZEROX_SKILL_MCP_ALLOWLIST=example-mcp-skill/server-name` 的服务器，发现其中的工具并
注册到智能体的工具执行器中。allowlist 不支持通配符。

支持的 MCP 传输协议：
- `stdio`：通过标准输入/输出与子进程通信，默认只读 Skill 根目录且禁止网络；
  `readRoots`、`network` 和 `env` 必须显式声明。
- `http` / `sse`：远程 HTTPS MCP，可选 `headers`。

## 自定义工具

在 `tools` 配置项中定义自定义工具。每个工具有：
- `name`：工具名称（在 function calling 中使用）
- `description`：工具描述
- `entrypoint`：工具实现文件（相对于 SKILL.md 所在目录的 JS 文件）
- `parameters`：工具参数 JSON Schema

## 技能依赖

通过 `dependencies` 声明对其他技能的依赖。智能体会自动按拓扑顺序
加载技能，确保依赖的技能先加载。
