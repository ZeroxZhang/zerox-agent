#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

const repositoryRoot = path.resolve(process.cwd());
const fixtureRoot = path.join(
  repositoryRoot,
  "fixtures/conversation-disclosure/v3.9.1-multidomain",
);
const generatorPath =
  "scripts/generate-v391-conversation-fixture-from-stores.mjs";
const expectedFiles = [
  "config/agent-goals/cd09-v391-goal.json",
  "config/agent-goals/cd09-v391-goal.ledger.jsonl",
  "config/agent-runs.jsonl",
  "config/agent-trajectories/cd09-v391-run.jsonl",
  "config/chat-sessions.json",
  "config/plans/cd09-v391-plan.events.jsonl",
  "config/plans/cd09-v391-plan.json",
  "config/plans/session-index.json",
];
const sourceStorePaths = [
  "src/main/chatSessionStore.ts",
  "src/main/agentGoalStore.ts",
  "src/main/planStore.ts",
  "src/main/agentRunStore.ts",
  "src/main/agentTrajectoryStore.ts",
];
const actualFiles = (await listFiles(path.join(fixtureRoot, "config")))
  .map((file) => `config/${file}`)
  .sort();
if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
  throw new Error(
    `v3.9.1 fixture file set changed: ${JSON.stringify(actualFiles)}`,
  );
}

const generatorBytes = await readFile(path.join(repositoryRoot, generatorPath));
const generatorSource = generatorBytes.toString("utf8");
if (
  /node:fs(?:\/promises)?/.test(generatorSource)
  || /\b(?:writeFile|appendFile|createWriteStream|copyFile|rename)\b/.test(
    generatorSource,
  )
) {
  throw new Error("v3.9.1 fixture generator contains a direct filesystem writer.");
}
const files = [];
for (const relativePath of expectedFiles) {
  const absolutePath = path.join(fixtureRoot, relativePath);
  const identity = await lstat(absolutePath);
  if (!identity.isFile() || identity.isSymbolicLink() || identity.nlink !== 1) {
    throw new Error(`Fixture source is not a single-link regular file: ${relativePath}`);
  }
  const bytes = await readFile(absolutePath);
  files.push({
    path: relativePath,
    sha256: sha256(bytes),
    bytes: bytes.length,
    mediaType: relativePath.endsWith(".jsonl")
      ? "application/x-ndjson"
      : "application/json",
    lineCount: countLines(bytes),
  });
}
const sourceStores = sourceStorePaths.map((sourcePath) => ({
  path: sourcePath,
  gitBlobOid: git("rev-parse", `v3.9.1:${sourcePath}`),
}));
const fixtureDigest = sha256(Buffer.from(files.map((file) =>
  `${file.path}\0${file.sha256}\0${file.bytes}\0${file.lineCount}\n`
).join("")));
const manifest = {
  schemaVersion: 1,
  fixtureId: "conversation-disclosure-v3.9.1-multidomain-json",
  sourceRelease: {
    tag: "v3.9.1",
    packageVersion: "3.9.1",
    annotatedTagObject: git("rev-parse", "v3.9.1^{tag}"),
    commit: git("rev-parse", "v3.9.1^{commit}"),
    tree: git("rev-parse", "v3.9.1^{tree}"),
    tagSignature: { present: false, verified: false },
  },
  generatedBackend: "json",
  releaseDefaultBackend: "sqlite",
  generator: {
    path: generatorPath,
    sha256: sha256(generatorBytes),
    command:
      "node scripts/generate-v391-conversation-fixture-from-stores.mjs --dist-root <exact-v3.9.1-clone>/dist-electron --config-dir <output>/config",
    sourceBuild:
      "cd <exact-v3.9.1-clone> && npm ci && npm run build",
    nodeVersion: process.version,
    npmVersion: execFileSync("npm", ["--version"], { encoding: "utf8" }).trim(),
    deterministicGenerationCount: 2,
    byteForByteMatch: true,
    directFilesystemWrites: false,
  },
  sourceStores,
  relationships: {
    sessionId: "cd09-v391-session",
    requestId: "cd09-v391-request",
    turnId: "cd09-v391-turn",
    goalId: "cd09-v391-goal",
    planId: "cd09-v391-plan",
    runId: "cd09-v391-run",
    milestoneId: "cd09-v391-milestone",
    workspaceId: "cd09-v391-workspace",
  },
  intentionalAbsences: [
    "conversation_causal_records",
    "workspace_run_records",
    "kernel_records",
    "projection_cursors",
  ],
  files,
  fixtureDigest,
};
await writeFile(
  path.join(fixtureRoot, "fixture-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { encoding: "utf8", flag: "wx", mode: 0o600 },
);
process.stdout.write(`${JSON.stringify({
  fixtureDigest,
  fileCount: files.length,
  commit: manifest.sourceRelease.commit,
  tree: manifest.sourceRelease.tree,
})}\n`);

function git(...args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function countLines(bytes) {
  if (bytes.length === 0) return 0;
  return bytes.toString("utf8").split("\n").length - 1;
}

async function listFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink()) {
      throw new Error(`Fixture source contains a symbolic link: ${entry.name}`);
    }
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await listFiles(path.join(directory, entry.name), relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(`Fixture source contains a special file: ${relativePath}`);
    }
  }
  return files;
}
