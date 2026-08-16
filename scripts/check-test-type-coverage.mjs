import {
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";
import {
  parseJsonConfigFileContent,
  readConfigFile,
  sys,
} from "typescript";

const rootDir = process.cwd();
const configPath = path.join(rootDir, "tsconfig.tests.json");
const configFile = readConfigFile(configPath, sys.readFile);
if (configFile.error) {
  throw new Error(formatDiagnostic(configFile.error));
}

const expectedInclude = [
  "src/**/*.test.ts",
  "src/**/*.test.tsx",
];
if (JSON.stringify(configFile.config.include) !== JSON.stringify(expectedInclude)) {
  throw new Error(
    `tsconfig.tests.json must use the broad test includes ${JSON.stringify(expectedInclude)}.`,
  );
}

const parsedConfig = parseJsonConfigFileContent(
  configFile.config,
  sys,
  rootDir,
  undefined,
  configPath,
);
if (parsedConfig.errors.length > 0) {
  throw new Error(parsedConfig.errors.map(formatDiagnostic).join("\n"));
}

const actualTests = canonicalTestFiles(
  listFilesRecursively(path.join(rootDir, "src")),
);
const projectTests = canonicalTestFiles(parsedConfig.fileNames);
const missing = actualTests.filter((filePath) => !projectTests.includes(filePath));
const unexpected = projectTests.filter(
  (filePath) => !actualTests.includes(filePath),
);

console.log(
  `[test-types] repo test file count = ${actualTests.length}; ` +
    `project covered count = ${projectTests.length}`,
);
if (missing.length > 0 || unexpected.length > 0) {
  throw new Error(
    [
      "tsconfig.tests.json does not cover the repository test set.",
      ...missing.map((filePath) => `missing: ${filePath}`),
      ...unexpected.map((filePath) => `unexpected: ${filePath}`),
    ].join("\n"),
  );
}

function listFilesRecursively(directory, visited = new Set()) {
  const canonicalDirectory = canonicalPath(directory);
  if (visited.has(canonicalDirectory)) {
    return [];
  }
  visited.add(canonicalDirectory);

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    const metadata = statSync(entryPath);
    if (metadata.isDirectory()) {
      return listFilesRecursively(entryPath, visited);
    }
    return metadata.isFile() ? [entryPath] : [];
  });
}

function canonicalTestFiles(filePaths) {
  return [
    ...new Set(
      filePaths
        .filter((filePath) => /\.test\.tsx?$/.test(filePath))
        .map(canonicalPath),
    ),
  ].sort();
}

function canonicalPath(filePath) {
  const canonical = path.normalize(realpathSync.native(path.resolve(filePath)));
  return sys.useCaseSensitiveFileNames ? canonical : canonical.toLowerCase();
}

function formatDiagnostic(diagnostic) {
  return typeof diagnostic.messageText === "string"
    ? diagnostic.messageText
    : diagnostic.messageText.messageText;
}
