import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readGitDiff, readGitStatus } from "./nativeGitTools";

const execFileAsync = promisify(execFile);

describe("native git tools", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await mkdtemp(path.join(os.tmpdir(), "zerox-native-git-"));
    await execFileAsync("git", ["init", "-b", "master"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: repoDir,
    });
    await execFileAsync("git", ["config", "user.name", "Test User"], {
      cwd: repoDir,
    });
    await writeFile(path.join(repoDir, "README.md"), "hello\n", "utf8");
    await execFileAsync("git", ["add", "README.md"], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-m", "initial"], { cwd: repoDir });
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  it("returns structured git status", async () => {
    await writeFile(path.join(repoDir, "notes.md"), "draft\n", "utf8");

    await expect(readGitStatus({ workspaceRoot: repoDir })).resolves.toEqual({
      ok: true,
      result: {
        workspaceRoot: repoDir,
        branch: "master",
        clean: false,
        entries: [
          {
            path: "notes.md",
            indexStatus: "?",
            worktreeStatus: "?",
          },
        ],
      },
    });
  });

  it("returns diff stats and raw diff text", async () => {
    await writeFile(path.join(repoDir, "README.md"), "hello\nworld\n", "utf8");

    const result = await readGitDiff({ workspaceRoot: repoDir });

    expect(result).toMatchObject({
      ok: true,
      result: {
        workspaceRoot: repoDir,
        filesChanged: 1,
      },
    });
    expect(result.ok ? result.result.rawDiff : "").toContain("+world");
  });
});
