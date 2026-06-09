import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentToolExecutionResult } from "./dynamicToolRegistry";

const execFileAsync = promisify(execFile);

export async function readGitStatus(args: {
  workspaceRoot: string;
}): Promise<AgentToolExecutionResult> {
  if (!args.workspaceRoot) {
    return { ok: false, error: "git_status requires workspaceRoot." };
  }

  const branch = await git(args.workspaceRoot, ["branch", "--show-current"]);
  const status = await git(args.workspaceRoot, ["status", "--porcelain=v1"]);
  const entries = status.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => ({
      indexStatus: line.slice(0, 1).trim() || "?",
      worktreeStatus: line.slice(1, 2).trim() || "?",
      path: line.slice(3),
    }));

  return {
    ok: true,
    result: {
      workspaceRoot: args.workspaceRoot,
      branch: branch.stdout.trim(),
      clean: entries.length === 0,
      entries,
    },
  };
}

export async function readGitDiff(args: {
  workspaceRoot: string;
  staged?: boolean;
}): Promise<AgentToolExecutionResult> {
  if (!args.workspaceRoot) {
    return { ok: false, error: "git_diff requires workspaceRoot." };
  }

  const diffArgs = args.staged ? ["diff", "--cached"] : ["diff"];
  const statArgs = args.staged
    ? ["diff", "--cached", "--numstat"]
    : ["diff", "--numstat"];
  const [diff, stat] = await Promise.all([
    git(args.workspaceRoot, diffArgs),
    git(args.workspaceRoot, statArgs),
  ]);
  const statRows = stat.stdout.split("\n").filter(Boolean);

  return {
    ok: true,
    result: {
      workspaceRoot: args.workspaceRoot,
      staged: Boolean(args.staged),
      filesChanged: statRows.length,
      rawDiff: diff.stdout,
      numstat: statRows.map((row) => {
        const [added, deleted, filePath] = row.split("\t");
        return { added, deleted, path: filePath };
      }),
    },
  };
}

async function git(cwd: string, args: string[]) {
  try {
    return await execFileAsync("git", args, {
      cwd,
      maxBuffer: 1024 * 1024 * 4,
    });
  } catch (error) {
    const typed = error as Error & {
      stdout?: string;
      stderr?: string;
      code?: number;
    };
    throw new Error(
      `git ${args.join(" ")} failed: ${typed.stderr || typed.message}`,
    );
  }
}
