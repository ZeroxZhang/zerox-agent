---
name: local-file-organizer
displayName: 本地文件整理
description: 扫描本地文件夹，整理最近变化，并写出一份 Markdown 报告。
version: 0.1.0
execution:
  mode: agent
  maxTurns: 48
inputs:
  - name: targetDir
    label: 目标文件夹
    type: path
    required: true
  - name: reportName
    label: 报告文件名
    type: string
    required: false
permissions:
  files:
    read:
      - "{{targetDir}}"
    write:
      - "{{targetDir}}"
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
  maxSteps: 5
---

# 本地文件整理

## 目标

扫描目标文件夹，识别最近新增或变化的文件，总结文件类型和可能的整理建议，并在同一个文件夹里写出一份 Markdown 报告。

## 输出要求

- 默认用中文输出报告正文、运行摘要和用户可见说明。
- 报告应简洁，包括扫描目录、文件清单摘要、建议分类和下一步建议。
- 如果任务输入提供 `reportName`，优先使用它作为报告文件名；否则使用一个清晰的 Markdown 文件名。
- 运行摘要需要说明扫描了多少文件、报告写到了哪里。
- 可以提出值得写入记忆的长期偏好，例如用户偏好的整理方式或报告格式。

## 安全边界

- 不要读取或写入授权目标文件夹之外的路径。
- 不要运行 shell 命令。
- 不要访问网页。
- 列目录时先用 `file_list`，只在需要摘要具体内容时再用 `file_read` 读取单个文件。
