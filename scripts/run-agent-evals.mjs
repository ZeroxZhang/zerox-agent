#!/usr/bin/env node

const [{ createAgentEvalFixtures }, { runAgentEvals }] = await Promise.all([
  import("../dist-electron/main/eval/agentEvalFixtures.js"),
  import("../dist-electron/main/eval/agentEvalRunner.js"),
]);

const report = await runAgentEvals(createAgentEvalFixtures());
console.log(JSON.stringify(report, null, 2));

if (report.failed > 0) {
  process.exitCode = 1;
}
