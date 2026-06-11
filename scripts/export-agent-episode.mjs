import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));

if (args.help || !args.configDir || !args.runId) {
  console.log([
    "Usage:",
    "  npm run episode:export -- --config-dir <userData/config> --run-id <runId> [--out <dir>]",
    "",
    "Exports run.json, checkpoint.json, trajectory.jsonl, learning-candidates.json,",
    "verification.json, and metadata.json from local Zerox Agent stores.",
  ].join("\n"));
  process.exit(args.help ? 0 : 1);
}

const configDir = path.resolve(args.configDir);
const outDir = path.resolve(args.out ?? path.join("episode-exports", args.runId));

const run = await readRun(configDir, args.runId);
const checkpoint = await readJsonOrNull(
  path.join(configDir, "agent-executions", `${args.runId}.json`),
);
const trajectory = await readTextOrEmpty(
  path.join(configDir, "agent-trajectories", `${args.runId}.jsonl`),
);
const learningCandidates = await readLearningCandidates(configDir, args.runId);
const verification = {
  passed: Boolean(run && trajectory.includes("\"final_summary\"")),
  checks: ["run_record", "trajectory_final_summary"],
};
const metadata = {
  runId: args.runId,
  exportedAt: new Date().toISOString(),
  sourceConfigDir: configDir,
  fileCount: 6,
};

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "run.json"), `${JSON.stringify(run, null, 2)}\n`);
await writeFile(
  path.join(outDir, "checkpoint.json"),
  `${JSON.stringify(checkpoint, null, 2)}\n`,
);
await writeFile(path.join(outDir, "trajectory.jsonl"), trajectory);
await writeFile(
  path.join(outDir, "learning-candidates.json"),
  `${JSON.stringify(learningCandidates, null, 2)}\n`,
);
await writeFile(
  path.join(outDir, "verification.json"),
  `${JSON.stringify(verification, null, 2)}\n`,
);
await writeFile(
  path.join(outDir, "metadata.json"),
  `${JSON.stringify(metadata, null, 2)}\n`,
);

console.log(`Episode exported to ${outDir}`);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--help" || item === "-h") {
      parsed.help = true;
      continue;
    }
    if (item.startsWith("--")) {
      parsed[item.slice(2)] = argv[index + 1];
      index += 1;
    }
  }
  return parsed;
}

async function readRun(configDir, runId) {
  const raw = await readTextOrEmpty(path.join(configDir, "agent-runs.jsonl"));
  const records = raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return records.find((record) => record.id === runId) ?? null;
}

async function readLearningCandidates(configDir, runId) {
  const stored = await readJsonOrNull(
    path.join(configDir, "agent-learning-candidates.json"),
  );
  const candidates = Array.isArray(stored?.candidates)
    ? stored.candidates
    : Array.isArray(stored)
      ? stored
      : [];
  return candidates.filter((candidate) => candidate.sourceRunId === runId);
}

async function readJsonOrNull(filePath) {
  const raw = await readTextOrEmpty(filePath);
  return raw ? JSON.parse(raw) : null;
}

async function readTextOrEmpty(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}
