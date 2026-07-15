import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRootDir = resolve(dirname(scriptPath), "..");
const manifestDomain = Buffer.from(
  "ZEROX_AGENT_UPDATE_MANIFEST\0V2\0ZeroxZhang/zerox-agent\0darwin\0stable\0",
  "utf8",
);
const signatureLifetimeMs = 365 * 24 * 60 * 60 * 1000;

function isInsideDirectory(rootPath, candidatePath) {
  const relativePath = relative(rootPath, candidatePath);
  return (
    relativePath === "" ||
    (!isAbsolute(relativePath) &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`))
  );
}

function readPrivateKey(rootDir, env) {
  if (env.ZEROX_UPDATE_SIGNING_PRIVATE_KEY?.trim()) {
    throw new Error(
      "inline update signing keys are forbidden; use ZEROX_UPDATE_SIGNING_PRIVATE_KEY_FILE",
    );
  }
  const keyFile = env.ZEROX_UPDATE_SIGNING_PRIVATE_KEY_FILE?.trim() ?? "";
  if (!keyFile || !isAbsolute(keyFile)) {
    throw new Error(
      "ZEROX_UPDATE_SIGNING_PRIVATE_KEY_FILE must be an absolute path outside the repository",
    );
  }
  const stat = lstatSync(keyFile);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("update signing private key must be a regular non-symlink file");
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new Error("update signing private key permissions must be 0600 or stricter");
  }
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new Error("update signing private key must be owned by the current user");
  }
  const realKeyPath = realpathSync(keyFile);
  const realRootDir = realpathSync(rootDir);
  if (isInsideDirectory(realRootDir, realKeyPath)) {
    throw new Error("update signing private key must stay outside the repository");
  }
  return readFileSync(realKeyPath, "utf8");
}

function sequenceForVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error("update manifest must declare a stable semantic version");
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part) || part > 999)) {
    throw new Error("update manifest version exceeds the monotonic sequence range");
  }
  return parts[0] * 1_000_000 + parts[1] * 1_000 + parts[2];
}

export function createUpdateManifestSignatureMessage({
  keyId,
  tag,
  sequence,
  issuedAt,
  expiresAt,
  manifestBytes,
}) {
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(manifestBytes.length));
  return Buffer.concat([
    manifestDomain,
    Buffer.from(
      `${keyId}\0${tag}\0${sequence}\0${issuedAt}\0${expiresAt}\0`,
      "utf8",
    ),
    length,
    manifestBytes,
  ]);
}

export function signUpdateManifest({
  rootDir = defaultRootDir,
  env = process.env,
  now = new Date(),
} = {}) {
  const manifestPath = join(rootDir, "release", "latest-mac.yml");
  const signaturePath = `${manifestPath}.sig`;
  const publicKeyPath = join(rootDir, "build", "update-signing-public-key.pem");
  if (!existsSync(manifestPath)) {
    throw new Error(`update manifest is missing: ${manifestPath}`);
  }
  if (!Number.isFinite(now.getTime())) {
    throw new Error("update manifest signing time is invalid");
  }

  const privateKey = createPrivateKey(readPrivateKey(rootDir, env));
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("update signing private key must use Ed25519");
  }
  const trackedPublicKey = createPublicKey(readFileSync(publicKeyPath));
  const derivedPublicKey = createPublicKey(privateKey);
  const trackedDer = trackedPublicKey.export({ format: "der", type: "spki" });
  const derivedDer = derivedPublicKey.export({ format: "der", type: "spki" });
  if (!trackedDer.equals(derivedDer)) {
    throw new Error("update signing private key does not match the tracked public key");
  }

  const manifestBytes = readFileSync(manifestPath);
  const keyId = createHash("sha256").update(trackedDer).digest("hex").slice(0, 32);
  const manifest = parse(manifestBytes.toString("utf8"));
  const version = typeof manifest?.version === "string" ? manifest.version.trim() : "";
  const sequence = sequenceForVersion(version);
  const tag = `v${version}`;
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + signatureLifetimeMs).toISOString();
  const message = createUpdateManifestSignatureMessage({
    keyId,
    tag,
    sequence,
    issuedAt,
    expiresAt,
    manifestBytes,
  });
  const signature = sign(null, message, privateKey);
  if (signature.length !== 64 || !verify(null, message, trackedPublicKey, signature)) {
    throw new Error("generated update manifest signature could not be verified");
  }
  const manifestSha512 = createHash("sha512")
    .update(manifestBytes)
    .digest("base64");
  const envelope = {
    schema: 2,
    algorithm: "ed25519",
    keyId,
    tag,
    sequence,
    issuedAt,
    expiresAt,
    manifestSha512,
    signature: signature.toString("base64"),
  };
  writeFileSync(signaturePath, `${JSON.stringify(envelope, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o644,
  });
  return { envelope, manifestPath, signaturePath };
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const result = signUpdateManifest();
  console.log(`Signed latest-mac.yml with update key ${result.envelope.keyId}.`);
}
