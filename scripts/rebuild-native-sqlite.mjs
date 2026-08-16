import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(import.meta.dirname, "..");
const moduleDir = path.join(rootDir, "node_modules", "better-sqlite3");
const electronRebuildMain = require.resolve("@electron/rebuild");
const electronRebuildRoot = path.resolve(
  path.dirname(electronRebuildMain),
  "..",
);
const electronRebuildRequire = createRequire(
  path.join(electronRebuildRoot, "package.json"),
);
const nodeGypBin = electronRebuildRequire.resolve(
  "node-gyp/bin/node-gyp.js",
);
const nodeHeadersRoot = resolveNodeHeadersRoot();

const evidence = {
  runtime: "node",
  node: process.versions.node,
  modulesAbi: process.versions.modules,
  nodeGypBin,
  nodeHeadersRoot,
  moduleDir,
  networkRequired: false,
};

if (process.argv.includes("--check")) {
  console.log(`[smoke:node-rebuild] ${JSON.stringify(evidence)}`);
  process.exit(0);
}

console.log(`[smoke:node-rebuild] ${JSON.stringify(evidence)}`);
const result = spawnSync(
  process.execPath,
  [
    nodeGypBin,
    "rebuild",
    "--release",
    `--nodedir=${nodeHeadersRoot}`,
  ],
  {
    cwd: moduleDir,
    env: {
      ...process.env,
      npm_config_build_from_source: "true",
      npm_config_nodedir: nodeHeadersRoot,
      npm_config_offline: "true",
      npm_config_runtime: "node",
      npm_config_target: process.versions.node,
      npm_config_update_notifier: "false",
    },
    stdio: "inherit",
  },
);

if (result.error) {
  throw result.error;
}
if (result.signal) {
  console.error(
    `[smoke:node-rebuild] local node-gyp exited with signal ${result.signal}.`,
  );
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}

function resolveNodeHeadersRoot() {
  const configured = process.env.ZEROX_NODE_HEADERS_DIR?.trim();
  const executable = realpathSync.native(process.execPath);
  const executablePrefix = path.resolve(path.dirname(executable), "..");
  const candidates = [
    configured,
    executablePrefix,
  ].filter((candidate) => Boolean(candidate));

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (
      existsSync(path.join(resolved, "include", "node", "node.h")) &&
      existsSync(path.join(resolved, "include", "node", "common.gypi"))
    ) {
      return realpathSync.native(resolved);
    }
  }

  throw new Error(
    "Offline Node ABI rebuild requires local Node headers beside process.execPath " +
      "or in ZEROX_NODE_HEADERS_DIR.",
  );
}
