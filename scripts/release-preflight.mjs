import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  readSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { blake2b } from "@noble/hashes/blake2.js";
import { parse } from "yaml";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRootDir = resolve(dirname(scriptPath), "..");
const productName = "Zerox Agent";
const githubPublisher = {
  provider: "github",
  owner: "ZeroxZhang",
  repo: "zerox-agent",
  releaseType: "release",
};
const systemCommand = {
  codesign: "/usr/bin/codesign",
  ditto: "/usr/bin/ditto",
  git: "/usr/bin/git",
  hdiutil: "/usr/bin/hdiutil",
  plistBuddy: "/usr/libexec/PlistBuddy",
  security: "/usr/bin/security",
  spctl: "/usr/sbin/spctl",
  stapler: "/usr/bin/stapler",
};

export class ReleasePreflightError extends Error {
  constructor(errors) {
    super(`Release preflight failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
    this.name = "ReleasePreflightError";
    this.errors = errors;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function sha512Base64(filePath) {
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("base64");
}

function isInsideDirectory(rootPath, candidatePath) {
  const relativePath = relative(rootPath, candidatePath);
  return (
    relativePath === "" ||
    (!isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith(`..${sep}`))
  );
}

export async function createAppBundleDigest(appPath) {
  const rootStat = lstatSync(appPath);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("application bundle root must be a physical directory");
  }

  const physicalRoot = realpathSync(appPath);
  const hash = createHash("sha512");

  async function walk(directoryPath, relativeDirectory = "") {
    const names = readdirSync(directoryPath).sort((left, right) => left.localeCompare(right));
    for (const name of names) {
      const filePath = join(directoryPath, name);
      const relativePath = relativeDirectory ? join(relativeDirectory, name) : name;
      const stat = lstatSync(filePath);
      const mode = stat.mode & 0o777;

      if (stat.isSymbolicLink()) {
        const target = readlinkSync(filePath);
        const resolvedTarget = realpathSync(filePath);
        if (!isInsideDirectory(physicalRoot, resolvedTarget)) {
          throw new Error(`application bundle symlink escapes its root: ${relativePath}`);
        }
        hash.update(JSON.stringify(["symlink", relativePath, mode, target]));
        continue;
      }
      if (stat.isDirectory()) {
        hash.update(JSON.stringify(["directory", relativePath, mode]));
        await walk(filePath, relativePath);
        continue;
      }
      if (!stat.isFile()) {
        throw new Error(`application bundle contains an unsupported entry: ${relativePath}`);
      }

      hash.update(JSON.stringify(["file", relativePath, mode, stat.size]));
      for await (const chunk of createReadStream(filePath)) {
        hash.update(chunk);
      }
    }
  }

  await walk(appPath);
  return hash.digest("base64");
}

function readYaml(filePath, errors, label) {
  if (!existsSync(filePath)) {
    errors.push(`${label} is missing: ${filePath}`);
    return null;
  }

  try {
    return parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    errors.push(`${label} is invalid YAML: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function readPackageVersion(rootDir, errors) {
  const packagePath = join(rootDir, "package.json");
  try {
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
    if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
      errors.push("package.json must declare a non-empty version");
      return null;
    }
    return packageJson.version;
  } catch (error) {
    errors.push(`package.json cannot be read: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function expectedAppDirectory(releaseDir, arch) {
  if (arch === "x64") return join(releaseDir, "mac", `${productName}.app`);
  return join(releaseDir, `mac-${arch}`, `${productName}.app`);
}

function validateBlockmap(blockmapPath, assetSize, url, errors) {
  if (!existsSync(blockmapPath) || statSync(blockmapPath).size === 0) {
    errors.push(`${url}.blockmap is missing or empty`);
    return;
  }

  try {
    const blockmap = JSON.parse(gunzipSync(readFileSync(blockmapPath)).toString("utf8"));
    if (
      blockmap.version !== "2" ||
      !Array.isArray(blockmap.files) ||
      blockmap.files.length !== 1 ||
      blockmap.files[0]?.name !== "file"
    ) {
      errors.push(`${url}.blockmap must contain the canonical single v2 file entry`);
      return;
    }

    let coveredEnd = 0;
    const descriptor = blockmap.files[0];
    for (const file of blockmap.files) {
      if (
        !Number.isSafeInteger(file?.offset) ||
        file.offset < 0 ||
        !Array.isArray(file.sizes) ||
        !Array.isArray(file.checksums) ||
        file.sizes.length === 0 ||
        file.sizes.length !== file.checksums.length ||
        file.sizes.some(
          (size) => !Number.isSafeInteger(size) || size <= 0 || size > 32 * 1024,
        ) ||
        file.checksums.some(
          (checksum) =>
            typeof checksum !== "string" || !/^[A-Za-z0-9+/]{24}$/.test(checksum),
        )
      ) {
        errors.push(`${url}.blockmap contains an invalid file entry`);
        return;
      }
      if (file.offset !== coveredEnd) {
        errors.push(
          `${url}.blockmap has a gap or overlap at byte ${coveredEnd} (next offset ${file.offset})`,
        );
        return;
      }
      coveredEnd += file.sizes.reduce((sum, size) => sum + size, 0);
    }

    if (coveredEnd !== assetSize) {
      errors.push(`${url}.blockmap covers ${coveredEnd} bytes instead of ${assetSize}`);
      return;
    }

    const assetPath = blockmapPath.slice(0, -".blockmap".length);
    const descriptorHandle = openSync(assetPath, "r");
    try {
      let position = 0;
      for (let index = 0; index < descriptor.sizes.length; index += 1) {
        const size = descriptor.sizes[index];
        const chunk = Buffer.allocUnsafe(size);
        let bytesRead = 0;
        while (bytesRead < size) {
          const count = readSync(
            descriptorHandle,
            chunk,
            bytesRead,
            size - bytesRead,
            position + bytesRead,
          );
          if (count === 0) throw new Error(`unexpected end of file at byte ${position + bytesRead}`);
          bytesRead += count;
        }
        const checksum = Buffer.from(blake2b(chunk, { dkLen: 18 })).toString("base64");
        if (checksum !== descriptor.checksums[index]) {
          errors.push(`${url}.blockmap checksum mismatch at chunk ${index}`);
          return;
        }
        position += size;
      }
    } finally {
      closeSync(descriptorHandle);
    }
  } catch (error) {
    errors.push(
      `${url}.blockmap is not valid gzip-compressed JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function inspectReleaseArtifacts(rootDir = defaultRootDir) {
  const errors = [];
  const version = readPackageVersion(rootDir, errors);
  const releaseDir = join(rootDir, "release");
  const metadataPath = join(releaseDir, "latest-mac.yml");
  const metadata = readYaml(metadataPath, errors, "latest-mac.yml");
  const assets = [];

  if (metadata && version) {
    if (metadata.version !== version) {
      errors.push(`latest-mac.yml version ${String(metadata.version)} does not match package version ${version}`);
    }

    if (!Array.isArray(metadata.files) || metadata.files.length !== 2) {
      errors.push("latest-mac.yml must contain exactly one ZIP and one DMG file entry");
    } else {
      const assetPattern = new RegExp(
        `^Zerox-Agent-${escapeRegExp(version)}-(arm64|x64|universal)\\.(zip|dmg)$`,
      );
      const extensions = new Set();
      const architectures = new Set();

      for (const entry of metadata.files) {
        const url = typeof entry?.url === "string" ? entry.url : "";
        const match = assetPattern.exec(url);
        if (!match) {
          errors.push(
            `release asset URL must use the updater-safe name Zerox-Agent-${version}-<arch>.<zip|dmg>: ${url || "<missing>"}`,
          );
          continue;
        }

        const [, arch, extension] = match;
        extensions.add(extension);
        architectures.add(arch);
        const filePath = join(releaseDir, url);
        const blockmapPath = `${filePath}.blockmap`;

        if (!existsSync(filePath)) {
          errors.push(`metadata references a missing release asset: ${url}`);
          continue;
        }

        const size = statSync(filePath).size;
        if (entry.size !== size) {
          errors.push(`${url} size mismatch: metadata=${String(entry.size)}, actual=${size}`);
        }

        const sha512 = await sha512Base64(filePath);
        if (entry.sha512 !== sha512) {
          errors.push(`${url} SHA-512 does not match latest-mac.yml`);
        }

        validateBlockmap(blockmapPath, size, url, errors);

        assets.push({ arch, extension, filePath, url, sha512, size, blockmapPath });
      }

      if (!extensions.has("zip") || !extensions.has("dmg")) {
        errors.push("latest-mac.yml must reference both ZIP and DMG assets");
      }
      if (architectures.size !== 1) {
        errors.push("latest-mac.yml ZIP and DMG entries must target the same architecture");
      }

      const zip = assets.find((asset) => asset.extension === "zip");
      if (zip && (metadata.path !== zip.url || metadata.sha512 !== zip.sha512)) {
        errors.push("latest-mac.yml top-level path and SHA-512 must match the ZIP entry");
      }
    }
  }

  if (errors.length > 0) throw new ReleasePreflightError(errors);

  const arch = assets[0]?.arch;
  return {
    assets,
    appPath: expectedAppDirectory(releaseDir, arch),
    metadataPath,
    releaseDir,
    version,
  };
}

function run(command, args, { allowFailure = false, env = process.env } = {}) {
  const result = spawnSync(command, args, {
    cwd: defaultRootDir,
    encoding: "utf8",
    env,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();

  if (result.error) {
    if (allowFailure) return { ok: false, output: result.error.message };
    throw new Error(`${command} could not run: ${result.error.message}`);
  }
  if (result.status !== 0) {
    if (allowFailure) return { ok: false, output };
    throw new Error(`${command} ${args.join(" ")} failed${output ? `: ${output}` : ""}`);
  }
  return { ok: true, output };
}

function sanitizedGitEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  return env;
}

function runGit(args) {
  return run(
    systemCommand.git,
    [
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.untrackedCache=false",
      "-C",
      defaultRootDir,
      ...args,
    ],
    {
      allowFailure: true,
      env: sanitizedGitEnvironment(),
    },
  );
}

function assertCommand(errors, command, args, label) {
  const result = run(command, args, { allowFailure: true });
  if (!result.ok) errors.push(`${label} failed${result.output ? `: ${result.output}` : ""}`);
  return result;
}

function validatePublisherConfig(filePath, errors, label) {
  const config = readYaml(filePath, errors, `${label} app-update.yml`);
  if (!config) return;

  for (const [key, expected] of Object.entries(githubPublisher)) {
    if (config[key] !== expected) {
      errors.push(`${label} app-update.yml ${key} must be ${expected}`);
    }
  }
}

async function validatePackagedApp({
  appPath,
  errors,
  expectedIntegrity,
  label,
  manifest,
  teamId,
}) {
  if (!existsSync(appPath)) {
    errors.push(`${label} is missing: ${appPath}`);
    return null;
  }

  try {
    await createAppBundleDigest(appPath);
  } catch (error) {
    errors.push(
      `${label} bundle integrity inspection failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }

  const plistPath = join(appPath, "Contents", "Info.plist");
  const plistVersion = assertCommand(
    errors,
    systemCommand.plistBuddy,
    ["-c", "Print :CFBundleShortVersionString", plistPath],
    `${label} Info.plist version read`,
  );
  if (plistVersion.ok && plistVersion.output !== manifest.version) {
    errors.push(`${label} version ${plistVersion.output} does not match ${manifest.version}`);
  }
  const bundleIdentifier = assertCommand(
    errors,
    systemCommand.plistBuddy,
    ["-c", "Print :CFBundleIdentifier", plistPath],
    `${label} bundle identifier read`,
  );
  if (bundleIdentifier.ok && bundleIdentifier.output !== "local.zerox.agent.desktop") {
    errors.push(`${label} bundle identifier must be local.zerox.agent.desktop`);
  }

  validatePublisherConfig(
    join(appPath, "Contents", "Resources", "app-update.yml"),
    errors,
    label,
  );
  assertCommand(
    errors,
    systemCommand.codesign,
    ["--verify", "--deep", "--strict", "--verbose=2", appPath],
    `${label} Developer ID signature verification`,
  );
  const signature = assertCommand(
    errors,
    systemCommand.codesign,
    ["-dv", "--verbose=4", appPath],
    `${label} signature authority inspection`,
  );
  if (signature.ok) {
    if (!signature.output.includes("Identifier=local.zerox.agent.desktop")) {
      errors.push(`${label} signed identifier must be local.zerox.agent.desktop`);
    }
    if (!signature.output.includes("Authority=Developer ID Application:")) {
      errors.push(`${label} is not signed with a Developer ID Application certificate`);
    }
    if (teamId && !signature.output.includes(`TeamIdentifier=${teamId}`)) {
      errors.push(`${label} signature TeamIdentifier does not match APPLE_TEAM_ID`);
    }
  }
  const cdHash = /^CDHash=([A-Fa-f0-9]+)$/m.exec(signature.output)?.[1]?.toLowerCase() ?? "";
  if (!cdHash) errors.push(`${label} signature does not expose a CDHash`);
  assertCommand(
    errors,
    systemCommand.spctl,
    ["--assess", "--type", "execute", "--verbose=4", appPath],
    `${label} Gatekeeper assessment`,
  );
  assertCommand(
    errors,
    systemCommand.stapler,
    ["validate", appPath],
    `${label} notarization ticket validation`,
  );

  const codeResourcesPath = join(appPath, "Contents", "_CodeSignature", "CodeResources");
  if (!existsSync(codeResourcesPath)) {
    errors.push(`${label} sealed CodeResources manifest is missing`);
    return null;
  }
  const codeResourcesSha512 = await sha512Base64(codeResourcesPath);
  if (
    expectedIntegrity &&
    (cdHash !== expectedIntegrity.cdHash ||
      codeResourcesSha512 !== expectedIntegrity.codeResourcesSha512)
  ) {
    errors.push(`${label} signed resource seal does not match the frozen packaged application`);
  }
  return { cdHash, codeResourcesSha512 };
}

export async function runReleasePreflight(rootDir = defaultRootDir) {
  if (process.platform !== "darwin") {
    throw new ReleasePreflightError(["macOS release preflight must run on macOS"]);
  }
  if (resolve(rootDir) !== defaultRootDir) {
    throw new ReleasePreflightError(["release preflight only accepts the repository root"]);
  }

  const manifest = await inspectReleaseArtifacts(rootDir);
  const errors = [];
  const teamId = process.env.APPLE_TEAM_ID?.trim() ?? "";
  if (!/^[A-Z0-9]{10}$/.test(teamId)) {
    errors.push("APPLE_TEAM_ID must identify the expected 10-character Apple Developer team");
  }

  const identity = run(systemCommand.security, ["find-identity", "-v", "-p", "codesigning"], {
    allowFailure: true,
  });
  const identityCount = Number(/(\d+) valid identities found/.exec(identity.output)?.[1] ?? 0);
  if (
    !identity.ok ||
    identityCount < 1 ||
    !identity.output.includes("Developer ID Application:") ||
    (teamId && !identity.output.includes(`(${teamId})`))
  ) {
    errors.push("no valid Developer ID Application identity for APPLE_TEAM_ID is available");
  }

  const gitRoot = runGit(["rev-parse", "--show-toplevel"]);
  if (!gitRoot.ok || resolve(gitRoot.output) !== defaultRootDir) {
    errors.push("trusted git repository root could not be verified");
  }
  const gitStatus = runGit(["status", "--porcelain", "--untracked-files=all"]);
  if (!gitStatus.ok) {
    errors.push(`git status failed${gitStatus.output ? `: ${gitStatus.output}` : ""}`);
  } else if (gitStatus.output.length > 0) {
    errors.push("the working tree has tracked or untracked changes; commit the frozen release tree");
  }
  const hiddenIndexEntries = runGit(["ls-files", "-v"]);
  if (!hiddenIndexEntries.ok) {
    errors.push(
      `git index flag inspection failed${hiddenIndexEntries.output ? `: ${hiddenIndexEntries.output}` : ""}`,
    );
  } else if (hiddenIndexEntries.output.split("\n").some((line) => /^[a-zS] /.test(line))) {
    errors.push("git index contains assume-unchanged or skip-worktree entries");
  }
  const ignoredPackageSources = runGit([
    "ls-files",
    "--others",
    "--ignored",
    "--exclude-standard",
    "--",
    "skills",
    "prompts",
  ]);
  if (!ignoredPackageSources.ok) {
    errors.push(
      `ignored package-source inspection failed${ignoredPackageSources.output ? `: ${ignoredPackageSources.output}` : ""}`,
    );
  } else if (ignoredPackageSources.output.length > 0) {
    errors.push("ignored untracked files exist under packaged skills/ or prompts/ directories");
  }

  const frozenIntegrity = await validatePackagedApp({
    appPath: manifest.appPath,
    errors,
    label: "packaged application",
    manifest,
    teamId,
  });

  const temporaryDir = mkdtempSync(join(tmpdir(), "zerox-release-preflight-"));
  try {
    const zipAsset = manifest.assets.find((asset) => asset.extension === "zip");
    const zipDirectory = join(temporaryDir, "zip");
    mkdirSync(zipDirectory);
    const extraction = assertCommand(
      errors,
      systemCommand.ditto,
      ["-x", "-k", zipAsset.filePath, zipDirectory],
      `${zipAsset.url} extraction`,
    );
    if (extraction.ok) {
      await validatePackagedApp({
        appPath: join(zipDirectory, `${productName}.app`),
        errors,
        expectedIntegrity: frozenIntegrity,
        label: `${zipAsset.url} application`,
        manifest,
        teamId,
      });
    }

    const dmgAsset = manifest.assets.find((asset) => asset.extension === "dmg");
    assertCommand(
      errors,
      systemCommand.hdiutil,
      ["verify", dmgAsset.filePath],
      `${dmgAsset.url} disk image verification`,
    );
    assertCommand(
      errors,
      systemCommand.spctl,
      [
        "--assess",
        "--type",
        "open",
        "--context",
        "context:primary-signature",
        "--verbose=4",
        dmgAsset.filePath,
      ],
      `${dmgAsset.url} Gatekeeper assessment`,
    );
    assertCommand(
      errors,
      systemCommand.stapler,
      ["validate", dmgAsset.filePath],
      `${dmgAsset.url} notarization ticket validation`,
    );
    const mountPoint = join(temporaryDir, "dmg");
    mkdirSync(mountPoint);
    const attached = assertCommand(
      errors,
      systemCommand.hdiutil,
      ["attach", "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", mountPoint, dmgAsset.filePath],
      `${dmgAsset.url} read-only mount`,
    );
    if (attached.ok) {
      try {
        await validatePackagedApp({
          appPath: join(mountPoint, `${productName}.app`),
          errors,
          expectedIntegrity: frozenIntegrity,
          label: `${dmgAsset.url} application`,
          manifest,
          teamId,
        });
      } finally {
        assertCommand(
          errors,
          systemCommand.hdiutil,
          ["detach", mountPoint],
          `${dmgAsset.url} detach`,
        );
      }
    }
  } finally {
    rmSync(temporaryDir, { force: true, recursive: true });
  }

  if (errors.length > 0) throw new ReleasePreflightError(errors);
  return manifest;
}

async function main() {
  try {
    const manifest = await runReleasePreflight();
    console.log(`Release preflight passed for Zerox Agent v${manifest.version}.`);
    for (const asset of manifest.assets) {
      console.log(`${asset.url} ${asset.size} bytes sha512=${asset.sha512}`);
      console.log(`${asset.url}.blockmap`);
    }
    console.log("latest-mac.yml");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  await main();
}
