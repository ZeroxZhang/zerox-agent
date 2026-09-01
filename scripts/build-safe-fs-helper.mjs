#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  createReadStream,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  loadPinnedSafeFsToolchainPolicy,
  selectSafeFsToolchain,
} from "./safe-fs-toolchain-selection.mjs";
import { inspectPinnedUnsignedSafeFsHelper } from "./inspect-safe-fs-helper.mjs";

if (process.platform !== "darwin") {
  console.log(JSON.stringify({ kind: "zerox-safe-fs-build", status: "skipped", platform: process.platform }));
  process.exit(0);
}

const root = path.resolve(import.meta.dirname, "..");
const architecture = process.arch === "x64" ? "x86_64" : process.arch;
if (!new Set(["arm64", "x86_64"]).has(architecture)) {
  throw new Error(`Unsupported macOS safe-fs architecture: ${process.arch}`);
}
const sourcePath = path.join(root, "native/macos/zerox-safe-fs.c");
const outputDirectory = path.join(root, `dist-native/darwin-${process.arch}`);
const outputPath = path.join(outputDirectory, "zerox-safe-fs");
const temporaryDirectory = path.join(
  outputDirectory,
  `.build-${process.pid}`,
);
const temporaryPath = path.join(temporaryDirectory, "zerox-safe-fs");
const toolchainPolicy = loadPinnedSafeFsToolchainPolicy(root);
const { configuredCompiler, configuredSdkRoot } = selectSafeFsToolchain({
  policy: toolchainPolicy,
  environment: process.env,
  resolveXcrun,
});
const compilerPath = realpathSync(configuredCompiler);
if (toolchainPolicy && compilerPath !== toolchainPolicy.compiler.canonicalPath) {
  throw new Error("CC canonical path differs from the caller-reviewed compiler");
}
const sdkRoot = realpathSync(configuredSdkRoot);
if (toolchainPolicy && sdkRoot !== toolchainPolicy.sdk.canonicalPath) {
  throw new Error("SDKROOT canonical path differs from the caller-reviewed SDK");
}
const buildToolchainBefore = toolchainPolicy
  ? await capturePinnedBuildToolchain(toolchainPolicy)
  : null;
mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
mkdirSync(temporaryDirectory, { mode: 0o700 });

let buildError;
try {
  run(compilerPath, [
    "-arch", architecture,
    "-isysroot", sdkRoot,
    "-mmacosx-version-min=12.0",
    "-std=c17",
    "-Os",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-D_DARWIN_C_SOURCE",
    "-D_FORTIFY_SOURCE=2",
    "-fstack-protector-strong",
    "-fPIE",
    "-Wl,-pie",
    "-Wl,-dead_strip",
    "-o", temporaryPath,
    sourcePath,
  ]);
  chmodSync(temporaryPath, 0o755);
  renameSync(temporaryPath, outputPath);
} catch (error) {
  buildError = error;
}
let toolchainPostflightError;
if (toolchainPolicy) {
  try {
    const buildToolchainAfter = await capturePinnedBuildToolchain(toolchainPolicy);
    if (JSON.stringify(buildToolchainAfter) !== JSON.stringify(buildToolchainBefore)) {
      toolchainPostflightError = new Error(
        "caller-reviewed compiler or SDK changed during safe-fs build",
      );
    }
  } catch (error) {
    toolchainPostflightError = error;
  }
}
rmSync(temporaryDirectory, { recursive: true, force: true });
if (buildError && toolchainPostflightError) {
  throw new Error(
    `safe-fs build failed (${buildError.message}); toolchain postflight also failed: ${toolchainPostflightError.message}`,
    { cause: buildError },
  );
}
if (buildError) throw buildError;
if (toolchainPostflightError) throw toolchainPostflightError;

const helper = inspectPinnedUnsignedSafeFsHelper(
  outputPath,
  toolchainPolicy,
);

console.log(JSON.stringify({
  kind: "zerox-safe-fs-build",
  status: "passed",
  platform: process.platform,
  architecture: process.arch,
  minimumSystemVersion: "12.0",
  outputPath: path.relative(root, outputPath),
  bytes: helper.bytes,
  sha256: helper.sha256,
}));

function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.signal || result.status !== 0) {
    throw new Error(
      `${command} failed${result.signal ? ` with ${result.signal}` : ` with ${result.status}`}`
      + `${result.stderr ? `: ${result.stderr.trim()}` : ""}`,
    );
  }
  return result.stdout ?? "";
}

async function capturePinnedBuildToolchain(policy) {
  if (
    realpathSync(configuredCompiler) !== policy.compiler.canonicalPath
    || realpathSync(configuredSdkRoot) !== policy.sdk.canonicalPath
  ) {
    throw new Error("caller-reviewed compiler or SDK canonical path changed");
  }
  const compilerDigest = await sha256File(compilerPath);
  const sdkSettingsDigest = `sha256:${createHash("sha256")
    .update(readFileSync(path.join(sdkRoot, "SDKSettings.json")))
    .digest("hex")}`;
  if (
    compilerDigest !== policy.compiler.digest
    || sdkSettingsDigest !== policy.sdk.settingsDigest
  ) {
    throw new Error("caller-reviewed compiler or SDK digest changed");
  }
  return { compilerDigest, sdkSettingsDigest };
}

function resolveXcrun(args) {
  const result = spawnSync("/usr/bin/xcrun", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.signal || result.status !== 0) {
    throw new Error(
      `/usr/bin/xcrun failed${result.signal ? ` with ${result.signal}` : ` with ${result.status}`}`
      + `${result.stderr ? `: ${result.stderr.trim()}` : ""}`,
    );
  }
  return result.stdout.trim();
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return `sha256:${hash.digest("hex")}`;
}
