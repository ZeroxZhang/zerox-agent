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
    "sha256:f77fa0f917f92e2765fb66a384b9ce1979b9359770fc14ba60b74326a8e8de6f",
});

export const EXPECTED_SAFE_FS_HELPER_DIGEST =
  "sha256:302f899cdbc241230e7f66ef586a686acc108d5b667a301195fd579bd6cb7af9";

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
