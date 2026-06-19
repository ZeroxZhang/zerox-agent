import { describe, expect, it } from "vitest";
import { evaluatePermission } from "./permissionEngine";
import { analyzeShell } from "../tools/shell/shellAnalyzer";

describe("permission engine", () => {
  it("derives human-readable shell command prefixes", () => {
    expect(evaluatePermission(shell("npm run verify -- --watch"), []).command)
      .toBe("npm run verify");
    expect(evaluatePermission(shell("git status --short"), []).command)
      .toBe("git status");
  });

  it("allows commands matching allow rules", () => {
    expect(evaluatePermission(shell("git status --short"), [
      { pattern: "git *", action: "allow" },
    ])).toMatchObject({
      action: "allow",
      matchedRule: "git *",
      command: "git status",
    });
  });

  it("does not match reduced allow rules for compound shell commands", () => {
    expect(evaluatePermission(shell("git status --short && rm -rf /tmp/cache"), [
      { pattern: "git *", action: "allow" },
    ])).toMatchObject({
      action: "ask",
      matchedRule: undefined,
      fullCommand: "git status --short && rm -rf /tmp/cache",
    });
  });

  it("denies commands matching dangerous full-command rules", () => {
    expect(evaluatePermission(shell("rm -rf /tmp/cache"), [
      { pattern: "rm -rf *", action: "deny" },
    ])).toMatchObject({
      action: "deny",
      matchedRule: "rm -rf *",
      fullCommand: "rm -rf /tmp/cache",
    });
  });

  it("defaults to ask when no rule matches", () => {
    expect(evaluatePermission(shell("npm run verify"), [])).toMatchObject({
      action: "ask",
      command: "npm run verify",
      matchedRule: undefined,
    });
  });

  it("uses the last matching rule", () => {
    expect(evaluatePermission(shell("git status --short"), [
      { pattern: "git *", action: "allow" },
      { pattern: "git status", action: "deny" },
    ])).toMatchObject({
      action: "deny",
      matchedRule: "git status",
    });
  });
});

function shell(command: string) {
  return {
    toolName: "shell_exec",
    args: { command },
  };
}

describe("evaluatePermission shell plan (P4 activation)", () => {
  it("detects redirection control operators the legacy regex missed, via ShellPlan", () => {
    const request = { toolName: "shell_exec", args: { command: "echo hi > out.txt" } } as never;
    // Without a shell plan, the legacy regex now also catches redirection.
    const legacy = evaluatePermission(request, []);
    // ShellPlan path: redirect is a control operator → reduced match disabled.
    const plan = analyzeShell("echo hi > out.txt", { cwd: "/tmp" });
    const withPlan = evaluatePermission(request, [], { shellPlan: plan });
    expect(plan.controlOperators).toContain(">");
    // Both paths treat the redirected command as having a control operator.
    expect(legacy.action).toBe(withPlan.action);
  });
});
