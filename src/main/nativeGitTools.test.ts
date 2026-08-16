import { execFile } from "node:child_process";
import {
  access,
  chmod,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
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
    await rm(repoDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
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

  it("disables repository-configured Git process extensions", async () => {
    const fsmonitorMarker = path.join(repoDir, "fsmonitor-invoked");
    const externalDiffMarker = path.join(repoDir, "external-diff-invoked");
    const textconvMarker = path.join(repoDir, "textconv-invoked");
    const fsmonitor = await writeMarkerScript(
      repoDir,
      "fsmonitor.sh",
      fsmonitorMarker,
    );
    const externalDiff = await writeMarkerScript(
      repoDir,
      "external-diff.sh",
      externalDiffMarker,
    );
    const textconv = await writeMarkerScript(
      repoDir,
      "textconv.sh",
      textconvMarker,
    );
    await writeFile(path.join(repoDir, ".gitattributes"), "*.md diff=unsafe\n");
    await execFileAsync("git", ["add", ".gitattributes"], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-m", "add attributes"], {
      cwd: repoDir,
    });
    await execFileAsync("git", ["config", "core.fsmonitor", fsmonitor], {
      cwd: repoDir,
    });
    await execFileAsync("git", ["config", "diff.external", externalDiff], {
      cwd: repoDir,
    });
    await execFileAsync(
      "git",
      ["config", "diff.unsafe.textconv", textconv],
      { cwd: repoDir },
    );
    await writeFile(path.join(repoDir, "README.md"), "hello\nworld\n", "utf8");

    await expect(readGitStatus({ workspaceRoot: repoDir })).resolves.toMatchObject({
      ok: true,
    });
    await expect(readGitDiff({ workspaceRoot: repoDir })).resolves.toMatchObject({
      ok: true,
    });

    for (
      const marker of [fsmonitorMarker, externalDiffMarker, textconvMarker]
    ) {
      await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });
});

async function writeMarkerScript(
  directory: string,
  name: string,
  markerPath: string,
): Promise<string> {
  const scriptPath = path.join(directory, name);
  await writeFile(
    scriptPath,
    `#!/bin/sh\nprintf invoked > ${JSON.stringify(markerPath)}\n`,
    "utf8",
  );
  await chmod(scriptPath, 0o755);
  return scriptPath;
}
