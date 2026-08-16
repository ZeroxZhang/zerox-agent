import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import type { AgentToolExecutionResult } from "./dynamicToolRegistry";
import { runReadOnlyNativeProcess } from "./nativeReadOnlyProcess";
import type { ProcessSandboxProvider } from "./processSandbox";

const safeGitGlobalArgs = [
  "--no-pager",
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.pager=cat",
  "-c",
  "pager.status=false",
  "-c",
  "pager.diff=false",
  "-c",
  "diff.external=",
] as const;

const safeGitEnv = {
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_PAGER: "cat",
  GIT_TERMINAL_PROMPT: "0",
  PAGER: "cat",
} as const;

export type GitPlanningState = {
  summary: string;
  sha256: string;
};

export async function readGitPlanningState(args: {
  workspaceRoot: string;
  signal?: AbortSignal;
  processSandbox?: ProcessSandboxProvider;
}): Promise<GitPlanningState> {
  if (!args.workspaceRoot) {
    throw new Error("git planning state requires workspaceRoot.");
  }
  const processOptions = nativeGitProcessOptions(args);
  const [head, branch, status, unstaged, staged, untracked] = await Promise.all([
    gitOptional(
      args.workspaceRoot,
      ["rev-parse", "--verify", "HEAD"],
      processOptions,
    ),
    git(args.workspaceRoot, ["branch", "--show-current"], processOptions),
    git(
      args.workspaceRoot,
      ["status", "--porcelain=v1", "--untracked-files=all"],
      processOptions,
    ),
    git(args.workspaceRoot, [
      "diff",
      "--binary",
      "--no-ext-diff",
      "--no-textconv",
    ], processOptions),
    git(args.workspaceRoot, [
      "diff",
      "--cached",
      "--binary",
      "--no-ext-diff",
      "--no-textconv",
    ], processOptions),
    git(args.workspaceRoot, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
    ], processOptions),
  ]);
  const untrackedFiles = await fingerprintUntrackedFiles(
    args.workspaceRoot,
    untracked.stdout.split("\u0000").filter(Boolean),
  );
  const state = {
    head: head.stdout.trim(),
    branch: branch.stdout.trim(),
    status: status.stdout,
    unstagedDiffSha256: hash(unstaged.stdout),
    stagedDiffSha256: hash(staged.stdout),
    untrackedFiles,
  };
  return {
    summary: JSON.stringify(state),
    sha256: hash(JSON.stringify(state)),
  };
}

async function fingerprintUntrackedFiles(
  workspaceRoot: string,
  relativePaths: string[],
): Promise<
  Array<{
    path: string;
    size: number;
    sha256?: string;
    modifiedAtMs?: number;
    truncated?: boolean;
  }>
> {
  const root = path.resolve(workspaceRoot);
  const fingerprints = [];
  for (const relativePath of relativePaths.sort().slice(0, 80)) {
    const candidate = path.resolve(root, relativePath);
    const relative = path.relative(root, candidate);
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
    try {
      const info = await lstat(candidate);
      if (!info.isFile()) continue;
      if (info.size > 1024 * 1024) {
        fingerprints.push({
          path: relativePath,
          size: info.size,
          modifiedAtMs: info.mtimeMs,
          truncated: true,
        });
        continue;
      }
      fingerprints.push({
        path: relativePath,
        size: info.size,
        sha256: hash(await readFile(candidate)),
      });
    } catch {
      fingerprints.push({ path: relativePath, size: -1 });
    }
  }
  if (relativePaths.length > 80) {
    fingerprints.push({
      path: `__truncated__:${relativePaths.length - 80}`,
      size: -1,
      truncated: true,
    });
  }
  return fingerprints;
}

export async function readGitStatus(args: {
  workspaceRoot: string;
  signal?: AbortSignal;
  processSandbox?: ProcessSandboxProvider;
}): Promise<AgentToolExecutionResult> {
  if (!args.workspaceRoot) {
    return { ok: false, error: "git_status requires workspaceRoot." };
  }

  const processOptions = nativeGitProcessOptions(args);
  const branch = await git(
    args.workspaceRoot,
    ["branch", "--show-current"],
    processOptions,
  );
  const status = await git(
    args.workspaceRoot,
    ["status", "--porcelain=v1"],
    processOptions,
  );
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
  signal?: AbortSignal;
  processSandbox?: ProcessSandboxProvider;
}): Promise<AgentToolExecutionResult> {
  if (!args.workspaceRoot) {
    return { ok: false, error: "git_diff requires workspaceRoot." };
  }

  const diffArgs = args.staged
    ? ["diff", "--cached", "--no-ext-diff", "--no-textconv"]
    : ["diff", "--no-ext-diff", "--no-textconv"];
  const statArgs = args.staged
    ? [
        "diff",
        "--cached",
        "--numstat",
        "--no-ext-diff",
        "--no-textconv",
      ]
    : ["diff", "--numstat", "--no-ext-diff", "--no-textconv"];
  const processOptions = nativeGitProcessOptions(args);
  const [diff, stat] = await Promise.all([
    git(args.workspaceRoot, diffArgs, processOptions),
    git(args.workspaceRoot, statArgs, processOptions),
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

type NativeGitProcessOptions = {
  signal?: AbortSignal;
  processSandbox?: ProcessSandboxProvider;
};

class NativeGitCommandError extends Error {
  constructor(
    message: string,
    readonly kind: "exit" | "spawn_error" | "timeout" | "canceled",
  ) {
    super(message);
    this.name = "NativeGitCommandError";
  }
}

async function git(
  cwd: string,
  args: string[],
  options: NativeGitProcessOptions,
) {
  const result = await runReadOnlyNativeProcess({
    argv: ["git", ...safeGitGlobalArgs, ...args],
    workspaceRoot: cwd,
    signal: options.signal,
    processSandbox: options.processSandbox,
    additionalEnv: safeGitEnv,
  });
  if (result.terminal !== "exit") {
    const reason = result.error?.message || result.stderr || result.terminal;
    throw new NativeGitCommandError(
      `git ${args.join(" ")} failed: ${reason}`,
      result.terminal,
    );
  }
  if (result.exitCode !== 0) {
    throw new NativeGitCommandError(
      `git ${args.join(" ")} failed: ${
        result.stderr || `exit code ${result.exitCode}`
      }`,
      "exit",
    );
  }
  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function gitOptional(
  cwd: string,
  args: string[],
  options: NativeGitProcessOptions,
) {
  try {
    return await git(cwd, args, options);
  } catch (error) {
    if (!(error instanceof NativeGitCommandError) || error.kind !== "exit") {
      throw error;
    }
    return { stdout: "", stderr: "" };
  }
}

function nativeGitProcessOptions(
  args: NativeGitProcessOptions,
): NativeGitProcessOptions {
  return {
    signal: args.signal,
    processSandbox: args.processSandbox,
  };
}

function hash(value: string | NodeJS.ArrayBufferView): string {
  return createHash("sha256").update(value).digest("hex");
}
