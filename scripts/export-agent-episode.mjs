import path from "node:path";
import { pathToFileURL } from "node:url";

const args = parseArgs(process.argv.slice(2));
const configDir = readString(args["config-dir"]);
const runId = readString(args["run-id"]);
const outDir = readString(args.out);
const latestValidation = args["latest-validation"] === true;
const backend = readString(args.backend);

if (args.help || !configDir || (!runId && !latestValidation)) {
  console.log([
    "Usage:",
    "  npm run episode:export -- --config-dir <userData/config> --run-id <runId> [--out <dir>]",
    "  npm run episode:export -- --config-dir <userData/config> --latest-validation [--out <dir>]",
    "",
    "Exports typed episode evidence from local Zerox Agent stores, including",
    "run.json, checkpoint.json, trajectory.jsonl, run-graph.json,",
    "learning-candidates.json, verification.json, eval-candidate.json, and metadata.json.",
  ].join("\n"));
  process.exit(args.help ? 0 : 1);
}

try {
  const servicePath = path.resolve("dist-electron/main/agentEpisodeExportCli.js");
  const { exportAgentEpisodeFromConfig } = await import(
    pathToFileURL(servicePath).href
  );
  const result = await exportAgentEpisodeFromConfig({
    configDir,
    ...(runId ? { runId } : {}),
    ...(outDir ? { outDir } : {}),
    ...(backend ? { backend } : {}),
    latestValidation,
  });

  console.log(
    `Episode ${result.runId} exported to ${result.outDir} (${result.files.length} files).`,
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Unable to export episode evidence.",
  );
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--help" || item === "-h") {
      parsed.help = true;
      continue;
    }
    if (!item.startsWith("--")) {
      continue;
    }

    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }

    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value : null;
}
