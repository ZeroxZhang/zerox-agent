import { describe, expect, it } from "vitest";
import {
  classifyTaskFrame,
  lintExecutionStrategy,
  resolveUserReferences,
} from "./agentTaskStrategy";

describe("agent task strategy", () => {
  it("resolves Chinese path suffixes without treating prose as part of the path", () => {
    expect(
      resolveUserReferences("请帮我整理 /Users/bytedance/Downloads 这个文件夹"),
    ).toEqual([
      {
        rawText: "/Users/bytedance/Downloads 这个文件夹",
        canonical: "/Users/bytedance/Downloads",
        kind: "path",
        exists: undefined,
        confidence: 0.95,
        alternatives: [],
      },
    ]);
  });

  it("classifies small deterministic local batch work away from Goal Mode", () => {
    const frame = classifyTaskFrame(
      "请帮我整理 /Users/bytedance/Downloads 这个文件夹",
    );

    expect(frame).toMatchObject({
      domain: "files",
      mode: "deterministic",
      risk: "moves_data",
      expectedScale: "small",
      needsConfirmation: true,
      recommendedRuntime: "quick_action",
    });
    expect(frame.targetRefs[0]).toMatchObject({
      canonical: "/Users/bytedance/Downloads",
      kind: "path",
    });
  });

  it("keeps code changes on the agent loop instead of file-specific quick actions", () => {
    expect(classifyTaskFrame("修复登录失败 bug，并跑测试")).toMatchObject({
      domain: "code",
      mode: "exploratory",
      risk: "writes_files",
      recommendedRuntime: "agent_loop",
    });
  });

  it("rejects Goal Mode and missing confirmation for deterministic local moves", () => {
    const frame = classifyTaskFrame("整理 /Users/bytedance/Downloads 这个文件夹");

    const result = lintExecutionStrategy(frame, {
      runtime: "goal_mode",
      confirmationGates: [],
      steps: [
        {
          id: "move",
          operation: "move files into category folders",
          toolName: "shell_exec",
          toolClass: "shell",
          risk: "local_write",
          batchExpected: true,
          platformSensitive: true,
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "DETERMINISTIC_TASK_IN_GOAL_MODE",
      "MISSING_SIDE_EFFECT_CONFIRMATION",
      "SHELL_USED_FOR_DETERMINISTIC_WORK",
    ]);
  });

  it("flags fragmented repeated tool calls when a batch strategy is expected", () => {
    const frame = classifyTaskFrame("分析 /Users/bytedance/Downloads 目录内容");

    const result = lintExecutionStrategy(frame, {
      runtime: "agent_loop",
      confirmationGates: [],
      steps: [
        {
          id: "list-root",
          operation: "list root",
          toolName: "file_list",
          toolClass: "single_read",
          risk: "none",
          batchExpected: false,
          platformSensitive: false,
        },
        {
          id: "list-a",
          operation: "list child A",
          toolName: "file_list",
          toolClass: "single_read",
          risk: "none",
          batchExpected: false,
          platformSensitive: false,
        },
        {
          id: "list-b",
          operation: "list child B",
          toolName: "file_list",
          toolClass: "single_read",
          risk: "none",
          batchExpected: false,
          platformSensitive: false,
        },
        {
          id: "list-c",
          operation: "list child C",
          toolName: "file_list",
          toolClass: "single_read",
          risk: "none",
          batchExpected: false,
          platformSensitive: false,
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "FRAGMENTED_TOOL_CALLS",
        severity: "error",
      }),
    );
  });

  it("prefers native tools when shell is used for known operations", () => {
    const frame = classifyTaskFrame("修复登录失败 bug，并跑测试");

    const result = lintExecutionStrategy(frame, {
      runtime: "agent_loop",
      confirmationGates: [],
      steps: [
        {
          id: "test",
          operation: "run npm test for login flow",
          toolName: "shell_exec",
          toolClass: "shell",
          risk: "none",
          batchExpected: false,
          platformSensitive: true,
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "PREFER_NATIVE_TOOL",
        severity: "warn",
        message: "test_run is the native tool for code:test.",
      }),
    );
  });
});
