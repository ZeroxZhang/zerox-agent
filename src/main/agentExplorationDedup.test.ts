import { describe, expect, it } from "vitest";
import {
  buildExplorationDedupNote,
  buildReadResultDigest,
  createExplorationDedupTracker,
  isMutatingToolCall,
  isReadClassTool,
} from "./agentExplorationDedup";

describe("exploration dedup tracker", () => {
  it("treats the first read of a target as fresh", () => {
    const tracker = createExplorationDedupTracker();
    const check = tracker.check("file_read", { path: "/tmp/a.txt" }, 1);
    expect(check).toEqual({
      isDuplicate: false,
      priorReads: 0,
      firstTurn: 0,
      lastTurn: 0,
    });
    expect(tracker.duplicateCount()).toBe(0);
  });

  it("flags a re-read of a successfully read target as duplicate", () => {
    const tracker = createExplorationDedupTracker();
    tracker.recordRead("file_read", { path: "/tmp/a.txt" }, 2);

    const check = tracker.check("file_read", { path: "/tmp/a.txt" }, 5);
    expect(check).toEqual({
      isDuplicate: true,
      priorReads: 1,
      firstTurn: 2,
      lastTurn: 2,
    });
    expect(tracker.duplicateCount()).toBe(1);
  });

  it("carries the latest result digest into the duplicate check", () => {
    const tracker = createExplorationDedupTracker();
    tracker.recordRead("file_list", { path: "/tmp/dir" }, 1, "a.txt b.txt");
    tracker.recordRead("file_list", { path: "/tmp/dir" }, 3, "a.txt b.txt c.txt");

    const check = tracker.check("file_list", { path: "/tmp/dir" }, 5);
    expect(check).toMatchObject({
      isDuplicate: true,
      priorReads: 2,
      firstTurn: 1,
      lastTurn: 3,
      digest: "a.txt b.txt c.txt",
    });
  });

  it("counts every subsequent duplicate read", () => {
    const tracker = createExplorationDedupTracker();
    tracker.recordRead("file_list", { path: "/tmp/dir" }, 1);

    tracker.check("file_list", { path: "/tmp/dir" }, 2);
    tracker.check("file_list", { path: "/tmp/dir" }, 3);
    tracker.check("file_list", { path: "/tmp/dir" }, 4);
    expect(tracker.duplicateCount()).toBe(3);
  });

  it("normalizes trailing slashes on path-like args", () => {
    const tracker = createExplorationDedupTracker();
    tracker.recordRead("file_list", { path: "/tmp/dir/" }, 1);

    const check = tracker.check("file_list", { path: "/tmp/dir" }, 2);
    expect(check?.isDuplicate).toBe(true);
  });

  it("distinguishes different targets and different tools", () => {
    const tracker = createExplorationDedupTracker();
    tracker.recordRead("file_read", { path: "/tmp/a.txt" }, 1);

    expect(
      tracker.check("file_read", { path: "/tmp/b.txt" }, 2)?.isDuplicate,
    ).toBe(false);
    expect(
      tracker.check("file_stat", { path: "/tmp/a.txt" }, 2)?.isDuplicate,
    ).toBe(false);
    expect(tracker.duplicateCount()).toBe(0);
  });

  it("ignores non-read-class tools entirely", () => {
    const tracker = createExplorationDedupTracker();
    expect(tracker.check("file_write", { path: "/tmp/a.txt" }, 1)).toBeNull();
    expect(tracker.check("shell_exec", { command: "ls" }, 1)).toBeNull();
  });

  it("invalidates recorded reads after a successful mutation", () => {
    const tracker = createExplorationDedupTracker();
    tracker.recordRead("file_read", { path: "/tmp/a.txt" }, 1);
    expect(
      tracker.check("file_read", { path: "/tmp/a.txt" }, 2)?.isDuplicate,
    ).toBe(true);

    tracker.recordMutation("file_edit");
    const check = tracker.check("file_read", { path: "/tmp/a.txt" }, 3);
    expect(check).toEqual({
      isDuplicate: false,
      priorReads: 0,
      firstTurn: 0,
      lastTurn: 0,
    });
  });
});

describe("tool classification", () => {
  it("classifies read-class tools", () => {
    expect(isReadClassTool("file_read")).toBe(true);
    expect(isReadClassTool("file_list")).toBe(true);
    expect(isReadClassTool("code_search")).toBe(true);
    expect(isReadClassTool("file_write")).toBe(false);
    expect(isReadClassTool("shell_exec")).toBe(false);
  });

  it("classifies hard-mutating tools", () => {
    expect(isMutatingToolCall("file_write", {})).toBe(true);
    expect(isMutatingToolCall("file_edit", {})).toBe(true);
    expect(isMutatingToolCall("file_delete", {})).toBe(true);
  });

  it("treats test runs as mutating to stay conservative", () => {
    expect(isMutatingToolCall("test_run", {})).toBe(true);
  });

  it("detects mutating shell commands heuristically", () => {
    expect(isMutatingToolCall("shell_exec", { command: "ls -la" })).toBe(false);
    expect(isMutatingToolCall("shell_exec", { command: "cat package.json" })).toBe(false);
    expect(isMutatingToolCall("shell_exec", { command: "echo hi > out.txt" })).toBe(true);
    expect(isMutatingToolCall("shell_exec", { command: "rm -rf dist" })).toBe(true);
    expect(isMutatingToolCall("shell_exec", { command: "git commit -m x" })).toBe(true);
    expect(isMutatingToolCall("shell_exec", { command: "git status" })).toBe(false);
  });
});

describe("dedup note", () => {
  it("mentions the tool, target, prior reads, and first turn", () => {
    const note = buildExplorationDedupNote({
      toolName: "file_list",
      args: { path: "/tmp/project" },
      priorReads: 2,
      firstTurn: 3,
    });
    expect(note).toContain("file_list /tmp/project");
    expect(note).toContain("2");
    expect(note).toContain("3");
    expect(note).toContain("复用");
  });

  it("embeds the latest result digest when available", () => {
    const note = buildExplorationDedupNote({
      toolName: "file_list",
      args: { path: "/tmp/project" },
      priorReads: 2,
      firstTurn: 1,
      lastTurn: 4,
      digest: "a.txt b.txt c.txt",
    });
    expect(note).toContain("最近一次第 4 轮");
    expect(note).toContain("a.txt b.txt c.txt");
    expect(note).toContain("offset/limit");
  });
});

describe("read result digest", () => {
  it("strips the XML wrapper and collapses whitespace", () => {
    const digest = buildReadResultDigest(
      '<tool_result tool="file_list">\n{"files": ["a.txt",\n"b.txt"]}\n</tool_result>',
    );
    expect(digest).toBe('{"files": ["a.txt", "b.txt"]}');
  });

  it("truncates oversized results", () => {
    const digest = buildReadResultDigest(`<tool_result>${"x".repeat(5000)}</tool_result>`);
    expect(digest.length).toBeLessThanOrEqual(601);
    expect(digest.endsWith("…")).toBe(true);
  });
});
