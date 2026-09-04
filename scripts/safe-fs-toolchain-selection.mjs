import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const EXPECTED_SAFE_FS_COMPILER = Object.freeze({
  configuredPath: "/Library/Developer/CommandLineTools/usr/bin/clang",
  canonicalPath: "/Library/Developer/CommandLineTools/usr/bin/clang",
  digest: "sha256:60468f3efd513d53f6ce581ec8d00595855ebf5a31a496d685b91c104aee1ca0",
});

export const EXPECTED_SAFE_FS_SDK = Object.freeze({
  configuredPath: "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk",
  canonicalPath: "/Library/Developer/CommandLineTools/SDKs/MacOSX15.2.sdk",
  settingsDigest:
    "sha256:2fa5c0ce1bbcd261b132b572b1a9eece3b5905b04640a44deae1a6a8812928fb",
});

export const EXPECTED_SAFE_FS_HELPER_DIGEST =
  "sha256:8a01c653cc58e82a71001dacf3dcc1624565d021";

export const SAFE_FS_TOOLCHAIN_POLICY_NAME =
  ".v392-pinned-safe-fs-toolchain.json";

export function loadPinnedSafeFsToolchainPolicy(root) {
  const policyPath = path.join(
    path.dirname(root),
    SAFE_FS_TOOLCHAIN_POLICY_NAME,
  );
  if (!existsSync(policyPath)) return null;
  const policy = JSON.parse(readFileSync(policyPath, "utf8"));
  const { digest, ...digestInput } = policy;
  const expectedShape = {
    schemaVersion: 1,
    kind: "v3.9.2-pinned-safe-fs-toolchain",
    compiler: EXPECTED_SAFE_FS_COMPILER,
    sdk: EXPECTED_SAFE_FS_SDK,
    safeFsHelperDigest: EXPECTED_SAFE_FS_HELPER_DIGEST,
  };
  if (
    JSON.stringify(digestInput) !== JSON.stringify(expectedShape)
    || digest !== hashCanonicalSafeFsToolchainPolicy(digestInput)
  ) {
    throw new Error("caller-owned safe-fs toolchain policy is invalid");
  }
  return policy;
}

export function selectSafeFsToolchain({
  policy,
  environment,
  resolveXcrun,
}) {
  const configuredCompiler = policy
    ? environment.CC?.trim() || policy.compiler.configuredPath
    : resolveXcrun(["--find", "clang"]);
  if (policy && configuredCompiler !== policy.compiler.configuredPath) {
    throw new Error("CC differs from the caller-reviewed compiler path");
  }
  if (!path.isAbsolute(configuredCompiler)) {
    throw new Error("CC must resolve to an absolute compiler path");
  }

  const configuredSdkRoot = policy
    ? environment.SDKROOT?.trim() || policy.sdk.configuredPath
    : resolveXcrun(["--show-sdk-path"]);
  if (policy && configuredSdkRoot !== policy.sdk.configuredPath) {
    throw new Error("SDKROOT differs from the caller-reviewed SDK path");
  }
  if (!path.isAbsolute(configuredSdkRoot)) {
    throw new Error("SDKROOT must resolve to an absolute SDK path");
  }

  return { configuredCompiler, configuredSdkRoot };
}

export function hashCanonicalSafeFsToolchainPolicy(value) {
  return `sha256:${createHash("sha256")
    .update(Buffer.from(canonicalJson(value)))
    .digest("hex")}`;
}

function canonicalJson(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
