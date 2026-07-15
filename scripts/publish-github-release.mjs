import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path, { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  inspectReleaseArtifacts,
  runReleasePreflight,
} from "./release-preflight.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const notesFile = process.argv[2] ? resolve(process.argv[2]) : "";
const releaseEnv = { ...process.env };
for (const key of Object.keys(releaseEnv)) {
  if (key.startsWith("GIT_")) delete releaseEnv[key];
}

function run(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    env: releaseEnv,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.error || result.status !== 0) {
    if (allowFailure) return { ok: false, output };
    throw new Error(
      `${command} ${args.join(" ")} failed${output ? `: ${output}` : ""}`,
    );
  }
  return { ok: true, output };
}

if (!notesFile || !existsSync(notesFile) || statSync(notesFile).size === 0) {
  throw new Error(
    "Usage: npm run release:publish -- /absolute/path/to/release-notes.md",
  );
}

const manifest = await runReleasePreflight(rootDir);
const tag = `v${manifest.version}`;
const head = run("/usr/bin/git", ["rev-parse", "HEAD"]).output;
const tagCommit = run("/usr/bin/git", [
  "rev-parse",
  `refs/tags/${tag}^{commit}`,
]).output;
if (head !== tagCommit) {
  throw new Error(`${tag} must resolve to the exact clean release HEAD ${head}`);
}
if (run("gh", [
  "release",
  "view",
  tag,
  "--repo",
  "ZeroxZhang/zerox-agent",
], { allowFailure: true }).ok) {
  throw new Error(`GitHub Release ${tag} already exists; refusing an implicit overwrite`);
}
function githubTagCommit() {
  let object = JSON.parse(run("gh", [
    "api",
    `repos/ZeroxZhang/zerox-agent/git/ref/tags/${encodeURIComponent(tag)}`,
  ]).output).object;
  for (let depth = 0; object?.type === "tag" && depth < 5; depth += 1) {
    object = JSON.parse(run("gh", [
      "api",
      `repos/ZeroxZhang/zerox-agent/git/tags/${object.sha}`,
    ]).output).object;
  }
  if (object?.type !== "commit" || !/^[a-f0-9]{40}$/.test(object.sha)) {
    throw new Error(`${tag} GitHub tag does not resolve to a commit`);
  }
  return object.sha;
}

if (githubTagCommit() !== head) {
  throw new Error(`${tag} remote tag must resolve to the exact release HEAD ${head}`);
}

const sourceUploadPaths = [
  ...manifest.assets.flatMap((asset) => [asset.filePath, asset.blockmapPath]),
  manifest.metadataPath,
  manifest.signaturePath,
];
if (sourceUploadPaths.length !== 6 || new Set(sourceUploadPaths).size !== 6) {
  throw new Error("release publication requires exactly six distinct assets");
}

const stagingRoot = mkdtempSync(path.join(tmpdir(), "zerox-release-publish-"));
let stagedManifest;
try {
  mkdirSync(path.join(stagingRoot, "release"));
  mkdirSync(path.join(stagingRoot, "build"));
  copyFileSync(path.join(rootDir, "package.json"), path.join(stagingRoot, "package.json"));
  copyFileSync(
    manifest.publicKeyPath,
    path.join(stagingRoot, "build", "update-signing-public-key.pem"),
  );
  for (const sourcePath of sourceUploadPaths) {
    copyFileSync(sourcePath, path.join(stagingRoot, "release", path.basename(sourcePath)));
  }
  stagedManifest = await inspectReleaseArtifacts(stagingRoot);
} catch (error) {
  rmSync(stagingRoot, { recursive: true, force: true });
  throw error;
}
const uploadPaths = [
  ...stagedManifest.assets.flatMap((asset) => [asset.filePath, asset.blockmapPath]),
  stagedManifest.metadataPath,
  stagedManifest.signaturePath,
];

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return `sha256:${hash.digest("hex")}`;
}

const expectedAssets = new Map(
  await Promise.all(uploadPaths.map(async (filePath) => [
    filePath.split("/").pop(),
    { size: statSync(filePath).size, digest: await sha256File(filePath) },
  ])),
);
const finalTitle = `Zerox Agent ${tag}`;
const stagingTitle = `${finalTitle} [staging ${randomUUID()}]`;

function inspectPublishedRelease(expectedDraft) {
  const published = JSON.parse(run("gh", [
    "release",
    "view",
    tag,
    "--repo",
    "ZeroxZhang/zerox-agent",
    "--json",
    "tagName,name,isDraft,isPrerelease,url,assets",
  ]).output);
  const actualAssets = new Map(
    published.assets.map((asset) => [asset.name, {
      size: asset.size,
      digest: asset.digest,
    }]),
  );
  if (
    published.tagName !== tag ||
    published.name !== (expectedDraft ? stagingTitle : finalTitle) ||
    published.isDraft !== expectedDraft ||
    published.isPrerelease ||
    JSON.stringify([...actualAssets].sort()) !==
      JSON.stringify([...expectedAssets].sort())
  ) {
    throw new Error(
      `${expectedDraft ? "draft" : "published"} GitHub Release ${tag} failed the six-asset verification`,
    );
  }
  return published;
}

let draftCreated = false;
try {
  run("gh", [
    "release",
    "create",
    tag,
    ...uploadPaths,
    "--repo",
    "ZeroxZhang/zerox-agent",
    "--verify-tag",
    "--target",
    head,
    "--title",
    stagingTitle,
    "--notes-file",
    notesFile,
    "--draft",
  ]);
  draftCreated = true;
  inspectPublishedRelease(true);
  run("gh", [
    "release",
    "edit",
    tag,
    "--repo",
    "ZeroxZhang/zerox-agent",
    "--draft=false",
    "--latest",
    "--title",
    finalTitle,
  ]);
  draftCreated = false;
  inspectPublishedRelease(false);
  const finalLocalAssets = new Map(
    await Promise.all(uploadPaths.map(async (filePath) => [
      filePath.split("/").pop(),
      { size: statSync(filePath).size, digest: await sha256File(filePath) },
    ])),
  );
  if (JSON.stringify([...finalLocalAssets].sort()) !== JSON.stringify([...expectedAssets].sort())) {
    throw new Error("local release assets changed during GitHub publication");
  }
  if (run("/usr/bin/git", ["rev-parse", "HEAD"]).output !== head) {
    throw new Error("Git HEAD changed during GitHub publication");
  }
  if (run("/usr/bin/git", ["status", "--porcelain", "--untracked-files=all"]).output) {
    throw new Error("working tree changed during GitHub publication");
  }
  if (githubTagCommit() !== head) {
    throw new Error(`${tag} remote tag changed during GitHub publication`);
  }
  const finalPublished = inspectPublishedRelease(false);
  console.log(`Published and verified ${tag}: ${finalPublished.url}`);
} catch (error) {
  const remote = run("gh", [
    "release",
    "view",
    tag,
    "--repo",
    "ZeroxZhang/zerox-agent",
    "--json",
    "isDraft,name",
  ], { allowFailure: true });
  const remoteDraft = remote.ok ? JSON.parse(remote.output) : null;
  if (
    draftCreated ||
    (remoteDraft?.isDraft === true && remoteDraft?.name === stagingTitle)
  ) {
    run("gh", [
      "release",
      "delete",
      tag,
      "--repo",
      "ZeroxZhang/zerox-agent",
      "--yes",
    ], { allowFailure: true });
  }
  throw error;
} finally {
  rmSync(stagingRoot, { recursive: true, force: true });
}
