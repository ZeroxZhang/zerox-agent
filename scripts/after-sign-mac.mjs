import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
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
  const pathExists = dependencies.existsSync ?? existsSync;
  const codesignRunner = dependencies.runCodesign ?? runCodesign;
  if (releaseMode !== legacyReleaseMode) return;
  if (context.electronPlatformName !== "darwin") return;

  const productFilename = context.packager?.appInfo?.productFilename;
  if (typeof productFilename !== "string" || productFilename.length === 0) {
    throw new Error("legacy ad-hoc signing requires the packaged product filename");
  }

  const appPath = join(context.appOutDir, `${productFilename}.app`);
  if (!pathExists(appPath)) {
    throw new Error(`legacy ad-hoc signing cannot find ${appPath}`);
  }

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
