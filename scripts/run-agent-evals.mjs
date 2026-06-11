#!/usr/bin/env node

const args = parseArgs(process.argv.slice(2));
const configDir = args["config-dir"] ?? process.env.BUILDING_AGENT_CONFIG_DIR;

const [
  { createAgentEvalFixtures },
  {
    createCombinedAgentEvalFixtures,
    createPromotedAgentEvalFixtureStore,
  },
  { runAgentEvals },
] = await Promise.all([
  import("../dist-electron/main/eval/agentEvalFixtures.js"),
  import("../dist-electron/main/eval/agentPromotedEvalFixtures.js"),
  import("../dist-electron/main/eval/agentEvalRunner.js"),
]);

const builtInFixtures = createAgentEvalFixtures();
const promotedFixtures = configDir
  ? await createPromotedAgentEvalFixtureStore({ configDir }).list()
  : [];
const fixtures = configDir
  ? createCombinedAgentEvalFixtures(builtInFixtures, promotedFixtures)
  : builtInFixtures;

const report = await runAgentEvals(fixtures);
console.log(JSON.stringify(report, null, 2));

if (report.failed > 0) {
  process.exitCode = 1;
}

function parseArgs(values) {
  const parsed = {};

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value?.startsWith("--")) {
      continue;
    }

    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
      continue;
    }

    parsed[key] = next;
    index += 1;
  }

  return parsed;
}
