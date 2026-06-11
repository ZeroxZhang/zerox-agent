import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { AgentToolExecutionResult } from "./dynamicToolRegistry";

const execFileAsync = promisify(execFile);
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

  const rgResult = await tryRipgrep(workspaceRoot, query, maxResults);
  if (rgResult) {
    return rgResult;
  }

  const results = await fallbackSearch(workspaceRoot, query, maxResults);
  return {
    ok: true,
    result: { workspaceRoot, query, results },
  };
}

async function tryRipgrep(
  workspaceRoot: string,
  query: string,
  maxResults: number,
): Promise<AgentToolExecutionResult | null> {
  try {
    const { stdout } = await execFileAsync(
      "rg",
      [
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
        query,
        workspaceRoot,
      ],
      { maxBuffer: 1024 * 1024 * 4 },
    );
    const results = stdout
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
    const code = (error as { code?: number | string }).code;
    if (code === 1) {
      return { ok: true, result: { workspaceRoot, query, results: [] } };
    }

    return null;
  }
}

async function fallbackSearch(
  workspaceRoot: string,
  query: string,
  maxResults: number,
) {
  const results: Array<{
    path: string;
    relativePath: string;
    line: number;
    preview: string;
  }> = [];

  async function visit(directory: string) {
    if (results.length >= maxResults) {
      return;
    }

    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
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
