import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";

export const legacyReleaseMode = "legacy-adhoc";
export const legacyDesignatedRequirement =
  'identifier "local.zerox.agent.desktop"';

function runCodesign(args) {
  return spawnSync("/usr/bin/codesign", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runCommand(command, args) {
  return spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function commandOutput(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
}

function assertCodesign(args, label, runner = runCodesign) {
  const result = runner(args);
  if (result.error || result.status !== 0) {
    const output = commandOutput(result);
    throw new Error(
      `${label} failed${output ? `: ${output}` : result.error ? `: ${result.error.message}` : ""}`,
    );
  }
  return commandOutput(result);
}

function assertCommand(command, args, label, runner = runCommand) {
  const result = runner(command, args);
  if (result.error || result.status !== 0) {
    const output = commandOutput(result);
    throw new Error(
      `${label} failed${output ? `: ${output}` : result.error ? `: ${result.error.message}` : ""}`,
    );
  }
  return commandOutput(result);
}

function assertSafeFsHelper(appPath, dependencies = {}) {
  const pathExists = dependencies.existsSync ?? existsSync;
  const readMetadata = dependencies.lstatSync ?? lstatSync;
  const resolveRealpath = dependencies.realpathSync ?? realpathSync;
  const commandRunner = dependencies.runCommand ?? runCommand;
  const codesignRunner = dependencies.runCodesign ?? runCodesign;
  const helperPath = join(
    appPath,
    "Contents",
    "Resources",
    "safe-fs",
    "zerox-safe-fs",
  );
  if (!pathExists(helperPath)) {
    throw new Error(`packaged safe-fs helper is missing: ${helperPath}`);
  }
  const metadata = readMetadata(helperPath);
  if (
    !metadata.isFile()
    || metadata.isSymbolicLink()
    || (metadata.mode & 0o777) !== 0o755
    || resolveRealpath(helperPath) !== helperPath
  ) {
    throw new Error("packaged safe-fs helper must be a canonical 0755 regular file");
  }
  const fileOutput = assertCommand(
    "/usr/bin/file",
    [helperPath],
    "safe-fs architecture inspection",
    commandRunner,
  );
  if (!/Mach-O 64-bit executable (?:arm64|x86_64)\b/.test(fileOutput)) {
    throw new Error(`packaged safe-fs helper architecture is invalid: ${fileOutput}`);
  }
  const loadCommands = assertCommand(
    "/usr/bin/otool",
    ["-l", helperPath],
    "safe-fs deployment-target inspection",
    commandRunner,
  );
  if (!/cmd LC_BUILD_VERSION[\s\S]*?minos 12\.0(?:\.0)?\b/.test(loadCommands)) {
    throw new Error("packaged safe-fs helper does not require macOS 12.0");
  }
  const libraries = assertCommand(
    "/usr/bin/otool",
    ["-L", helperPath],
    "safe-fs linked-library inspection",
    commandRunner,
  ).split("\n").slice(1).map((line) => line.trim()).filter(Boolean);
  const unexpectedLibraries = libraries.filter(
    (line) => !line.startsWith("/usr/lib/libSystem.B.dylib "),
  );
  if (unexpectedLibraries.length > 0) {
    throw new Error(
      `packaged safe-fs helper has unexpected libraries: ${unexpectedLibraries.join(", ")}`,
    );
  }
  assertCodesign(
    ["--verify", "--strict", "--verbose=2", helperPath],
    "safe-fs signature verification",
    codesignRunner,
  );
  const signature = assertCodesign(
    ["-dv", "--verbose=4", helperPath],
    "safe-fs signature metadata inspection",
    codesignRunner,
  );
  if (!/flags=.*\bruntime\b/.test(signature)) {
    throw new Error("packaged safe-fs helper signature lacks hardened runtime");
  }
  const entitlements = assertCodesign(
    ["-d", "--entitlements", ":-", helperPath],
    "safe-fs entitlement inspection",
    codesignRunner,
  );
  if (!/<dict>\s*<\/dict>/.test(entitlements) || /<key>/.test(entitlements)) {
    throw new Error("packaged safe-fs helper must have an empty entitlement set");
  }
}

/**
 * Developer ID remains the default release path. The explicit compatibility
 * mode re-signs only the outer bundle with a stable, version-independent
 * designated requirement after electron-builder has sealed all nested code.
 * Squirrel.Mac uses this requirement for cross-version bundle continuity;
 * publisher authentication is provided separately by the Ed25519 manifest.
 */
export default async function afterSignMac(context, dependencies = {}) {
  const releaseMode =
    dependencies.releaseMode ?? process.env.ZEROX_RELEASE_MODE?.trim();
  if (context.electronPlatformName !== "darwin") return;

  const pathExists = dependencies.existsSync ?? existsSync;
  const codesignRunner = dependencies.runCodesign ?? runCodesign;
  const productFilename = context.packager?.appInfo?.productFilename;
  if (typeof productFilename !== "string" || productFilename.length === 0) {
    throw new Error("macOS signing requires the packaged product filename");
  }

  const appPath = join(context.appOutDir, `${productFilename}.app`);
  if (!pathExists(appPath)) {
    throw new Error(`macOS signing cannot find ${appPath}`);
  }
  const verifyHelper = dependencies.verifySafeFsHelper ?? assertSafeFsHelper;
  await verifyHelper(appPath, dependencies);
  if (releaseMode !== legacyReleaseMode) return;

  assertCodesign(
    [
      "--force",
      "--sign",
      "-",
      "--timestamp=none",
      "--preserve-metadata=identifier,entitlements,flags,runtime",
      "--requirements",
      `=designated => ${legacyDesignatedRequirement}`,
      appPath,
    ],
    "legacy ad-hoc outer-bundle signing",
    codesignRunner,
  );
  assertCodesign(
    ["--verify", "--deep", "--strict", "--verbose=2", appPath],
    "legacy ad-hoc signature verification",
    codesignRunner,
  );
  const requirement = assertCodesign(
    ["-d", "-r-", appPath],
    "legacy ad-hoc designated requirement inspection",
    codesignRunner,
  );
  if (!requirement.includes(`designated => ${legacyDesignatedRequirement}`)) {
    throw new Error(
      `legacy ad-hoc designated requirement is not stable: ${requirement}`,
    );
  }
}
