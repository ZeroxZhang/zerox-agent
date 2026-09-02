import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  open,
  readlink,
  readdir,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export async function computeLocalCandidateSourceManifest(root) {
  return computeGitManifest(root, isGeneratedOrPlanningPath);
}

export async function computeAcceptanceInputManifest(root) {
  return computeGitManifest(root, isAcceptanceInputExcluded);
}

export async function computeReviewCandidateManifest(root) {
  return computeGitManifest(root, (relativePath) =>
    isAcceptanceInputExcluded(relativePath)
    || isPlanningPath(relativePath)
    || relativePath === ".zerox/conversation-disclosure-program.json"
    || relativePath === ".zerox/feature_list.json"
    || relativePath === ".zerox/release-program.json"
    || relativePath.startsWith(".zerox/reviews/CD09-"));
}

async function computeGitManifest(root, exclude) {
  const canonicalRoot = await realpath(root);
  const gitEnvironment = trustedGitEnvironment();
  const { stdout: gitDirectoryOutput } = await execFile(
    "/usr/bin/git",
    ["--no-replace-objects", "rev-parse", "--absolute-git-dir"],
    {
      cwd: canonicalRoot,
      env: gitEnvironment,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    },
  );
  const gitDirectory = await realpath(gitDirectoryOutput.trim());
  const { stdout } = await execFile(
    "/usr/bin/git",
    [
      "--no-replace-objects",
      "--literal-pathspecs",
      `--git-dir=${gitDirectory}`,
      `--work-tree=${canonicalRoot}`,
      "-c", "core.fsmonitor=false",
      "-c", "core.untrackedCache=false",
      "ls-files", "--cached", "--others", "--exclude-standard", "-z",
    ],
    {
      cwd: canonicalRoot,
      env: gitEnvironment,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const files = stdout
    .split("\0")
    .filter(Boolean)
    .filter((relativePath) => !exclude(relativePath))
    .sort();
  const hash = createHash("sha256");
  let fileCount = 0;
  for (const relativePath of files) {
    const absolutePath = path.join(root, relativePath);
    const metadata = await lstat(absolutePath);
    if (metadata.isSymbolicLink()) {
      throw new Error(`source manifest rejects symlinks: ${relativePath}`);
    }
    if (!metadata.isFile()) continue;
    const capture = await captureDescriptorFile(absolutePath, relativePath);
    const { bytes } = capture;
    fileCount += 1;
    hash.update(
      `${relativePath}\0file\0${capture.metadata.mode & 0o777}\0${bytes.length}\0`,
    );
    hash.update(bytes);
  }
  return {
    digest: `sha256:${hash.digest("hex")}`,
    fileCount,
  };
}

function trustedGitEnvironment() {
  return {
    HOME: "/var/empty",
    LANG: "en_US.UTF-8",
    PATH: "/usr/bin:/bin",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_COUNT: "0",
    GIT_OPTIONAL_LOCKS: "0",
  };
}

export async function computeTreeManifest(root, options = {}) {
  const canonicalRoot = await realpath(root);
  const entries = [];
  await walk(canonicalRoot, "");
  entries.sort((left, right) =>
    left.relativePath < right.relativePath ? -1 : 1);
  const hash = createHash("sha256");
  for (const entry of entries) {
    hash.update(
      `${entry.relativePath}\0${entry.kind}\0${entry.mode}\0${entry.bytes.length}\0`,
    );
    hash.update(entry.bytes);
  }
  return {
    digest: `sha256:${hash.digest("hex")}`,
    entryCount: entries.length,
  };

  async function walk(base, relativePath) {
    if (relativePath && options.exclude?.(relativePath)) return;
    const absolutePath = path.join(base, relativePath);
    const metadata = await lstat(absolutePath);
    if (metadata.isSymbolicLink()) {
      const target = await readlink(absolutePath);
      const resolvedTarget = path.resolve(path.dirname(absolutePath), target);
      let canonicalTarget;
      try {
        canonicalTarget = await realpath(resolvedTarget);
      } catch {
        throw new Error(`tree symlink target is missing: ${relativePath}`);
      }
      if (
        canonicalTarget !== canonicalRoot
        && !canonicalTarget.startsWith(`${canonicalRoot}${path.sep}`)
      ) {
        throw new Error(`tree symlink escapes root: ${relativePath}`);
      }
      entries.push({
        relativePath,
        kind: "symlink",
        mode: metadata.mode & 0o777,
        bytes: Buffer.from(target),
      });
      return;
    }
    if (metadata.isFile()) {
      const capture = await captureDescriptorFile(
        absolutePath,
        relativePath,
      );
      entries.push({
        relativePath,
        kind: "file",
        mode: capture.metadata.mode & 0o777,
        bytes: capture.bytes,
      });
      return;
    }
    if (!metadata.isDirectory()) return;
    entries.push({
      relativePath: relativePath || ".",
      kind: "directory",
      mode: metadata.mode & 0o777,
      bytes: Buffer.alloc(0),
    });
    for (const name of await readdir(absolutePath)) {
      await walk(base, path.join(relativePath, name));
    }
  }
}

async function captureDescriptorFile(filePath, label) {
  const handle = await open(
    filePath,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1) {
      throw new Error(`manifest rejects non-regular or hardlinked file: ${label}`);
    }
    const bytes = await handle.readFile();
    const [after, leaf, canonicalPath] = await Promise.all([
      handle.stat(),
      lstat(filePath),
      realpath(filePath),
    ]);
    if (
      !after.isFile()
      || after.dev !== before.dev
      || after.ino !== before.ino
      || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs
      || after.ctimeMs !== before.ctimeMs
      || !leaf.isFile()
      || leaf.isSymbolicLink()
      || leaf.dev !== before.dev
      || leaf.ino !== before.ino
      || canonicalPath !== filePath
    ) {
      throw new Error(`manifest file identity changed while reading: ${label}`);
    }
    return { bytes, metadata: after };
  } finally {
    await handle.close();
  }
}

function isGeneratedOrPlanningPath(relativePath) {
  return relativePath.startsWith("release-local/")
    || relativePath.startsWith("release/")
    || relativePath.startsWith("release-test-")
    || relativePath.startsWith("dist/")
    || relativePath.startsWith("dist-electron/")
    || relativePath.startsWith("dist-native/")
    || relativePath.startsWith(".zerox/")
    || isPlanningPath(relativePath);
}

function isPlanningPath(relativePath) {
  return relativePath === ".zerox/progress.md"
    || relativePath === "task_plan.md"
    || relativePath === "findings.md"
    || relativePath === "progress.md";
}

function isAcceptanceInputExcluded(relativePath) {
  if (
    relativePath.startsWith("release-local/")
    || relativePath.startsWith("release/")
    || relativePath.startsWith("release-test-")
    || relativePath.startsWith("dist/")
    || relativePath.startsWith("dist-electron/")
    || relativePath.startsWith("dist-native/")
  ) {
    return true;
  }
  if (
    relativePath === ".zerox/conversation-disclosure-program.json"
    || relativePath === ".zerox/feature_list.json"
  ) {
    return true;
  }
  if (!relativePath.startsWith(
    ".zerox/verification/conversation-disclosure/",
  )) {
    return false;
  }
  if (relativePath.startsWith(
    ".zerox/verification/conversation-disclosure/CD09-scenarios/",
  )) {
    return true;
  }
  const name = path.basename(relativePath);
  return name.startsWith("CD05-chat-browser")
    || name.startsWith("CD06-cross-surface")
    || name.startsWith("CD07-inspector")
    || name === "CD08-hardening.json"
    || name === "CD08-full-gates.md"
    || name.startsWith("CD09-");
}
