import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("production ToolRuntime boundary", () => {
  it("routes every authorization-plus-dispatch owner through ToolRuntime", () => {
    const migratedOwners = [
      "src/main/agentLoop.ts",
      "src/main/agentRunnerService.ts",
      "src/main/agentRuntimeEngine.ts",
      "src/main/goalRuntimeEngine.ts",
      "src/main/agentGoalAcceptanceToolExecutor.ts",
    ];

    for (const relativePath of migratedOwners) {
      const source = read(relativePath);
      expect(source, relativePath).toContain("createToolRuntime");
      expect(source, relativePath).not.toMatch(
        /toolAuthorizationService\.authorize|options\.toolAuthorizationService\.authorize/,
      );
      expect(source, relativePath).not.toMatch(
        /toolExecutor\.execute|options\.toolExecutor\.execute/,
      );
    }
  });

  it("keeps direct production dispatch limited to ToolRuntime and authorized acceptance ports", () => {
    const allowedDirectDispatchOwners = [
      "src/main/toolRuntime.ts",
      "src/main/agentGoalAcceptance.ts",
      "src/main/agentGoalValidatorRegistry.ts",
    ].sort();
    const directDispatchOwners = productionFiles().filter((relativePath) =>
      /(?:toolExecutor|\.toolExecutor)\.execute/.test(read(relativePath)),
    );

    expect(directDispatchOwners).toEqual(allowedDirectDispatchOwners);
    expect(read("src/main/container.ts")).toContain(
      "createAuthorizedGoalAcceptanceToolExecutor",
    );
  });

  it("keeps authorization policy calls out of migrated production owners", () => {
    const allowedAuthorizationOwners = [
      "src/main/toolRuntime.ts",
      // IPC exposes an authorization-only diagnostic endpoint and never
      // dispatches a tool.
      "src/main/ipc/index.ts",
    ].sort();
    const owners = productionFiles().filter((relativePath) =>
      /\.authorize\(/.test(read(relativePath)),
    );

    expect(owners).toEqual(allowedAuthorizationOwners);
  });
});

function read(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function productionFiles(): string[] {
  const mainRoot = path.join(root, "src", "main");
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (
        entry.isFile() &&
        entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".test.ts")
      ) {
        files.push(path.relative(root, absolutePath).split(path.sep).join("/"));
      }
    }
  };
  visit(mainRoot);
  return files.sort();
}
