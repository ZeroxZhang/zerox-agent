import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { AgentToolExecutionResult } from "./dynamicToolRegistry";
import type { ProcessSandboxProvider } from "./processSandbox";
import { runReadOnlyNativeProcess } from "./nativeReadOnlyProcess";

const ignoredDirectories = new Set([
  ".git",
  "dist",
  "dist-electron",
  "node_modules",
  "release",
]);
const textFilePattern =
  /\.(cjs|css|html|js|json|jsx|md|mjs|ts|tsx|txt|yaml|yml)$/i;

export async function searchCode(args: {
  workspaceRoot: string;
  query: string;
  maxResults?: number;
  signal?: AbortSignal;
  processSandbox?: ProcessSandboxProvider;
}): Promise<AgentToolExecutionResult> {
  const workspaceRoot = String(args.workspaceRoot ?? "");
  const query = String(args.query ?? "").trim();
  const maxResults = Math.max(1, Math.min(Number(args.maxResults ?? 20), 100));

  if (!workspaceRoot) {
    return { ok: false, error: "code_search requires workspaceRoot." };
  }
  if (!query) {
    return { ok: false, error: "code_search query is required." };
  }
  if (args.signal?.aborted) {
    return canceledResult();
  }

  const rgResult = await tryRipgrep(
    workspaceRoot,
    query,
    maxResults,
    args.signal,
    args.processSandbox,
  );
  if (rgResult) {
    return rgResult;
  }

  let results;
  try {
    results = await fallbackSearch(
      workspaceRoot,
      query,
      maxResults,
      args.signal,
    );
  } catch (error) {
    if (args.signal?.aborted) {
      return canceledResult();
    }
    throw error;
  }
  return {
    ok: true,
    result: { workspaceRoot, query, results },
  };
}

async function tryRipgrep(
  workspaceRoot: string,
  query: string,
  maxResults: number,
  signal?: AbortSignal,
  processSandbox?: ProcessSandboxProvider,
): Promise<AgentToolExecutionResult | null> {
  try {
    const processResult = await runReadOnlyNativeProcess({
      argv: [
        "rg",
        "--line-number",
        "--no-heading",
        "--color",
        "never",
        "--glob",
        "!**/node_modules/**",
        "--glob",
        "!**/dist/**",
        "--glob",
        "!**/dist-electron/**",
        "--glob",
        "!**/release/**",
        "-e",
        query,
        "--",
        workspaceRoot,
      ],
      workspaceRoot,
      signal,
      processSandbox,
    });
    if (processResult.terminal === "canceled") {
      return canceledResult();
    }
    if (processResult.terminal === "timeout") {
      return {
        ok: false,
        error: "code_search timed out.",
        errorDetails: { kind: "timeout" },
      };
    }
    if (processResult.terminal === "spawn_error") {
      return null;
    }
    if (processResult.exitCode === 1) {
      return { ok: true, result: { workspaceRoot, query, results: [] } };
    }
    if (processResult.exitCode !== 0) {
      return null;
    }

    const results = processResult.stdout
      .split("\n")
      .filter(Boolean)
      .slice(0, maxResults)
      .map((line) => {
        const [absolutePath, lineNumber, ...previewParts] = line.split(":");
        return {
          path: absolutePath,
          relativePath: path.relative(workspaceRoot, absolutePath ?? ""),
          line: Number(lineNumber),
          preview: previewParts.join(":").trim(),
        };
      });
    return {
      ok: true,
      result: { workspaceRoot, query, results },
    };
  } catch (error) {
    return {
      ok: false,
      error: `code_search process failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      errorDetails: { kind: "process_error" },
    };
  }
}

async function fallbackSearch(
  workspaceRoot: string,
  query: string,
  maxResults: number,
  signal?: AbortSignal,
) {
  const results: Array<{
    path: string;
    relativePath: string;
    line: number;
    preview: string;
  }> = [];

  async function visit(directory: string) {
    signal?.throwIfAborted();
    if (results.length >= maxResults) {
      return;
    }

    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      signal?.throwIfAborted();
      if (results.length >= maxResults) {
        return;
      }
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) {
          await visit(path.join(directory, entry.name));
        }
        continue;
      }
      if (!entry.isFile() || !textFilePattern.test(entry.name)) {
        continue;
      }

      const filePath = path.join(directory, entry.name);
      const fileStat = await stat(filePath);
      if (fileStat.size > 1024 * 1024) {
        continue;
      }
      const content = await readFile(filePath, "utf8");
      content.split("\n").forEach((line, index) => {
        if (results.length < maxResults && line.includes(query)) {
          results.push({
            path: filePath,
            relativePath: path.relative(workspaceRoot, filePath),
            line: index + 1,
            preview: line.trim(),
          });
        }
      });
    }
  }

  await visit(workspaceRoot);
  return results;
}

function canceledResult(): AgentToolExecutionResult {
  return {
    ok: false,
    error: "code_search was canceled.",
    errorDetails: { kind: "canceled" },
  };
}
