import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const EXPECTED_SAFE_FS_COMPILER = Object.freeze({
  configuredPath: "/Library/Developer/CommandLineTools/usr/bin/clang",
  canonicalPath: "/Library/Developer/CommandLineTools/usr/bin/clang",
  digest: "sha256:f30550eab15fdf5ab8c0dc54c52679711241e5d4b636b027e18c09fef531775d",
});

export const EXPECTED_SAFE_FS_SDK = Object.freeze({
  configuredPath: "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk",
  canonicalPath: "/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk",
  settingsDigest:
    "sha256:f8d005f09381389167f9e0aeaa169bc9e7dff162ef22ca2fd8e98df7ff1acafe",
});

export const EXPECTED_SAFE_FS_HELPER_DIGEST =
  "sha256:58b2493f585d2bc814ff44092fdde3b3debb793ea715a4a14b7fc638b0c04ad6";

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
