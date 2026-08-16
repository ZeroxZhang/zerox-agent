import {
  access,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { searchCode } from "./nativeCodeTools";

describe("native code tools", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "zerox-code-search-"));
    await mkdir(path.join(workspaceRoot, "src"));
    await writeFile(
      path.join(workspaceRoot, "src", "agent.ts"),
      "export function runAgent() { return 'ok'; }\n",
      "utf8",
    );
    await mkdir(path.join(workspaceRoot, "node_modules"));
    await writeFile(
      path.join(workspaceRoot, "node_modules", "ignored.ts"),
      "runAgent should not be returned\n",
      "utf8",
    );
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it("searches code content and skips dependency folders", async () => {
    await expect(
      searchCode({
        workspaceRoot,
        query: "runAgent",
        maxResults: 10,
      }),
    ).resolves.toEqual({
      ok: true,
      result: {
        workspaceRoot,
        query: "runAgent",
        results: [
          {
            path: path.join(workspaceRoot, "src", "agent.ts"),
            relativePath: "src/agent.ts",
            line: 1,
            preview: "export function runAgent() { return 'ok'; }",
          },
        ],
      },
    });
  });

  it("requires a query", async () => {
    await expect(
      searchCode({ workspaceRoot, query: "   " }),
    ).resolves.toEqual({
      ok: false,
      error: "code_search query is required.",
    });
  });

  it("treats option-shaped queries as literal ripgrep patterns", async () => {
    const markerPath = path.join(workspaceRoot, "injected.txt");
    const query =
      `--pre=sh -c 'printf injected > ${JSON.stringify(markerPath)}'`;
    await writeFile(
      path.join(workspaceRoot, "src", "literal-option.ts"),
      `// ${query}\n`,
      "utf8",
    );

    await expect(
      searchCode({ workspaceRoot, query }),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        query,
        results: [
          {
            relativePath: "src/literal-option.ts",
            line: 1,
          },
        ],
      },
    });
    await expect(access(markerPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
